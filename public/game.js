const crypto = require('node:crypto');

const ROWS = 5;
const COLS = 7;
const MIDDLE_ROW = 2;
const CENTER = { row: 2, col: 3 };
const MAX_ROUNDS = 6;
const MOVES_PER_ROUND = 12;
const CIRCULATION_DURATION_MS = 5200;
const EXTRA_MOVE_COST = 3;
const COLORS = ['yellow', 'white', 'red', 'gray'];
const SPECIAL_TYPES = ['shoal', 'sturgeon', 'dojo', 'papaTerra'];
const SPECIAL_PRIORITY = ['shoal', 'papaTerra', 'dojo', 'sturgeon'];
const SPECIAL_COSTS = { shoal: 1, papaTerra: 0, dojo: 1, sturgeon: 3 };
const SPECIAL_LABELS = { shoal: 'Tesourinhas', papaTerra: 'Papa-terra', dojo: 'Dojô', sturgeon: 'Esturjão' };

function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let i = 0; i < 4; i += 1) value += alphabet[crypto.randomInt(0, alphabet.length)];
  return value;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createPiece(type, color = null) {
  return {
    id: randomId(5),
    type,
    ...(color ? { color } : {}),
    rotation: crypto.randomInt(0, 4) * 90
  };
}

function createInitialBoard(playerCount = 2, mode = 'multiplayer', specialTypesForBoard = null) {
  const pieces = [];
  for (const color of COLORS) {
    for (let i = 0; i < 7; i += 1) pieces.push(createPiece('carp', color));
  }

  const isTwoOrSolo = mode === 'solo' || playerCount === 2;
  const algaeCount = isTwoOrSolo ? 4 : 5;
  const fallbackSpecialCount = isTwoOrSolo ? 2 : 1;
  const chosenSpecialTypes = Array.isArray(specialTypesForBoard) && specialTypesForBoard.length
    ? [...specialTypesForBoard]
    : shuffle(SPECIAL_TYPES).slice(0, fallbackSpecialCount);
  for (let i = 0; i < algaeCount; i += 1) pieces.push(createPiece('algae'));
  chosenSpecialTypes.forEach((type) => pieces.push(createPiece(type)));

  const shuffled = shuffle(pieces);
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let cursor = 0;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (row === CENTER.row && col === CENTER.col) continue;
      board[row][col] = shuffled[cursor++];
    }
  }
  return board;
}

function clonePiece(piece) {
  return piece ? { ...piece } : null;
}

function cloneBoard(board) {
  return board.map((row) => row.map(clonePiece));
}

function snapshotMovementState(player) {
  return {
    board: cloneBoard(player.board),
    movesRemaining: player.movesRemaining,
    mustMoveCarp: player.mustMoveCarp,
    correctionRequired: player.correctionRequired,
    movementReady: player.movementReady,
    lastMovedPieceId: player.lastMovedPieceId,
    extraMovesPurchased: player.extraMovesPurchased,
    specialAlert: player.specialAlert || ''
  };
}

function restoreMovementState(player, snapshot) {
  player.board = cloneBoard(snapshot.board);
  const purchasesAfterSnapshot = Math.max(0, player.extraMovesPurchased - Number(snapshot.extraMovesPurchased || 0));
  player.movesRemaining = snapshot.movesRemaining + purchasesAfterSnapshot;
  player.mustMoveCarp = snapshot.mustMoveCarp;
  player.correctionRequired = player.movesRemaining > 0 ? false : snapshot.correctionRequired;
  player.movementReady = snapshot.movementReady;
  player.lastMovedPieceId = snapshot.lastMovedPieceId;
  player.specialAlert = snapshot.specialAlert || '';
}

function findEmpty(board) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (board[row][col] === null) return { row, col };
    }
  }
  throw new Error('O tanque não possui espaço vazio.');
}

function isInside(row, col) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function isOrthogonallyAdjacent(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function rotationForMovement(from, to) {
  const rowDelta = to.row - from.row;
  const colDelta = to.col - from.col;
  if (rowDelta === 1) return 0;      // A cabeça do PNG aponta para baixo.
  if (rowDelta === -1) return 180;
  if (colDelta === 1) return 270;
  if (colDelta === -1) return 90;
  return 0;
}

function shortestRotationTarget(fromRotation, canonicalTarget) {
  const delta = ((canonicalTarget - fromRotation + 540) % 360) - 180;
  return fromRotation + delta;
}

function orientPieceForMovement(piece, from, to) {
  const fromRotation = Number(piece?.rotation || 0);
  if (!piece || !['carp', ...SPECIAL_TYPES].includes(piece.type)) {
    return { fromRotation, toRotation: fromRotation, oriented: false };
  }
  const canonicalTarget = rotationForMovement(from, to);
  const toRotation = shortestRotationTarget(fromRotation, canonicalTarget);
  piece.rotation = canonicalTarget;
  return { fromRotation, toRotation, oriented: true };
}

function orientPieceForCurrent(piece) {
  const fromRotation = Number(piece?.rotation || 0);
  if (!piece || !['carp', ...SPECIAL_TYPES].includes(piece.type)) return null;
  const toRotation = shortestRotationTarget(fromRotation, 90);
  piece.rotation = 90;
  return { fromRotation, toRotation, oriented: true };
}

function adjacentPositions(position) {
  return [
    { row: position.row - 1, col: position.col },
    { row: position.row + 1, col: position.col },
    { row: position.row, col: position.col - 1 },
    { row: position.row, col: position.col + 1 }
  ].filter(({ row, col }) => isInside(row, col));
}

function pieceName(piece) {
  if (!piece) return 'peça';
  if (piece.type === 'carp') return `carpa ${labelColor(piece.color)}`;
  if (piece.type === 'algae') return 'planta';
  return SPECIAL_LABELS[piece.type] || 'peça especial';
}

function findPiecePosition(board, type) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (board[row][col]?.type === type) return { row, col };
    }
  }
  return null;
}

