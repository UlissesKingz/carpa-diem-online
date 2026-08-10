const crypto = require('node:crypto');

const DEFAULT_DB_NAME = 'carpas_online';
const DEFAULT_ROOM_TTL_HOURS = 72;
const DEFAULT_HEARTBEAT_MS = 15000;

let client = null;
let database = null;
let enabled = false;
let lastError = null;
let serverInstanceId = null;
const roomWriteQueues = new Map();

const RANKING_MODES = ['solo', '2', '3', '4'];
// Nova temporada de ranking após a redução da partida para 5 rodadas.
// Alterar esta chave no futuro permite reiniciar os recordes sem misturar regras antigas.
const RANKING_VERSION = '5-rounds-v1';

function rankingModeForRoom(room) {
  if (room?.mode === 'solo') return 'solo';
  const count = Number(room?.playerOrder?.length || 0);
  return ['2', '3', '4'].includes(String(count)) ? String(count) : null;
}

function rankingLabel(mode) {
  if (mode === 'solo') return 'Solo';
  return `${mode} jogadores`;
}

function isBetterRankingResult(candidate, current) {
  if (!current) return true;
  if (candidate.score !== current.score) return candidate.score > current.score;
  return candidate.coins > current.coins;
}

function rankingResultEntries(room) {
  const ranking = room?.winner?.ranking || [];
  return ranking.map((entry) => {
    const player = room.players?.[entry.playerId];
    return {
      roomPlayerId: entry.playerId,
      rankingPlayerId: player?.rankingPlayerId || `legacy-${room.matchId || room.code}-${entry.playerId}`,
      nickname: String(player?.name || 'Jogador').trim().slice(0, 24) || 'Jogador',
      score: Number(entry.score || 0),
      coins: Number(entry.coins || 0)
    };
  });
}

function publicRankingRecord(record) {
  if (!record) return null;
  return {
    nickname: record.nickname,
    score: Number(record.score || 0),
    coins: Number(record.coins || 0)
  };
}


function enqueueRoomWrite(code, operation) {
  const previous = roomWriteQueues.get(code) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  roomWriteQueues.set(code, next);
  return next.finally(() => {
    if (roomWriteQueues.get(code) === next) roomWriteQueues.delete(code);
  });
}

function cleanRoomForStorage(room) {
  const snapshot = JSON.parse(JSON.stringify(room));
  for (const player of Object.values(snapshot.players || {})) player.socketId = null;
  for (const spectator of Object.values(snapshot.spectators || {})) spectator.socketId = null;
  return snapshot;
}

function restoreRoom(document) {
  const room = { ...document };
  delete room._id;
  delete room.expireAt;
  delete room.updatedAtDate;

  for (const player of Object.values(room.players || {})) {
    player.socketId = null;
    player.connected = false;
  }
  for (const spectator of Object.values(room.spectators || {})) {
    spectator.socketId = null;
    spectator.connected = false;
  }

  if (room.phase === 'circulation' && room.circulation) {
    const elapsed = Date.now() - Number(room.circulation.startedAt || Date.now());
    room.circulation.remainingMs = room.circulation.paused
      ? Number(room.circulation.remainingMs ?? room.circulation.durationMs)
      : Math.max(0, Number(room.circulation.durationMs || 0) - elapsed);
    room.circulation.paused = true;
  }
  return room;
}

function ensureAudit(room) {
  room.audit ||= {};
  room.audit.sessionId ||= `${room.code}-${room.createdAt || Date.now()}`;
  if (typeof room.audit.isEmpty !== 'boolean') room.audit.isEmpty = false;
  return room.audit;
}

function connectedMembers(room) {
  const players = room.playerOrder
    .map((id) => room.players[id])
    .filter(Boolean)
    .map((member) => ({
      memberId: member.id,
      name: member.name,
      role: 'player',
      color: member.color || null,
      connected: Boolean(member.connected)
    }));
  const spectators = Object.values(room.spectators || {}).map((member) => ({
    memberId: member.id,
    name: member.name,
    role: 'spectator',
    color: null,
    connected: Boolean(member.connected)
  }));
  return [...players, ...spectators];
}

function connectedCount(room) {
  return connectedMembers(room).filter((member) => member.connected).length;
}

function eventId() {
  return crypto.randomBytes(8).toString('hex');
}

