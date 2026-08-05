const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRoom,
  addPlayer,
  addSpectator,
  startGame,
  requestRestart,
  respondRestart,
  publicRoom,
  calculateScores,
  completeCirculation,
  movePiece,
  undoLastMove,
  removeMember,
  chooseDevelopmentColor,
  replaceFish,
  buyExtraMove,
  markMovementReady,
  finishGame
} = require('../src/game');

function makeTwoPlayerRoom() {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a' });
  addPlayer(room, { name: 'Beto', color: 'red', socketId: 'b' });
  return room;
}

test('cria a preparação equilibrada com centro vazio', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const counts = calculateScores({ ...room, playerOrder: [room.hostId] }).scores;
  assert.deepEqual(counts, { yellow: 7, white: 7, red: 7, gray: 7 });
  assert.equal(player.board[2][3], null);
  assert.equal(player.board.flat().filter((piece) => piece?.type === 'algae').length, 5);
  assert.equal(player.board.flat().filter((piece) => piece?.type === 'shoal').length, 1);
  assert.equal(publicRoom(room).constants.movesPerRound, 12);
  assert.equal(publicRoom(room).constants.maxRounds, 6);
});

test('espectador entra sem ocupar cor ou vaga de jogador', () => {
  const room = makeTwoPlayerRoom();
  const spectator = addSpectator(room, { name: 'Clara', socketId: 'c' });
  const visible = publicRoom(room);
  assert.equal(room.playerOrder.length, 2);
  assert.equal(visible.spectators[spectator.id].name, 'Clara');
});

test('reinício exige aprovação de todos os jogadores', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const otherId = room.playerOrder[1];
  const previousBoard = room.players[room.hostId].board;
  requestRestart(room, room.hostId);
  assert.deepEqual(room.restartVote.approvals, [room.hostId]);
  const result = respondRestart(room, otherId, true);
  assert.equal(result.restarted, true);
  assert.equal(room.round, 1);
  assert.equal(room.phase, 'movement');
  assert.notEqual(room.players[room.hostId].board, previousBoard);
  assert.equal(room.restartVote, null);
});

test('recusa cancela a votação de reinício', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  requestRestart(room, room.hostId);
  const result = respondRestart(room, room.playerOrder[1], false);
  assert.equal(result.rejected, true);
  assert.equal(room.restartVote, null);
});

test('circulação troca as linhas centrais antes da reposição', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const [a, b] = room.playerOrder;
  room.players[a].pendingDevelopmentCapacity = 1;
  room.players[b].pendingDevelopmentCapacity = 1;
  const lineA = room.players[a].board[2].map((piece) => piece && piece.id);
  const lineB = room.players[b].board[2].map((piece) => piece && piece.id);
  room.phase = 'circulation';
  room.circulation = {
    outgoing: {
      [a]: room.players[a].board[2].map((piece) => piece && { ...piece }),
      [b]: room.players[b].board[2].map((piece) => piece && { ...piece })
    },
    routes: [
      { senderId: a, receiverId: b },
      { senderId: b, receiverId: a }
    ]
  };
  room.circulation.stage = 'outgoing';
  assert.equal(completeCirculation(room), true);
  assert.deepEqual(room.players[a].board[2].map((piece) => piece && piece.id), lineB);
  assert.deepEqual(room.players[b].board[2].map((piece) => piece && piece.id), lineA);
  assert.equal(room.phase, 'circulation');
  assert.equal(room.circulation.stage, 'incoming');
  assert.equal(completeCirculation(room), true);
  assert.equal(room.round, 1);
  assert.equal(room.phase, 'development');
});