function sameDiagonal(a, b) {
  const rowDistance = Math.abs(a.row - b.row);
  const colDistance = Math.abs(a.col - b.col);
  return rowDistance > 0 && rowDistance === colDistance;
}

function sameOrthogonalLine(a, b) {
  return (a.row === b.row || a.col === b.col) && !(a.row === b.row && a.col === b.col);
}

function detectSpecialTrigger(board, emptyPosition) {
  for (const type of SPECIAL_PRIORITY) {
    const position = findPiecePosition(board, type);
    if (!position) continue;

    if (type === 'shoal' && isOrthogonallyAdjacent(position, emptyPosition)) {
      return { type, position, empty: { ...emptyPosition }, cost: SPECIAL_COSTS[type] };
    }

    if (type === 'papaTerra') {
      const rowDelta = emptyPosition.row - position.row;
      const colDelta = emptyPosition.col - position.col;
      const distance = Math.abs(rowDelta) + Math.abs(colDelta);
      if (distance === 2 && (rowDelta === 0 || colDelta === 0)) {
        const between = { row: position.row + Math.sign(rowDelta), col: position.col + Math.sign(colDelta) };
        if (board[between.row][between.col]) return { type, position, between, empty: { ...emptyPosition }, cost: 0 };
      }
    }

    if (type === 'dojo' && sameDiagonal(position, emptyPosition)) {
      return { type, position, empty: { ...emptyPosition }, cost: SPECIAL_COSTS[type] };
    }

    if (type === 'sturgeon' && sameOrthogonalLine(position, emptyPosition)) {
      return { type, position, empty: { ...emptyPosition }, cost: SPECIAL_COSTS[type] };
    }
  }
  return null;
}

function applySpecialTrigger(board, trigger) {
  if (!trigger) return null;
  const piece = board[trigger.position.row][trigger.position.col];
  const moves = [];
  let affectedCount = 0;

  if (trigger.type === 'shoal' || trigger.type === 'dojo') {
    const orientation = orientPieceForMovement(piece, trigger.position, trigger.empty);
    board[trigger.empty.row][trigger.empty.col] = piece;
    board[trigger.position.row][trigger.position.col] = null;
    moves.push({ pieceId: piece.id, from: { ...trigger.position }, to: { ...trigger.empty }, ...orientation });
  }

  if (trigger.type === 'papaTerra') {
    const middlePiece = board[trigger.between.row][trigger.between.col];
    const papaOrientation = orientPieceForMovement(piece, trigger.position, trigger.between);
    const middleOrientation = orientPieceForMovement(middlePiece, trigger.between, trigger.position);
    board[trigger.position.row][trigger.position.col] = middlePiece;
    board[trigger.between.row][trigger.between.col] = piece;
    moves.push({ pieceId: piece.id, from: { ...trigger.position }, to: { ...trigger.between }, ...papaOrientation });
    moves.push({ pieceId: middlePiece.id, from: { ...trigger.between }, to: { ...trigger.position }, ...middleOrientation });
    affectedCount = 1;
  }

  if (trigger.type === 'sturgeon') {
    const rowStep = Math.sign(trigger.empty.row - trigger.position.row);
    const colStep = Math.sign(trigger.empty.col - trigger.position.col);
    let cursor = { ...trigger.empty };
    while (!(cursor.row === trigger.position.row && cursor.col === trigger.position.col)) {
      const previous = { row: cursor.row - rowStep, col: cursor.col - colStep };
      const movedPiece = board[previous.row][previous.col];
      if (movedPiece) {
        const orientation = orientPieceForMovement(movedPiece, previous, cursor);
        board[cursor.row][cursor.col] = movedPiece;
        moves.push({ pieceId: movedPiece.id, from: previous, to: { ...cursor }, ...orientation });
        if (movedPiece.id !== piece.id) affectedCount += 1;
      }
      cursor = previous;
    }
    board[trigger.position.row][trigger.position.col] = null;
  }

  const messages = {
    shoal: 'Tesourinhas ocuparam o espaço vazio e consumiram 1 movimento.',
    dojo: 'Dojô atravessou o tanque pela diagonal e consumiu 1 movimento.',
    papaTerra: `Papa-terra trocou de posição com ${pieceName(board[trigger.position.row][trigger.position.col])}. Nenhum movimento foi consumido.`,
    sturgeon: `Esturjão empurrou ${affectedCount} peça(s) e consumiu 3 movimentos.`
  };
  return {
    type: trigger.type,
    pieceId: piece.id,
    label: SPECIAL_LABELS[trigger.type],
    cost: trigger.cost,
    moves,
    affectedCount,
    message: messages[trigger.type]
  };
}

function specialTypesOnBoard(board) {
  return new Set(board.flat().filter(Boolean).map((piece) => piece.type).filter((type) => SPECIAL_TYPES.includes(type)));
}

function generateAutomaLine(room, player) {
  const cooldown = room.solo.specialCooldown;
  const unavailable = specialTypesOnBoard(player.board);
  const pool = [];
  for (const color of COLORS) {
    for (let i = 0; i < 7; i += 1) pool.push({ type: 'carp', color });
  }
  for (let i = 0; i < 4; i += 1) pool.push({ type: 'algae' });
  for (const type of SPECIAL_TYPES) {
    if (!unavailable.has(type) && Number(cooldown[type] || 0) <= 0) pool.push({ type });
  }

  const selected = shuffle(pool).slice(0, COLS).map((definition) => createPiece(definition.type, definition.color || null));
  room.solo.automaLine = selected;
  for (const type of SPECIAL_TYPES) cooldown[type] = Math.max(0, Number(cooldown[type] || 0) - 1);
  return selected;
}

