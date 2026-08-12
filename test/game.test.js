const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRoom,
  SPECIAL_TYPES,
  addPlayer,
  addBot,
  removeBot,
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
  replaceFish,
  buyExtraMove,
  markMovementReady,
  markDevelopmentReady,
  setGameRuleset,
  finishGame
} = require('../src/game');

function makeTwoPlayerRoom() {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a' });
  addPlayer(room, { name: 'Beto', color: 'red', socketId: 'b' });
  return room;
}

function neutralizeSpecials(player) {
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const piece = player.board[row][col];
      if (piece && SPECIAL_TYPES.includes(piece.type)) player.board[row][col] = { ...piece, type: 'carp', color: 'gray' };
    }
  }
}

function blankBoard() {
  const board = Array.from({ length: 5 }, () => Array(7).fill(null));
  let id = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (row === 2 && col === 3) continue;
      board[row][col] = { id: `p${id++}`, type: 'carp', color: 'gray', rotation: 0 };
    }
  }
  return board;
}

test('cria a preparação equilibrada com centro vazio', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const counts = calculateScores({ ...room, playerOrder: [room.hostId] }).scores;
  assert.deepEqual(counts, { yellow: 7, white: 7, red: 7, gray: 7 });
  assert.equal(player.board[2][3], null);
  assert.equal(player.board.flat().filter((piece) => piece?.type === 'algae').length, 4);
  const specials = player.board.flat().filter((piece) => SPECIAL_TYPES.includes(piece?.type));
  assert.equal(specials.length, 2);
  assert.equal(new Set(specials.map((piece) => piece.type)).size, 2);
  assert.equal(publicRoom(room).constants.movesPerRound, 12);
  assert.equal(publicRoom(room).constants.maxRounds, 5);
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
    routes: [{ senderId: a, receiverId: b }, { senderId: b, receiverId: a }],
    stage: 'outgoing'
  };
  assert.equal(completeCirculation(room), true);
  assert.deepEqual(room.players[a].board[2].map((piece) => piece && piece.id), lineB);
  assert.deepEqual(room.players[b].board[2].map((piece) => piece && piece.id), lineA);
  assert.equal(room.circulation.stage, 'incoming');
  assert.equal(completeCirculation(room), true);
  assert.equal(room.phase, 'development');
});

test('carpa gira a cabeça para a direção do movimento', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  neutralizeSpecials(player);
  let carpPosition = null;
  for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) if (!carpPosition && player.board[row][col]?.type === 'carp') carpPosition = { row, col };
  const target = { row: 2, col: 2 };
  [player.board[carpPosition.row][carpPosition.col], player.board[target.row][target.col]] = [player.board[target.row][target.col], player.board[carpPosition.row][carpPosition.col]];
  const movedId = player.board[target.row][target.col].id;
  movePiece(room, room.hostId, target);
  assert.equal(player.board[2][3].id, movedId);
  assert.equal(player.board[2][3].rotation, 270);
  assert.equal(player.movesRemaining, 11);
});

test('mover uma alga não gasta movimento e obriga mover uma carpa', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  neutralizeSpecials(player);
  const target = { row: 2, col: 2 };
  let algaePosition = null;
  for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) if (!algaePosition && player.board[row][col]?.type === 'algae') algaePosition = { row, col };
  [player.board[algaePosition.row][algaePosition.col], player.board[target.row][target.col]] = [player.board[target.row][target.col], player.board[algaePosition.row][algaePosition.col]];
  movePiece(room, room.hostId, target);
  assert.equal(player.movesRemaining, 12);
  assert.equal(player.mustMoveCarp, true);
});

test('desfazer restaura o tabuleiro e o contador de movimentos', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  neutralizeSpecials(player);
  const from = { row: 2, col: 2 };
  let carpPosition = null;
  for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) if (!carpPosition && player.board[row][col]?.type === 'carp') carpPosition = { row, col };
  [player.board[carpPosition.row][carpPosition.col], player.board[from.row][from.col]] = [player.board[from.row][from.col], player.board[carpPosition.row][carpPosition.col]];
  const before = player.board.map((row) => row.map((piece) => piece && { ...piece }));
  movePiece(room, room.hostId, from);
  undoLastMove(room, room.hostId);
  assert.equal(player.movesRemaining, 12);
  assert.deepEqual(player.board, before);
});

test('sair durante a partida preserva a vaga para retorno', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const result = removeMember(room, player.id, 'player');
  assert.equal(result.retained, true);
  assert.equal(room.players[player.id].connected, false);
});

