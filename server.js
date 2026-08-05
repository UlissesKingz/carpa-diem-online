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
  startGame,
  requestRestart,
  respondRestart,
  movePiece,
  undoLastMove,
  buyExtraMove,
  markMovementReady,
  chooseDevelopmentColor,
  replaceFish,
  completeCirculation,
  publicRoom,
  allPlayersConnected
} = require('./src/game');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.redirect('/device.html'));
app.get('/health', (_req, res) => res.json({ ok: true, storage: storage.status() }));

const rooms = new Map();
const circulationTimers = new Map();

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
    const matches = await storage.listMatches(req.query.limit || 100);
    res.json({
      ok: true,
      storage: storage.status(),
      activeRooms: [...rooms.values()].map(roomSummary).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
      matches
    });
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

function emitRoom(room) {
  room.updatedAt = Date.now();
  io.to(room.code).emit('roomState', publicRoom(room));
  persistRoom(room);
  scheduleCirculation(room);
}

function cancelCirculationTimer(code) {
  const timer = circulationTimers.get(code);
  if (timer) clearTimeout(timer);
  circulationTimers.delete(code);
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

function clearSocketRoom(socket) {
  const code = socket.data.roomCode;
  if (code) socket.leave(code);
  delete socket.data.roomCode;
  delete socket.data.memberId;
  delete socket.data.memberRole;
}

io.on('connection', (socket) => {
  socket.on('createRoom', safeHandler(socket, (payload = {}) => {
    if (!COLORS.includes(payload.color)) throw new Error('Escolha uma cor válida.');
    const room = uniqueRoom({ hostName: payload.name, color: payload.color, socketId: socket.id });
    rooms.set(room.code, room);
    const player = room.players[room.hostId];
    attachSocketToRoom(socket, room, player, 'player');
    emitRoom(room);
    return {
      roomCode: room.code,
      memberId: player.id,
      memberToken: player.token,
      role: 'player',
      color: player.color
    };
  }));

  socket.on('joinRoom', safeHandler(socket, (payload = {}) => {
    const code = String(payload.roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new Error('Sala não encontrada.');

    let player = null;
    if (payload.playerToken) {
      player = Object.values(room.players).find((item) => item.token === payload.playerToken) || null;
    }

    if (!player && room.status !== 'lobby') {
      const normalizedName = String(payload.name || '').trim().toLocaleLowerCase('pt-BR');
      player = room.playerOrder
        .map((id) => room.players[id])
        .find((item) => !item.connected && item.name.trim().toLocaleLowerCase('pt-BR') === normalizedName) || null;
      if (!player) throw new Error('A partida já começou. Para voltar, use o mesmo nome e o código da sala; ou entre como espectador.');
    }

    if (player) {
      player.socketId = socket.id;
      player.connected = true;
      resumeCirculation(room);
      room.logs.push({ at: Date.now(), text: 'voltou à partida.', actorId: player.id, actorRole: 'player' });
    } else {
      player = addPlayer(room, { name: payload.name, color: payload.color, socketId: socket.id });
    }

    attachSocketToRoom(socket, room, player, 'player');
    emitRoom(room);
    return {
      roomCode: room.code,
      memberId: player.id,
      memberToken: player.token,
      role: 'player',
      color: player.color
    };
  }));

  socket.on('joinSpectator', safeHandler(socket, (payload = {}) => {
    const code = String(payload.roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new Error('Sala não encontrada.');

    let spectator = null;
    if (payload.spectatorToken) {
      spectator = Object.values(room.spectators).find((item) => item.token === payload.spectatorToken) || null;
    }

    if (spectator) {
      spectator.socketId = socket.id;
      spectator.connected = true;
      room.logs.push({ at: Date.now(), text: 'se reconectou como espectador.', actorId: spectator.id, actorRole: 'spectator' });
    } else {
      spectator = addSpectator(room, { name: payload.name, socketId: socket.id });
    }

    attachSocketToRoom(socket, room, spectator, 'spectator');
    emitRoom(room);
    return {
      roomCode: room.code,
      memberId: spectator.id,
      memberToken: spectator.token,
      role: 'spectator'
    };
  }));

  socket.on('leaveRoom', safeHandler(socket, () => {
    const room = roomForSocket(socket);
    const role = socket.data.memberRole;
    const memberId = socket.data.memberId;
    const result = removeMember(room, memberId, role);
    clearSocketRoom(socket);

    if (result.roomEmpty) {
      cancelCirculationTimer(room.code);
      rooms.delete(room.code);
      storage.deleteRoom(room.code).catch((error) => console.error('[MongoDB] Falha ao remover sala:', error.message));
    } else {
      if (result.retained) pauseCirculation(room);
      emitRoom(room);
    }
    return {};
  }));

  socket.on('startGame', safeHandler(socket, () => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem iniciar a partida.');
    startGame(room, socket.data.memberId);
    emitRoom(room);
    return {};
  }));

  socket.on('requestRestart', safeHandler(socket, () => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não participam da decisão.');
    requestRestart(room, socket.data.memberId);
    emitRoom(room);
    return {};
  }));

  socket.on('respondRestart', safeHandler(socket, (payload = {}) => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não participam da decisão.');
    const result = respondRestart(room, socket.data.memberId, Boolean(payload.accept));
    if (result.restarted) cancelCirculationTimer(room.code);
    emitRoom(room);
    return result;
  }));

  socket.on('movePiece', safeHandler(socket, (payload = {}) => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem mover peças.');
    const result = movePiece(room, socket.data.memberId, payload.from || {});
    emitRoom(room);
    return result;
  }));

  socket.on('undoMove', safeHandler(socket, () => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem desfazer jogadas.');
    const result = undoLastMove(room, socket.data.memberId);
    emitRoom(room);
    return result;
  }));

  socket.on('buyExtraMove', safeHandler(socket, () => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem comprar movimentos.');
    const result = buyExtraMove(room, socket.data.memberId);
    emitRoom(room);
    return result;
  }));

  socket.on('finishMovement', safeHandler(socket, () => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem concluir a fase.');
    markMovementReady(room, socket.data.memberId);
    emitRoom(room);
    return {};
  }));

  socket.on('chooseDevelopmentColor', safeHandler(socket, (payload = {}) => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem escolher reposições.');
    chooseDevelopmentColor(room, socket.data.memberId, payload.color);
    emitRoom(room);
    return {};
  }));

  socket.on('replaceFish', safeHandler(socket, (payload = {}) => {
    const room = roomForSocket(socket);
    if (socket.data.memberRole !== 'player') throw new Error('Espectadores não podem trocar peças.');
    replaceFish(room, socket.data.memberId, payload.position || {});
    emitRoom(room);
    return {};
  }));

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const memberId = socket.data.memberId;
    const role = socket.data.memberRole;
    const room = code ? rooms.get(code) : null;
    if (!room || !memberId) return;

    const member = role === 'spectator' ? room.spectators[memberId] : room.players[memberId];
    if (!member) return;
    member.connected = false;
    if (role === 'player') pauseCirculation(room);
    room.logs.push({
      at: Date.now(),
      text: role === 'spectator' ? `${member.name} desconectou como espectador.` : 'desconectou.',
      actorId: role === 'player' ? member.id : null,
      actorRole: role || 'player'
    });
    emitRoom(room);
  });
});

async function bootstrap() {
  try {
    const storageResult = await storage.initialize();
    if (storageResult.enabled) {
      const restoredRooms = await storage.loadRooms();
      for (const room of restoredRooms) rooms.set(room.code, room);
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
    console.log(`Carpas Online disponível em http://localhost:${PORT}`);
  });
}

process.on('SIGTERM', async () => {
  await storage.close().catch(() => {});
  server.close(() => process.exit(0));
});

bootstrap();