function countCarps(board) {
  const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
  for (const row of board) {
    for (const piece of row) {
      if (piece?.type === 'carp') counts[piece.color] += 1;
    }
  }
  return counts;
}

function countPreferredOnMiddle(board, color) {
  return board[MIDDLE_ROW].filter((piece) => piece?.type === 'carp' && piece.color === color).length;
}

function eligibleLeastColors(board, preferredColor) {
  const counts = countCarps(board);
  const candidates = COLORS
    .filter((color) => color !== preferredColor && counts[color] > 0)
    .map((color) => ({ color, count: counts[color] }));
  if (!candidates.length) return [];
  const minimum = Math.min(...candidates.map(({ count }) => count));
  return candidates.filter(({ count }) => count === minimum).map(({ color }) => color);
}

function allPlayersConnected(room) {
  return room.playerOrder.every((id) => room.players[id]?.connected);
}

function assertPlayersPresent(room) {
  if (!allPlayersConnected(room)) {
    const absent = room.playerOrder
      .map((id) => room.players[id])
      .filter((player) => player && !player.connected)
      .map((player) => player.name)
      .join(', ');
    throw new Error(`A partida está pausada. Aguardando o retorno de ${absent || 'um jogador'}.`);
  }
}

function labelColor(color) {
  return ({ yellow: 'amarela', white: 'branca', red: 'vermelha', gray: 'cinza' })[color] || color;
}

function phaseWaitLabel(phase) {
  return ({
    movement: 'Fase de movimentação',
    development: 'Fase de Venda e reposição'
  })[phase] || 'fase atual';
}

function playerFinishedPhase(player, phase) {
  if (phase === 'movement') return Boolean(player?.movementReady);
  if (phase === 'development') return Boolean(player?.development?.done);
  return false;
}

function waitingForPlayersMessage(room, playerId, phase = room.phase) {
  const pending = room.playerOrder
    .filter((id) => id !== playerId && !playerFinishedPhase(room.players[id], phase))
    .map((id) => room.players[id]?.name)
    .filter(Boolean);
  if (!pending.length) return null;
  if (pending.length === 1) return `Aguarde o jogador ${pending[0]} terminar a ${phaseWaitLabel(phase)}.`;
  const last = pending.at(-1);
  const names = `${pending.slice(0, -1).join(', ')} e ${last}`;
  return `Aguarde os jogadores ${names} terminarem a ${phaseWaitLabel(phase)}.`;
}

function addLog(room, text, actorId = null, actorRole = 'player') {
  room.updatedAt = Date.now();
  room.logs.push({ at: Date.now(), text, actorId, actorRole });
  if (room.logs.length > 150) room.logs.splice(0, room.logs.length - 150);
}

function setAction(room, action) {
  room.actionSequence += 1;
  room.lastAction = {
    id: room.actionSequence,
    at: Date.now(),
    ...action
  };
}

function createPlayer({ name, color, socketId }) {
  return {
    id: randomId(6),
    token: randomId(16),
    name: String(name || 'Jogador').trim().slice(0, 24) || 'Jogador',
    color,
    socketId,
    connected: true,
    board: null,
    movesRemaining: MOVES_PER_ROUND,
    mustMoveCarp: false,
    correctionRequired: false,
    movementReady: false,
    lastMovedPieceId: null,
    movementHistory: [],
    pendingDevelopmentCapacity: 0,
    development: null,
    coins: 0,
    extraMovesPurchased: 0,
    specialAlert: '',
    discard: Object.fromEntries(COLORS.map((item) => [item, 0]))
  };
}

function createSpectator({ name, socketId }) {
  return {
    id: randomId(6),
    token: randomId(16),
    name: String(name || 'Espectador').trim().slice(0, 24) || 'Espectador',
    socketId,
    connected: true
  };
}

function buildInitialSpecialAssignments(room) {
  const playerCount = room.playerOrder.length;
  const specialsPerPlayer = room.mode === 'solo' || playerCount === 2 ? 2 : 1;
  const shuffled = shuffle(SPECIAL_TYPES);
  const assignments = {};

  if (room.mode === 'solo') {
    assignments[room.playerOrder[0]] = shuffled.slice(0, 2);
    return assignments;
  }

  if (playerCount === 2) {
    assignments[room.playerOrder[0]] = shuffled.slice(0, 2);
    assignments[room.playerOrder[1]] = shuffled.slice(2, 4);
    return assignments;
  }

  room.playerOrder.forEach((id, index) => {
    assignments[id] = shuffled.slice(index, index + specialsPerPlayer);
  });
  return assignments;
}

function createRoom({ hostName, color, socketId, mode = 'multiplayer' }) {
  const host = createPlayer({ name: hostName, color, socketId });
  const room = {
    code: roomCode(),
    mode: mode === 'solo' ? 'solo' : 'multiplayer',
    status: 'lobby',
    phase: 'lobby',
    round: 0,
    hostId: host.id,
    playerOrder: [host.id],
    players: { [host.id]: host },
    spectators: {},
    logs: [],
    winner: null,
    restartVote: null,
    circulation: null,
    actionSequence: 0,
    lastAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    matchId: null,
    startedAt: null,
    finishedAt: null,
    restartCount: 0,
    solo: null
  };
  addLog(room, 'criou a sala.', host.id);
  return room;
}