test('reposição continua para a próxima menor cor e cada retirada rende uma moeda', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  const carps = player.board.flat().filter((piece) => piece?.type === 'carp');
  const colors = [...Array(20).fill('yellow'), ...Array(2).fill('white'), 'red', ...Array(5).fill('gray')];
  carps.forEach((piece, index) => { piece.color = colors[index]; });
  room.phase = 'development';
  player.development = { capacity: 4, eligibleColors: ['white'], chosenColor: 'white', replaced: 0, done: false };
  room.players[room.playerOrder[1]].development = { capacity: 0, eligibleColors: [], chosenColor: null, replaced: 0, done: true };
  const positionOf = (color) => {
    for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) if (player.board[row][col]?.type === 'carp' && player.board[row][col].color === color) return { row, col };
    return null;
  };
  replaceFish(room, player.id, positionOf('white'));
  replaceFish(room, player.id, positionOf('white'));
  replaceFish(room, player.id, positionOf('red'));
  replaceFish(room, player.id, positionOf('gray'));
  assert.equal(player.coins, 4);
  assert.equal(room.phase, 'development');
  assert.equal(player.development.done, true);
  assert.equal(player.development.confirmed, false);
  markDevelopmentReady(room, player.id);
  assert.equal(room.round, 2);
  assert.equal(room.phase, 'movement');
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
});

test('moedas desempata a classificação final', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const [a, b] = room.playerOrder;
  room.players[a].coins = 1;
  room.players[b].coins = 4;
  finishGame(room);
  assert.deepEqual(room.winner.playerIds, [b]);
});

test('movimento extra comprado depois de uma jogada é preservado ao desfazer', () => {
  const room = makeTwoPlayerRoom();
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  neutralizeSpecials(player);
  const target = { row: 2, col: 2 };
  let carpPosition = null;
  for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) if (!carpPosition && player.board[row][col]?.type === 'carp') carpPosition = { row, col };
  [player.board[carpPosition.row][carpPosition.col], player.board[target.row][target.col]] = [player.board[target.row][target.col], player.board[carpPosition.row][carpPosition.col]];
  movePiece(room, player.id, target);
  player.coins = 3;
  buyExtraMove(room, player.id);
  undoLastMove(room, player.id);
  assert.equal(player.extraMovesPurchased, 1);
  assert.equal(player.movesRemaining, 13);
});

test('modo solo inicia com duas peças especiais e linha Automa', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a', mode: 'solo' });
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  assert.equal(player.board.flat().filter((piece) => piece?.type === 'algae').length, 4);
  assert.equal(player.board.flat().filter((piece) => SPECIAL_TYPES.includes(piece?.type)).length, 2);
  assert.equal(room.solo.automaLine.length, 7);
});

test('Tesourinhas têm prioridade e ocupam o vazio por 1 movimento', () => {
  const room = makeTwoPlayerRoom(); startGame(room, room.hostId); const player = room.players[room.hostId]; player.board = blankBoard();
  player.board[2][2] = { id: 'move', type: 'carp', color: 'yellow', rotation: 0 };
  player.board[2][1] = { id: 'shoal', type: 'shoal', rotation: 0 };
  movePiece(room, player.id, { row: 2, col: 2 });
  assert.equal(player.board[2][2]?.type, 'shoal');
  assert.equal(player.movesRemaining, 10);
});

test('Papa-terra troca com a peça intermediária sem custo', () => {
  const room = makeTwoPlayerRoom(); startGame(room, room.hostId); const player = room.players[room.hostId]; player.board = blankBoard();
  player.board[2][2] = { id: 'move', type: 'carp', color: 'yellow', rotation: 0 };
  player.board[0][2] = { id: 'papa', type: 'papaTerra', rotation: 0 };
  player.board[1][2] = { id: 'middle', type: 'carp', color: 'red', rotation: 0 };
  movePiece(room, player.id, { row: 2, col: 2 });
  assert.equal(player.board[1][2]?.type, 'papaTerra');
  assert.equal(player.board[0][2]?.id, 'middle');
  assert.equal(player.movesRemaining, 11);
});

test('Dojô atravessa a diagonal até o vazio por 1 movimento', () => {
  const room = makeTwoPlayerRoom(); startGame(room, room.hostId); const player = room.players[room.hostId]; player.board = blankBoard();
  player.board[2][2] = { id: 'move', type: 'carp', color: 'yellow', rotation: 0 };
  player.board[0][0] = { id: 'dojo', type: 'dojo', rotation: 0 };
  movePiece(room, player.id, { row: 2, col: 2 });
  assert.equal(player.board[2][2]?.type, 'dojo');
  assert.equal(player.board[0][0], null);
  assert.equal(player.movesRemaining, 10);
});

