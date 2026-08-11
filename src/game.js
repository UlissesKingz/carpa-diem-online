const crypto = require('node:crypto');

const ROWS = 5;
const COLS = 7;
const MIDDLE_ROW = 2;
const CENTER = { row: 2, col: 3 };
const MAX_ROUNDS = 5;
const MOVES_PER_ROUND = 12;
const CIRCULATION_DURATION_MS = 5200;
const EXTRA_MOVE_COST = 3;
const COLORS = ['yellow', 'white', 'red', 'gray'];
const SPECIAL_TYPES = ['shoal', 'sturgeon', 'dojo', 'papaTerra'];
const SPECIAL_PRIORITY = ['shoal', 'papaTerra', 'dojo', 'sturgeon'];
const SPECIAL_COSTS = { shoal: 1, papaTerra: 0, dojo: 1, sturgeon: 2 };
const SPECIAL_LABELS = { shoal: 'Tesourinhas', papaTerra: 'Papa-terra', dojo: 'Dojô', sturgeon: 'Esturjão' };

const RULESETS = ['classic', 'advanced', 'kids'];
const RULESET_LABELS = { classic: 'Padrão', advanced: 'Avançado', kids: 'Kids' };
const ADVANCED_TYPES = ['hook', 'net', 'heron', 'cat'];
const ADVANCED_CELL_TYPES = ['hook', 'net'];
const ADVANCED_OVERLAY_TYPES = ['heron', 'cat'];
const ADVANCED_LABELS = { hook: 'Anzol', net: 'Rede', heron: 'Garça', cat: 'Gato' };
const ADVANCED_PRIORITY = ['hook', 'net', 'heron', 'cat'];
const AUTOMATIC_PRIORITY = [...ADVANCED_PRIORITY, ...SPECIAL_PRIORITY];

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
  const isAdvancedCell = ADVANCED_CELL_TYPES.includes(type);
  return {
    id: randomId(5),
    type,
    ...(color ? { color } : {}),
    rotation: isAdvancedCell ? 0 : crypto.randomInt(0, 4) * 90,
    ...(isAdvancedCell ? { facing: 'left' } : {})
  };
}

function createOverlay(type) {
  return {
    id: randomId(5),
    type,
    ...(ADVANCED_OVERLAY_TYPES.includes(type) ? { facing: 'left' } : {})
  };
}

function normalizedRuleset(value) {
  return RULESETS.includes(value) ? value : 'classic';
}

function chooseRandom(items) {
  if (!items.length) return null;
  return items[crypto.randomInt(0, items.length)];
}

function carpPositions(board, colors = null) {
  const accepted = Array.isArray(colors) && colors.length ? new Set(colors) : null;
  const positions = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const piece = board[row][col];
      if (piece?.type !== 'carp') continue;
      if (accepted && !accepted.has(piece.color)) continue;
      positions.push({ row, col });
    }
  }
  return positions;
}

function plantPositions(board) {
  const positions = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (board[row][col]?.type === 'algae') positions.push({ row, col });
    }
  }
  return positions;
}

function addAdvancedPieceToBoard(board, type, replacementColors) {
  if (!ADVANCED_TYPES.includes(type)) return null;

  if (ADVANCED_CELL_TYPES.includes(type)) {
    const candidates = carpPositions(board, replacementColors);
    const position = chooseRandom(candidates);
    if (!position) return null;
    const piece = createPiece(type);
    board[position.row][position.col] = piece;
    return { type, position, pieceId: piece.id };
  }

  // Garça e Gato são uma camada extra e não substituem nenhuma das 35 casas.
  // O preenchimento do tanque ocorre em ordem de leitura; por isso, a última
  // planta encontrada é a última planta colocada no setup.
  const plants = plantPositions(board);
  const position = plants.at(-1) || null;
  if (!position) return null;
  const plant = board[position.row][position.col];
  plant.overlays ||= [];
  const overlay = createOverlay(type);
  plant.overlays.push(overlay);
  return { type, position, pieceId: plant.id, overlayId: overlay.id };
}

function createInitialBoard(playerCount = 2, mode = 'multiplayer', specialTypesForBoard = null, setup = {}) {
  const ruleset = normalizedRuleset(setup.ruleset);
  const pieces = [];
  for (const color of COLORS) {
    for (let i = 0; i < 7; i += 1) pieces.push(createPiece('carp', color));
  }

  if (ruleset === 'kids') {
    for (let i = 0; i < 6; i += 1) pieces.push(createPiece('algae'));
  } else {
    const isTwoOrSolo = mode === 'solo' || playerCount === 2;
    const algaeCount = isTwoOrSolo ? 4 : 5;
    const fallbackSpecialCount = isTwoOrSolo ? 2 : 1;
    const chosenSpecialTypes = Array.isArray(specialTypesForBoard) && specialTypesForBoard.length
      ? [...specialTypesForBoard]
      : shuffle(SPECIAL_TYPES).slice(0, fallbackSpecialCount);
    for (let i = 0; i < algaeCount; i += 1) pieces.push(createPiece('algae'));
    chosenSpecialTypes.forEach((type) => pieces.push(createPiece(type)));
  }

  const shuffled = shuffle(pieces);
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let cursor = 0;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (row === CENTER.row && col === CENTER.col) continue;
      board[row][col] = shuffled[cursor++];
    }
  }

  if (ruleset === 'advanced' && ADVANCED_TYPES.includes(setup.advancedType)) {
    addAdvancedPieceToBoard(board, setup.advancedType, setup.advancedReplacementColors || null);
  }

  return board;
}