function normalizeEvent(event = {}) {
  const at = event.at instanceof Date ? event.at : new Date(event.at || Date.now());
  return {
    id: event.id || eventId(),
    at,
    type: event.type || 'event',
    message: String(event.message || ''),
    memberId: event.memberId || null,
    name: event.name || null,
    role: event.role || null,
    color: event.color || null,
    reason: event.reason || null,
    metadata: event.metadata || null
  };
}

function mergeParticipant(participants, event) {
  if (!event.memberId && !event.name) return participants;
  const key = event.memberId || `${event.role || 'unknown'}:${String(event.name).toLocaleLowerCase('pt-BR')}`;
  const index = participants.findIndex((participant) => participant.key === key || (event.memberId && participant.memberId === event.memberId));
  const now = event.at;
  const existing = index >= 0 ? participants[index] : {
    key,
    memberId: event.memberId || null,
    name: event.name || 'Participante',
    role: event.role || 'player',
    color: event.color || null,
    firstConnectedAt: now,
    lastConnectedAt: now,
    lastDisconnectedAt: null,
    connectionCount: 0,
    disconnectionCount: 0,
    voluntaryExitCount: 0
  };

  existing.name = event.name || existing.name;
  existing.role = event.role || existing.role;
  existing.color = event.color || existing.color || null;

  if (['participant_joined', 'participant_returned'].includes(event.type)) {
    existing.connectionCount += 1;
    existing.lastConnectedAt = now;
    existing.firstConnectedAt ||= now;
  }
  if (event.type === 'participant_disconnected') {
    existing.disconnectionCount += 1;
    existing.lastDisconnectedAt = now;
  }
  if (event.type === 'participant_left') {
    existing.voluntaryExitCount += 1;
    existing.lastDisconnectedAt = now;
  }

  if (index >= 0) participants[index] = existing;
  else participants.push(existing);
  return participants;
}

function buildMatchRecord(room) {
  const ranking = room.winner?.ranking || [];
  const players = ranking.map((entry, index) => {
    const player = room.players[entry.playerId];
    return {
      playerId: entry.playerId,
      name: player?.name || 'Jogador',
      color: player?.color || entry.color,
      score: entry.score,
      coins: entry.coins,
      placement: index + 1
    };
  });

  return {
    _id: room.matchId,
    matchId: room.matchId,
    roomCode: room.code,
    mode: room.mode || 'multiplayer',
    ruleset: room.ruleset || 'classic',
    sessionId: ensureAudit(room).sessionId,
    status: 'finished',
    startedAt: room.startedAt ? new Date(room.startedAt) : null,
    finishedAt: room.finishedAt ? new Date(room.finishedAt) : new Date(),
    durationMs: room.startedAt ? Math.max(0, Number(room.finishedAt || Date.now()) - room.startedAt) : null,
    round: room.round,
    restartCount: room.restartCount || 0,
    spectatorCount: Object.keys(room.spectators || {}).length,
    players,
    winnerPlayerIds: [...(room.winner?.playerIds || [])],
    winningScore: room.winner?.score ?? null,
    winningCoins: room.winner?.coins ?? null,
    finalScores: room.winner?.scores || {},
    byTank: room.winner?.byTank || {},
    soloResult: room.mode === 'solo' ? {
      score: room.winner?.soloScore ?? room.winner?.score ?? null,
      exitedPreferred: room.winner?.exitedPreferred ?? room.solo?.exitedPreferred ?? 0,
      remainingPreferred: room.winner?.remainingPreferred ?? null
    } : null,
    finalBoards: Object.fromEntries(room.playerOrder.map((id) => [id, room.players[id]?.board || null])),
    logs: [...(room.logs || [])],
    createdAt: new Date()
  };
}