test('Esturjão empurra a sequência em direção ao vazio por 2 movimentos', () => {
  const room = makeTwoPlayerRoom(); startGame(room, room.hostId); const player = room.players[room.hostId]; player.board = blankBoard();
  player.board[2][2] = { id: 'move', type: 'carp', color: 'yellow', rotation: 0 };
  player.board[2][0] = { id: 'sturgeon', type: 'sturgeon', rotation: 0 };
  player.board[2][1] = { id: 'between', type: 'carp', color: 'red', rotation: 0 };
  movePiece(room, player.id, { row: 2, col: 2 });
  assert.equal(player.board[2][0], null);
  assert.equal(player.board[2][1]?.type, 'sturgeon');
  assert.equal(player.board[2][2]?.id, 'between');
  assert.equal(player.movesRemaining, 9);
});

test('jogador pronto recebe aviso nominal enquanto aguarda a fase dos demais', () => {
  const room = makeTwoPlayerRoom(); startGame(room, room.hostId); const [hostId, otherId] = room.playerOrder; const host = room.players[hostId];
  host.movesRemaining = 0; host.mustMoveCarp = false; host.correctionRequired = false; markMovementReady(room, hostId);
  assert.throws(() => movePiece(room, hostId, { row: 0, col: 0 }), new RegExp(`Aguarde o jogador ${room.players[otherId].name}`));
});

test('três jogadores recebem cinco plantas e uma peça especial', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a' });
  addPlayer(room, { name: 'Beto', color: 'red', socketId: 'b' });
  addPlayer(room, { name: 'Clara', color: 'white', socketId: 'c' });
  startGame(room, room.hostId);
  for (const id of room.playerOrder) {
    const pieces = room.players[id].board.flat().filter(Boolean);
    assert.equal(pieces.filter((piece) => piece.type === 'algae').length, 5);
    assert.equal(pieces.filter((piece) => SPECIAL_TYPES.includes(piece.type)).length, 1);
  }
});

test('Tesourinhas vencem a prioridade quando mais de uma peça especial poderia reagir', () => {
  const room = makeTwoPlayerRoom(); startGame(room, room.hostId); const player = room.players[room.hostId]; player.board = blankBoard();
  player.board[2][2] = { id: 'move', type: 'carp', color: 'yellow', rotation: 0 };
  player.board[2][1] = { id: 'shoal', type: 'shoal', rotation: 0 };
  player.board[0][0] = { id: 'dojo', type: 'dojo', rotation: 0 };
  movePiece(room, player.id, { row: 2, col: 2 });
  assert.equal(player.board[2][2]?.type, 'shoal');
  assert.equal(player.board[0][0]?.type, 'dojo');
});

test('modo solo recebe a linha do Automa, contabiliza saídas e registra a espera da peça especial', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a', mode: 'solo' }); startGame(room, room.hostId); const player = room.players[room.hostId];
  const outgoingSpecial = player.board.flat().find((piece) => SPECIAL_TYPES.includes(piece?.type));
  for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) if (player.board[row][col]?.id === outgoingSpecial.id) player.board[row][col] = null;
  player.board[2] = [{ id:'y1',type:'carp',color:'yellow',rotation:0 },{ id:'r1',type:'carp',color:'red',rotation:0 },outgoingSpecial,{ id:'y2',type:'carp',color:'yellow',rotation:0 },{ id:'w1',type:'carp',color:'white',rotation:0 },{ id:'g1',type:'carp',color:'gray',rotation:0 },{ id:'r2',type:'carp',color:'red',rotation:0 }];
  const incomingIds = room.solo.automaLine.map((piece) => piece.id);
  player.movesRemaining = 0; player.correctionRequired = false; player.mustMoveCarp = false; markMovementReady(room, player.id);
  assert.equal(room.solo.exitedPreferred, 2);
  completeCirculation(room);
  assert.deepEqual(player.board[2].map((piece) => piece.id), incomingIds);
  completeCirculation(room);
  assert.equal(room.solo.specialCooldown[outgoingSpecial.type], 1);
});