function clonePiece(piece) {
  if (!piece) return null;
  return {
    ...piece,
    ...(Array.isArray(piece.overlays) ? { overlays: piece.overlays.map((overlay) => ({ ...overlay })) } : {})
  };
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
    specialAlert: player.specialAlert || '',
    advancedTrapArmed: (player.advancedTrapArmed || []).map((trap) => ({
      ...trap,
      position: trap.position ? { ...trap.position } : null
    }))
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
  player.advancedTrapArmed = (snapshot.advancedTrapArmed || []).map((trap) => ({
    ...trap,
    position: trap.position ? { ...trap.position } : null
  }));
}

function snapshotDevelopmentState(player) {
  return {
    board: cloneBoard(player.board),
    development: player.development ? {
      ...player.development,
      eligibleColors: [...(player.development.eligibleColors || [])]
    } : null,
    coins: Number(player.coins || 0),
    discard: { ...(player.discard || {}) }
  };
}

function restoreDevelopmentState(player, snapshot) {
  player.board = cloneBoard(snapshot.board);
  player.development = snapshot.development ? {
    ...snapshot.development,
    eligibleColors: [...(snapshot.development.eligibleColors || [])]
  } : null;
  player.coins = Number(snapshot.coins || 0);
  player.discard = { ...(snapshot.discard || {}) };
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


function advancedFacingTowardEmpty(position, empty, currentFacing = 'left') {
  // As artes avançadas nunca giram: o lado esquerdo do PNG é a frente.
  // Só espelhamos horizontalmente quando o vazio surge na mesma linha.
  // Se o vazio estiver acima/abaixo (ou em outra linha), preservamos a última orientação.
  if (!position || !empty || position.row !== empty.row || position.col === empty.col) {
    return currentFacing === 'right' ? 'right' : 'left';
  }
  return empty.col < position.col ? 'left' : 'right';
}

function orientAdvancedPiecesTowardEmpty(board, empty = findEmpty(board)) {
  if (!board || !empty) return;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const piece = board[row][col];
      if (!piece) continue;
      const position = { row, col };

      if (ADVANCED_CELL_TYPES.includes(piece.type)) {
        piece.rotation = 0;
        piece.facing = advancedFacingTowardEmpty(position, empty, piece.facing);
      }

      if (piece.type === 'algae' && Array.isArray(piece.overlays)) {
        for (const overlay of piece.overlays) {
          if (!ADVANCED_OVERLAY_TYPES.includes(overlay.type)) continue;
          overlay.facing = advancedFacingTowardEmpty(position, empty, overlay.facing);
        }
      }
    }
  }
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
  return SPECIAL_LABELS[piece.type] || ADVANCED_LABELS[piece.type] || 'peça especial';
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

function positionsBetween(a, b) {
  if (!sameOrthogonalLine(a, b)) return [];
  const rowStep = Math.sign(b.row - a.row);
  const colStep = Math.sign(b.col - a.col);
  const result = [];
  let row = a.row + rowStep;
  let col = a.col + colStep;
  while (!(row === b.row && col === b.col)) {
    result.push({ row, col });
    row += rowStep;
    col += colStep;
  }
  return result;
}

function hookSourceForCarpMove(board, from, empty, preferredColor) {
  const movingPiece = board[from.row]?.[from.col];
  if (movingPiece?.type !== 'carp' || movingPiece.color !== preferredColor) return null;
  if (!isOrthogonallyAdjacent(from, empty)) return null;

  for (const hookPosition of adjacentPositions(from)) {
    if (board[hookPosition.row]?.[hookPosition.col]?.type !== 'hook') continue;
    const rowStep = from.row - hookPosition.row;
    const colStep = from.col - hookPosition.col;
    const expectedEmpty = { row: from.row + rowStep, col: from.col + colStep };
    if (expectedEmpty.row === empty.row && expectedEmpty.col === empty.col) return { ...hookPosition };
  }
  return null;
}

function isValidManualMove(player, from, empty) {
  const piece = player.board[from.row]?.[from.col];
  if (!piece) return false;
  return isOrthogonallyAdjacent(from, empty);
}

function manualMovePositions(player) {
  return adjacentPositions(findEmpty(player.board));
}

function leastPresentReplacementColor(board, preferredColor) {
  const counts = countCarps(board);
  const candidates = COLORS
    .filter((color) => color !== preferredColor)
    .map((color) => ({ color, count: Number(counts[color] || 0) }));
  const minimum = Math.min(...candidates.map(({ count }) => count));
  return chooseRandom(candidates.filter(({ count }) => count === minimum).map(({ color }) => color));
}

function capturePreferredCarp(board, position, preferredColor, sources = []) {
  const piece = board[position.row]?.[position.col];
  if (piece?.type !== 'carp' || piece.color !== preferredColor) return null;
  const replacementColor = leastPresentReplacementColor(board, preferredColor);
  if (!replacementColor) return null;
  const replacement = createPiece('carp', replacementColor);
  board[position.row][position.col] = replacement;
  return {
    position: { ...position },
    capturedPieceId: piece.id,
    capturedColor: preferredColor,
    replacementPieceId: replacement.id,
    replacementColor,
    sources: [...sources]
  };
}