function addPlayer(room, { name, color, socketId }) {
  if (room.mode === 'solo') throw new Error('Esta sala está no modo solo. Entre como espectador.');
  if (room.status !== 'lobby') throw new Error('A partida já começou. Entre como espectador.');
  if (room.playerOrder.length >= 4) throw new Error('A sala está cheia.');
  const normalizedName = String(name || '').trim().toLocaleLowerCase('pt-BR');
  const nameTaken = room.playerOrder.some((id) => room.players[id].name.trim().toLocaleLowerCase('pt-BR') === normalizedName);
  if (nameTaken) throw new Error('Esse nome já está em uso nesta sala.');
  if (!COLORS.includes(color)) throw new Error('Cor inválida.');
  const colorTaken = room.playerOrder.some((id) => room.players[id].color === color);
  if (colorTaken) throw new Error('Essa cor já foi escolhida.');
  const player = createPlayer({ name, color, socketId });
  room.players[player.id] = player;
  room.playerOrder.push(player.id);
  addLog(room, 'entrou na sala.', player.id);
  return player;
}

function addSpectator(room, { name, socketId }) {
  const spectator = createSpectator({ name, socketId });
  room.spectators[spectator.id] = spectator;
  addLog(room, 'entrou como espectador.', spectator.id, 'spectator');
  return spectator;
}

function removeMember(room, memberId, role) {
  if (role === 'spectator') {
    const spectator = room.spectators[memberId];
    if (!spectator) return { roomEmpty: false, retained: false };
    delete room.spectators[memberId];
    addLog(room, `${spectator.name} saiu da sala.`, null, 'system');
    return { roomEmpty: room.playerOrder.length === 0, retained: false };
  }

  const player = room.players[memberId];
  if (!player) return { roomEmpty: room.playerOrder.length === 0, retained: false };

  if (room.status !== 'lobby') {
    player.connected = false;
    player.socketId = null;
    addLog(room, 'saiu da tela da partida e pode retornar com o mesmo nome e código.', player.id);
    return { roomEmpty: false, retained: true };
  }

  delete room.players[memberId];
  room.playerOrder = room.playerOrder.filter((id) => id !== memberId);
  addLog(room, `${player.name} saiu da sala.`, null, 'system');
  if (room.hostId === memberId) room.hostId = room.playerOrder[0] || null;
  return { roomEmpty: room.playerOrder.length === 0, retained: false };
}

function resetPlayerForRound(player, initializeBoard = false, setup = {}) {
  if (initializeBoard) player.board = createInitialBoard(setup.playerCount || 2, setup.mode || 'multiplayer', setup.specialTypes || null);
  player.movesRemaining = MOVES_PER_ROUND;
  player.mustMoveCarp = false;
  player.correctionRequired = false;
  player.movementReady = false;
  player.lastMovedPieceId = null;
  player.movementHistory = [];
  player.pendingDevelopmentCapacity = 0;
  player.development = null;
  player.extraMovesPurchased = 0;
  player.specialAlert = '';
}

function initializeMatch(room, restarted = false) {
  room.status = 'playing';
  room.phase = 'movement';
  room.round = 1;
  room.winner = null;
  room.restartVote = null;
  room.circulation = null;
  room.matchId = randomId(10);
  room.startedAt = Date.now();
  room.finishedAt = null;
  if (restarted) room.restartCount += 1;
  room.solo = room.mode === 'solo' ? {
    exitedPreferred: 0,
    automaLine: null,
    specialCooldown: Object.fromEntries(SPECIAL_TYPES.map((type) => [type, 0]))
  } : null;
  const specialAssignments = buildInitialSpecialAssignments(room);
  for (const id of room.playerOrder) {
    const player = room.players[id];
    player.discard = Object.fromEntries(COLORS.map((item) => [item, 0]));
    player.coins = 0;
    resetPlayerForRound(player, true, {
      playerCount: room.playerOrder.length,
      mode: room.mode,
      specialTypes: specialAssignments[id] || null
    });
  }
  if (room.mode === 'solo') generateAutomaLine(room, room.players[room.playerOrder[0]]);
  setAction(room, { type: restarted ? 'restartComplete' : 'gameStart' });
  addLog(room, restarted ? 'A partida foi reiniciada por acordo dos jogadores.' : 'A partida começou.');
}

function startGame(room, requesterId) {
  if (room.hostId !== requesterId) throw new Error('Somente o anfitrião pode iniciar.');
  if (room.status !== 'lobby') throw new Error('A partida já começou.');
  if (room.mode === 'solo' ? room.playerOrder.length !== 1 : room.playerOrder.length < 2) throw new Error(room.mode === 'solo' ? 'O modo solo deve ter exatamente 1 jogador.' : 'São necessários pelo menos 2 jogadores.');
  if (!allPlayersConnected(room)) throw new Error('Aguarde todos os jogadores retornarem antes de iniciar.');
  initializeMatch(room, false);
}

function restartGame(room) {
  if (room.mode !== 'solo' && room.playerOrder.length < 2) throw new Error('São necessários pelo menos 2 jogadores.');
  initializeMatch(room, true);
}

function requestRestart(room, requesterId) {
  assertPlayersPresent(room);
  if (room.mode === 'solo') {
    restartGame(room);
    return { restarted: true };
  }
  if (!['playing', 'finished'].includes(room.status)) throw new Error('A partida ainda não começou.');
  if (!room.players[requesterId]) throw new Error('Somente jogadores podem solicitar reinício.');
  if (room.restartVote) throw new Error('Já existe uma votação de reinício em andamento.');
  room.restartVote = {
    id: randomId(6),
    requesterId,
    approvals: [requesterId],
    createdAt: Date.now()
  };
  setAction(room, { type: 'restartRequested', playerId: requesterId });
  addLog(room, 'solicitou o reinício da partida.', requesterId);
}

