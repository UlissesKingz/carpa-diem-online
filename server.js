const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const storage = require('./src/storage');
const {
  COLORS,
  createRoom,
  addPlayer,
  addSpectator,
  removeMember,
  setGameRuleset,
  startGame,
  requestRestart,
  respondRestart,
  movePiece,
  undoLastMove,
  buyExtraMove,
  markMovementReady,
  chooseDevelopmentColor,
  replaceFish,
  markDevelopmentReady,
  completeCirculation,
  publicRoom,
  allPlayersConnected
} = require('./src/game');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || process.env.PUBLIC_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origem não autorizada.'), false);
    },
    credentials: true
  },
  // Dá mais tolerância a travamentos momentâneos do navegador/mobile antes de
  // considerar a conexão perdida. O cliente continua reconectando automaticamente.
  pingInterval: 25000,
  pingTimeout: 60000
});

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.redirect('/device.html'));
app.get('/health', (_req, res) => res.json({ ok: true, storage: storage.status() }));
app.get('/api/ranking/leaders', async (_req, res) => {
  try {
    res.json({ ok: true, ...(await storage.getRankingLeaders()) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

const rooms = new Map();
const circulationTimers = new Map();
const emptyRoomTimers = new Map();
const rankingJobs = new Set();
const EMPTY_ROOM_CLOSE_MS = 10 * 60 * 1000;
let heartbeatTimer = null;
let shuttingDown = false;

const rateBuckets = new Map();
const RATE_LIMIT_CLEANUP_MS = 5 * 60 * 1000;

function clientIp(socket) {
  const forwarded = String(socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || socket.handshake.address || 'unknown';
}

function rateLimit(socket, key, limit, windowMs) {
  const now = Date.now();
  const bucketKey = `${clientIp(socket)}:${key}`;
  const bucket = rateBuckets.get(bucketKey);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) throw new Error('Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente novamente.');
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets.entries()) {
    if (now > bucket.resetAt + RATE_LIMIT_CLEANUP_MS) rateBuckets.delete(key);
  }
}, RATE_LIMIT_CLEANUP_MS).unref?.();

function sanitizeName(value) {
  const name = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);

  if (!name) throw new Error('Informe um nome.');
  if (!/^[\p{L}\p{N} ._'’\-]{1,24}$/u.test(name)) throw new Error('Use apenas letras, números, espaços, ponto, hífen ou apóstrofo no nome.');
  return name;
}

function sanitizeRoomCode(value) {
  const code = String(value || '').normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error('Código de sala inválido.');
  return code;
}

function sanitizeColor(value) {
  if (!COLORS.includes(value)) throw new Error('Escolha uma cor válida.');
  return value;
}

function sanitizeMode(value) {
  return value === 'solo' ? 'solo' : 'multiplayer';
}

function sanitizeRuleset(value) {
  const ruleset = String(value || 'classic').trim().toLowerCase();
  if (!['kids', 'classic', 'advanced'].includes(ruleset)) throw new Error('Dificuldade inválida.');
  return ruleset;
}

function sanitizeRankingPlayerId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{12,96}$/.test(id) ? id : null;
}

function safePayload(payload = {}) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function fireAndForget(promise, label) {
  Promise.resolve(promise).catch((error) => console.error(`${label}:`, error.message));
}

function auditRoomEvent(room, event) {
  fireAndForget(storage.recordRoomEvent(room, event), `[MongoDB] Falha ao registrar evento da sala ${room.code}`);
}

function markRoomEmpty(room, message, final = false) {
  const audit = storage.ensureAudit(room);
  const now = Date.now();
  if (final) {
    audit.isEmpty = true;
    audit.emptySince ||= now;
    audit.finalClosedAt = now;
    auditRoomEvent(room, {
      at: now,
      type: 'room_final_closed',
      message: message || `Sala ${room.code} encerrada sem participantes conectados.`,
      reason: 'no_connected_participants'
    });
    return;
  }
  if (audit.isEmpty) return;
  audit.isEmpty = true;
  audit.emptySince = now;
  auditRoomEvent(room, {
    at: now,
    type: 'room_closed',
    message: message || `Sala ${room.code} ficou sem participantes conectados.`,
    reason: 'no_connected_participants'
  });
}

function reopenRoomIfNeeded(room, memberName) {
  cancelEmptyRoomTimer(room.code);
  const audit = storage.ensureAudit(room);
  if (!audit.isEmpty) return;
  const now = Date.now();
  audit.isEmpty = false;
  audit.emptySince = null;
  auditRoomEvent(room, {
    at: now,
    type: 'room_reopened',
    message: `Sala ${room.code} reaberta após o retorno de ${memberName}.`
  });
}

function memberAuditData(member, role) {
  return {
    memberId: member?.id || null,
    name: member?.name || null,
    role,
    color: role === 'player' ? member?.color || null : null
  };
}

function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return res.status(503).send('ADMIN_PASSWORD não configurada.');
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="Carpa Diem Admin"');
    return res.status(401).send('Autenticação necessária.');
  }
  let credentials = '';
  try { credentials = Buffer.from(encoded, 'base64').toString('utf8'); } catch { credentials = ''; }
  const separator = credentials.indexOf(':');
  const suppliedPassword = separator >= 0 ? credentials.slice(separator + 1) : '';
  if (suppliedPassword !== password) {
    res.set('WWW-Authenticate', 'Basic realm="Carpa Diem Admin"');
    return res.status(401).send('Senha inválida.');
  }
  next();
}

function roomSummary(room) {
  return {
    code: room.code,
    mode: room.mode || 'multiplayer',
    ruleset: room.ruleset || 'classic',
    status: room.status,
    phase: room.phase,
    round: room.round,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    matchId: room.matchId,
    restartCount: room.restartCount || 0,
    players: room.playerOrder.map((id) => {
      const player = room.players[id];
      return {
        id: player.id,
        name: player.name,
        color: player.color,
        connected: player.connected,
        coins: player.coins || 0,
        movesRemaining: player.movesRemaining,
        movementReady: player.movementReady
      };
    }),
    spectators: Object.values(room.spectators || {}).map((spectator) => ({
      id: spectator.id,
      name: spectator.name,
      connected: spectator.connected
    })),
    solo: room.solo ? { exitedPreferred: room.solo.exitedPreferred, automaLine: room.solo.automaLine } : null,
    winner: room.winner ? {
      playerIds: room.winner.playerIds,
      score: room.winner.score,
      coins: room.winner.coins,
      ranking: room.winner.ranking
    } : null
  };
}

function roomAdminDetails(room) {
  const details = roomSummary(room);
  details.logs = room.logs || [];
  details.liveScores = publicRoom(room).liveScores;
  details.boards = Object.fromEntries(room.playerOrder.map((id) => [id, room.players[id].board]));
  return details;
}

app.get('/dev-salas', adminAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'dev-salas.html'));
});