async function initialize() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    enabled = false;
    return { enabled: false, reason: 'MONGODB_URI não configurada' };
  }

  try {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    database = client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);
    enabled = true;
    lastError = null;

    const activeRooms = database.collection('active_rooms');
    const matches = database.collection('match_records');
    const roomSessions = database.collection('room_sessions');
    const serverEvents = database.collection('server_events');
    const leaderboard = database.collection('leaderboard_records');

    await Promise.all([
      activeRooms.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      activeRooms.createIndex({ updatedAtDate: -1 }),
      matches.createIndex({ finishedAt: -1 }),
      matches.createIndex({ roomCode: 1, finishedAt: -1 }),
      roomSessions.createIndex({ openedAt: -1 }),
      roomSessions.createIndex({ roomCode: 1, openedAt: -1 }),
      roomSessions.createIndex({ status: 1, lastActivityAt: -1 }),
      serverEvents.createIndex({ at: -1 }),
      leaderboard.createIndex({ rankingVersion: 1, mode: 1, score: -1, coins: -1, achievedAt: 1 })
    ]);

    // Os recordes anteriores pertencem à versão de 6 rodadas e não são
    // comparáveis com a nova versão de 5 rodadas. A limpeza é idempotente:
    // em reinícios futuros, os registros da versão atual são preservados.
    await leaderboard.deleteMany({ rankingVersion: { $ne: RANKING_VERSION } });

    return { enabled: true, dbName: database.databaseName };
  } catch (error) {
    lastError = error;
    enabled = false;
    throw error;
  }
}

function status() {
  return {
    enabled,
    connected: Boolean(enabled && client),
    dbName: database?.databaseName || null,
    error: lastError?.message || null,
    serverInstanceId
  };
}

async function saveRoom(room) {
  if (!enabled || !database) return;
  const ttlHours = Math.max(1, Number(process.env.ROOM_TTL_HOURS || DEFAULT_ROOM_TTL_HOURS));
  ensureAudit(room);
  const document = cleanRoomForStorage(room);
  document._id = room.code;
  document.updatedAtDate = new Date();
  document.expireAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  return enqueueRoomWrite(room.code, () => database.collection('active_rooms').replaceOne({ _id: room.code }, document, { upsert: true }));
}

async function deleteRoom(code) {
  if (!enabled || !database) return;
  return enqueueRoomWrite(code, () => database.collection('active_rooms').deleteOne({ _id: code }));
}

async function loadRooms() {
  if (!enabled || !database) return [];
  const documents = await database.collection('active_rooms').find({}).toArray();
  return documents.map(restoreRoom);
}

async function openRoomSession(room, host) {
  if (!enabled || !database) return;
  const audit = ensureAudit(room);
  const openedAt = new Date(room.createdAt || Date.now());
  const openingEvent = normalizeEvent({
    at: openedAt,
    type: 'room_opened',
    message: `Sala ${room.code} aberta por ${host?.name || 'jogador'}.`,
    memberId: host?.id || null,
    name: host?.name || null,
    role: 'player',
    color: host?.color || null
  });
  const participants = [];
  mergeParticipant(participants, { ...openingEvent, type: 'participant_joined' });

  const document = {
    _id: audit.sessionId,
    sessionId: audit.sessionId,
    roomCode: room.code,
    status: 'open',
    openedAt,
    closedAt: null,
    finalClosedAt: null,
    lastActivityAt: openedAt,
    connectedCount: connectedCount(room),
    disconnectCount: 0,
    returnCount: 0,
    participants,
    events: [openingEvent]
  };
  await database.collection('room_sessions').replaceOne({ _id: audit.sessionId }, document, { upsert: true });
}

async function recordRoomEvent(room, eventInput) {
  if (!enabled || !database) return;
  const audit = ensureAudit(room);
  const event = normalizeEvent(eventInput);
  return enqueueRoomWrite(`session:${audit.sessionId}`, async () => {
    const collection = database.collection('room_sessions');
    let document = await collection.findOne({ _id: audit.sessionId });
    if (!document) {
      document = {
        _id: audit.sessionId,
        sessionId: audit.sessionId,
        roomCode: room.code,
        status: audit.isEmpty ? 'empty' : 'open',
        openedAt: new Date(room.createdAt || event.at),
        closedAt: null,
        finalClosedAt: null,
        lastActivityAt: event.at,
        connectedCount: connectedCount(room),
        disconnectCount: 0,
        returnCount: 0,
        participants: [],
        events: []
      };
    }

    document.events ||= [];
    document.participants ||= [];
    document.events.push(event);
    mergeParticipant(document.participants, event);
    document.lastActivityAt = event.at;
    document.connectedCount = connectedCount(room);
    if (event.type === 'participant_disconnected') document.disconnectCount = Number(document.disconnectCount || 0) + 1;
    if (event.type === 'participant_returned') document.returnCount = Number(document.returnCount || 0) + 1;
    if (event.type === 'room_closed') {
      document.status = 'empty';
      document.closedAt = event.at;
    }
    if (event.type === 'room_reopened') {
      document.status = 'open';
      document.closedAt = null;
    }
    if (event.type === 'room_final_closed') {
      document.status = 'closed';
      document.closedAt = event.at;
      document.finalClosedAt = event.at;
    }

    await collection.replaceOne({ _id: audit.sessionId }, document, { upsert: true });
  });
}