function respondRestart(room, playerId, accept) {
  assertPlayersPresent(room);
  const vote = room.restartVote;
  if (!vote) throw new Error('Não há votação de reinício em andamento.');
  if (!room.players[playerId]) throw new Error('Somente jogadores participam da decisão.');
  if (vote.approvals.includes(playerId)) throw new Error('Você já confirmou essa solicitação.');

  if (!accept) {
    addLog(room, 'recusou o reinício da partida.', playerId);
    setAction(room, { type: 'restartRejected', playerId, requesterId: vote.requesterId });
    room.restartVote = null;
    return { restarted: false, rejected: true };
  }

  vote.approvals.push(playerId);
  addLog(room, 'aceitou o reinício da partida.', playerId);
  if (room.playerOrder.every((id) => vote.approvals.includes(id))) {
    restartGame(room);
    return { restarted: true, rejected: false };
  }
  setAction(room, { type: 'restartAccepted', playerId, requesterId: vote.requesterId });
  return { restarted: false, rejected: false };
}

function movePiece(room, playerId, from) {
  assertPlayersPresent(room);
  if (room.phase !== 'movement') throw new Error('Não é a fase de movimentação.');
  const player = room.players[playerId];
  if (!player) throw new Error('Jogador não encontrado.');
  if (player.movementReady) throw new Error(waitingForPlayersMessage(room, playerId, 'movement') || 'Você já concluiu a Fase de movimentação.');
  if (!isInside(from.row, from.col)) throw new Error('Posição inválida.');

  const board = player.board;
  const empty = findEmpty(board);
  const piece = board[from.row][from.col];
  if (!piece) throw new Error('Escolha uma peça.');
  if (!isOrthogonallyAdjacent(from, empty)) throw new Error('A peça deve estar ao lado do espaço vazio.');

  if (player.correctionRequired) {
    const validCorrection = from.col === empty.col && Math.abs(from.row - empty.row) === 1 && from.row !== MIDDLE_ROW;
    if (!validCorrection) throw new Error('Preencha a linha central usando a peça imediatamente acima ou abaixo.');
    player.movementHistory.push(snapshotMovementState(player));
    const orientation = orientPieceForMovement(piece, from, empty);
    board[empty.row][empty.col] = piece;
    board[from.row][from.col] = null;
    player.correctionRequired = false;
    player.lastMovedPieceId = piece.id;
    player.specialAlert = '';
    setAction(room, { type: 'correctionMove', playerId, from: { ...from }, to: { ...empty }, pieceId: piece.id, ...orientation });
    addLog(room, 'retirou o vazio da linha central.', playerId);
    return { correction: true, specialMoved: false };
  }

  if (player.movesRemaining <= 0) throw new Error('Seus movimentos disponíveis terminaram. Compre um movimento extra ou conclua a fase.');
  if (SPECIAL_TYPES.includes(piece.type)) throw new Error('As peças especiais se movimentam automaticamente quando o espaço vazio ativa sua ação.');
  if (player.mustMoveCarp && piece.type !== 'carp') throw new Error('Depois de uma alga, você deve mover uma carpa.');

  const projected = cloneBoard(board);
  projected[empty.row][empty.col] = clonePiece(piece);
  projected[from.row][from.col] = null;
  const specialTrigger = detectSpecialTrigger(projected, from);
  const createsCarpObligation = piece.type === 'algae';
  const pieceMoveCost = createsCarpObligation ? 0 : 1;
  const specialCost = Number(specialTrigger?.cost || 0);
  const currentCost = pieceMoveCost + specialCost;
  const futureRequired = createsCarpObligation ? 1 : 0;
  if (player.movesRemaining < currentCost + futureRequired) {
    throw new Error('Não há movimentos suficientes para completar essa ação e suas obrigações.');
  }

  player.movementHistory.push(snapshotMovementState(player));
  player.specialAlert = '';
  const fulfillsCarpObligation = player.mustMoveCarp && piece.type === 'carp';
  const orientation = orientPieceForMovement(piece, from, empty);
  board[empty.row][empty.col] = piece;
  board[from.row][from.col] = null;
  player.movesRemaining -= pieceMoveCost;
  if (fulfillsCarpObligation) player.mustMoveCarp = false;
  if (createsCarpObligation) player.mustMoveCarp = true;

  let specialAction = null;
  const trigger = detectSpecialTrigger(board, findEmpty(board));
  if (trigger) {
    specialAction = applySpecialTrigger(board, trigger);
    player.movesRemaining -= specialAction.cost;
    player.specialAlert = specialAction.message;
    addLog(room, specialAction.message, playerId);
  }

  if (player.movesRemaining === 0) {
    const finalEmpty = findEmpty(board);
    player.correctionRequired = finalEmpty.row === MIDDLE_ROW;
  }

  player.lastMovedPieceId = specialAction?.pieceId || piece.id;
  setAction(room, {
    type: 'move',
    playerId,
    from: { ...from },
    to: { ...empty },
    pieceId: piece.id,
    ...orientation,
    special: specialAction
  });
  const moveLimit = MOVES_PER_ROUND + player.extraMovesPurchased;
  if (createsCarpObligation && !specialAction) {
    addLog(room, 'moveu uma alga sem gastar movimento; agora deve mover uma carpa.', playerId);
  } else if (!specialAction) {
    addLog(room, `realizou o movimento ${moveLimit - player.movesRemaining}/${moveLimit}.`, playerId);
  }
  return { correction: false, specialMoved: Boolean(specialAction), specialType: specialAction?.type || null };
}