test('carpa gira a cabeça para a direção do movimento', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const board = player.board;

  let carpPosition = null;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (!carpPosition && board[row][col]?.type === 'carp') carpPosition = { row, col };
    }
  }

  const target = { row: 2, col: 2 };
  [board[carpPosition.row][carpPosition.col], board[target.row][target.col]] = [board[target.row][target.col], board[carpPosition.row][carpPosition.col]];

  let shoalPosition = null;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (board[row][col]?.type === 'shoal') shoalPosition = { row, col };
    }
  }

  if (Math.abs(shoalPosition.row - target.row) + Math.abs(shoalPosition.col - target.col) === 1) {
    const safe = { row: 0, col: 0 };
    [board[shoalPosition.row][shoalPosition.col], board[safe.row][safe.col]] = [board[safe.row][safe.col], board[shoalPosition.row][shoalPosition.col]];
  }

  const movedId = board[target.row][target.col].id;
  movePiece(room, room.hostId, target);
  const moved = board[2][3];
  assert.equal(moved.id, movedId);
  assert.equal(moved.rotation, 270);
  assert.equal(player.lastMovedPieceId, movedId);
  assert.equal(player.movesRemaining, 11);
});

test('mover uma alga não gasta movimento e obriga mover uma carpa', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const board = player.board;
  const target = { row: 2, col: 2 };

  let algaePosition = null;
  let shoalPosition = null;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (!algaePosition && board[row][col]?.type === 'algae') algaePosition = { row, col };
      if (board[row][col]?.type === 'shoal') shoalPosition = { row, col };
    }
  }
  [board[algaePosition.row][algaePosition.col], board[target.row][target.col]] = [board[target.row][target.col], board[algaePosition.row][algaePosition.col]];
  if (Math.abs(shoalPosition.row - target.row) + Math.abs(shoalPosition.col - target.col) === 1) {
    const safe = { row: 0, col: 0 };
    [board[shoalPosition.row][shoalPosition.col], board[safe.row][safe.col]] = [board[safe.row][safe.col], board[shoalPosition.row][shoalPosition.col]];
  }

  movePiece(room, room.hostId, target);
  assert.equal(player.movesRemaining, 12);
  assert.equal(player.mustMoveCarp, true);
  assert.match(room.logs.at(-1).text, /sem gastar movimento/);
});

test('desfazer restaura o tabuleiro e o contador de movimentos', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const empty = { row: 2, col: 3 };
  const from = { row: 2, col: 2 };

  // Garante uma carpa adjacente e afasta o cardume para o teste ser determinístico.
  let carpPosition = null;
  let shoalPosition = null;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (!carpPosition && player.board[row][col]?.type === 'carp') carpPosition = { row, col };
      if (player.board[row][col]?.type === 'shoal') shoalPosition = { row, col };
    }
  }
  [player.board[carpPosition.row][carpPosition.col], player.board[from.row][from.col]] = [player.board[from.row][from.col], player.board[carpPosition.row][carpPosition.col]];
  if (Math.abs(shoalPosition.row - from.row) + Math.abs(shoalPosition.col - from.col) === 1) {
    const safe = { row: 0, col: 0 };
    [player.board[shoalPosition.row][shoalPosition.col], player.board[safe.row][safe.col]] = [player.board[safe.row][safe.col], player.board[shoalPosition.row][shoalPosition.col]];
  }

  const before = player.board.map((row) => row.map((piece) => piece && { ...piece }));
  movePiece(room, room.hostId, from);
  assert.equal(player.movesRemaining, 11);
  assert.equal(player.movementHistory.length, 1);

  undoLastMove(room, room.hostId);
  assert.equal(player.movesRemaining, 12);
  assert.equal(player.movementHistory.length, 0);
  assert.deepEqual(player.board, before);
  assert.equal(room.logs.at(-1).text, 'desfez a última jogada.');
  assert.equal(player.board[empty.row][empty.col], null);
});

test('sair durante a partida preserva a vaga para retorno', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const result = removeMember(room, player.id, 'player');
  assert.equal(result.retained, true);
  assert.equal(room.players[player.id].connected, false);
  assert.equal(room.playerOrder.includes(player.id), true);
});