async function listRoomSessions(limit = 200) {
  if (!enabled || !database) return [];
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 200));
  return database.collection('room_sessions')
    .find({}, { projection: { events: 0 } })
    .sort({ openedAt: -1 })
    .limit(safeLimit)
    .toArray();
}

async function getRoomSession(sessionId) {
  if (!enabled || !database) return null;
  return database.collection('room_sessions').findOne({ _id: sessionId });
}

async function archiveMatch(room) {
  if (!enabled || !database || !room.matchId || !room.winner) return;
  const record = buildMatchRecord(room);
  await database.collection('match_records').replaceOne({ _id: room.matchId }, record, { upsert: true });
}

async function listMatches(limit = 100) {
  if (!enabled || !database) return [];
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  return database.collection('match_records')
    .find({}, { projection: { finalBoards: 0, logs: 0 } })
    .sort({ finishedAt: -1 })
    .limit(safeLimit)
    .toArray();
}

async function getMatch(matchId) {
  if (!enabled || !database) return null;
  return database.collection('match_records').findOne({ _id: matchId });
}


async function rankingPosition(record, excludeId = null) {
  if (!enabled || !database || !record) return null;
  const collection = database.collection('leaderboard_records');
  const query = {
    rankingVersion: RANKING_VERSION,
    mode: record.mode,
    $or: [
      { score: { $gt: record.score } },
      { score: record.score, coins: { $gt: record.coins } },
      { score: record.score, coins: record.coins, achievedAt: { $lt: record.achievedAt } },
      { score: record.score, coins: record.coins, achievedAt: record.achievedAt, _id: { $lt: record._id } }
    ]
  };
  if (excludeId) query._id = { $ne: excludeId };
  const betterCount = await collection.countDocuments(query);
  return betterCount + 1;
}

async function rankingLeader(mode) {
  if (!enabled || !database || !RANKING_MODES.includes(mode)) return null;
  const record = await database.collection('leaderboard_records')
    .find({ rankingVersion: RANKING_VERSION, mode })
    .sort({ score: -1, coins: -1, achievedAt: 1, _id: 1 })
    .limit(1)
    .next();
  return publicRankingRecord(record);
}

async function registerRankingResults(room) {
  const mode = rankingModeForRoom(room);
  if (!mode) return { available: false, mode: null, label: null, positions: {}, leader: null };
  if (!enabled || !database) {
    return { available: false, mode, label: rankingLabel(mode), positions: {}, leader: null };
  }

  const collection = database.collection('leaderboard_records');
  const positions = {};

  for (const entry of rankingResultEntries(room)) {
    const now = new Date();
    const documentId = `${RANKING_VERSION}:${mode}:${entry.rankingPlayerId}`;
    const existing = await collection.findOne({ _id: documentId });
    const candidate = {
      _id: documentId,
      rankingVersion: RANKING_VERSION,
      mode,
      score: entry.score,
      coins: entry.coins,
      achievedAt: now
    };

    if (isBetterRankingResult(candidate, existing)) {
      const document = {
        _id: documentId,
        rankingPlayerId: entry.rankingPlayerId,
        rankingVersion: RANKING_VERSION,
        mode,
        nickname: entry.nickname,
        score: entry.score,
        coins: entry.coins,
        achievedAt: now,
        createdAt: existing?.createdAt || now,
        lastPlayedAt: now,
        lastMatchId: room.matchId || null
      };
      await collection.replaceOne({ _id: documentId }, document, { upsert: true });
    } else {
      await collection.updateOne(
        { _id: documentId },
        {
          $set: {
            nickname: entry.nickname,
            lastPlayedAt: now,
            lastMatchId: room.matchId || null
          }
        }
      );
    }

    // A coluna da tela final representa a colocação do resultado desta partida.
    // O registro persistente continua guardando apenas o melhor resultado do jogador.
    positions[entry.roomPlayerId] = await rankingPosition(candidate, documentId);
  }

  return {
    available: true,
    mode,
    label: rankingLabel(mode),
    positions,
    leader: await rankingLeader(mode),
    updatedAt: Date.now()
  };
}