function undoLastMove(room, playerId) {
  assertPlayersPresent(room);
  if (room.phase !== 'movement') throw new Error('Só é possível desfazer durante a fase de movimentação.');
  const player = room.players[playerId];
  if (!player) throw new Error('Jogador não encontrado.');
  if (player.movementReady) throw new Error(waitingForPlayersMessage(room, playerId, 'movement') || 'Você já concluiu a Fase de movimentação.');
  const snapshot = player.movementHistory.pop();
  if (!snapshot) throw new Error('Não há jogadas para desfazer.');

  const boardBeforeUndo = cloneBoard(player.board);
  restoreMovementState(player, snapshot);
  const positions = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if ((boardBeforeUndo[row][col]?.id || null) !== (player.board[row][col]?.id || null)) positions.push({ row, col });
    }
  }
  setAction(room, {
    type: 'undo',
    playerId,
    positions,
    movesRemaining: player.movesRemaining,
    historyRemaining: player.movementHistory.length
  });
  addLog(room, 'desfez a última jogada.', playerId);
  return { historyRemaining: player.movementHistory.length };
}

function buyExtraMove(room, playerId) {
  assertPlayersPresent(room);
  if (room.phase !== 'movement') throw new Error('Movimentos extras só podem ser comprados na fase de movimentação.');
  const player = room.players[playerId];
  if (!player) throw new Error('Jogador não encontrado.');
  if (player.movementReady) throw new Error(waitingForPlayersMessage(room, playerId, 'movement') || 'Você já concluiu a Fase de movimentação.');
  if (player.coins < EXTRA_MOVE_COST) throw new Error(`São necessárias ${EXTRA_MOVE_COST} moedas para comprar um movimento extra.`);

  player.coins -= EXTRA_MOVE_COST;
  player.extraMovesPurchased += 1;
  player.movesRemaining += 1;
  player.correctionRequired = false;
  setAction(room, {
    type: 'extraMovePurchased',
    playerId,
    cost: EXTRA_MOVE_COST,
    coins: player.coins,
    movesRemaining: player.movesRemaining,
    moveLimit: MOVES_PER_ROUND + player.extraMovesPurchased
  });
  addLog(room, `gastou ${EXTRA_MOVE_COST} moedas e comprou 1 movimento extra.`, playerId);
  return {
    coins: player.coins,
    movesRemaining: player.movesRemaining,
    moveLimit: MOVES_PER_ROUND + player.extraMovesPurchased
  };
}

function markMovementReady(room, playerId) {
  assertPlayersPresent(room);
  if (room.phase !== 'movement') throw new Error('Não é a fase de movimentação.');
  const player = room.players[playerId];
  if (!player) throw new Error('Jogador não encontrado.');
  if (player.movementReady) throw new Error(waitingForPlayersMessage(room, playerId, 'movement') || 'Você já concluiu a Fase de movimentação.');
  if (player.movesRemaining !== 0) throw new Error(`Complete os ${MOVES_PER_ROUND + player.extraMovesPurchased} movimentos disponíveis.`);
  if (player.mustMoveCarp) throw new Error('Ainda é necessário mover uma carpa.');
  if (player.correctionRequired) throw new Error('Retire o espaço vazio da linha central.');
  player.movementReady = true;
  addLog(room, 'concluiu a movimentação.', playerId);

  if (room.playerOrder.every((id) => room.players[id].movementReady)) {
    for (const id of room.playerOrder) {
      const current = room.players[id];
      current.pendingDevelopmentCapacity = countPreferredOnMiddle(current.board, current.color);
    }
    beginCirculation(room);
  }
}

function beginDevelopment(room) {
  room.phase = 'development';
  for (const id of room.playerOrder) {
    const player = room.players[id];
    const capacity = player.pendingDevelopmentCapacity;
    const eligibleColors = eligibleLeastColors(player.board, player.color);
    player.development = {
      capacity,
      eligibleColors,
      chosenColor: eligibleColors.length === 1 ? eligibleColors[0] : null,
      replaced: 0,
      done: capacity === 0 || eligibleColors.length === 0
    };
  }
  setAction(room, { type: 'phaseChange', phase: 'development' });
  addLog(room, 'Começou a fase de Venda e reposição.');
  completeZeroDevelopments(room);
}

function refreshDevelopmentOptions(player) {
  const development = player.development;
  if (!development || development.done) return;
  if (development.replaced >= development.capacity) {
    development.done = true;
    development.chosenColor = null;
    development.eligibleColors = [];
    return;
  }

  const counts = countCarps(player.board);
  if (development.chosenColor && counts[development.chosenColor] > 0) return;

  development.eligibleColors = eligibleLeastColors(player.board, player.color);
  development.chosenColor = development.eligibleColors.length === 1 ? development.eligibleColors[0] : null;
  if (development.eligibleColors.length === 0) development.done = true;
}

function completeZeroDevelopments(room) {
  if (room.playerOrder.every((id) => room.players[id].development?.done)) finishDevelopmentAndAdvance(room);
}