app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const limit = req.query.limit || 300;
    const [roomSessions, serverEvents, matches] = await Promise.all([
      storage.listRoomSessions(limit),
      storage.listServerEvents(limit),
      storage.listMatches(50)
    ]);
    res.json({
      ok: true,
      storage: storage.status(),
      activeRooms: [...rooms.values()].map(roomSummary).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
      roomSessions,
      serverEvents,
      matches
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/admin/room-sessions/:sessionId', adminAuth, async (req, res) => {
  try {
    const session = await storage.getRoomSession(req.params.sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Registro da sala não encontrado.' });
    res.json({ ok: true, session });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/admin/rooms/:code', adminAuth, (req, res) => {
  const room = rooms.get(String(req.params.code || '').toUpperCase());
  if (!room) return res.status(404).json({ ok: false, error: 'Sala não encontrada.' });
  res.json({ ok: true, room: roomAdminDetails(room) });
});

app.get('/api/admin/matches/:matchId', adminAuth, async (req, res) => {
  try {
    const match = await storage.getMatch(req.params.matchId);
    if (!match) return res.status(404).json({ ok: false, error: 'Partida não encontrada.' });
    res.json({ ok: true, match });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

function normalizeRankingPlayerId(value) {
  return sanitizeRankingPlayerId(value);
}

function uniqueRoom(options) {
  let room;
  do room = createRoom(options); while (rooms.has(room.code));
  return room;
}

function roomForSocket(socket) {
  const code = socket.data.roomCode;
  if (!code) throw new Error('Você não está em uma sala.');
  const room = rooms.get(code);
  if (!room) throw new Error('Sala não encontrada.');
  return room;
}

function persistRoom(room) {
  storage.saveRoom(room).catch((error) => console.error(`[MongoDB] Falha ao salvar sala ${room.code}:`, error.message));
  if (room.status === 'finished' && room.winner) {
    storage.archiveMatch(room).catch((error) => console.error(`[MongoDB] Falha ao arquivar partida ${room.matchId}:`, error.message));
  }
}

function refreshRankingForFinishedRoom(room) {
  if (room.status !== 'finished' || !room.winner || !room.matchId) return;
  if (room.rankingGeneral?.matchId === room.matchId) return;
  if (rankingJobs.has(room.matchId)) return;

  rankingJobs.add(room.matchId);
  fireAndForget((async () => {
    try {
      const rankingGeneral = await storage.registerRankingResults(room);
      room.rankingGeneral = { ...rankingGeneral, matchId: room.matchId };
      room.updatedAt = Date.now();
      io.to(room.code).emit('roomState', publicRoom(room));
      persistRoom(room);
    } finally {
      rankingJobs.delete(room.matchId);
    }
  })(), `[MongoDB] Falha ao atualizar Ranking Geral da partida ${room.matchId}`);
}

function emitRoom(room) {
  room.updatedAt = Date.now();
  io.to(room.code).emit('roomState', publicRoom(room));
  persistRoom(room);
  refreshRankingForFinishedRoom(room);
  scheduleCirculation(room);
}

function cancelCirculationTimer(code) {
  const timer = circulationTimers.get(code);
  if (timer) clearTimeout(timer);
  circulationTimers.delete(code);
}

function cancelEmptyRoomTimer(code) {
  const timer = emptyRoomTimers.get(code);
  if (timer) clearTimeout(timer);
  emptyRoomTimers.delete(code);
}

function scheduleEmptyRoomClosure(room) {
  if (!room || storage.connectedCount(room) > 0) {
    if (room) cancelEmptyRoomTimer(room.code);
    return;
  }
  if (emptyRoomTimers.has(room.code)) return;

  const audit = storage.ensureAudit(room);
  const emptySince = Number(audit.emptySince || Date.now());
  const delay = Math.max(0, EMPTY_ROOM_CLOSE_MS - (Date.now() - emptySince));
  const timer = setTimeout(() => {
    emptyRoomTimers.delete(room.code);
    const current = rooms.get(room.code);
    if (!current || storage.connectedCount(current) > 0) return;

    cancelCirculationTimer(current.code);
    markRoomEmpty(current, `Sala ${current.code} encerrada após 10 minutos sem participantes conectados.`, true);
    rooms.delete(current.code);
    fireAndForget(storage.deleteRoom(current.code), '[MongoDB] Falha ao remover sala ativa');
  }, delay);
  timer.unref?.();
  emptyRoomTimers.set(room.code, timer);
}

function scheduleCirculation(room) {
  if (room.phase !== 'circulation' || !room.circulation || room.circulation.paused || !allPlayersConnected(room) || circulationTimers.has(room.code)) return;
  const elapsed = Date.now() - room.circulation.startedAt;
  const delay = Math.max(0, room.circulation.durationMs - elapsed);
  const timer = setTimeout(() => {
    circulationTimers.delete(room.code);
    if (!rooms.has(room.code)) return;
    if (completeCirculation(room)) emitRoom(room);
  }, delay);
  circulationTimers.set(room.code, timer);
}

function pauseCirculation(room) {
  if (room.phase !== 'circulation' || !room.circulation || room.circulation.paused) return;
  const elapsed = Date.now() - Number(room.circulation.startedAt || Date.now());
  room.circulation.remainingMs = Math.max(0, room.circulation.durationMs - elapsed);
  room.circulation.paused = true;
  cancelCirculationTimer(room.code);
}

function resumeCirculation(room) {
  if (!allPlayersConnected(room) || room.phase !== 'circulation' || !room.circulation?.paused) return;
  room.circulation.durationMs = Math.max(0, Number(room.circulation.remainingMs ?? room.circulation.durationMs));
  room.circulation.startedAt = Date.now();
  room.circulation.paused = false;
  delete room.circulation.remainingMs;
}

function ackResult(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function safeHandler(socket, handler) {
  return (...args) => {
    const maybeAck = args.at(-1);
    const ack = typeof maybeAck === 'function' ? args.pop() : undefined;
    try {
      const result = handler(...args) || {};
      ackResult(ack, { ok: true, ...result });
    } catch (error) {
      ackResult(ack, { ok: false, error: error.message || 'Erro inesperado.' });
    }
  };
}

function attachSocketToRoom(socket, room, member, role) {
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.memberId = member.id;
  socket.data.memberRole = role;
}

function handoffMemberSocket(room, member, socket) {
  const previousSocketId = member?.socketId;
  if (previousSocketId && previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket) clearSocketRoom(previousSocket);
  }
  member.socketId = socket.id;
  member.connected = true;
}

function clearSocketRoom(socket) {
  const code = socket.data.roomCode;
  if (code) socket.leave(code);
  delete socket.data.roomCode;
  delete socket.data.memberId;
  delete socket.data.memberRole;
}

io.on('connection', (socket) => {
  socket.on('createRoom', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'createRoom', 6, 60 * 1000);
    payload = safePayload(payload);
    const hostName = sanitizeName(payload.name);
    const color = sanitizeColor(payload.color);
    const mode = sanitizeMode(payload.mode);
    const rankingPlayerId = sanitizeRankingPlayerId(payload.rankingPlayerId);
    const ruleset = sanitizeRuleset(payload.ruleset || 'classic');
    const room = uniqueRoom({
      hostName,
      color,
      socketId: socket.id,
      mode,
      rankingPlayerId,
      ruleset
    });
    rooms.set(room.code, room);
    const player = room.players[room.hostId];
    storage.ensureAudit(room);
    attachSocketToRoom(socket, room, player, 'player');
    fireAndForget(storage.openRoomSession(room, player), `[MongoDB] Falha ao abrir registro da sala ${room.code}`);
    emitRoom(room);
    return {
      roomCode: room.code,
      memberId: player.id,
      memberToken: player.token,
      role: 'player',
      roomMode: room.mode,
      color: player.color
    };
  }));

  socket.on('joinRoom', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'joinRoom', 20, 60 * 1000);
    payload = safePayload(payload);
    const code = sanitizeRoomCode(payload.roomCode);
    const name = sanitizeName(payload.name);
    const color = payload.color ? sanitizeColor(payload.color) : null;
    const rankingPlayerId = sanitizeRankingPlayerId(payload.rankingPlayerId);
    const room = rooms.get(code);
    if (!room) throw new Error('Sala não encontrada.');

    let player = null;
    if (payload.playerToken) {
      player = Object.values(room.players).find((item) => item.token === payload.playerToken) || null;
    }

    if (!player && room.status !== 'lobby') {
      const normalizedName = name.toLocaleLowerCase('pt-BR');
      player = room.playerOrder
        .map((id) => room.players[id])
        .find((item) => !item.connected && item.name.trim().toLocaleLowerCase('pt-BR') === normalizedName) || null;
      if (!player) throw new Error('A partida já começou. Para voltar, use o mesmo nome e o código da sala; ou entre como espectador.');
    }

    const returningPlayer = Boolean(player);
    if (player) {
      handoffMemberSocket(room, player, socket);
      if (!player.rankingPlayerId) player.rankingPlayerId = normalizeRankingPlayerId(rankingPlayerId);
      resumeCirculation(room);
      room.logs.push({ at: Date.now(), text: 'voltou à partida.', actorId: player.id, actorRole: 'player' });
    } else {
      if (!color) throw new Error('Escolha uma cor válida.');
      player = addPlayer(room, { name, color, socketId: socket.id, rankingPlayerId });
    }

    attachSocketToRoom(socket, room, player, 'player');
    auditRoomEvent(room, {
      at: Date.now(),
      type: returningPlayer ? 'participant_returned' : 'participant_joined',
      message: returningPlayer ? `${player.name} retornou à sala como jogador.` : `${player.name} entrou na sala como jogador.`,
      ...memberAuditData(player, 'player')
    });
    reopenRoomIfNeeded(room, player.name);
    emitRoom(room);
    return {
      roomCode: room.code,
      memberId: player.id,
      memberToken: player.token,
      role: 'player',
      roomMode: room.mode,
      color: player.color
    };
  }));

  socket.on('joinSpectator', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'joinSpectator', 30, 60 * 1000);
    payload = safePayload(payload);
    const code = sanitizeRoomCode(payload.roomCode);
    const name = sanitizeName(payload.name);
    const room = rooms.get(code);
    if (!room) throw new Error('Sala não encontrada.');

    let spectator = null;
    if (payload.spectatorToken) {
      spectator = Object.values(room.spectators).find((item) => item.token === payload.spectatorToken) || null;
    }

    const returningSpectator = Boolean(spectator);
    if (spectator) {
      handoffMemberSocket(room, spectator, socket);
      room.logs.push({ at: Date.now(), text: 'se reconectou como espectador.', actorId: spectator.id, actorRole: 'spectator' });
    } else {
      spectator = addSpectator(room, { name, socketId: socket.id });
    }

    attachSocketToRoom(socket, room, spectator, 'spectator');
    auditRoomEvent(room, {
      at: Date.now(),
      type: returningSpectator ? 'participant_returned' : 'participant_joined',
      message: returningSpectator ? `${spectator.name} retornou à sala como espectador.` : `${spectator.name} entrou na sala como espectador.`,
      ...memberAuditData(spectator, 'spectator')
    });
    reopenRoomIfNeeded(room, spectator.name);
    emitRoom(room);
    return {
      roomCode: room.code,
      memberId: spectator.id,
      memberToken: spectator.token,
      role: 'spectator',
      roomMode: room.mode
    };
  }));

  socket.on('leaveRoom', safeHandler(socket, () => {
    const room = roomForSocket(socket);
    const role = socket.data.memberRole;
    const memberId = socket.data.memberId;
    const member = role === 'spectator' ? room.spectators[memberId] : room.players[memberId];
    const memberData = memberAuditData(member, role);
    const result = removeMember(room, memberId, role);
    clearSocketRoom(socket);

    auditRoomEvent(room, {
      at: Date.now(),
      type: 'participant_left',
      message: `${memberData.name || 'Participante'} saiu voluntariamente da sala como ${role === 'spectator' ? 'espectador' : 'jogador'}.`,
      reason: 'voluntary_exit',
      ...memberData
    });

    const noConnectedParticipants = storage.connectedCount(room) === 0;
    if (result.retained) pauseCirculation(room);
    if (noConnectedParticipants) {
      markRoomEmpty(room, `Sala ${room.code} ficou sem participantes conectados. Será encerrada em 10 minutos se ninguém retornar.`);
      scheduleEmptyRoomClosure(room);
    }
    emitRoom(room);
    return {};
  }));

  socket.on('setGameRuleset', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'gameAction', 80, 10 * 1000);
    payload = safePayload(payload);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem alterar o modo de regras.');
    setGameRuleset(room, socket.data.memberId, sanitizeRuleset(payload.ruleset));
    emitRoom(room);
    return { ruleset: room.ruleset };
  }));

  socket.on('startGame', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'gameAction', 80, 10 * 1000);
    payload = safePayload(payload);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem iniciar a partida.');

    // Compatibilidade com salas solo criadas antes de o modo ser corretamente persistido.
    if (sanitizeMode(payload.mode) === 'solo' && room.status === 'lobby' && room.playerOrder.length === 1) {
      room.mode = 'solo';
    }

    startGame(room, socket.data.memberId);
    emitRoom(room);
    return {};
  }));

  socket.on('requestRestart', safeHandler(socket, () => {
    rateLimit(socket, 'restart', 8, 60 * 1000);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não participam da decisão.');
    const result = requestRestart(room, socket.data.memberId) || {};
    if (result.restarted) cancelCirculationTimer(room.code);
    emitRoom(room);
    return result;
  }));

  socket.on('respondRestart', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'restart', 20, 60 * 1000);
    payload = safePayload(payload);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não participam da decisão.');
    const result = respondRestart(room, socket.data.memberId, Boolean(payload.accept));
    if (result.restarted) cancelCirculationTimer(room.code);
    emitRoom(room);
    return result;
  }));

  socket.on('movePiece', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'movePiece', 120, 10 * 1000);
    payload = safePayload(payload);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem mover peças.');
    const result = movePiece(room, socket.data.memberId, payload.from || {});
    emitRoom(room);
    return result;
  }));

  socket.on('undoMove', safeHandler(socket, () => {
    rateLimit(socket, 'gameAction', 80, 10 * 1000);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem desfazer jogadas.');
    const result = undoLastMove(room, socket.data.memberId);
    emitRoom(room);
    return result;
  }));

  socket.on('buyExtraMove', safeHandler(socket, () => {
    rateLimit(socket, 'gameAction', 80, 10 * 1000);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem comprar movimentos.');
    const result = buyExtraMove(room, socket.data.memberId);
    emitRoom(room);
    return result;
  }));

  socket.on('finishMovement', safeHandler(socket, () => {
    rateLimit(socket, 'gameAction', 80, 10 * 1000);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem concluir a fase.');
    markMovementReady(room, socket.data.memberId);
    emitRoom(room);
    return {};
  }));

  socket.on('chooseDevelopmentColor', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'gameAction', 80, 10 * 1000);
    payload = safePayload(payload);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem escolher reposições.');
    chooseDevelopmentColor(room, socket.data.memberId, payload.color);
    emitRoom(room);
    return {};
  }));

  socket.on('replaceFish', safeHandler(socket, (payload = {}) => {
    rateLimit(socket, 'gameAction', 80, 10 * 1000);
    payload = safePayload(payload);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem trocar peças.');
    replaceFish(room, socket.data.memberId, payload.position || {});
    emitRoom(room);
    return {};
  }));

  socket.on('finishDevelopment', safeHandler(socket, () => {
    rateLimit(socket, 'gameAction', 80, 10 * 1000);
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem concluir a reposição.');
    const result = markDevelopmentReady(room, socket.data.memberId);
    emitRoom(room);
    return result;
  }));

  socket.on('disconnect', (reason) => {
    const code = socket.data.roomCode;
    const memberId = socket.data.memberId;
    const role = socket.data.memberRole;
    const room = code ? rooms.get(code) : null;
    if (!room || !memberId) return;

    const member = role === 'spectator' ? room.spectators[memberId] : room.players[memberId];
    if (!member || !member.connected) return;

    // Uma reconexão cria um novo socket. Se o transporte antigo fechar depois
    // do retorno, ele não pode derrubar novamente o mesmo jogador.
    if (member.socketId && member.socketId !== socket.id) return;

    member.connected = false;
    member.socketId = null;
    if (role === 'player') pauseCirculation(room);
    room.logs.push({
      at: Date.now(),
      text: role === 'spectator' ? `${member.name} desconectou como espectador.` : 'desconectou.',
      actorId: role === 'player' ? member.id : null,
      actorRole: role || 'player'
    });
    auditRoomEvent(room, {
      at: Date.now(),
      type: 'participant_disconnected',
      message: `${member.name} perdeu a conexão como ${role === 'spectator' ? 'espectador' : 'jogador'}.`,
      reason: reason || 'socket_disconnect',
      ...memberAuditData(member, role || 'player')
    });
    if (storage.connectedCount(room) === 0) {
      markRoomEmpty(room, `Sala ${room.code} ficou sem participantes conectados após uma queda de conexão. Será encerrada em 10 minutos se ninguém retornar.`);
      scheduleEmptyRoomClosure(room);
    }
    emitRoom(room);
  });
});