function netPositionAdjacentTo(board, position) {
  return adjacentPositions(position).find(({ row, col }) => board[row][col]?.type === 'net') || null;
}

function overlayEntries(board) {
  const entries = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const piece = board[row][col];
      if (piece?.type !== 'algae' || !Array.isArray(piece.overlays)) continue;
      piece.overlays.forEach((overlay) => entries.push({ overlay, position: { row, col }, plant: piece }));
    }
  }
  return entries;
}

function predatorJumpCandidate(board, targetPosition, type) {
  const targetPlant = board[targetPosition.row]?.[targetPosition.col];
  if (targetPlant?.type !== 'algae') return null;

  return overlayEntries(board)
    .filter(({ position, overlay }) =>
      overlay.type === type
      && !(position.row === targetPosition.row && position.col === targetPosition.col)
    )
    .find(({ position }) => (
      type === 'heron'
        ? sameDiagonal(position, targetPosition)
        : type === 'cat'
          ? sameOrthogonalLine(position, targetPosition)
          : false
    )) || null;
}

function movePredatorOverlayToPlant(board, targetPosition, type) {
  const targetPlant = board[targetPosition.row]?.[targetPosition.col];
  const entry = predatorJumpCandidate(board, targetPosition, type);
  if (!targetPlant || !entry) return null;

  targetPlant.overlays ||= [];
  entry.plant.overlays = (entry.plant.overlays || []).filter((overlay) => overlay.id !== entry.overlay.id);
  targetPlant.overlays.push(entry.overlay);
  return {
    type,
    overlayId: entry.overlay.id,
    from: { ...entry.position },
    to: { ...targetPosition }
  };
}

function predatorCaptureCandidate(board, destination, type) {
  return overlayEntries(board).find(({ overlay, position }) =>
    overlay.type === type && isOrthogonallyAdjacent(position, destination)
  ) || null;
}

function detectAdvancedTrigger(boardBefore, boardAfter, piece, from, destination, preferredColor) {
  if (piece?.type === 'carp' && piece.color === preferredColor) {
    const hookSource = hookSourceForCarpMove(boardBefore, from, destination, preferredColor);
    if (hookSource) {
      return {
        type: 'hook',
        kind: 'capture',
        sourcePosition: hookSource,
        capturedPosition: { ...destination },
        replacementPosition: { ...from }
      };
    }

    const netPosition = netPositionAdjacentTo(boardAfter, destination);
    if (netPosition) return { type: 'net', kind: 'capture', sourcePosition: { ...netPosition } };

    // Garça e Gato ameaçam permanentemente as casas ortogonais (✚) à planta
    // enquanto permanecerem sobre ela; não existe mais janela de apenas uma jogada.
    for (const type of ['heron', 'cat']) {
      const trap = predatorCaptureCandidate(boardAfter, destination, type);
      if (trap) {
        return {
          type,
          kind: 'capture',
          trap: { type, overlayId: trap.overlay.id, position: { ...trap.position } }
        };
      }
    }
  }

  if (piece?.type === 'algae') {
    for (const type of ['heron', 'cat']) {
      const candidate = predatorJumpCandidate(boardAfter, destination, type);
      if (candidate) return { type, kind: 'jump' };
    }
  }

  return null;
}

function capturePreferredCarpWithReplacement(board, capturedPosition, replacementPosition, preferredColor, sources = []) {
  const piece = board[capturedPosition.row]?.[capturedPosition.col];
  if (piece?.type !== 'carp' || piece.color !== preferredColor) return null;
  const replacementColor = leastPresentReplacementColor(board, preferredColor);
  if (!replacementColor) return null;

  const replacement = createPiece('carp', replacementColor);
  board[capturedPosition.row][capturedPosition.col] = null;
  board[replacementPosition.row][replacementPosition.col] = replacement;
  return {
    position: { ...replacementPosition },
    capturedPosition: { ...capturedPosition },
    replacementPosition: { ...replacementPosition },
    capturedPieceId: piece.id,
    capturedColor: preferredColor,
    replacementPieceId: replacement.id,
    replacementColor,
    sources: [...sources]
  };
}

function applyAdvancedTrigger(board, trigger, destination, preferredColor) {
  if (!trigger) return { captures: [], jumps: [], armed: [] };

  if (trigger.kind === 'capture') {
    const capturedPosition = trigger.capturedPosition || destination;
    const replacementPosition = trigger.replacementPosition || destination;
    const capture = trigger.type === 'hook'
      ? capturePreferredCarpWithReplacement(board, capturedPosition, replacementPosition, preferredColor, [trigger.type])
      : capturePreferredCarp(board, capturedPosition, preferredColor, [trigger.type]);
    if (capture) {
      capture.capturedPosition ||= { ...capturedPosition };
      capture.replacementPosition ||= { ...replacementPosition };
      const activationPosition = trigger.sourcePosition || trigger.trap?.position || null;
      const activationPiece = activationPosition
        ? board[activationPosition.row]?.[activationPosition.col]
        : null;
      capture.activationType = trigger.type;
      capture.activationPosition = activationPosition ? { ...activationPosition } : null;
      capture.activationPieceId = ADVANCED_CELL_TYPES.includes(trigger.type) ? (activationPiece?.id || null) : null;
      capture.activationOverlayId = ADVANCED_OVERLAY_TYPES.includes(trigger.type) ? (trigger.trap?.overlayId || null) : null;
    }
    return { captures: capture ? [capture] : [], jumps: [], armed: [] };
  }

  if (trigger.kind === 'jump') {
    const jump = movePredatorOverlayToPlant(board, destination, trigger.type);
    return { captures: [], jumps: jump ? [jump] : [], armed: [] };
  }

  return { captures: [], jumps: [], armed: [] };
}