function chooseDevelopmentColor(room, playerId, color) {
  assertPlayersPresent(room);
  if (room.phase !== 'development') throw new Error('Não é a fase de Venda e reposição.');
  const player = room.players[playerId];
  const development = player?.development;
  if (!development) throw new Error('Reposição indisponível.');
  if (development.done) throw new Error(waitingForPlayersMessage(room, playerId, 'development') || 'Você já concluiu a Fase de Venda e reposição.');
  refreshDevelopmentOptions(player);
  if (!development.eligibleColors.includes(color)) throw new Error('Essa cor não está entre as menos numerosas neste momento.');
  development.chosenColor = color;
  setAction(room, { type: 'developmentColorChosen', playerId, color });
  addLog(room, `escolheu substituir carpas ${labelColor(color)}s.`, playerId);
}

function replaceFish(room, playerId, position) {
  assertPlayersPresent(room);
  if (room.phase !== 'development') throw new Error('Não é a fase de Venda e reposição.');
  const player = room.players[playerId];
  const development = player?.development;
  if (!development) throw new Error('Reposição indisponível.');
  if (development.done) throw new Error(waitingForPlayersMessage(room, playerId, 'development') || 'Você já concluiu a Fase de Venda e reposição.');
  refreshDevelopmentOptions(player);
  if (!development.chosenColor) throw new Error('Escolha primeiro uma das cores menos numerosas.');
  if (!isInside(position.row, position.col)) throw new Error('Posição inválida.');

  const piece = player.board[position.row][position.col];
  if (piece?.type !== 'carp' || piece.color !== development.chosenColor) {
    throw new Error('Escolha uma carpa da cor selecionada.');
  }
  if (development.replaced >= development.capacity) throw new Error('Você já realizou todas as substituições conquistadas.');

  const oldColor = piece.color;
  player.discard[oldColor] += 1;
  player.coins += 1;
  const replacement = createPiece('carp', player.color);
  player.board[position.row][position.col] = replacement;
  development.replaced += 1;

  const exhaustedColor = countCarps(player.board)[oldColor] === 0;
  refreshDevelopmentOptions(player);
  setAction(room, {
    type: 'replace',
    playerId,
    position: { ...position },
    oldColor,
    newColor: player.color,
    pieceId: replacement.id,
    coins: player.coins,
    exhaustedColor,
    needsNextColor: !development.done && !development.chosenColor
  });
  addLog(room, `trocou uma carpa ${labelColor(oldColor)} por uma ${labelColor(player.color)} e recebeu 1 moeda.`, playerId);

  if (development.done) {
    addLog(room, `concluiu ${development.replaced} reposição(ões).`, playerId);
  } else if (exhaustedColor) {
    addLog(room, `esgotou as carpas ${labelColor(oldColor)}s e deve seguir para a próxima menor cor.`, playerId);
  }

  if (room.playerOrder.every((id) => room.players[id].development?.done)) finishDevelopmentAndAdvance(room);
}

function finishDevelopmentAndAdvance(room) {
  if (room.round >= MAX_ROUNDS) {
    finishGame(room);
    return;
  }

  room.round += 1;
  room.phase = 'movement';
  for (const id of room.playerOrder) resetPlayerForRound(room.players[id], false);
  if (room.mode === 'solo') generateAutomaLine(room, room.players[room.playerOrder[0]]);
  setAction(room, { type: 'phaseChange', phase: 'movement', round: room.round });
  addLog(room, `Rodada ${room.round} iniciada.`);
}

function beginCirculation(room) {
  if (room.phase === 'circulation') return;
  room.phase = 'circulation';
  const outgoing = {};
  const routes = [];
  const turns = {};

  if (room.mode === 'solo') {
    const playerId = room.playerOrder[0];
    const player = room.players[playerId];
    player.lastMovedPieceId = null;
    player.board[MIDDLE_ROW].forEach((piece) => {
      const turn = orientPieceForCurrent(piece);
      if (turn) turns[piece.id] = turn;
      if (piece?.type === 'carp' && piece.color === player.color) room.solo.exitedPreferred += 1;
      if (piece && SPECIAL_TYPES.includes(piece.type)) room.solo.specialCooldown[piece.type] = 1;
    });
    outgoing[playerId] = player.board[MIDDLE_ROW].map(clonePiece);
    routes.push({ senderId: playerId, receiverId: 'automa' });
  } else {
    for (let index = 0; index < room.playerOrder.length; index += 1) {
      const senderId = room.playerOrder[index];
      const receiverId = room.playerOrder[(index + 1) % room.playerOrder.length];
      const sender = room.players[senderId];
      sender.lastMovedPieceId = null;
      sender.board[MIDDLE_ROW].forEach((piece) => {
        const turn = orientPieceForCurrent(piece);
        if (turn) turns[piece.id] = turn;
      });
      outgoing[senderId] = sender.board[MIDDLE_ROW].map(clonePiece);
      routes.push({ senderId, receiverId });
    }
  }

  room.circulation = {
    id: randomId(6),
    startedAt: Date.now(),
    stage: 'outgoing',
    durationMs: Math.ceil(CIRCULATION_DURATION_MS / 2),
    outgoing,
    routes,
    incomingAutoma: room.mode === 'solo' ? room.solo.automaLine.map(clonePiece) : null
  };
  setAction(room, { type: 'circulationStart', routes, turns });
  addLog(room, 'Começou a Fase da Correnteza.');
}