async function bootstrap() {
  try {
    const storageResult = await storage.initialize();
    if (storageResult.enabled) {
      await storage.registerServerStart();
      heartbeatTimer = setInterval(() => {
        fireAndForget(storage.heartbeatServer(), '[MongoDB] Falha no heartbeat do servidor');
      }, storage.DEFAULT_HEARTBEAT_MS);
      heartbeatTimer.unref?.();

      const restoredRooms = await storage.loadRooms();
      for (const room of restoredRooms) {
        storage.ensureAudit(room);
        room.audit.isEmpty = true;
        room.audit.emptySince ||= Date.now();
        rooms.set(room.code, room);
        auditRoomEvent(room, {
          at: Date.now(),
          type: 'room_closed',
          message: `Sala ${room.code} recuperada após reinício do servidor e aguardando retorno dos participantes por até 10 minutos.`,
          reason: 'server_restart'
        });
        scheduleEmptyRoomClosure(room);
      }
      console.log(`[MongoDB] Conectado ao banco ${storageResult.dbName}. ${restoredRooms.length} sala(s) recuperada(s).`);
    } else {
      console.log('[MongoDB] Modo memória:', storageResult.reason);
    }
  } catch (error) {
    console.error('[MongoDB] Não foi possível iniciar a persistência:', error.message);
    process.exitCode = 1;
    return;
  }

  server.listen(PORT, () => {
    console.log(`Carpa Diem Online disponível em http://localhost:${PORT}`);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  for (const timer of emptyRoomTimers.values()) clearTimeout(timer);
  emptyRoomTimers.clear();
  await storage.registerServerStop(signal).catch(() => {});
  await storage.close().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap();