async function getRankingLeaders() {
  const leaders = {};
  for (const mode of RANKING_MODES) {
    leaders[mode] = {
      label: rankingLabel(mode),
      leader: await rankingLeader(mode)
    };
  }
  return { available: Boolean(enabled && database), leaders };
}

async function addServerEvent(type, message, extra = {}) {
  if (!enabled || !database) return;
  const at = extra.at instanceof Date ? extra.at : new Date(extra.at || Date.now());
  const document = {
    at,
    type,
    message,
    instanceId: extra.instanceId || serverInstanceId || null,
    durationMs: extra.durationMs ?? null,
    outageStartedAt: extra.outageStartedAt || null,
    restoredAt: extra.restoredAt || null,
    reason: extra.reason || null
  };
  await database.collection('server_events').insertOne(document);
}

async function registerServerStart() {
  if (!enabled || !database) return null;
  const now = new Date();
  const stateCollection = database.collection('server_state');
  const previous = await stateCollection.findOne({ _id: 'main' });
  serverInstanceId = crypto.randomUUID();

  if (previous?.status === 'online' && previous.lastHeartbeat) {
    const lastHeartbeat = new Date(previous.lastHeartbeat);
    const durationMs = Math.max(0, now.getTime() - lastHeartbeat.getTime());
    await addServerEvent(
      'server_outage',
      `Queda do servidor detectada. Último sinal em ${lastHeartbeat.toISOString()}; retorno em ${now.toISOString()}.`,
      { at: lastHeartbeat, outageStartedAt: lastHeartbeat, restoredAt: now, durationMs, instanceId: previous.instanceId }
    );
    await addServerEvent('server_restored', 'Servidor restabelecido.', { at: now, durationMs, instanceId: serverInstanceId });
  } else {
    await addServerEvent('server_started', 'Servidor iniciado.', { at: now, instanceId: serverInstanceId });
  }

  await stateCollection.replaceOne(
    { _id: 'main' },
    { _id: 'main', status: 'online', instanceId: serverInstanceId, startedAt: now, lastHeartbeat: now, heartbeatMs: DEFAULT_HEARTBEAT_MS },
    { upsert: true }
  );
  return { instanceId: serverInstanceId, previous };
}

async function heartbeatServer() {
  if (!enabled || !database || !serverInstanceId) return;
  await database.collection('server_state').updateOne(
    { _id: 'main', instanceId: serverInstanceId },
    { $set: { status: 'online', lastHeartbeat: new Date() } }
  );
}

async function registerServerStop(reason = 'Encerramento normal') {
  if (!enabled || !database || !serverInstanceId) return;
  const now = new Date();
  await addServerEvent('server_stopped', 'Servidor encerrado normalmente.', { at: now, reason, instanceId: serverInstanceId });
  await database.collection('server_state').updateOne(
    { _id: 'main', instanceId: serverInstanceId },
    { $set: { status: 'offline', stoppedAt: now, lastHeartbeat: now, stopReason: reason } }
  );
}

async function listServerEvents(limit = 200) {
  if (!enabled || !database) return [];
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 200));
  return database.collection('server_events').find({}).sort({ at: -1 }).limit(safeLimit).toArray();
}

async function close() {
  if (client) await client.close();
  client = null;
  database = null;
  enabled = false;
  serverInstanceId = null;
}

module.exports = {
  DEFAULT_HEARTBEAT_MS,
  initialize,
  status,
  ensureAudit,
  connectedCount,
  saveRoom,
  deleteRoom,
  loadRooms,
  openRoomSession,
  recordRoomEvent,
  listRoomSessions,
  getRoomSession,
  archiveMatch,
  listMatches,
  getMatch,
  registerRankingResults,
  getRankingLeaders,
  registerServerStart,
  heartbeatServer,
  registerServerStop,
  listServerEvents,
  close,
  buildMatchRecord
};