test('peça especial que saiu fica fora da próxima linha do Automa', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a', mode: 'solo' }); startGame(room, room.hostId); const player = room.players[room.hostId];
  const outgoingSpecial = player.board.flat().find((piece) => SPECIAL_TYPES.includes(piece?.type));
  for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) if (player.board[row][col]?.id === outgoingSpecial.id) player.board[row][col] = null;
  player.board[2] = [{id:'r1',type:'carp',color:'red',rotation:0},{id:'r2',type:'carp',color:'red',rotation:0},outgoingSpecial,{id:'w1',type:'carp',color:'white',rotation:0},{id:'w2',type:'carp',color:'white',rotation:0},{id:'g1',type:'carp',color:'gray',rotation:0},{id:'g2',type:'carp',color:'gray',rotation:0}];
  player.movesRemaining = 0; player.correctionRequired = false; player.mustMoveCarp = false; markMovementReady(room, player.id); completeCirculation(room); completeCirculation(room);
  assert.equal(room.round, 2);
  assert.equal(room.solo.automaLine.some((piece) => piece.type === outgoingSpecial.type), false);
});

test('pontuação solo soma carpas preferidas que saíram e as que permaneceram', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a', mode: 'solo' }); startGame(room, room.hostId); const player = room.players[room.hostId]; room.solo.exitedPreferred = 9;
  let kept = 0; for (const piece of player.board.flat()) if (piece?.type === 'carp') { piece.color = kept < 6 ? 'yellow' : 'red'; kept += 1; }
  finishGame(room);
  assert.equal(room.winner.soloScore, 15);
});

test('espectadores podem acompanhar uma sala solo', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a', mode: 'solo' });
  const spectator = addSpectator(room, { name: 'Visitante', socketId: 'v' }); startGame(room, room.hostId);
  assert.equal(publicRoom(room).spectators[spectator.id].name, 'Visitante');
});


test('Anzol repõe a nova carpa na casa original adjacente e devolve o vazio ao destino', () => {
  const room = makeTwoPlayerRoom();
  setGameRuleset(room, room.hostId, 'advanced');
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  player.board = blankBoard();
  player.board[2][1] = { id: 'hook-advanced', type: 'hook', rotation: 0 };
  player.board[2][2] = { id: 'preferred-hook', type: 'carp', color: player.color, rotation: 0 };
  player.movesRemaining = 12;
  player.movementHistory = [];

  movePiece(room, player.id, { row: 2, col: 2 });

  assert.equal(player.board[2][1]?.type, 'hook');
  assert.equal(player.board[2][2]?.type, 'carp');
  assert.notEqual(player.board[2][2]?.color, player.color);
  assert.equal(player.board[2][3], null);
  const capture = room.lastAction.advanced.captures[0];
  assert.deepEqual(capture.capturedPosition, { row: 2, col: 3 });
  assert.deepEqual(capture.replacementPosition, { row: 2, col: 2 });
  assert.equal(capture.activationPieceId, 'hook-advanced');
});

for (const [type, label] of [['heron', 'Garça'], ['cat', 'Gato']]) {
  test(`${label} mantém a ameaça de captura enquanto permanece sobre a planta`, () => {
    const room = makeTwoPlayerRoom();
    setGameRuleset(room, room.hostId, 'advanced');
    startGame(room, room.hostId);
    const player = room.players[room.hostId];
    player.board = blankBoard();
    player.board[2][2] = {
      id: `plant-${type}`,
      type: 'algae',
      rotation: 0,
      overlays: [{ id: `overlay-${type}`, type }]
    };
    player.board[2][4] = { id: `preferred-${type}`, type: 'carp', color: player.color, rotation: 0 };
    player.advancedTrapArmed = [];
    player.movesRemaining = 12;
    player.movementHistory = [];

    movePiece(room, player.id, { row: 2, col: 4 });

    const capture = room.lastAction.advanced.captures[0];
    assert.equal(capture.activationType, type);
    assert.equal(capture.activationOverlayId, `overlay-${type}`);
    assert.notEqual(player.board[2][3]?.color, player.color);
  });
}