function completeCirculation(room) {
  if (room.phase !== 'circulation' || !room.circulation) return false;

  if (room.circulation.stage === 'outgoing') {
    const { outgoing, routes, incomingAutoma } = room.circulation;
    if (room.mode === 'solo') {
      const playerId = room.playerOrder[0];
      room.players[playerId].board[MIDDLE_ROW] = incomingAutoma.map(clonePiece);
    } else {
      for (const { senderId, receiverId } of routes) {
        room.players[receiverId].board[MIDDLE_ROW] = outgoing[senderId].map(clonePiece);
      }
    }
    room.circulation.stage = 'incoming';
    room.circulation.startedAt = Date.now();
    room.circulation.durationMs = Math.floor(CIRCULATION_DURATION_MS / 2);
    setAction(room, { type: 'circulationComplete', routes });
    addLog(room, room.mode === 'solo' ? 'A linha do Automa entrou no tanque mantendo a ordem das peças.' : 'As linhas centrais entraram nos novos tanques mantendo a ordem das peças.');
    return true;
  }

  room.circulation = null;
  beginDevelopment(room);
  return true;
}

function calculateScores(room) {
  const scores = Object.fromEntries(COLORS.map((color) => [color, 0]));
  const byTank = {};
  for (const id of room.playerOrder) {
    const counts = countCarps(room.players[id].board);
    byTank[id] = counts;
    for (const color of COLORS) scores[color] += counts[color];
  }
  return { scores, byTank };
}

function finishGame(room) {
  room.status = 'finished';
  room.phase = 'finished';
  room.finishedAt = Date.now();
  if (room.mode === 'solo') {
    const playerId = room.playerOrder[0];
    const player = room.players[playerId];
    const remainingPreferred = countCarps(player.board)[player.color];
    const exitedPreferred = Number(room.solo?.exitedPreferred || 0);
    const soloScore = exitedPreferred + remainingPreferred;
    room.winner = {
      solo: true,
      playerIds: [playerId],
      score: soloScore,
      soloScore,
      exitedPreferred,
      remainingPreferred,
      ranking: [{ playerId, color: player.color, score: soloScore, coins: player.coins }]
    };
    setAction(room, { type: 'gameFinished', playerIds: [playerId], score: soloScore, solo: true });
    addLog(room, `A partida solo terminou com ${soloScore} carpas preferidas no recorde.`);
    return;
  }
  const result = calculateScores(room);
  const ranking = room.playerOrder
    .map((id) => ({
      playerId: id,
      color: room.players[id].color,
      score: result.scores[room.players[id].color],
      coins: room.players[id].coins
    }))
    .sort((a, b) => b.score - a.score || b.coins - a.coins || room.playerOrder.indexOf(a.playerId) - room.playerOrder.indexOf(b.playerId));

  const first = ranking[0];
  const playerIds = ranking
    .filter((entry) => entry.score === first.score && entry.coins === first.coins)
    .map((entry) => entry.playerId);

  room.winner = {
    score: first.score,
    coins: first.coins,
    playerIds,
    ranking,
    ...result
  };
  setAction(room, { type: 'gameFinished', playerIds, score: first.score, coins: first.coins });
  addLog(room, 'A partida terminou. Em caso de empate em carpas, as moedas decidiram a classificação.');
}

function publicRoom(room) {
  const players = {};
  for (const id of room.playerOrder) {
    const player = room.players[id];
    players[id] = {
      id: player.id,
      name: player.name,
      color: player.color,
      connected: player.connected,
      board: player.board,
      movesRemaining: player.movesRemaining,
      mustMoveCarp: player.mustMoveCarp,
      correctionRequired: player.correctionRequired,
      movementReady: player.movementReady,
      lastMovedPieceId: player.lastMovedPieceId,
      movementHistoryLength: player.movementHistory.length,
      development: player.development,
      coins: player.coins,
      extraMovesPurchased: player.extraMovesPurchased,
      moveLimit: MOVES_PER_ROUND + player.extraMovesPurchased,
      discard: player.discard,
      specialAlert: player.specialAlert || ''
    };
  }

  const spectators = {};
  for (const [id, spectator] of Object.entries(room.spectators)) {
    spectators[id] = {
      id: spectator.id,
      name: spectator.name,
      connected: spectator.connected
    };
  }

  return {
    code: room.code,
    mode: room.mode || 'multiplayer',
    status: room.status,
    phase: room.phase,
    round: room.round,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    matchId: room.matchId,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    restartCount: room.restartCount,
    hostId: room.hostId,
    playerOrder: room.playerOrder,
    players,
    spectators,
    logs: room.logs.slice(-50),
    liveScores: room.playerOrder.every((id) => room.players[id].board) ? calculateScores(room) : null,
    winner: room.winner,
    disconnectedPlayerIds: room.playerOrder.filter((id) => !room.players[id].connected),
    restartVote: room.restartVote ? {
      id: room.restartVote.id,
      requesterId: room.restartVote.requesterId,
      approvals: [...room.restartVote.approvals],
      createdAt: room.restartVote.createdAt
    } : null,
    circulation: room.circulation ? {
      id: room.circulation.id,
      startedAt: room.circulation.startedAt,
      stage: room.circulation.stage,
      durationMs: room.circulation.durationMs,
      routes: room.circulation.routes
    } : null,
    lastAction: room.lastAction,
    solo: room.mode === 'solo' && room.solo ? {
      exitedPreferred: room.solo.exitedPreferred,
      automaLine: room.solo.automaLine,
      specialCooldown: room.solo.specialCooldown
    } : null,
    constants: {
      rows: ROWS,
      cols: COLS,
      middleRow: MIDDLE_ROW,
      movesPerRound: MOVES_PER_ROUND,
      maxRounds: MAX_ROUNDS,
      circulationDurationMs: CIRCULATION_DURATION_MS,
      extraMoveCost: EXTRA_MOVE_COST,
      colors: COLORS,
      specialTypes: SPECIAL_TYPES
    }
  };
}

module.exports = {
  COLORS,
  SPECIAL_TYPES,
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
  calculateScores,
  finishGame,
  randomId,
  allPlayersConnected
};