function advancedTypesOnBoard(board) {
  const found = new Set();
  for (const piece of board.flat()) {
    if (!piece) continue;
    if (ADVANCED_CELL_TYPES.includes(piece.type)) found.add(piece.type);
    for (const overlay of piece.overlays || []) {
      if (ADVANCED_OVERLAY_TYPES.includes(overlay.type)) found.add(overlay.type);
    }
  }
  return found;
}

function advancedTypesInLine(line) {
  const found = new Set();
  for (const piece of line || []) {
    if (!piece) continue;
    if (ADVANCED_CELL_TYPES.includes(piece.type)) found.add(piece.type);
    for (const overlay of piece.overlays || []) {
      if (ADVANCED_OVERLAY_TYPES.includes(overlay.type)) found.add(overlay.type);
    }
  }
  return [...found];
}

function detectSpecialTrigger(board, emptyPosition, { excludePieceId = null } = {}) {
  for (const type of SPECIAL_PRIORITY) {
    const position = findPiecePosition(board, type);
    if (!position) continue;
    const specialPiece = board[position.row][position.col];
    if (excludePieceId && specialPiece?.id === excludePieceId) continue;

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

function hasValidMovementOption(player) {
  if (!player?.board || player.movementReady || player.correctionRequired || player.movesRemaining <= 0) return true;
  const board = player.board;
  const empty = findEmpty(board);

  for (const from of manualMovePositions(player)) {
    const piece = board[from.row][from.col];
    if (!piece) continue;
    if (player.mustMoveCarp && piece.type !== 'carp') continue;

    const projected = cloneBoard(board);
    projected[empty.row][empty.col] = clonePiece(piece);
    projected[from.row][from.col] = null;

    const advancedTrigger = detectAdvancedTrigger(
      board,
      projected,
      piece,
      from,
      empty,
      player.color,
      player.advancedTrapArmed || []
    );
    const manuallyMovedSpecial = SPECIAL_TYPES.includes(piece.type);
    const specialTrigger = advancedTrigger ? null : detectSpecialTrigger(projected, from, {
      excludePieceId: manuallyMovedSpecial ? piece.id : null
    });
    const createsCarpObligation = piece.type === 'algae';
    const pieceMoveCost = createsCarpObligation ? 0 : 1;
    const specialCost = Number(specialTrigger?.cost || 0);
    const futureRequired = createsCarpObligation ? 1 : 0;

    if (player.movesRemaining >= pieceMoveCost + specialCost + futureRequired) return true;
  }

  return false;
}

function isMovementDeadEnd(player) {
  return Boolean(
    player?.board
    && player.movesRemaining > 0
    && !player.movementReady
    && !player.correctionRequired
    && !hasValidMovementOption(player)
  );
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
    shoal: 'Ativação automática — Tesourinhas: o novo vazio ficou ortogonalmente (✚) adjacente a elas. Tesourinhas ocuparam o espaço vazio e consumiram 1 movimento.',
    dojo: 'Ativação automática — Dojô: o novo vazio ficou na mesma diagonal (✕). Dojô atravessou o tanque até o vazio e consumiu 1 movimento.',
    papaTerra: `Ativação automática — Papa-terra: o novo vazio ficou a duas casas em linha reta, com uma peça entre eles. Papa-terra trocou de posição com ${pieceName(board[trigger.position.row][trigger.position.col])} e nenhum movimento foi consumido.`,
    sturgeon: `Ativação automática — Esturjão: o novo vazio ficou na mesma linha ou coluna. Esturjão empurrou ${affectedCount} peça(s) em direção ao vazio e consumiu 2 movimentos.`
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
  const pool = [];
  for (const color of COLORS) {
    if (color === player.color) continue;
    for (let i = 0; i < 7; i += 1) pool.push({ type: 'carp', color });
  }

  const ruleset = normalizedRuleset(room.ruleset);
  const algaeCopies = ruleset === 'kids' ? 6 : 4;
  for (let i = 0; i < algaeCopies; i += 1) pool.push({ type: 'algae' });

  if (ruleset !== 'kids') {
    const cooldown = room.solo.specialCooldown;
    const unavailable = specialTypesOnBoard(player.board);
    for (const type of SPECIAL_TYPES) {
      if (!unavailable.has(type) && Number(cooldown[type] || 0) <= 0) pool.push({ type });
    }
    for (const type of SPECIAL_TYPES) cooldown[type] = Math.max(0, Number(cooldown[type] || 0) - 1);
  }

  const selected = shuffle(pool).slice(0, COLS).map((definition) => createPiece(definition.type, definition.color || null));
  room.solo.automaLine = selected;
  return selected;
}

function tryReturnSoloAdvancedPiece(room, player) {
  if (room.mode !== 'solo' || normalizedRuleset(room.ruleset) !== 'advanced') return null;
  const returnRound = Number(room.solo?.advancedReturnRound || 0);
  if (!returnRound || room.round < returnRound) return null;
  if (advancedTypesOnBoard(player.board).size > 0) {
    room.solo.advancedReturnRound = null;
    return null;
  }
  const replacementColors = COLORS.filter((color) => color !== player.color);
  let inserted = null;
  let type = null;
  for (const candidateType of shuffle(ADVANCED_TYPES)) {
    inserted = addAdvancedPieceToBoard(player.board, candidateType, replacementColors);
    if (inserted) {
      type = candidateType;
      break;
    }
  }
  if (!inserted || !type) return null;
  room.solo.advancedReturnRound = null;
  room.solo.advancedType = type;
  addLog(room, `${ADVANCED_LABELS[type]} entrou no tanque no início da rodada ${room.round}.`, player.id);
  return inserted;
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
  if (phase === 'development') {
    const development = player?.development;
    if (!development) return false;
    return development.confirmed === undefined ? Boolean(development.done) : Boolean(development.confirmed);
  }
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

function normalizeRankingPlayerId(value) {
  const normalized = String(value || '').trim().slice(0, 96);
  return /^[A-Za-z0-9_-]{12,96}$/.test(normalized) ? normalized : null;
}

function createPlayer({ name, color, socketId, rankingPlayerId }) {
  return {
    id: randomId(6),
    token: randomId(16),
    name: String(name || 'Jogador').trim().slice(0, 24) || 'Jogador',
    color,
    socketId,
    connected: true,
    rankingPlayerId: normalizeRankingPlayerId(rankingPlayerId),
    board: null,
    movesRemaining: MOVES_PER_ROUND,
    mustMoveCarp: false,
    correctionRequired: false,
    movementReady: false,
    lastMovedPieceId: null,
    movementHistory: [],
    pendingDevelopmentCapacity: 0,
    development: null,
    developmentHistory: [],
    coins: 0,
    extraMovesPurchased: 0,
    specialAlert: '',
    advancedTrapArmed: [],
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
  if (normalizedRuleset(room.ruleset) === 'kids') {
    return Object.fromEntries(room.playerOrder.map((id) => [id, []]));
  }

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

function buildInitialAdvancedAssignments(room) {
  const assignments = {};
  if (normalizedRuleset(room.ruleset) !== 'advanced') return assignments;
  const shuffled = shuffle(ADVANCED_TYPES);
  room.playerOrder.forEach((id, index) => {
    assignments[id] = shuffled[index % shuffled.length];
  });
  return assignments;
}

function advancedReplacementColorsForPlayer(room, playerId) {
  const player = room.players[playerId];
  if (!player) return [];
  if (room.mode === 'solo') return COLORS.filter((color) => color !== player.color);

  const preferred = new Set(room.playerOrder.map((id) => room.players[id]?.color).filter(Boolean));
  if (room.playerOrder.length <= 3) return COLORS.filter((color) => !preferred.has(color));

  const index = room.playerOrder.indexOf(playerId);
  const oppositeId = room.playerOrder[(index + 2) % 4];
  return room.players[oppositeId]?.color ? [room.players[oppositeId].color] : [];
}

function setGameRuleset(room, requesterId, ruleset) {
  if (room.hostId !== requesterId) throw new Error('Somente o anfitrião pode escolher o modo de regras.');
  if (room.status !== 'lobby') throw new Error('O modo de regras só pode ser alterado antes da partida.');
  const normalized = normalizedRuleset(ruleset);
  room.ruleset = normalized;
  setAction(room, { type: 'rulesetChanged', playerId: requesterId, ruleset: normalized });
  addLog(room, `escolheu o modo ${RULESET_LABELS[normalized]}.`, requesterId);
  return normalized;
}

function createRoom({ hostName, color, socketId, mode = 'multiplayer', rankingPlayerId, ruleset = 'classic' }) {
  const host = createPlayer({ name: hostName, color, socketId, rankingPlayerId });
  const room = {
    code: roomCode(),
    mode: mode === 'solo' ? 'solo' : 'multiplayer',
    ruleset: normalizedRuleset(ruleset),
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
    solo: null,
    rankingGeneral: null
  };
  addLog(room, 'criou a sala.', host.id);
  return room;
}

function addPlayer(room, { name, color, socketId, rankingPlayerId }) {
  if (room.mode === 'solo') throw new Error('Esta sala está no modo solo. Entre como espectador.');
  if (room.status !== 'lobby') throw new Error('A partida já começou. Entre como espectador.');
  if (room.playerOrder.length >= 4) throw new Error('A sala está cheia.');
  const normalizedName = String(name || '').trim().toLocaleLowerCase('pt-BR');
  const nameTaken = room.playerOrder.some((id) => room.players[id].name.trim().toLocaleLowerCase('pt-BR') === normalizedName);
  if (nameTaken) throw new Error('Esse nome já está em uso nesta sala.');
  if (!COLORS.includes(color)) throw new Error('Cor inválida.');
  const colorTaken = room.playerOrder.some((id) => room.players[id].color === color);
  if (colorTaken) throw new Error('Essa cor já foi escolhida.');
  const player = createPlayer({ name, color, socketId, rankingPlayerId });
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
  if (initializeBoard) {
    player.board = createInitialBoard(
      setup.playerCount || 2,
      setup.mode || 'multiplayer',
      setup.specialTypes || null,
      {
        ruleset: setup.ruleset,
        advancedType: setup.advancedType,
        advancedReplacementColors: setup.advancedReplacementColors
      }
    );
  }
  player.movesRemaining = MOVES_PER_ROUND;
  player.mustMoveCarp = false;
  player.correctionRequired = false;
  player.movementReady = false;
  player.lastMovedPieceId = null;
  player.movementHistory = [];
  player.pendingDevelopmentCapacity = 0;
  player.development = null;
  player.developmentHistory = [];
  player.extraMovesPurchased = 0;
  player.specialAlert = '';
  player.advancedTrapArmed = [];
}

function initializeMatch(room, restarted = false) {
  room.ruleset = normalizedRuleset(room.ruleset);
  room.status = 'playing';
  room.phase = 'movement';
  room.round = 1;
  room.winner = null;
  room.restartVote = null;
  room.circulation = null;
  room.matchId = randomId(10);
  room.startedAt = Date.now();
  room.finishedAt = null;
  room.rankingGeneral = null;
  if (restarted) room.restartCount += 1;
  room.solo = room.mode === 'solo' ? {
    exitedPreferred: 0,
    automaLine: null,
    specialCooldown: Object.fromEntries(SPECIAL_TYPES.map((type) => [type, 0])),
    advancedReturnRound: null,
    advancedType: null
  } : null;

  const specialAssignments = buildInitialSpecialAssignments(room);
  const advancedAssignments = buildInitialAdvancedAssignments(room);

  for (const id of room.playerOrder) {
    const player = room.players[id];
    player.discard = Object.fromEntries(COLORS.map((item) => [item, 0]));
    player.coins = 0;
    const advancedType = advancedAssignments[id] || null;
    resetPlayerForRound(player, true, {
      playerCount: room.playerOrder.length,
      mode: room.mode,
      ruleset: room.ruleset,
      specialTypes: specialAssignments[id] || null,
      advancedType,
      advancedReplacementColors: advancedReplacementColorsForPlayer(room, id)
    });
    if (room.mode === 'solo' && advancedType) room.solo.advancedType = advancedType;
  }

  if (room.mode === 'solo') generateAutomaLine(room, room.players[room.playerOrder[0]]);
  setAction(room, { type: restarted ? 'restartComplete' : 'gameStart', ruleset: room.ruleset });
  addLog(room, restarted ? 'A partida foi reiniciada por acordo dos jogadores.' : `A partida começou no modo ${RULESET_LABELS[room.ruleset]}.`);
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
  if (!isValidManualMove(player, from, empty)) {
    throw new Error('A peça deve estar ao lado do espaço vazio.');
  }

  if (player.correctionRequired) {
    const validCorrection = from.col === empty.col && Math.abs(from.row - empty.row) === 1 && from.row !== MIDDLE_ROW;
    if (!validCorrection) throw new Error('Preencha a linha central usando a peça imediatamente acima ou abaixo.');
    player.movementHistory.push(snapshotMovementState(player));
    player.advancedTrapArmed = [];
    const boardBefore = cloneBoard(board);
    const orientation = orientPieceForMovement(piece, from, empty);
    board[empty.row][empty.col] = piece;
    board[from.row][from.col] = null;

    const advancedTrigger = detectAdvancedTrigger(boardBefore, board, piece, from, empty, player.color);
    const advanced = applyAdvancedTrigger(board, advancedTrigger, empty, player.color);
    player.advancedTrapArmed = advanced.armed;
    orientAdvancedPiecesTowardEmpty(board, findEmpty(board));

    player.correctionRequired = false;
    player.lastMovedPieceId = advanced.captures[0]?.replacementPieceId || piece.id;
    const advancedMessage = advancedActivationMessage(advanced);
    player.specialAlert = advancedMessage;
    if (advancedMessage) addLog(room, advancedMessage, playerId);
    setAction(room, {
      type: 'correctionMove',
      playerId,
      from: { ...from },
      to: { ...empty },
      pieceId: piece.id,
      pieceType: piece.type,
      movedOverlayTypes: (piece.overlays || []).map((overlay) => overlay.type),
      ...orientation,
      advanced
    });
    addLog(room, 'retirou o vazio da linha central.', playerId);
    return { correction: true, specialMoved: false, advanced };
  }

  if (player.movesRemaining <= 0) throw new Error('Seus movimentos disponíveis terminaram. Compre um movimento extra ou conclua a fase.');
  if (player.mustMoveCarp && piece.type !== 'carp') throw new Error('Depois de uma alga, você deve mover uma carpa.');

  const projected = cloneBoard(board);
  projected[empty.row][empty.col] = clonePiece(piece);
  projected[from.row][from.col] = null;
  const advancedTriggerPreview = detectAdvancedTrigger(
    board,
    projected,
    piece,
    from,
    empty,
    player.color
  );
  const manuallyMovedSpecial = SPECIAL_TYPES.includes(piece.type);
  const specialTrigger = advancedTriggerPreview ? null : detectSpecialTrigger(projected, from, {
    excludePieceId: manuallyMovedSpecial ? piece.id : null
  });
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
  player.advancedTrapArmed = [];

  const boardBefore = cloneBoard(board);
  const fulfillsCarpObligation = player.mustMoveCarp && piece.type === 'carp';
  const orientation = orientPieceForMovement(piece, from, empty);
  board[empty.row][empty.col] = piece;
  board[from.row][from.col] = null;
  player.movesRemaining -= pieceMoveCost;
  if (fulfillsCarpObligation) player.mustMoveCarp = false;
  if (createsCarpObligation) player.mustMoveCarp = true;

  // Hierarquia automática: Anzol → Rede → Garça → Gato → especiais.
  // Se uma avançada é ativada, nenhuma especial é ativada pelo mesmo novo vazio.
  const advancedTrigger = detectAdvancedTrigger(
    boardBefore,
    board,
    piece,
    from,
    empty,
    player.color
  );
  const advancedAction = applyAdvancedTrigger(board, advancedTrigger, empty, player.color);
  player.advancedTrapArmed = advancedAction.armed;

  let specialAction = null;
  if (!advancedTrigger) {
    const trigger = detectSpecialTrigger(board, findEmpty(board), {
      excludePieceId: manuallyMovedSpecial ? piece.id : null
    });
    if (trigger) {
      specialAction = applySpecialTrigger(board, trigger);
      player.movesRemaining -= specialAction.cost;
      addLog(room, specialAction.message, playerId);
    }
  }

  orientAdvancedPiecesTowardEmpty(board, findEmpty(board));

  const advancedMessage = advancedActivationMessage(advancedAction);
  player.specialAlert = advancedMessage || specialAction?.message || '';
  if (advancedMessage) addLog(room, advancedMessage, playerId);

  if (player.movesRemaining === 0) {
    const finalEmpty = findEmpty(board);
    player.correctionRequired = finalEmpty.row === MIDDLE_ROW;
  }

  const lastCapture = advancedAction.captures.at(-1);
  player.lastMovedPieceId = specialAction?.pieceId || lastCapture?.replacementPieceId || piece.id;
  setAction(room, {
    type: 'move',
    playerId,
    from: { ...from },
    to: { ...empty },
    pieceId: piece.id,
    pieceType: piece.type,
    movedOverlayTypes: (piece.overlays || []).map((overlay) => overlay.type),
    ...orientation,
    special: specialAction,
    advanced: advancedAction
  });

  const moveLimit = MOVES_PER_ROUND + player.extraMovesPurchased;
  if (createsCarpObligation && !specialAction && !advancedMessage) {
    addLog(room, 'moveu uma alga sem gastar movimento; agora deve mover uma carpa.', playerId);
  } else if (!specialAction && !advancedMessage) {
    addLog(room, `realizou o movimento ${moveLimit - player.movesRemaining}/${moveLimit}.`, playerId);
  }

  return {
    correction: false,
    specialMoved: Boolean(specialAction),
    specialType: specialAction?.type || null,
    advanced: advancedAction
  };
}

function advancedCaptureMessage(capture) {
  const source = capture.sources?.[0];
  const replacement = `Ela foi substituída por uma carpa ${labelColor(capture.replacementColor)}.`;
  const explanations = {
    hook: `Ativação automática — Anzol: sua carpa preferida estava ortogonalmente (✚) adjacente ao Anzol, entre ele e o vazio. Ao se mover para o vazio, ela foi fisgada; a carpa substituta entrou na casa original, ao lado do Anzol. ${replacement}`,
    net: `Ativação automática — Rede: sua carpa preferida terminou o movimento ortogonalmente (✚) adjacente à Rede. A carpa foi capturada. ${replacement}`,
    heron: `Ativação automática — Garça: enquanto estava sobre a planta, uma carpa preferida entrou no vazio ortogonalmente (✚) adjacente a ela e foi capturada. ${replacement}`,
    cat: `Ativação automática — Gato: enquanto estava sobre a planta, uma carpa preferida entrou no vazio ortogonalmente (✚) adjacente a ela e foi capturada. ${replacement}`
  };
  return explanations[source] || `Ativação automática — peça avançada: uma carpa preferida foi capturada. ${replacement}`;
}

function advancedActivationMessage(advancedAction) {
  if (advancedAction?.captures?.length) return advancedCaptureMessage(advancedAction.captures[0]);
  const jump = advancedAction?.jumps?.[0];
  if (!jump) return '';

  if (jump.type === 'heron') {
    return 'Ativação automática — Garça: a planta movida terminou na mesma diagonal (✕) da Garça. A Garça saltou para essa planta e permanece de tocaia: enquanto estiver sobre ela, qualquer carpa preferida movida para um vazio ortogonalmente (✚) adjacente à planta será capturada.';
  }
  if (jump.type === 'cat') {
    return 'Ativação automática — Gato: a planta movida terminou na mesma linha ou coluna do Gato. O Gato saltou para essa planta e permanece de tocaia: enquanto estiver sobre ela, qualquer carpa preferida movida para um vazio ortogonalmente (✚) adjacente à planta será capturada.';
  }
  return '';
}

function undoLastMove(room, playerId) {
  assertPlayersPresent(room);
  const player = room.players[playerId];
  if (!player) throw new Error('Jogador não encontrado.');

  if (room.phase === 'development') {
    if (player.development?.confirmed) {
      throw new Error(waitingForPlayersMessage(room, playerId, 'development') || 'Você já confirmou a Venda e reposição.');
    }
    const snapshot = player.developmentHistory?.pop();
    if (!snapshot) throw new Error('Não há reposições para desfazer.');

    const boardBeforeUndo = cloneBoard(player.board);
    restoreDevelopmentState(player, snapshot);
    const positions = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        if ((boardBeforeUndo[row][col]?.id || null) !== (player.board[row][col]?.id || null)) positions.push({ row, col });
      }
    }
    setAction(room, {
      type: 'undoDevelopment',
      playerId,
      positions,
      developmentHistoryRemaining: player.developmentHistory.length,
      replaced: player.development?.replaced || 0,
      coins: player.coins
    });
    addLog(room, 'desfez a última reposição.', playerId);
    return { developmentHistoryRemaining: player.developmentHistory.length };
  }

  if (room.phase !== 'movement') throw new Error('Só é possível desfazer durante a Movimentação ou a Venda e reposição.');
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
    const automaticallyDone = capacity === 0 || eligibleColors.length === 0;
    player.development = {
      capacity,
      eligibleColors,
      chosenColor: eligibleColors.length === 1 ? eligibleColors[0] : null,
      replaced: 0,
      done: automaticallyDone,
      confirmed: automaticallyDone
    };
    player.developmentHistory = [];
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
  if (room.playerOrder.every((id) => {
    const development = room.players[id].development;
    return development?.confirmed === undefined ? Boolean(development?.done) : Boolean(development?.confirmed);
  })) finishDevelopmentAndAdvance(room);
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

  player.developmentHistory ||= [];
  player.developmentHistory.push(snapshotDevelopmentState(player));

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
    development.confirmed = false;
    addLog(room, `completou ${development.replaced} reposição(ões) e pode revisar ou desfazer antes de confirmar.`, playerId);
  } else if (exhaustedColor) {
    addLog(room, `esgotou as carpas ${labelColor(oldColor)}s e deve seguir para a próxima menor cor.`, playerId);
  }
}

function markDevelopmentReady(room, playerId) {
  assertPlayersPresent(room);
  if (room.phase !== 'development') throw new Error('Não é a fase de Venda e reposição.');
  const player = room.players[playerId];
  const development = player?.development;
  if (!development) throw new Error('Reposição indisponível.');
  if (development.confirmed) throw new Error(waitingForPlayersMessage(room, playerId, 'development') || 'Você já confirmou a Venda e reposição.');
  if (!development.done) throw new Error('Complete todas as reposições antes de concluir a fase.');

  development.confirmed = true;
  setAction(room, {
    type: 'developmentReady',
    playerId,
    replaced: development.replaced,
    coins: player.coins
  });
  addLog(room, 'confirmou a Venda e reposição.', playerId);

  if (room.playerOrder.every((id) => {
    const current = room.players[id].development;
    return current?.confirmed === undefined ? Boolean(current?.done) : Boolean(current?.confirmed);
  })) finishDevelopmentAndAdvance(room);
  return { confirmed: true };
}

function finishDevelopmentAndAdvance(room) {
  if (room.round >= MAX_ROUNDS) {
    finishGame(room);
    return;
  }

  room.round += 1;
  room.phase = 'movement';
  for (const id of room.playerOrder) resetPlayerForRound(room.players[id], false);
  if (room.mode === 'solo') {
    const soloPlayer = room.players[room.playerOrder[0]];
    tryReturnSoloAdvancedPiece(room, soloPlayer);
    generateAutomaLine(room, soloPlayer);
  }
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
    const soloOutgoingLine = player.board[MIDDLE_ROW];
    soloOutgoingLine.forEach((piece) => {
      const turn = orientPieceForCurrent(piece);
      if (turn) turns[piece.id] = turn;
      if (piece?.type === 'carp' && piece.color === player.color) room.solo.exitedPreferred += 1;
      if (piece && SPECIAL_TYPES.includes(piece.type)) room.solo.specialCooldown[piece.type] = 1;
    });
    const exitedAdvanced = advancedTypesInLine(soloOutgoingLine);
    if (normalizedRuleset(room.ruleset) === 'advanced' && exitedAdvanced.length) {
      room.solo.advancedReturnRound = room.round + 1;
      room.solo.advancedType = null;
      addLog(room, `${exitedAdvanced.map((type) => ADVANCED_LABELS[type]).join(' e ')} saiu do tanque. Uma nova peça avançada poderá entrar no início da próxima rodada.`, playerId);
    }
    outgoing[playerId] = soloOutgoingLine.map(clonePiece);
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
      developmentHistoryLength: player.developmentHistory?.length || 0,
      coins: player.coins,
      extraMovesPurchased: player.extraMovesPurchased,
      moveLimit: MOVES_PER_ROUND + player.extraMovesPurchased,
      discard: player.discard,
      specialAlert: player.specialAlert || '',
      movementDeadEnd: room.phase === 'movement' ? isMovementDeadEnd(player) : false
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
    ruleset: normalizedRuleset(room.ruleset),
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
    rankingGeneral: room.rankingGeneral || null,
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
      specialCooldown: room.solo.specialCooldown,
      advancedReturnRound: room.solo.advancedReturnRound || null,
      advancedType: room.solo.advancedType || null
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
      specialTypes: SPECIAL_TYPES,
      advancedTypes: ADVANCED_TYPES,
      automaticPriority: AUTOMATIC_PRIORITY,
      rulesets: RULESETS
    }
  };
}

module.exports = {
  COLORS,
  SPECIAL_TYPES,
  ADVANCED_TYPES,
  RULESETS,
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
  calculateScores,
  finishGame,
  randomId,
  allPlayersConnected
};