test('reposição continua para a próxima menor cor e cada retirada rende uma moeda', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];

  const carps = player.board.flat().filter((piece) => piece?.type === 'carp');
  const colors = [
    ...Array(20).fill('yellow'),
    ...Array(2).fill('white'),
    'red',
    ...Array(5).fill('gray')
  ];
  carps.forEach((piece, index) => { piece.color = colors[index]; });

  room.phase = 'development';
  player.development = {
    capacity: 4,
    eligibleColors: ['white'],
    chosenColor: 'white',
    replaced: 0,
    done: false
  };
  const other = room.players[room.playerOrder[1]];
  other.development = { capacity: 0, eligibleColors: [], chosenColor: null, replaced: 0, done: true };

  function positionOf(color) {
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        if (player.board[row][col]?.type === 'carp' && player.board[row][col].color === color) return { row, col };
      }
    }
    return null;
  }

  replaceFish(room, player.id, positionOf('white'));
  replaceFish(room, player.id, positionOf('white'));
  assert.equal(player.development.chosenColor, 'red');
  replaceFish(room, player.id, positionOf('red'));
  assert.equal(player.development.chosenColor, 'gray');
  replaceFish(room, player.id, positionOf('gray'));

  assert.equal(player.coins, 4);
  assert.equal(room.round, 2);
  assert.equal(room.phase, 'movement');
  assert.equal(player.development, null);
});

test('três moedas compram um movimento extra', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  player.coins = 6;

  buyExtraMove(room, player.id);
  buyExtraMove(room, player.id);

  assert.equal(player.coins, 0);
  assert.equal(player.movesRemaining, 14);
  assert.equal(player.extraMovesPurchased, 2);
  assert.equal(publicRoom(room).players[player.id].moveLimit, 14);
});

test('moedas desempata a classificação final', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const [a, b] = room.playerOrder;
  room.players[a].coins = 1;
  room.players[b].coins = 4;

  finishGame(room);

  assert.deepEqual(room.winner.playerIds, [b]);
  assert.equal(room.winner.ranking[0].playerId, b);
  assert.equal(room.winner.ranking[0].coins, 4);
});

test('movimento extra comprado depois de uma jogada é preservado ao desfazer', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const target = { row: 2, col: 2 };

  let carpPosition = null;
  let shoalPosition = null;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (!carpPosition && player.board[row][col]?.type === 'carp') carpPosition = { row, col };
      if (player.board[row][col]?.type === 'shoal') shoalPosition = { row, col };
    }
  }
  [player.board[carpPosition.row][carpPosition.col], player.board[target.row][target.col]] = [player.board[target.row][target.col], player.board[carpPosition.row][carpPosition.col]];
  if (Math.abs(shoalPosition.row - target.row) + Math.abs(shoalPosition.col - target.col) === 1) {
    const safe = { row: 0, col: 0 };
    [player.board[shoalPosition.row][shoalPosition.col], player.board[safe.row][safe.col]] = [player.board[safe.row][safe.col], player.board[shoalPosition.row][shoalPosition.col]];
  }

  movePiece(room, player.id, target);
  player.coins = 3;
  buyExtraMove(room, player.id);
  undoLastMove(room, player.id);

  assert.equal(player.coins, 0);
  assert.equal(player.extraMovesPurchased, 1);
  assert.equal(player.movesRemaining, 13);
});


test('jogador pronto recebe aviso nominal enquanto aguarda a fase dos demais', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const [hostId, otherId] = room.playerOrder;
  const host = room.players[hostId];
  host.movesRemaining = 0;
  host.mustMoveCarp = false;
  host.correctionRequired = false;
  markMovementReady(room, hostId);

  assert.equal(host.movementReady, true);
  assert.equal(room.players[otherId].movementReady, false);
  assert.throws(
    () => movePiece(room, hostId, { row: 0, col: 0 }),
    new RegExp(`Aguarde o jogador ${room.players[otherId].name} terminar a Fase de movimentação`)
  );
});
