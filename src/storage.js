const DEFAULT_DB_NAME = 'carpas_online';
const DEFAULT_ROOM_TTL_HOURS = 72;

let client = null;
let database = null;
let enabled = false;
let lastError = null;
const roomWriteQueues = new Map();

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
  for (const player of Object.values(snapshot.players || {})) {
    player.socketId = null;
  }
  for (const spectator of Object.values(snapshot.spectators || {})) {
    spectator.socketId = null;
  }
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
    finalBoards: Object.fromEntries(
      room.playerOrder.map((id) => [id, room.players[id]?.board || null])
    ),
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
    // O require é intencionalmente tardio: o jogo continua em modo memória sem MONGODB_URI.
    const { MongoClient } = require('mongodb');
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    database = client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);
    enabled = true;
    lastError = null;

    const activeRooms = database.collection('active_rooms');
    const matches = database.collection('match_records');
    await Promise.all([
      activeRooms.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      activeRooms.createIndex({ updatedAtDate: -1 }),
      matches.createIndex({ finishedAt: -1 }),
      matches.createIndex({ roomCode: 1, finishedAt: -1 })
    ]);
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
    error: lastError?.message || null
  };
}

async function saveRoom(room) {
  if (!enabled || !database) return;
  const ttlHours = Math.max(1, Number(process.env.ROOM_TTL_HOURS || DEFAULT_ROOM_TTL_HOURS));
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

async function close() {
  if (client) await client.close();
  client = null;
  database = null;
  enabled = false;
}

module.exports = {
  initialize,
  status,
  saveRoom,
  deleteRoom,
  loadRooms,
  archiveMatch,
  listMatches,
  getMatch,
  close,
  buildMatchRecord
};