test('última reposição pode ser desfeita antes da confirmação da fase', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a', mode: 'solo' });
  startGame(room, room.hostId);
  const player = room.players[room.hostId];
  player.board = blankBoard();
  const carps = player.board.flat().filter((piece) => piece?.type === 'carp');
  carps.forEach((piece, index) => { piece.color = index === 0 ? 'gray' : (index % 2 ? 'white' : 'red'); });
  room.phase = 'development';
  player.development = { capacity: 1, eligibleColors: ['gray'], chosenColor: 'gray', replaced: 0, done: false, confirmed: false };
  player.developmentHistory = [];
  const position = (() => {
    for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) {
      if (player.board[row][col]?.type === 'carp' && player.board[row][col].color === 'gray') return { row, col };
    }
    return null;
  })();
  const previousPiece = { ...player.board[position.row][position.col] };
  const previousCoins = player.coins;
  const previousDiscard = { ...player.discard };

  replaceFish(room, player.id, position);
  assert.equal(room.phase, 'development');
  assert.equal(player.development.done, true);
  assert.equal(player.development.confirmed, false);
  assert.equal(publicRoom(room).players[player.id].developmentHistoryLength, 1);

  undoLastMove(room, player.id);
  assert.deepEqual(player.board[position.row][position.col], previousPiece);
  assert.equal(player.coins, previousCoins);
  assert.deepEqual(player.discard, previousDiscard);
  assert.equal(player.development.replaced, 0);
  assert.equal(player.development.done, false);
  assert.equal(player.development.chosenColor, 'gray');
  assert.equal(room.lastAction.type, 'undoDevelopment');
});


test('cor ocupada informa também quais cores continuam disponíveis', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a' });
  addPlayer(room, { name: 'Beto', color: 'red', socketId: 'b' });
  assert.throws(
    () => addPlayer(room, { name: 'Caio', color: 'yellow', socketId: 'c' }),
    (error) => /Amarela já foi selecionada/.test(error.message)
      && /Branca/.test(error.message)
      && /Cinza/.test(error.message)
  );
});

test('anfitrião pode adicionar e remover bots no lobby', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a' });
  const bot = addBot(room, room.hostId);
  assert.equal(bot.isBot, true);
  assert.equal(bot.connected, true);
  assert.notEqual(bot.color, 'yellow');
  assert.equal(room.playerOrder.length, 2);
  assert.equal(publicRoom(room).players[bot.id].isBot, true);
  removeBot(room, room.hostId, bot.id);
  assert.equal(room.players[bot.id], undefined);
  assert.equal(room.playerOrder.length, 1);
});

test('bot começa com linha central completa e vazio no centro da linha 4', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a' });
  const bot = addBot(room, room.hostId);
  startGame(room, room.hostId);
  assert.equal(bot.movementReady, true);
  assert.equal(bot.movesRemaining, 0);
  assert.notEqual(bot.board[2][3], null);
  assert.equal(bot.board[3][3], null);
});

function advanceTestRound(room, humanId) {
  const human = room.players[humanId];
  if (human.board[2].some((piece) => piece === null)) {
    const col = human.board[2].findIndex((piece) => piece === null);
    human.board[2][col] = human.board[3][col];
    human.board[3][col] = null;
  }
  human.movesRemaining = 0;
  human.mustMoveCarp = false;
  human.correctionRequired = false;
  if (!human.movementReady) markMovementReady(room, humanId);
  assert.equal(room.phase, 'circulation');
  completeCirculation(room);
  completeCirculation(room);
  if (room.phase === 'development') {
    const development = room.players[humanId].development;
    if (!development.confirmed) {
      development.done = true;
      development.confirmed = false;
      development.chosenColor = null;
      development.eligibleColors = [];
      markDevelopmentReady(room, humanId);
    }
  }
}

test('bot gira as cinco linhas a cada nova rodada sem ativar especiais e corrige o vazio na rodada 5', () => {
  const room = createRoom({ hostName: 'Ana', color: 'yellow', socketId: 'a' });
  const bot = addBot(room, room.hostId);
  startGame(room, room.hostId);

  advanceTestRound(room, room.hostId);
  assert.equal(room.round, 2);
  assert.equal(bot.movementReady, true);
  assert.equal(bot.specialAlert, '');
  assert.equal(bot.board[4][3], null, 'na rodada 2 o vazio deve ter descido para a linha 5');

  advanceTestRound(room, room.hostId);
  assert.equal(room.round, 3);
  assert.equal(bot.board[0][3], null, 'na rodada 3 o vazio deve reaparecer na linha 1');

  advanceTestRound(room, room.hostId);
  assert.equal(room.round, 4);
  assert.equal(bot.board[1][3], null, 'na rodada 4 o vazio deve estar na linha 2');

  advanceTestRound(room, room.hostId);
  assert.equal(room.round, 5);
  assert.notEqual(bot.board[2][3], null, 'na última rodada a linha central deve ser preenchida');
  assert.equal(bot.board[3][3], null, 'a peça da linha 4 sobe e o vazio fica na linha 4');
});
