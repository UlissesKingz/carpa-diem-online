(() => {
  const socket = io();
  const app = document.querySelector('#app');
  const layout = document.body.dataset.layout || 'desktop';
  const config = window.CARPAS_CONFIG || {};
  const useMobilePngAssets = layout === 'mobile' || window.matchMedia('(max-width: 720px)').matches;
  const MOBILE_PNG_ASSET_ROOT = '/assets/mobile';
  const MOBILE_MINI_PNG_ASSET_ROOT = '/assets/mobile-mini';
  const PNG_ASSET_ROOT = useMobilePngAssets ? MOBILE_PNG_ASSET_ROOT : '/assets';
  const MINI_PNG_ASSET_ROOT = useMobilePngAssets ? MOBILE_MINI_PNG_ASSET_ROOT : MOBILE_PNG_ASSET_ROOT;
  const RANKING_PLAYER_ID_KEY = 'carpaDiemRankingPlayerId';

  const COLORS = ['yellow', 'white', 'red', 'gray'];
  const COLOR_LABELS = { yellow: 'Amarela', white: 'Branca', red: 'Vermelha', gray: 'Cinza' };
  const RULESET_LABELS = { classic: 'Padrão', advanced: 'Avançado', kids: 'Kids' };
  const RULESET_SUMMARIES = {
    classic: 'Jogo-base com carpas, plantas e as quatro peças especiais.',
    advanced: 'Adiciona Anzol, Rede, Garça e Gato ao setup e à movimentação.',
    kids: 'Sem peças especiais ou avançadas: 7 carpas de cada cor + 6 plantas.'
  };
  const PHASE_LABELS = {
    lobby: 'Sala de espera',
    movement: 'Fase da movimentação',
    development: 'Fase de Venda e reposição',
    circulation: 'Fase da Correnteza',
    finished: 'Fase do resultado final'
  };
  const ASSETS = {
    yellow: `${PNG_ASSET_ROOT}/carp-yellow.png`,
    white: `${PNG_ASSET_ROOT}/carp-white.png`,
    red: `${PNG_ASSET_ROOT}/carp-red.png`,
    gray: `${PNG_ASSET_ROOT}/carp-gray.png`,
    algae: `${PNG_ASSET_ROOT}/algae.png`,
    shoal: `${PNG_ASSET_ROOT}/tesourinhas.png`,
    sturgeon: `${PNG_ASSET_ROOT}/sturgeon.png`,
    dojo: `${PNG_ASSET_ROOT}/dojo.png`,
    papaTerra: `${PNG_ASSET_ROOT}/papa-terra.png`,
    hook: `${PNG_ASSET_ROOT}/anzol.png`,
    net: `${PNG_ASSET_ROOT}/rede.png`,
    heron: `${PNG_ASSET_ROOT}/garca.png`,
    cat: `${PNG_ASSET_ROOT}/gato.png`,
    coin: `${PNG_ASSET_ROOT}/coin.png`,
    moneyBag: `${PNG_ASSET_ROOT}/money-bag.png`,
    logo: `${PNG_ASSET_ROOT}/logo.png`,
    fishAnimation: '/assets/fish-animation.gif'
  };

  const MINI_ASSETS = {
    yellow: `${MINI_PNG_ASSET_ROOT}/carp-yellow.png`,
    white: `${MINI_PNG_ASSET_ROOT}/carp-white.png`,
    red: `${MINI_PNG_ASSET_ROOT}/carp-red.png`,
    gray: `${MINI_PNG_ASSET_ROOT}/carp-gray.png`,
    algae: `${MINI_PNG_ASSET_ROOT}/algae.png`,
    shoal: `${MINI_PNG_ASSET_ROOT}/tesourinhas.png`,
    sturgeon: `${MINI_PNG_ASSET_ROOT}/sturgeon.png`,
    dojo: `${MINI_PNG_ASSET_ROOT}/dojo.png`,
    papaTerra: `${MINI_PNG_ASSET_ROOT}/papa-terra.png`,
    hook: `${MINI_PNG_ASSET_ROOT}/anzol.png`,
    net: `${MINI_PNG_ASSET_ROOT}/rede.png`,
    heron: `${MINI_PNG_ASSET_ROOT}/garca.png`,
    cat: `${MINI_PNG_ASSET_ROOT}/gato.png`
  };

  const SOUND_URLS = {
    move: 'https://res.cloudinary.com/dzjwlafsx/video/upload/v1785869993/fish_move_htw4ys.mp3',
    current: 'https://res.cloudinary.com/dzjwlafsx/video/upload/v1785875411/canal_aberto_longo_lw0d8w.mp3',
    replace: 'https://res.cloudinary.com/dzjwlafsx/video/upload/v1785869993/change_fish_inwrkc.mp3',
    hook: '/assets/anzol.mp3',
    net: '/assets/rede.mp3',
    heron: '/assets/garca.mp3',
    cat: '/assets/gato.mp3',
    roundStart: '/assets/iniciorodada.mp3',
    coins: '/assets/coins.mp3',
    undo: '/assets/desfazerjogada.mp3'
  };
  const SOUND_VOLUMES = {
    move: 0.46,
    current: 0.58,
    replace: 0.54,
    hook: 0.60,
    net: 0.60,
    heron: 0.60,
    cat: 0.60,
    roundStart: 0.62,
    coins: 1.0,
    undo: 0.62
  };
  const soundBases = Object.fromEntries(Object.entries(SOUND_URLS).map(([key, src]) => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = SOUND_VOLUMES[key];
    return [key, audio];
  }));

  let state = null;
  let identity = loadIdentity();
  let notice = '';
  let movementError = '';
  let entryRole = identity.role === 'spectator' ? 'spectator' : (identity.roomMode === 'solo' ? 'solo' : 'multiplayer');
  let localRestartConfirm = false;
  let localExitConfirm = false;
  let clearEntryAfterExit = false;
  let lastAnimatedActionId = null;
  let animateCurrentAction = false;
  let serverConnected = socket.connected;
  let reconnectingToRoom = false;
  const rankingPlayerId = loadOrCreateRankingPlayerId();
  let rankingLeadersOpen = false;
  let rankingLeadersLoading = false;
  let rankingLeadersData = null;
  let rankingLeadersError = '';
  let lastRoundIntroShown = null;
  let roundIntroRound = null;
  let roundIntroTimer = null;

  function isCompactMobile() {
    return layout === 'mobile' || window.matchMedia('(max-width: 720px)').matches;
  }


  function loadOrCreateRankingPlayerId() {
    let stored = String(localStorage.getItem(RANKING_PLAYER_ID_KEY) || '').trim();
    if (/^[A-Za-z0-9_-]{12,96}$/.test(stored)) return stored;

    if (window.crypto?.randomUUID) {
      stored = window.crypto.randomUUID();
    } else if (window.crypto?.getRandomValues) {
      const bytes = new Uint8Array(18);
      window.crypto.getRandomValues(bytes);
      stored = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    } else {
      stored = `player-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    }

    localStorage.setItem(RANKING_PLAYER_ID_KEY, stored);
    return stored;
  }

  function loadIdentity() {
    try {
      const stored = JSON.parse(localStorage.getItem('carpasIdentity')) || {};
      if (!stored.memberId && stored.playerId) stored.memberId = stored.playerId;
      if (!stored.memberToken && stored.playerToken) stored.memberToken = stored.playerToken;
      if (!stored.role && stored.memberId) stored.role = 'player';
      return stored;
    } catch {
      return {};
    }
  }

  function saveIdentity(next) {
    identity = { ...identity, ...next };
    localStorage.setItem('carpasIdentity', JSON.stringify(identity));
  }

  function clearRoomIdentity() {
    const preservedName = identity.name || '';
    identity = { name: preservedName };
    localStorage.setItem('carpasIdentity', JSON.stringify(identity));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeEntryName(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
  }

  function isValidEntryName(value) {
    return /^[\p{L}\p{N} ._'’\-]{1,24}$/u.test(value);
  }

  function normalizeEntryRoomCode(value) {
    return String(value || '')
      .normalize('NFKC')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4);
  }

  function emit(event, payload = {}, options = {}) {
    return new Promise((resolve) => {
      socket.emit(event, payload, (response) => {
        if (!response?.ok) {
          const message = response?.error || 'Não foi possível concluir a ação.';
          if (!options.silent) {
            if (['movePiece', 'finishMovement', 'buyExtraMove'].includes(event) || (event === 'undoMove' && state?.phase === 'movement')) {
              movementError = message;
              notice = '';
            } else {
              notice = message;
            }
            render();
          }
        } else if (['movePiece', 'finishMovement', 'undoMove', 'buyExtraMove'].includes(event)) {
          movementError = '';
        }
        resolve(response);
      });
    });
  }

  function playSound(key) {
    const base = soundBases[key];
    if (!base) return;
    const sound = base.cloneNode(true);
    sound.volume = SOUND_VOLUMES[key];
    sound.play().catch(() => {});
  }

  function advancedActivationSoundType(action) {
    const captureType = action?.advanced?.captures?.[0]?.sources?.[0];
    if (['hook', 'net', 'heron', 'cat'].includes(captureType)) return captureType;

    const jumpType = action?.advanced?.jumps?.[0]?.type;
    if (['heron', 'cat'].includes(jumpType)) return jumpType;

    return null;
  }

  function manuallyMovedAdvancedSoundType(action) {
    if (['hook', 'net'].includes(action?.pieceType)) return action.pieceType;
    const overlayType = (action?.movedOverlayTypes || []).find((type) => ['heron', 'cat'].includes(type));
    return overlayType || null;
  }

  function playActionSound(action) {
    if (!action || Date.now() - Number(action.at || 0) > 3500) return;

    if (action.type === 'move' || action.type === 'correctionMove') {
      // Ativações automáticas das peças avançadas continuam globais: todos ouvem.
      const advancedEffect = advancedActivationSoundType(action);
      if (advancedEffect) {
        playSound(advancedEffect);
        return;
      }

      // Movimentos comuns e deslocamentos manuais de peças avançadas são locais:
      // somente o jogador que realizou a jogada ouve em sua própria tela.
      if (action.playerId !== identity.memberId) return;
      const movedAdvanced = manuallyMovedAdvancedSoundType(action);
      if (movedAdvanced) {
        playSound(movedAdvanced);
        return;
      }

      playSound('move');
      return;
    }

    // Desfazer é um acontecimento global da partida.
    if (action.type === 'undo' || action.type === 'undoDevelopment') {
      playSound('undo');
      return;
    }

    if (action.type === 'circulationStart') {
      playSound('current');
      return;
    }

    // Na venda, somente quem recebeu a moeda ouve o som.
    if (action.type === 'replace') {
      if (action.playerId === identity.memberId) playSound('coins');
      return;
    }

    // A compra de movimento extra é anunciada para todos com o som de moedas.
    if (action.type === 'extraMovePurchased') playSound('coins');
  }


  function roomIsAtRoundMovementStart(room) {
    if (!room || room.status !== 'playing' || room.phase !== 'movement') return false;
    const playerIds = Array.isArray(room.playerOrder) ? room.playerOrder : [];
    if (!playerIds.length) return false;
    return playerIds.every((id) => {
      const player = room.players?.[id];
      if (!player) return false;
      const limit = Number(player.moveLimit || room.constants?.movesPerRound || 12);
      return Number(player.movesRemaining) === limit && !player.movementReady;
    });
  }

  function maybeShowRoundIntro(room) {
    const round = Number(room?.round || 0);
    const introKey = `${room?.code || ''}:${Number(room?.restartCount || 0)}:${round}`;
    if (!round || lastRoundIntroShown === introKey || !roomIsAtRoundMovementStart(room)) return;
    lastRoundIntroShown = introKey;
    roundIntroRound = round;
    // O aviso de início de rodada e seu som são locais a cada jogador.
    if (identity.role === 'player') playSound('roundStart');
    if (roundIntroTimer) clearTimeout(roundIntroTimer);
    roundIntroTimer = window.setTimeout(() => {
      if (roundIntroRound === round) {
        roundIntroRound = null;
        render();
      }
    }, 2200);
  }

  function roundLabel(round = state?.round) {
    const currentRound = Number(round || 0);
    const maxRounds = Number(state?.constants?.maxRounds || 0);
    if (currentRound > 0 && maxRounds > 0 && currentRound === maxRounds) return 'Última Rodada';
    return currentRound > 0 ? `Rodada ${currentRound}` : 'Rodada —';
  }

  function roundIntroHtml() {
    if (!roundIntroRound) return '';
    const label = roundLabel(roundIntroRound);
    const text = label === 'Última Rodada' ? label : `Início da ${label}`;
    return `<div class="round-start-announcement" aria-live="polite"><strong>${text}</strong></div>`;
  }

  socket.on('roomState', (room) => {
    serverConnected = true;
    reconnectingToRoom = false;
    const previousState = state;
    const isNewAction = Boolean(room.lastAction && room.lastAction.id !== lastAnimatedActionId);
    const phaseChanged = previousState?.phase && previousState.phase !== room.phase;
    const ownMovementSucceeded = room.lastAction?.playerId === identity.memberId
      && ['move', 'correctionMove', 'undo'].includes(room.lastAction?.type);
    state = room;
    maybeShowRoundIntro(room);
    notice = '';
    if (phaseChanged || ownMovementSucceeded || room.phase !== 'movement') movementError = '';
    localRestartConfirm = false;
    animateCurrentAction = isNewAction;

    // No mobile, durante a maior parte da Fase de movimentação, atualiza só o
    // tanque/jogador que realmente mudou e os pequenos painéis necessários.
    // Isso evita destruir e recriar todos os 2–4 tabuleiros a cada movimento.
    const usedMobilePatch = isNewAction
      && canUseMobileMovementPatch(previousState, room, room.lastAction)
      && updateMobileMovementUi(room.lastAction);
    if (!usedMobilePatch) render();

    if (isNewAction) playActionSound(room.lastAction);
    if (room.lastAction) lastAnimatedActionId = room.lastAction.id;
  });

  socket.on('connect', async () => {
    serverConnected = true;
    if (!identity.roomCode || !identity.memberToken) {
      reconnectingToRoom = false;
      render();
      return;
    }
    reconnectingToRoom = true;
    render();

    const event = identity.role === 'spectator' ? 'joinSpectator' : 'joinRoom';
    const payload = identity.role === 'spectator'
      ? { roomCode: identity.roomCode, spectatorToken: identity.memberToken, name: identity.name }
      : { roomCode: identity.roomCode, playerToken: identity.memberToken, name: identity.name, color: identity.color, rankingPlayerId };
    const response = await emit(event, payload, { silent: true });
    if (!response?.ok) {
      reconnectingToRoom = false;
      clearRoomIdentity();
      state = null;
      notice = '';
      movementError = '';
      entryRole = 'multiplayer';
      render();
    }
  });

  socket.on('disconnect', () => {
    serverConnected = false;
    reconnectingToRoom = Boolean(identity.roomCode && identity.memberToken);
    render();
  });

  socket.on('connect_error', () => {
    serverConnected = false;
    reconnectingToRoom = Boolean(identity.roomCode && identity.memberToken);
    render();
  });

  function me() {
    return identity.role === 'player' ? state?.players?.[identity.memberId] || null : null;
  }

  function spectatorMe() {
    return identity.role === 'spectator' ? state?.spectators?.[identity.memberId] || null : null;
  }

  function actorForLog(log) {
    if (!log.actorId) return null;
    if (log.actorRole === 'spectator') return state?.spectators?.[log.actorId] || null;
    return state?.players?.[log.actorId] || null;
  }

  function colorBadge(color) {
    return `<span class="color-badge badge-${color}">${COLOR_LABELS[color]}</span>`;
  }

  function playerNameChip(player) {
    return `<span class="player-name-chip chip-${player.color}">${escapeHtml(player.name)}</span>`;
  }

  function botBadgeHtml(player, compact = false) {
    return player?.isBot ? `<span class="bot-badge ${compact ? 'compact' : ''}">BOT</span>` : '';
  }

  function pieceAnimation(playerId, row, col, piece) {
    const emptyAnimation = { shellClass: '', shellStyle: '', orientationClass: '', orientationStyle: '' };
    if (!animateCurrentAction || !state?.lastAction || !piece) return emptyAnimation;
    if (isCompactMobile() && identity.role === 'player' && playerId !== identity.memberId) return emptyAnimation;
    const action = state.lastAction;

    const advancedLunge = action.playerId === playerId
      ? action.advanced?.captures?.find((capture) =>
        capture.activationPieceId === piece.id
        && capture.activationPosition?.row === row
        && capture.activationPosition?.col === col
        && capture.capturedPosition
      )
      : null;
    if (advancedLunge) {
      return {
        ...emptyAnimation,
        shellClass: 'animate-advanced-capture-lunge',
        shellStyle: `--capture-x:${advancedLunge.capturedPosition.col - col};--capture-y:${advancedLunge.capturedPosition.row - row};`
      };
    }

    if ((action.type === 'move' || action.type === 'correctionMove') && action.playerId === playerId) {
      if (action.pieceId === piece.id && action.to?.row === row && action.to?.col === col) {
        const dx = action.from.col - action.to.col;
        const dy = action.from.row - action.to.row;
        return {
          shellClass: 'animate-slide',
          shellStyle: `--move-x:${dx};--move-y:${dy};`,
          orientationClass: action.oriented ? 'animate-orient' : '',
          orientationStyle: `--start-rotation:${Number(action.fromRotation || 0)}deg;--piece-rotation:${Number(action.toRotation ?? piece.rotation ?? 0)}deg;`
        };
      }
      if (action.shoal?.pieceId === piece.id && action.shoal.to?.row === row && action.shoal.to?.col === col) {
        const dx = action.shoal.from.col - action.shoal.to.col;
        const dy = action.shoal.from.row - action.shoal.to.row;
        return {
          shellClass: 'animate-shoal',
          shellStyle: `--move-x:${dx};--move-y:${dy};`,
          orientationClass: action.shoal.oriented ? 'animate-orient-shoal' : '',
          orientationStyle: `--start-rotation:${Number(action.shoal.fromRotation || 0)}deg;--piece-rotation:${Number(action.shoal.toRotation ?? piece.rotation ?? 0)}deg;`
        };
      }
      const specialMove = action.special?.moves?.find((move) => move.pieceId === piece.id && move.to?.row === row && move.to?.col === col);
      if (specialMove) {
        const dx = specialMove.from.col - specialMove.to.col;
        const dy = specialMove.from.row - specialMove.to.row;
        return {
          shellClass: `animate-special animate-special-${action.special.type}`,
          shellStyle: `--move-x:${dx};--move-y:${dy};`,
          orientationClass: specialMove.oriented ? 'animate-orient-shoal' : '',
          orientationStyle: `--start-rotation:${Number(specialMove.fromRotation || 0)}deg;--piece-rotation:${Number(specialMove.toRotation ?? piece.rotation ?? 0)}deg;`
        };
      }
    }

    if (action.type === 'replace' && action.playerId === playerId && action.pieceId === piece.id && action.position?.row === row && action.position?.col === col) {
      return { ...emptyAnimation, shellClass: 'animate-replace' };
    }

    const advancedCapture = action.advanced?.captures?.find((capture) =>
      capture.replacementPieceId === piece.id
      && capture.position?.row === row
      && capture.position?.col === col
    );
    if (advancedCapture) {
      return { ...emptyAnimation, shellClass: 'animate-replace advanced-capture-replacement' };
    }

    if (['undo', 'undoDevelopment'].includes(action.type) && action.playerId === playerId && action.positions?.some((position) => position.row === row && position.col === col)) {
      return { ...emptyAnimation, shellClass: 'animate-undo', shellStyle: `--undo-delay:${(row * state.constants.cols + col) * 10}ms;` };
    }

    if (action.type === 'circulationStart' && row === state.constants.middleRow) {
      const turn = action.turns?.[piece.id];
      return {
        ...emptyAnimation,
        shellClass: 'animate-line-out',
        shellStyle: `--line-delay:${col * 155}ms;--line-travel:-${(col + 2) * 112}%;`,
        orientationClass: turn?.oriented ? 'animate-orient-current' : '',
        orientationStyle: turn ? `--start-rotation:${Number(turn.fromRotation || 0)}deg;--piece-rotation:${Number(turn.toRotation || 90)}deg;` : ''
      };
    }

    if (action.type === 'circulationComplete' && row === state.constants.middleRow) {
      return {
        ...emptyAnimation,
        shellClass: 'animate-line-in',
        shellStyle: `--line-delay:${col * 180}ms;--line-travel:${(state.constants.cols - col + 1) * 112}%;`
      };
    }

    if (action.type === 'restartComplete') {
      return { ...emptyAnimation, shellClass: 'animate-replace', shellStyle: `--line-delay:${(row * state.constants.cols + col) * 8}ms;` };
    }

    return emptyAnimation;
  }

  function createPieceHtml(piece, playerId, row, col, { tiny = false } = {}) {
    if (!piece) return '<span class="empty-water" aria-label="Espaço vazio"></span>';
    const animation = pieceAnimation(playerId, row, col, piece);
    const isAdvancedCell = ['hook', 'net'].includes(piece.type);
    const rotation = isAdvancedCell ? 0 : Number(piece.rotation || 0);
    const pieceAssets = tiny ? MINI_ASSETS : ASSETS;
    const src = piece.type === 'carp' ? pieceAssets[piece.color] : pieceAssets[piece.type];
    const SPECIAL_LABELS = { shoal: 'Tesourinhas', sturgeon: 'Esturjão', dojo: 'Dojô', papaTerra: 'Papa-terra' };
    const ADVANCED_LABELS = { hook: 'Anzol', net: 'Rede', heron: 'Garça', cat: 'Gato' };
    const label = piece.type === 'carp'
      ? `Carpa ${COLOR_LABELS[piece.color]}`
      : piece.type === 'algae'
        ? 'Planta'
        : (SPECIAL_LABELS[piece.type] || ADVANCED_LABELS[piece.type] || 'Peça especial');
    const lastMoved = state?.phase === 'movement' && state?.players?.[playerId]?.lastMovedPieceId === piece.id;
    const actionIsOwnMovement = state?.phase === 'movement'
      && ['move', 'correctionMove'].includes(state?.lastAction?.type)
      && state.lastAction.playerId === playerId;
    const specialEffectMoved = actionIsOwnMovement
      && state.lastAction.special?.moves?.some((move) => move.pieceId === piece.id && move.to?.row === row && move.to?.col === col);
    const advancedCellEffect = actionIsOwnMovement
      && state.lastAction.advanced?.captures?.some((capture) =>
        capture.activationPieceId === piece.id
        && capture.activationPosition?.row === row
        && capture.activationPosition?.col === col
      );
    const movementEmphasisClass = (specialEffectMoved || advancedCellEffect)
      ? 'special-effect-moved-art'
      : (lastMoved ? 'last-moved-art' : '');
    const orientationStyle = isAdvancedCell
      ? `--piece-rotation:0deg;--start-rotation:0deg;--advanced-facing-scale:${piece.facing === 'right' ? -1 : 1};`
      : (animation.orientationStyle || `--piece-rotation:${rotation}deg;--start-rotation:${rotation}deg;--advanced-facing-scale:1;`);
    const overlaysHtml = piece.type === 'algae' && Array.isArray(piece.overlays)
      ? piece.overlays.map((overlay, index) => {
          const overlayLabel = ADVANCED_LABELS[overlay.type] || 'Peça avançada';
          const facingScale = overlay.facing === 'right' ? -1 : 1;
          const overlayJump = actionIsOwnMovement
            ? state.lastAction.advanced?.jumps?.find((jump) =>
                jump.overlayId === overlay.id
                && jump.to?.row === row
                && jump.to?.col === col
              )
            : null;
          const overlayCapture = actionIsOwnMovement
            ? state.lastAction.advanced?.captures?.find((capture) =>
                capture.activationOverlayId === overlay.id
                && capture.activationPosition?.row === row
                && capture.activationPosition?.col === col
              )
            : null;
          const overlayMovedWithPlant = actionIsOwnMovement
            && state.lastAction.pieceId === piece.id
            && state.lastAction.to?.row === row
            && state.lastAction.to?.col === col
            && (state.lastAction.movedOverlayTypes || []).includes(overlay.type);
          const overlayEmphasisClass = (overlayJump || overlayCapture)
            ? 'special-effect-moved-art'
            : ((overlayMovedWithPlant || lastMoved) ? 'last-moved-art' : '');
          const animateOverlayJump = Boolean(animateCurrentAction && overlayJump && state.lastAction.from);
          const animateOverlayCapture = Boolean(animateCurrentAction && overlayCapture?.capturedPosition);
          const overlayMotionClass = animateOverlayCapture
            ? 'animate-advanced-overlay-capture'
            : (animateOverlayJump ? 'animate-advanced-overlay-jump' : '');
          const overlayMotionStyle = animateOverlayCapture
            ? `--capture-x:${overlayCapture.capturedPosition.col - col};--capture-y:${overlayCapture.capturedPosition.row - row};`
            : (animateOverlayJump
              ? `--overlay-move-x:${overlayJump.from.col - state.lastAction.from.col};--overlay-move-y:${overlayJump.from.row - state.lastAction.from.row};`
              : '');
          return `<span class="advanced-overlay-motion ${overlayMotionClass}" style="${overlayMotionStyle}"><span class="advanced-overlay-position" style="--overlay-index:${index}"><span class="advanced-overlay-facing" style="--advanced-facing-scale:${facingScale}"><img class="advanced-overlay-art advanced-overlay-${overlay.type} ${overlayEmphasisClass}" src="${pieceAssets[overlay.type]}" alt="" title="${overlayLabel}" aria-hidden="true" draggable="false"></span></span></span>`;
        }).join('')
      : '';

    return `
  <span
    class="piece-shell piece-shell-${piece.type} ${tiny ? 'tiny' : ''} ${animation.shellClass}"
    style="${animation.shellStyle}"
  >
    <span
      class="piece-orientation ${animation.orientationClass}"
      style="${orientationStyle}"
    >
      <img
        class="piece-art piece-${piece.type} ${movementEmphasisClass}"
        src="${src}"
        alt=""
        title="${label}"
        aria-hidden="true"
        draggable="false"
      >
    </span>
    ${overlaysHtml}
  </span>
`;
  }


  function advancedCaptureGhostHtml(playerId, row, col, { tiny = false } = {}) {
    if (!animateCurrentAction || !state?.lastAction || state.lastAction.playerId !== playerId) return '';
    if (isCompactMobile() && identity.role === 'player' && playerId !== identity.memberId) return '';
    const capture = state.lastAction.advanced?.captures?.find((item) =>
      item.capturedPosition?.row === row && item.capturedPosition?.col === col
    );
    const ghostAssets = tiny ? MINI_ASSETS : ASSETS;
    if (!capture?.capturedColor || !ghostAssets[capture.capturedColor]) return '';
    return `<span class="captured-carp-ghost" aria-hidden="true"><img src="${ghostAssets[capture.capturedColor]}" alt=""></span>`;
  }

  function boardHtml(player, { interactive = false, miniature = false, spectator = false } = {}) {
    if (!player?.board) return '<div class="tank-placeholder">Aguardando início</div>';
    const current = me();
    const cells = [];
    player.board.forEach((row, rowIndex) => {
      row.forEach((piece, colIndex) => {
        const middle = rowIndex === state.constants.middleRow ? 'middle-row' : '';
        const canReplace = state.phase === 'development'
          && interactive
          && current?.development?.chosenColor
          && piece?.type === 'carp'
          && piece.color === current.development.chosenColor
          && !current.development.done;
        cells.push(`
          <button class="tank-cell ${middle} ${canReplace ? 'replaceable' : ''}" ${interactive ? '' : 'disabled'} data-row="${rowIndex}" data-col="${colIndex}" aria-label="Linha ${rowIndex + 1}, coluna ${colIndex + 1}">
            ${createPieceHtml(piece, player.id, rowIndex, colIndex, { tiny: miniature })}
            ${advancedCaptureGhostHtml(player.id, rowIndex, colIndex, { tiny: miniature })}
          </button>`);
      });
    });
    return `
      <div class="tank ${miniature ? 'miniature' : ''} ${spectator ? 'spectator-tank' : ''}">
        <div class="tank-water-layer"></div>
        <div class="tank-liquid-layer"></div>
        <div class="tank-grid">${cells.join('')}</div>
        <div class="tank-frame-layer"></div>
        <span class="channel-marker left" aria-hidden="true">‹</span>
        <span class="channel-marker right" aria-hidden="true">‹</span>
      </div>`;
  }


  function logoHtml(className = 'brand-logo') {
    return `<img class="${className}" src="${ASSETS.logo}" alt="Carpa Diem">`;
  }

  function externalButton(label, key, icon) {
    return `<button class="top-action external-link" data-link-key="${key}"><span aria-hidden="true">${icon}</span>${label}</button>`;
  }

  function initialExternalActionsHtml() {
    return `<nav class="initial-external-actions" aria-label="Links do jogo">${externalButton('Manual', 'manual', '▤')}${externalButton('Discord', 'discord', '◉')}<button class="top-action ranking-leaders-button" type="button"><span aria-hidden="true">★</span>Maior pontuação</button></nav>`;
  }

  function rankingLeadersModalHtml() {
    if (!rankingLeadersOpen) return '';
    const modes = ['solo', '2', '3', '4'];
    const rulesets = ['kids', 'classic', 'advanced'];
    const content = rankingLeadersLoading
      ? '<p class="ranking-leaders-loading">Carregando os maiores pontuadores...</p>'
      : rankingLeadersError
        ? `<p class="notice error">${escapeHtml(rankingLeadersError)}</p>`
        : rankingLeadersData?.available === false
          ? '<p class="ranking-leaders-loading">Ranking temporariamente indisponível.</p>'
          : `<div class="ranking-difficulty-groups">${rulesets.map((ruleset) => {
            const group = rankingLeadersData?.rulesets?.[ruleset];
            const fallbackLeaders = ruleset === 'classic' ? rankingLeadersData?.leaders : null;
            return `<section class="ranking-difficulty-group">
              <h3>${escapeHtml(group?.label || RULESET_LABELS[ruleset])}</h3>
              <div class="ranking-leaders-grid">${modes.map((mode) => {
                const item = group?.leaders?.[mode] || fallbackLeaders?.[mode];
                const leader = item?.leader;
                return `<article class="ranking-leader-mode">
                  <p class="eyebrow">${escapeHtml(item?.label || (mode === 'solo' ? 'Solo' : `${mode} jogadores`))}</p>
                  ${leader
                    ? `<strong>${escapeHtml(leader.nickname)}</strong><span>${leader.score} carpas · ${leader.coins} moeda${leader.coins === 1 ? '' : 's'}</span>`
                    : '<strong>Sem recorde</strong><span>Ainda não há resultado registrado.</span>'}
                </article>`;
              }).join('')}</div>
            </section>`;
          }).join('')}</div>`;

    return `<div class="modal-backdrop ranking-leaders-backdrop"><section class="modal-card ranking-leaders-card"><p class="eyebrow">Ranking Geral</p><h2>Maiores pontuações por dificuldade</h2>${content}<button class="secondary-button close-ranking-leaders" type="button">Voltar</button></section></div>`;
  }

  async function openRankingLeaders() {
    rankingLeadersOpen = true;
    rankingLeadersLoading = true;
    rankingLeadersError = '';
    render();
    try {
      const response = await fetch('/api/ranking/leaders', { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Não foi possível carregar o ranking.');
      rankingLeadersData = data;
    } catch (error) {
      rankingLeadersError = error.message || 'Não foi possível carregar o ranking.';
    } finally {
      rankingLeadersLoading = false;
      render();
    }
  }

  function bindRankingLeaders() {
    document.querySelector('.ranking-leaders-button')?.addEventListener('click', openRankingLeaders);
    document.querySelector('.close-ranking-leaders')?.addEventListener('click', () => {
      rankingLeadersOpen = false;
      render();
    });
  }

  function bindExternalLinks() {
    document.querySelectorAll('.external-link').forEach((button) => {
      button.addEventListener('click', () => {
        const url = config[`${button.dataset.linkKey}Url`];
        if (!url) {
          notice = `O link de ${button.textContent.trim()} ainda não foi configurado.`;
          render();
          return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    });
  }

  function topbarHtml() {
    const current = me();
    const spectator = spectatorMe();
    const canRestart = identity.role === 'player' && ['playing', 'finished'].includes(state.status);
    return `
      <header class="topbar">
        <div class="topbar-status">
          <strong>${state.status === 'lobby' ? (state.mode === 'solo' ? 'Modo solo' : 'Aguardando jogadores') : `${state.mode === 'solo' ? 'Solo · ' : ''}${RULESET_LABELS[state.ruleset || 'classic']} · Rodada ${state.round}/${state.constants.maxRounds}`}</strong>
          <span class="phase-pill">${PHASE_LABELS[state.phase]}</span>
        </div>
        <div class="topbar-brand">${logoHtml('topbar-logo')}</div>
        <div class="topbar-controls">
          <nav class="topbar-actions" aria-label="Ações da partida">
            ${canRestart ? '<button id="restartGame" class="top-action danger-outline">↻ Reiniciar</button>' : ''}
            ${externalButton('Manual', 'manual', '▤')}
            ${externalButton('Discord', 'discord', '◉')}
            <button class="top-action global-ranking-leaders-button" type="button"><span aria-hidden="true">★</span>Maior pontuação</button>
            <button id="exitGame" class="top-action exit-action">↪ Sair</button>
          </nav>
          <div class="topbar-identity">
            ${current ? `${colorBadge(current.color)}<strong>${escapeHtml(current.name)}</strong>` : `<span class="spectator-badge">Espectador</span><strong>${escapeHtml(spectator?.name || identity.name || '')}</strong>`}
            <span class="connection ${serverConnected ? 'online' : ''}"></span>
          </div>
        </div>
      </header>`;
  }

  function phaseRules() {
    if (state.phase === 'movement') {
      const rules = [
        `Faça ${state.constants.movesPerRound} movimentos usando o espaço vazio.`,
        'Mover uma planta não gasta movimento; depois dela, mova uma carpa.'
      ];
      if (state.ruleset === 'advanced') {
        rules.push(
          'Prioridade automática: Anzol, Rede, Garça, Gato, Tesourinhas, Papa-terra, Dojô e Esturjão.',
          'Peças avançadas têm prioridade sobre as especiais; quando uma avançada ativa, nenhuma especial ativa pelo mesmo novo vazio.',
          'Capturas avançadas substituem a carpa preferida pela cor menos presente.'
        );
      } else if (state.ruleset !== 'kids') {
        rules.push(
          'Peças especiais se ativam automaticamente, com prioridade: Tesourinhas, Papa-terra, Dojô e Esturjão.',
          'Tesourinhas e Dojô gastam 1; Esturjão gasta 2; Papa-terra é gratuito.'
        );
      }
      rules.push(
        'Se o vazio terminar na linha central, preencha-o com um movimento extra.',
        `A cada ${state.constants.extraMoveCost} moedas, compre 1 movimento extra.`
      );
      return rules;
    }
    if (state.phase === 'development') {
      return [
        'Conte sua cor preferida na linha central.',
        'Escolha a menor cor presente entre as demais.',
        'Troque as peças da menor cor até ela acabar.',
        'Se ela acabar antes do total conquistado, escolha a próxima menor cor.',
        'Cada carpa retirada rende 1 moeda imediatamente.',
        'Use Desfazer jogada para voltar a última reposição enquanto esta fase estiver aberta.',
        'Quando terminar, revise as trocas e clique em Concluir venda e reposição.'
      ];
    }
    if (state.phase === 'circulation') {
      return state.mode === 'solo'
        ? [
            'As 7 peças da linha central saem pela esquerda.',
            'As carpas da sua cor preferida que saírem entram na pontuação solo.',
            'A linha do Automa entra pela direita mantendo a ordem.',
            'Depois da Correnteza, ocorre normalmente a Venda e reposição.'
          ]
        : [
            'As 7 peças da linha central saem pela esquerda.',
            'A sequência das peças é preservada.',
            'Cada linha entra pela direita no tanque seguinte.',
            'A fase de Venda e reposição começa depois da Correnteza.'
          ];
    }
    if (state.mode === 'solo') return ['Some as carpas preferidas que saíram pela Correnteza às que ficaram no tanque.', 'Esse total é o seu resultado solo.', 'Sua colocação entra no Ranking Geral da dificuldade jogada — Solo.'];
    return ['Conte todas as carpas de cada cor nos tanques.', 'A maior pontuação vence.', 'Em empate de carpas, vence quem tiver mais moedas.'];
  }


  function roundPanelHtml() {
    const rules = phaseRules();
    return `
      <aside class="round-panel">
        <p class="eyebrow">Rodada atual</p>
        <div class="round-number"><strong>${state.round || '—'}</strong><span>de ${state.constants.maxRounds}</span></div>
        <h2>${PHASE_LABELS[state.phase]}</h2>
        <ol>${rules.map((rule) => `<li>${rule}</li>`).join('')}</ol>
        <div class="phase-track" aria-label="Ordem das fases">
          <span class="${state.phase === 'movement' ? 'active' : ''}">Movimentação</span>
          <span class="${state.phase === 'circulation' ? 'active' : ''}">Correnteza</span>
          <span class="${state.phase === 'development' ? 'active' : ''}">Venda e reposição</span>
        </div>
      </aside>`;
  }

  function lobbyEntry() {
    const colorButtons = COLORS.map((color, index) => `
      <label class="color-choice">
        <input type="radio" name="color" value="${color}" ${identity.color === color || (!identity.color && index === 0) ? 'checked' : ''}>
        <span class="swatch swatch-${color}"></span>${COLOR_LABELS[color]}
      </label>`).join('');

    const isPlayerMode = entryRole === 'multiplayer' || entryRole === 'solo';
    const roleLead = entryRole === 'solo'
      ? 'Desafie seu próprio recorde enquanto espectadores acompanham pelo código da sala.'
      : entryRole === 'spectator'
        ? 'Informe o código para acompanhar uma partida sem interferir nas jogadas.'
        : 'Jogue de 2 a 4 pessoas e faça sua carpa preferida prosperar.';

    const actions = entryRole === 'solo'
      ? '<button id="createRoom" class="primary-button">Criar sala solo</button>'
      : entryRole === 'multiplayer'
        ? '<button id="createRoom" class="primary-button">Criar sala</button><div class="join-row"><input id="roomCode" maxlength="4" placeholder="CÓDIGO"><button id="joinRoom" class="secondary-button">Entrar</button></div>'
        : '<div class="join-row"><input id="roomCode" maxlength="4" placeholder="CÓDIGO"><button id="joinRoom" class="secondary-button">Assistir</button></div>';

    app.innerHTML = `
      <main class="entry-shell">
        <div class="initial-stack">
          ${logoHtml('initial-logo')}
          ${initialExternalActionsHtml()}
          <section class="entry-card">
          <p class="eyebrow">Carpa Diem Online · MVP 6</p>
          <h1>Entre no ecossistema</h1>
          <p class="lead">${roleLead}</p>
          ${notice ? `<div class="notice error">${escapeHtml(notice)}</div>` : ''}
          <div class="role-switch three-tabs">
            <button class="role-tab ${entryRole === 'multiplayer' ? 'active' : ''}" data-role="multiplayer">2–4 Jogadores</button>
            <button class="role-tab ${entryRole === 'solo' ? 'active' : ''}" data-role="solo">Solo</button>
            <button class="role-tab ${entryRole === 'spectator' ? 'active' : ''}" data-role="spectator">Espectador</button>
          </div>
          <label>Seu nome<input id="playerName" maxlength="24" value="${escapeHtml(identity.name || '')}" placeholder="Nome"></label>
          ${isPlayerMode ? `<fieldset><legend>Carpa preferida</legend><div class="color-options">${colorButtons}</div></fieldset>` : '<p class="spectator-note">Espectadores veem todos os tanques, mas não movimentam peças nem participam da votação de reinício.</p>'}
          <div class="entry-actions">${actions}</div>
          <a class="small-link" href="/device.html">Trocar versão</a>
          </section>
        </div>
        ${serverConnectionUiHtml()}
        ${rankingLeadersModalHtml()}
      </main>`;

    bindExternalLinks();
    bindRankingLeaders();

    document.querySelectorAll('.role-tab').forEach((button) => {
      button.addEventListener('click', () => {
        entryRole = button.dataset.role;
        notice = '';
        render();
      });
    });

    document.querySelector('#createRoom')?.addEventListener('click', async () => {
      const name = normalizeEntryName(document.querySelector('#playerName').value);
      const color = document.querySelector('input[name="color"]:checked')?.value;
      if (!name) { notice = 'Digite seu nome.'; return render(); }
      if (!isValidEntryName(name)) { notice = 'Use apenas letras, números, espaços, ponto, hífen ou apóstrofo no nome.'; return render(); }
      const mode = entryRole === 'solo' ? 'solo' : 'multiplayer';
      const response = await emit('createRoom', { name, color, mode, rankingPlayerId });
      if (response?.ok) {
        saveIdentity({ name, color, ...response, roomMode: mode === 'solo' ? 'solo' : (response.roomMode || mode) });
        render();
      }
    });

    document.querySelector('#joinRoom')?.addEventListener('click', async () => {
      const name = normalizeEntryName(document.querySelector('#playerName').value);
      const roomCode = normalizeEntryRoomCode(document.querySelector('#roomCode').value);
      if (!name || roomCode.length !== 4) { notice = 'Informe seu nome e o código da sala.'; return render(); }
      if (!isValidEntryName(name)) { notice = 'Use apenas letras, números, espaços, ponto, hífen ou apóstrofo no nome.'; return render(); }
      if (entryRole === 'spectator') {
        const response = await emit('joinSpectator', { name, roomCode });
        if (response?.ok) { saveIdentity({ name, color: null, ...response }); render(); }
        return;
      }
      const color = document.querySelector('input[name="color"]:checked')?.value;
      const response = await emit('joinRoom', { name, color, roomCode, rankingPlayerId });
      if (response?.ok) { saveIdentity({ name, color, ...response }); render(); }
    });
  }

  function lobbyRoom() {
    const current = me();
    const players = state.playerOrder.map((id) => state.players[id]);
    const spectators = Object.values(state.spectators || {});
    const available = COLORS.filter((color) => !players.some((player) => player.color === color));
    app.innerHTML = `
      <main class="lobby-shell">
        <div class="initial-stack lobby-initial-stack">
          ${logoHtml('initial-logo lobby-logo')}
          ${initialExternalActionsHtml()}
          <section class="lobby-card">
          <header>
            <button id="backToEntry" class="back-button">← Voltar</button>
            <div class="lobby-code"><p class="eyebrow">Sala</p><h1>${state.code}</h1></div>
            <button class="copy-code secondary-button" data-code="${state.code}">Copiar código</button>
          </header>
          <section class="lobby-ruleset" aria-label="Modo de regras">
            <div class="lobby-ruleset-buttons">
              ${['kids', 'classic', 'advanced'].map((ruleset) => `<button class="ruleset-button ${state.ruleset === ruleset ? 'active' : ''}" data-ruleset="${ruleset}" ${current?.id === state.hostId ? '' : 'disabled'}>${RULESET_LABELS[ruleset]}</button>`).join('')}
            </div>
            <p class="ruleset-summary"><strong>${RULESET_LABELS[state.ruleset || 'classic']}:</strong> ${RULESET_SUMMARIES[state.ruleset || 'classic']}</p>
            ${current?.id === state.hostId ? '<small>O anfitrião escolhe o modo antes de iniciar.</small>' : '<small>Modo escolhido pelo anfitrião.</small>'}
          </section>
          ${notice ? `<div class="notice error">${escapeHtml(notice)}</div>` : ''}
          <div class="player-list">
            ${players.map((player) => `<article class="player-row ${player.isBot ? 'bot-player-row' : ''}">${player.isBot ? '<span class="bot-status-dot" aria-hidden="true">◆</span>' : `<span class="connection ${player.connected ? 'online' : ''}"></span>`}${playerNameChip(player)}${colorBadge(player.color)}${botBadgeHtml(player)}${player.id === state.hostId ? '<em>Anfitrião</em>' : ''}${current?.id === state.hostId && player.isBot ? `<button class="remove-bot-button" type="button" data-bot-id="${player.id}" title="Remover ${escapeHtml(player.name)}">Remover</button>` : ''}</article>`).join('')}
          </div>
          <p class="muted">${state.mode === 'solo' ? 'Modo solo · você pode iniciar imediatamente. Espectadores são opcionais e podem entrar usando este código.' : `${players.length}/4 jogadores · Cores livres: ${available.map((color) => COLOR_LABELS[color]).join(', ') || 'nenhuma'}`}</p>
          ${state.mode !== 'solo' && current?.id === state.hostId ? `<section class="lobby-bot-controls"><div><strong>Bots</strong><span>Preencha as vagas restantes com adversários automáticos.</span></div><button id="addBot" class="secondary-button" type="button" ${players.length >= 4 ? 'disabled' : ''}>+ Adicionar bot</button></section>` : ''}
          <section class="spectator-list"><h2>Espectadores <span>${spectators.length}</span></h2>${spectators.length ? spectators.map((spectator) => `<p><span class="connection ${spectator.connected ? 'online' : ''}"></span>${escapeHtml(spectator.name)}</p>`).join('') : '<p class="muted">Nenhum espectador conectado.</p>'}</section>
          ${current?.id === state.hostId ? `<button id="startGame" class="primary-button" ${(state.mode === 'solo' || identity.roomMode === 'solo' || entryRole === 'solo') ? '' : (players.length < 2 ? 'disabled' : '')}>Iniciar partida</button>` : identity.role === 'spectator' ? '<p class="waiting">Você está assistindo à sala de espera.</p>' : '<p class="waiting">Aguardando o anfitrião iniciar...</p>'}
          </section>
        </div>
        ${serverConnectionUiHtml()}
        ${rankingLeadersModalHtml()}
      </main>`;

    bindExternalLinks();
    bindRankingLeaders();

    document.querySelector('#backToEntry').addEventListener('click', async () => {
      const response = await emit('leaveRoom');
      if (!response?.ok) return;
      clearRoomIdentity();
      state = null;
      entryRole = 'multiplayer';
      notice = '';
      render();
    });
    document.querySelector('.copy-code').addEventListener('click', async (event) => {
      await navigator.clipboard.writeText(event.currentTarget.dataset.code);
      notice = 'Código copiado.';
      render();
    });
    document.querySelectorAll('.ruleset-button').forEach((button) => button.addEventListener('click', () => {
      if (button.disabled) return;
      emit('setGameRuleset', { ruleset: button.dataset.ruleset });
    }));
    document.querySelector('#addBot')?.addEventListener('click', () => emit('addBot'));
    document.querySelectorAll('.remove-bot-button').forEach((button) => button.addEventListener('click', () => {
      emit('removeBot', { botId: button.dataset.botId });
    }));
    document.querySelector('#startGame')?.addEventListener('click', () => {
      const mode = state.mode === 'solo' || identity.roomMode === 'solo' || entryRole === 'solo' ? 'solo' : 'multiplayer';
      emit('startGame', { mode });
    });
  }

  function developmentIsConfirmed(development) {
    if (!development) return false;
    return development.confirmed === undefined ? Boolean(development.done) : Boolean(development.confirmed);
  }

  function playerHasFinishedCurrentPhase(player) {
    if (state.phase === 'movement') return Boolean(player?.movementReady);
    if (state.phase === 'development') return developmentIsConfirmed(player?.development);
    return false;
  }

  function viewerHasFinishedCurrentPhase() {
    if (identity.role === 'spectator') return true;
    return playerHasFinishedCurrentPhase(me());
  }

  function playerPhaseStatus(player, { spectatorView = false } = {}) {
    if (state.phase === 'movement') {
      if (player.movementReady) return { text: 'Fase concluída', waiting: false };
      if (spectatorView || viewerHasFinishedCurrentPhase()) return { text: 'aguardando jogador concluir', waiting: true };
      return { text: 'Movimentando', waiting: false };
    }
    if (state.phase === 'development') {
      if (developmentIsConfirmed(player.development)) return { text: 'Fase concluída', waiting: false };
      if (player.development?.done) return { text: 'revisando reposição', waiting: false };
      if (spectatorView || viewerHasFinishedCurrentPhase()) return { text: 'aguardando jogador concluir', waiting: true };
      return { text: 'repondo peças', waiting: false };
    }
    return { text: PHASE_LABELS[state.phase], waiting: false };
  }

  function waitingForOtherPlayersMessage() {
    const current = me();
    if (!current) return '';
    const pending = state.playerOrder
      .filter((id) => id !== current.id && !playerHasFinishedCurrentPhase(state.players[id]))
      .map((id) => state.players[id]?.name)
      .filter(Boolean);
    if (!pending.length) return '';
    const phase = state.phase === 'movement' ? 'Fase de movimentação' : 'Fase de Venda e reposição';
    if (pending.length === 1) return `Aguarde o jogador ${pending[0]} terminar a ${phase}.`;
    return `Aguarde os jogadores ${pending.slice(0, -1).join(', ')} e ${pending.at(-1)} terminarem a ${phase}.`;
  }


  function opponentMovementCounterHtml(player) {
    if (state.phase !== 'movement') return '';
    const limit = Number(player?.moveLimit || state.constants.movesPerRound || 12);
    const remaining = Math.max(0, Number(player?.movesRemaining || 0));
    const completed = Math.max(0, limit - remaining);
    return `<span class="opponent-move-counter" title="${completed} de ${limit} movimentos realizados"><b>${completed}</b>/${limit} mov.</span>`;
  }

  function circulationNeighbors(playerId) {
    const order = state.playerOrder || [];
    const index = order.indexOf(playerId);
    if (index < 0 || order.length < 2) return { sendsTo: null, receivesFrom: null, neutral: [] };
    const receivesFrom = order[(index - 1 + order.length) % order.length];
    const sendsTo = order[(index + 1) % order.length];
    const neutral = order.filter((id) => id !== playerId && id !== receivesFrom && id !== sendsTo);
    return { sendsTo, receivesFrom, neutral };
  }

  function orderedOpponentIds() {
    const { sendsTo, receivesFrom, neutral } = circulationNeighbors(identity.memberId);
    return [receivesFrom, ...neutral, sendsTo].filter((id, index, items) => id && id !== identity.memberId && items.indexOf(id) === index);
  }

  function opponentFlowBadgesHtml(opponentId) {
    const { sendsTo, receivesFrom } = circulationNeighbors(identity.memberId);
    const badges = [];
    if (opponentId === receivesFrom) badges.push('<span class="opponent-flow-badge incoming">Envia peças para você</span>');
    if (opponentId === sendsTo) badges.push('<span class="opponent-flow-badge outgoing">Você envia peças para este jogador</span>');
    return badges.length ? `<div class="opponent-flow-badges">${badges.join('')}</div>` : '<div class="opponent-flow-badges neutral"><span class="opponent-flow-badge neutral">Sem troca direta com você</span></div>';
  }

  function opponentCardHtml(id) {
    const player = state.players[id];
    if (!player) return '';
    const status = playerPhaseStatus(player);
    return `<article class="opponent-card ${player.isBot ? 'bot-opponent-card' : ''}" data-player-id="${escapeHtml(id)}"><header>${playerNameChip(player)}${colorBadge(player.color)}${botBadgeHtml(player, true)}</header>${opponentFlowBadgesHtml(id)}${boardHtml(player, { miniature: true })}<footer class="${status.waiting ? 'phase-waiting-footer' : ''}"><span class="opponent-status-text">${player.isBot ? '<span class="bot-status-dot small" aria-hidden="true">◆</span>' : `<span class="connection ${player.connected ? 'online' : ''}"></span>`}${player.isBot ? 'Bot automático' : status.text}</span>${player.isBot ? '' : opponentMovementCounterHtml(player)}</footer></article>`;
  }

  function opponentsHtml() {
    return orderedOpponentIds().map(opponentCardHtml).join('');
  }

  function automaLineHtml() {
    if (state.mode !== 'solo' || !['movement', 'circulation'].includes(state.phase) || !state.solo?.automaLine?.length) return '';
    return `<section class="automa-card">
      <div><p class="eyebrow">Automa</p><strong>Próxima linha</strong></div>
      <div class="automa-line">${state.solo.automaLine.map((piece, index) => `<span class="automa-cell">${createPieceHtml(piece, 'automa', 0, index, { tiny: true })}</span>`).join('')}</div>
    </section>`;
  }

  function soloScorePanelHtml() {
    if (state.mode !== 'solo') return '';
    const current = me() || state.players[state.playerOrder[0]];
    const remaining = current?.board?.flat().filter((piece) => piece?.type === 'carp' && piece.color === current.color).length || 0;
    return `<section class="population-panel solo-score-panel">
      <p class="eyebrow">Pontuação solo</p>
      <h2>Carpas preferidas</h2>
      <div class="solo-score-row"><span>Já saíram</span><strong>${state.solo?.exitedPreferred || 0}</strong></div>
      <div class="solo-score-row"><span>No tanque agora</span><strong>${remaining}</strong></div>
    </section>`;
  }

  function pieceGuideHtml() {
    const baseItems = [
      { key: 'yellow', name: 'Carpa', text: 'Move 1 casa para o vazio.' },
      { key: 'algae', name: 'Planta', text: 'Não gasta movimento; depois dela, mova uma carpa.' }
    ];
    const specialItems = [
      { key: 'shoal', name: 'Tesourinhas', text: 'Pode mover manualmente ao vazio por 1. Ao ativar, invade o vazio adjacente por 1.' },
      { key: 'sturgeon', name: 'Esturjão', text: 'Pode mover manualmente ao vazio por 1. Ao ativar, empurra linha/coluna por 2.' },
      { key: 'dojo', name: 'Dojô', text: 'Pode mover manualmente ao vazio por 1. Ao ativar, atravessa a diagonal (✕) por 1.' },
      { key: 'papaTerra', name: 'Papa-terra', text: 'Pode mover manualmente ao vazio por 1. Sua troca automática continua grátis.' }
    ];
    const advancedItems = [
      { key: 'hook', name: 'Anzol', text: 'Captura sua carpa preferida quando ela está ortogonalmente (✚) adjacente ao Anzol, entre ele e o vazio, e se move para esse vazio. A substituta entra na casa original, ao lado do Anzol, e o destino volta a ser o vazio.' },
      { key: 'net', name: 'Rede', text: 'Captura a carpa preferida que for movida para uma casa ortogonalmente (✚) adjacente a ela.' },
      { key: 'heron', name: 'Garça', text: 'Fica sobre uma planta. Salta para uma planta movida na mesma diagonal (✕). Enquanto permanecer sobre a planta, captura a preferida movida para um vazio ortogonalmente (✚) adjacente a ela.' },
      { key: 'cat', name: 'Gato', text: 'Fica sobre uma planta. Salta para uma planta movida na mesma linha/coluna. Enquanto permanecer sobre a planta, captura a preferida movida para um vazio ortogonalmente (✚) adjacente a ela.' }
    ];

    const items = [
      ...baseItems,
      ...(state.ruleset === 'kids' ? [] : specialItems),
      ...(state.ruleset === 'advanced' ? advancedItems : [])
    ];

    const priority = state.ruleset === 'kids'
      ? ''
      : state.ruleset === 'advanced'
        ? '<div class="piece-guide-priority"><strong>Prioridade de ativação automática:</strong><span>Anzol → Rede → Garça → Gato → Tesourinhas → Papa-terra → Dojô → Esturjão</span></div>'
        : '<div class="piece-guide-priority"><strong>Prioridade de ativação automática:</strong><span>Tesourinhas → Papa-terra → Dojô → Esturjão</span></div>';

    return `<section class="piece-guide-card">
      <div class="piece-guide-header"><p class="eyebrow">Resumo das peças</p><strong>Partida ${RULESET_LABELS[state.ruleset || 'classic']}</strong></div>
      ${priority}
      <div class="piece-guide-grid">${items.map(({ key, name, text }) => {
        const guidePiece = key === 'yellow'
          ? { type: 'carp', color: 'yellow', rotation: 90, id: `guide-${key}` }
          : key === 'heron' || key === 'cat'
            ? { type: 'algae', rotation: 0, id: `guide-${key}-plant`, overlays: [{ id: `guide-${key}`, type: key }] }
            : { type: key, rotation: 90, id: `guide-${key}` };
        return `
        <article class="piece-guide-item">
          <span class="piece-guide-icon">${createPieceHtml(guidePiece, 'guide', -1, -1, { tiny: true })}</span>
          <div><h3>${name}</h3><p>${text}</p></div>
        </article>`;
      }).join('')}</div>
    </section>`;
  }


  function populationScorePanelHtml() {
    const scores = state.liveScores?.scores;
    if (!scores) return '';
    const ranking = state.playerOrder
      .map((id) => ({ player: state.players[id], score: scores[state.players[id].color] || 0 }))
      .sort((a, b) => b.score - a.score || b.player.coins - a.player.coins || a.player.name.localeCompare(b.player.name, 'pt-BR'));
    return `<section class="population-panel">
      <p class="eyebrow">Pontuação parcial</p>
      <h2>Carpas em todos os tanques</h2>
      <div class="population-ranking">${ranking.map(({ player, score }, index) => `<div class="population-row"><strong>${index + 1}º</strong>${playerNameChip(player)}<span class="population-fish fish-${player.color}" aria-hidden="true"></span><b title="${player.coins} moeda(s)">${score}</b></div>`).join('')}</div>
    </section>`;
  }

  function movementPanel(current) {
    const totalMoves = current.moveLimit || state.constants.movesPerRound;
    const completed = Math.max(0, totalMoves - current.movesRemaining);
    let instruction = state.ruleset === 'kids'
      ? 'Clique em uma peça ortogonalmente (✚) adjacente ao espaço vazio.'
      : state.ruleset === 'advanced'
        ? 'Clique em uma peça ortogonalmente (✚) adjacente ao vazio. Anzol e Rede também se movem normalmente por 1; Garça e Gato permanecem sobre plantas.'
        : 'Clique em uma peça ortogonalmente (✚) adjacente ao espaço vazio. Peças especiais também podem ser movidas manualmente por 1 movimento.';
    if (current.mustMoveCarp) instruction = 'A alga foi movida: agora mova obrigatoriamente uma carpa.';
    if (current.correctionRequired) instruction = 'Preencha o vazio da linha central usando a peça imediatamente acima ou abaixo, ou compre um movimento extra.';
    if (current.movementDeadEnd) instruction = 'Você ficou sem movimento válido para completar o numero total e exato de 12 de movimentos. Clique em “Desfazer jogada” e escolha outro caminho.';
    if (current.movementReady) instruction = waitingForOtherPlayersMessage() || 'Movimentação concluída. Preparando a próxima fase.';
    const canFinish = current.movesRemaining === 0 && !current.mustMoveCarp && !current.correctionRequired && !current.movementReady;
    const dots = Array.from({ length: totalMoves }, (_, index) => `<i class="${index < completed ? 'done' : ''}"></i>`).join('');
    return `
      <section class="action-panel movement-dashboard">
        <p class="phase-kicker">Fase da movimentação</p>
        <h2>Faça ${totalMoves} movimentos</h2>
        <div class="movement-score"><strong>${completed}</strong><span>/${totalMoves}</span></div>
        <div class="movement-purchase-row">
          <div class="movement-coins-summary"><img src="${ASSETS.coin}" alt=""><span>Você tem <strong>${current.coins}</strong> moeda${current.coins === 1 ? '' : 's'}</span><small>${state.constants.extraMoveCost} moedas = +1 movimento</small></div>
          <button id="buyExtraMove" class="money-button movement-buy-button" ${state.phase !== 'movement' || current.movementReady || current.coins < state.constants.extraMoveCost || !serverConnected || (state.disconnectedPlayerIds || []).length ? 'disabled' : ''} title="Gaste ${state.constants.extraMoveCost} moedas para comprar 1 movimento extra"><img src="${ASSETS.coin}" alt="Moedas"><strong>Comprar</strong><small>+1 movimento</small></button>
        </div>
        <div class="movement-progress" style="--progress:${totalMoves ? (completed / totalMoves) * 100 : 0}%"><span></span></div>
        <div class="movement-dots" style="--moves-count:${totalMoves}">${dots}</div>
        <p class="instruction">${instruction}</p>
        ${!isCompactMobile() && canFinish ? '<button id="finishMovement" class="primary-button">Concluir movimentação</button>' : ''}
        ${!isCompactMobile() && current.movementReady && waitingForOtherPlayersMessage() ? '<button class="secondary-button try-next-phase" data-wait-phase="movement">Continuar para a próxima fase</button>' : ''}
        ${current.specialAlert ? `<div class="automatic-activation-notice" role="status"><strong>O que aconteceu</strong><p>${escapeHtml(current.specialAlert)}</p></div>` : ''}
        ${current.movementDeadEnd ? '<p class="movement-alert visible" role="alert" aria-live="assertive">Você ficou sem movimento válido para completar o numero total e exato de 12 de movimentos. Clique em “Desfazer jogada” e escolha outro caminho.</p>' : `<p class="movement-alert ${movementError ? 'visible' : ''}" role="alert" aria-live="assertive">${movementError ? escapeHtml(movementError) : '&nbsp;'}</p>`}
      </section>`;
  }



  function mobilePhaseActionHtml(current) {
    if (!isCompactMobile() || state.phase !== 'movement') return '';
    const canFinish = current.movesRemaining === 0 && !current.mustMoveCarp && !current.correctionRequired && !current.movementReady;
    if (canFinish) {
      return '<section class="mobile-phase-confirm-slot"><button id="finishMovement" class="primary-button">Concluir movimentação</button></section>';
    }
    if (current.movementReady && waitingForOtherPlayersMessage()) {
      return '<section class="mobile-phase-confirm-slot"><button class="secondary-button try-next-phase" data-wait-phase="movement">Continuar para a próxima fase</button></section>';
    }
    return '';
  }

  function developmentPanel(current) {
    const dev = current.development;
    if (!dev) return '<section class="action-panel"><h2>Preparando a venda e reposição...</h2></section>';
    if (dev.done) {
      if (!developmentIsConfirmed(dev)) {
        return `<section class="action-panel"><p class="phase-kicker">Fase de Venda e reposição</p><h2>Revise suas reposições</h2><div class="replacement-score"><strong>${dev.replaced}</strong><span>/ ${dev.capacity}</span></div><p>As reposições foram completadas. Você ainda pode usar <strong>Desfazer jogada</strong> para voltar uma troca antes de confirmar.</p><button id="finishDevelopment" class="primary-button">Concluir venda e reposição</button></section>`;
      }
      const waitMessage = waitingForOtherPlayersMessage();
      return `<section class="action-panel"><p class="phase-kicker">Fase de Venda e reposição</p><h2>Venda e reposição concluída</h2><div class="replacement-score"><strong>${dev.replaced}</strong><span>/ ${dev.capacity}</span></div><p>Você recebeu ${dev.replaced} moeda(s) nesta fase. ${waitMessage || 'Preparando a próxima rodada.'}</p>${waitMessage ? '<button class="secondary-button try-next-phase" data-wait-phase="development">Continuar para a próxima fase</button>' : ''}</section>`;
    }
    if (dev.capacity === 0) return `<section class="action-panel"><p class="phase-kicker">Fase de Venda e reposição</p><h2>Nenhuma venda ou reposição</h2><p>Não há carpas ${COLOR_LABELS[current.color].toLowerCase()} na linha central.</p></section>`;
    if (!dev.chosenColor) {
      const title = dev.replaced > 0 ? 'Escolha a próxima menor cor' : 'Escolha a menor cor';
      return `<section class="action-panel"><p class="phase-kicker">Fase de Venda e reposição</p><h2>${title}</h2><div class="replacement-score"><strong>${dev.replaced}</strong><span>/ ${dev.capacity}</span></div><p>Continue até completar todas as reposições conquistadas.</p><div class="choice-row">${dev.eligibleColors.map((color) => `<button class="color-target secondary-button target-${color}" data-color="${color}">${COLOR_LABELS[color]}</button>`).join('')}</div></section>`;
    }
    return `<section class="action-panel"><p class="phase-kicker">Fase de Venda e reposição</p><h2>Troque as carpas ${COLOR_LABELS[dev.chosenColor].toLowerCase()}</h2><div class="replacement-score"><strong>${dev.replaced}</strong><span>/ ${dev.capacity}</span></div><p>Clique nas peças destacadas. Cada carpa retirada rende <strong>1 moeda</strong>.</p></section>`;
  }


  function circulationPanel() {
    const description = state.mode === 'solo'
      ? 'Sua linha central sai pela esquerda e a linha exibida pelo Automa entra pela direita.'
      : 'As peças saem pela esquerda e entram no próximo tanque na mesma sequência.';
    return `<section class="action-panel circulation-panel"><p class="phase-kicker">Fase da Correnteza</p><h2>As peças seguem a correnteza</h2><div class="flow-graphic"><span>◀</span><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p>${description}</p></section>`;
  }


  function rankingModeLabel() {
    if (state?.rankingGeneral?.label) return state.rankingGeneral.label;
    const rulesetLabel = RULESET_LABELS[state?.ruleset || 'classic'] || 'Padrão';
    const modeLabel = state?.mode === 'solo' ? 'Solo' : `${state?.playerOrder?.length || 0} jogadores`;
    return `${rulesetLabel} — ${modeLabel}`;
  }

  function rankingPositionText(playerId) {
    if (!state?.rankingGeneral) return 'Calculando...';
    if (!state.rankingGeneral.available) return 'Indisponível';
    const position = Number(state.rankingGeneral.positions?.[playerId] || 0);
    return position > 0 ? `${position}º` : '—';
  }

  function generalRankingLeaderHtml() {
    const ranking = state?.rankingGeneral;
    const label = rankingModeLabel();
    if (!ranking) {
      return `<div class="general-ranking-leader pending"><p class="eyebrow">1º lugar — Ranking Geral — ${escapeHtml(label)}</p><strong>Calculando ranking...</strong></div>`;
    }
    if (!ranking.available) {
      return `<div class="general-ranking-leader pending"><p class="eyebrow">Ranking Geral — ${escapeHtml(label)}</p><strong>Ranking temporariamente indisponível</strong></div>`;
    }
    const leader = ranking.leader;
    if (!leader) {
      return `<div class="general-ranking-leader"><p class="eyebrow">1º lugar — Ranking Geral — ${escapeHtml(label)}</p><strong>Aguardando o primeiro resultado</strong></div>`;
    }
    return `<div class="general-ranking-leader">
      <p class="eyebrow">1º lugar — Ranking Geral — ${escapeHtml(label)}</p>
      <strong>${escapeHtml(leader.nickname)}</strong>
      <span>${leader.score} carpas · ${leader.coins} moeda${leader.coins === 1 ? '' : 's'}</span>
    </div>`;
  }

  function scorePanel() {
    if (!state.winner) return '';
    if (state.winner.solo) {
      const player = state.players[state.winner.playerIds[0]];
      const score = Number(state.winner.soloScore || state.winner.score || 0);
      const coins = Number(player.coins || 0);
      return `<div class="modal-backdrop final-results-backdrop"><section class="result-card final-results-card solo-result-card">${logoHtml('result-logo')}<p class="eyebrow">Resultado do modo solo</p><h1>Parabéns, ${escapeHtml(player.name)}!</h1><div class="solo-final-score"><strong>${score}</strong><span>carpas preferidas</span></div><div class="solo-result-coins"><img src="${ASSETS.coin}" alt=""><strong>${coins}</strong><span>moeda${coins === 1 ? '' : 's'}</span></div><p>${state.winner.exitedPreferred} saíram pela Correnteza e ${state.winner.remainingPreferred} permaneceram no tanque.</p><div class="solo-general-ranking"><span>Ranking Geral — ${escapeHtml(rankingModeLabel())}</span><strong>${rankingPositionText(player.id)}</strong></div>${generalRankingLeaderHtml()}<p class="print-suggestion">Tire um print do resultado e compartilhe seu recorde.</p><div class="final-result-actions"><button id="finalRestartGame" class="primary-button">↻ Reiniciar partida</button><button id="finalExitGame" class="secondary-button">Sair</button></div></section></div>`;
    }

    const rankingSource = state.winner.ranking || state.playerOrder.map((id) => ({
      playerId: id,
      score: state.winner.scores[state.players[id].color],
      coins: state.players[id].coins || 0
    }));
    const ranking = rankingSource.map((entry) => ({ ...entry, player: state.players[entry.playerId] }));
    const winnerNames = state.winner.playerIds.map((id) => state.players[id].name).join(' e ');
    const title = state.winner.playerIds.length > 1 ? `Empate entre ${escapeHtml(winnerNames)}!` : `${escapeHtml(winnerNames)} venceu!`;
    const restartButton = identity.role === 'player' ? '<button id="finalRestartGame" class="primary-button">↻ Reiniciar partida</button>' : '';
    const rankingLabel = `Ranking Geral — ${rankingModeLabel()}`;

    return `<div class="modal-backdrop final-results-backdrop"><section class="result-card final-results-card">${logoHtml('result-logo')}<p class="eyebrow">Resultado final</p><h1>${title}</h1><p class="result-rule">Primeiro conta-se o total de carpas. Em empate, vence quem tiver mais moedas.</p><div class="ranking ranking-with-general"><div class="ranking-table-header"><span>Partida</span><span>Jogador</span><span></span><span>Pontuação</span><span>Moedas</span><span>${escapeHtml(rankingLabel)}</span></div>${ranking.map(({ player, score, coins }, index) => `<div class="${index === 0 ? 'winner-row' : ''}"><strong>${index + 1}º</strong>${playerNameChip(player)}${colorBadge(player.color)}<span>${score} carpas</span><span class="ranking-coins"><img src="${ASSETS.coin}" alt="">${coins}</span><span class="general-rank-position">${player.isBot ? '—' : rankingPositionText(player.id)}</span></div>`).join('')}</div>${generalRankingLeaderHtml()}<div class="final-result-actions">${restartButton}<button id="finalExitGame" class="secondary-button">Sair</button></div></section></div>`;
  }

  function logPanelHtml() {
    return `<section class="log-panel"><header><h2>Registro</h2><span>${state.logs.length}</span></header>${state.logs.slice().reverse().slice(0, 14).map((log) => {
      const actor = actorForLog(log);
      if (actor?.color) return `<p class="log-entry">${playerNameChip(actor)}<span>${escapeHtml(log.text)}</span></p>`;
      if (actor) return `<p class="log-entry"><span class="spectator-name-chip">${escapeHtml(actor.name)}</span><span>${escapeHtml(log.text)}</span></p>`;
      return `<p class="log-entry system-log"><span>${escapeHtml(log.text)}</span></p>`;
    }).join('')}</section>`;
  }

  function waitExitButtonHtml() {
    return '<button type="button" class="danger-button wait-exit-game">Sair da partida</button>';
  }

  function serverConnectionUiHtml() {
    if ((serverConnected && !reconnectingToRoom) || (!state && !identity.roomCode)) return '';
    const reconnecting = serverConnected && reconnectingToRoom;
    return `<div class="modal-backdrop server-wait-backdrop"><section class="modal-card wait-card"><img class="wait-fish-gif" src="${ASSETS.fishAnimation}" alt="" aria-hidden="true"><p class="eyebrow">${reconnecting ? 'Servidor restabelecido' : 'Conexão interrompida'}</p><h2>${reconnecting ? 'Reconectando à sala' : 'Aguardando o restabelecimento do servidor'}</h2><p>${reconnecting ? 'Recuperando seu lugar e o estado mais recente da partida.' : 'A partida permanecerá nesta tela e tentará reconectar automaticamente.'}</p>${waitExitButtonHtml()}</section></div>`;
  }

  function disconnectedPlayersUiHtml() {
    if (!serverConnected || !state || state.status !== 'playing') return '';
    const absent = (state.disconnectedPlayerIds || []).map((id) => state.players[id]).filter(Boolean);
    if (!absent.length) return '';
    const first = absent[0];
    const extra = absent.length > 1 ? ` e mais ${absent.length - 1} jogador(es)` : '';
    return `<div class="modal-backdrop player-wait-backdrop"><section class="modal-card wait-card"><img class="wait-fish-gif" src="${ASSETS.fishAnimation}" alt="" aria-hidden="true"><p class="eyebrow">Partida pausada</p><h2>Jogador ${escapeHtml(first.name)} desconectou${extra}</h2><p><strong>Aguarde o retorno do jogador ${escapeHtml(first.name)}.</strong> A partida continua automaticamente quando todos estiverem presentes.</p>${absent.length > 1 ? `<div class="absent-list">${absent.map((player) => playerNameChip(player)).join('')}</div>` : ''}${waitExitButtonHtml()}</section></div>`;
  }

  function restartUiHtml() {
    if (localRestartConfirm) {
      if (state.mode === 'solo') {
        return `<div class="modal-backdrop decision-backdrop"><section class="modal-card"><p class="eyebrow">Novo desafio</p><h2>Reiniciar a partida solo?</h2><p>O tanque, a linha do Automa e a pontuação serão reiniciados.</p><div class="modal-actions"><button id="cancelRestart" class="secondary-button">Cancelar</button><button id="confirmRestart" class="danger-button">Reiniciar</button></div></section></div>`;
      }
      return `<div class="modal-backdrop decision-backdrop"><section class="modal-card"><p class="eyebrow">Confirmar solicitação</p><h2>Reiniciar a partida?</h2><p>Os outros jogadores receberão um pedido de confirmação. A partida só será reiniciada se todos aceitarem.</p><div class="modal-actions"><button id="cancelRestart" class="secondary-button">Cancelar</button><button id="confirmRestart" class="danger-button">Solicitar reinício</button></div></section></div>`;
    }

    const vote = state.restartVote;
    if (!vote) return '';
    const requester = state.players[vote.requesterId];
    const approved = vote.approvals.includes(identity.memberId);
    const count = vote.approvals.length;
    const total = state.playerOrder.length;

    if (identity.role === 'spectator') {
      return `<div class="restart-banner"><strong>${escapeHtml(requester?.name || 'Um jogador')}</strong> solicitou o reinício. Aguardando decisão dos jogadores (${count}/${total}).</div>`;
    }

    if (vote.requesterId !== identity.memberId && !approved) {
      return `<div class="modal-backdrop decision-backdrop"><section class="modal-card"><p class="eyebrow">Pedido de reinício</p><h2>${escapeHtml(requester?.name || 'Um jogador')} quer reiniciar a partida</h2><p>Todos os jogadores precisam aceitar. Espectadores não participam da decisão.</p><div class="modal-actions"><button id="rejectRestart" class="secondary-button">Recusar</button><button id="acceptRestart" class="primary-button">Aceitar</button></div></section></div>`;
    }

    return `<div class="restart-banner"><strong>Reinício solicitado.</strong> Aguardando confirmações: ${count}/${total}.</div>`;
  }

  function exitUiHtml() {
    if (!localExitConfirm) return '';
    return `<div class="modal-backdrop decision-backdrop"><section class="modal-card"><p class="eyebrow">Sair da partida</p><h2>Voltar para a tela inicial?</h2><p>Você poderá criar ou acessar outra sala. Para retornar a esta partida, informe novamente o mesmo nome e o código <strong>${state.code}</strong>.</p><div class="modal-actions"><button id="cancelExit" class="secondary-button">Continuar jogando</button><button id="confirmExit" class="danger-button">Sair</button></div></section></div>`;
  }

  async function leaveWaitScreenToCleanLobby() {
    const wasConnected = serverConnected;

    // Apaga primeiro a identidade local para impedir uma reconexão automática
    // caso o servidor retorne enquanto a saída estiver sendo processada.
    identity = {};
    localStorage.removeItem('carpasIdentity');
    reconnectingToRoom = false;

    if (wasConnected && state) {
      await emit('leaveRoom', {}, { silent: true });
    }

    state = null;
    entryRole = 'multiplayer';
    notice = '';
    movementError = '';
    localRestartConfirm = false;
    localExitConfirm = false;
    clearEntryAfterExit = false;
    render();
  }

  function bindCommonGameActions() {
    bindExternalLinks();
    document.querySelectorAll('.wait-exit-game').forEach((button) => {
      button.addEventListener('click', leaveWaitScreenToCleanLobby);
    });
    document.querySelectorAll('#restartGame, #finalRestartGame').forEach((button) => button.addEventListener('click', () => {
      if (state.restartVote) {
        notice = 'Já existe uma votação de reinício em andamento.';
        render();
        return;
      }
      localRestartConfirm = true;
      render();
    }));
    document.querySelector('#cancelRestart')?.addEventListener('click', () => {
      localRestartConfirm = false;
      render();
    });
    document.querySelector('#confirmRestart')?.addEventListener('click', async () => {
      localRestartConfirm = false;
      await emit('requestRestart');
    });
    document.querySelector('#acceptRestart')?.addEventListener('click', () => emit('respondRestart', { accept: true }));
    document.querySelector('#rejectRestart')?.addEventListener('click', () => emit('respondRestart', { accept: false }));
    document.querySelectorAll('#exitGame, #finalExitGame').forEach((button) => button.addEventListener('click', () => {
      clearEntryAfterExit = button.id === 'finalExitGame';
      localExitConfirm = true;
      render();
    }));
    document.querySelector('#cancelExit')?.addEventListener('click', () => {
      localExitConfirm = false;
      clearEntryAfterExit = false;
      render();
    });
    document.querySelector('#confirmExit')?.addEventListener('click', async () => {
      const response = await emit('leaveRoom');
      if (!response?.ok) return;
      if (clearEntryAfterExit) {
        identity = {};
        localStorage.removeItem('carpasIdentity');
      } else {
        clearRoomIdentity();
      }
      state = null;
      entryRole = 'multiplayer';
      notice = '';
      movementError = '';
      localExitConfirm = false;
      clearEntryAfterExit = false;
      render();
    });
  }

  function preferredInMiddleCount(current) {
    return current?.board
      ? current.board[state.constants.middleRow].filter((piece) => piece?.type === 'carp' && piece.color === current.color).length
      : 0;
  }

  function playerCanUndo(current) {
    if (!current) return false;
    return state.phase === 'movement'
      ? !current.movementReady && current.movementHistoryLength > 0
      : state.phase === 'development' && !developmentIsConfirmed(current.development) && current.developmentHistoryLength > 0;
  }

  function playerCanFinishMovement(current) {
    return Boolean(current
      && current.movesRemaining === 0
      && !current.mustMoveCarp
      && !current.correctionRequired
      && !current.movementReady);
  }

  function bindTankCopyCode() {
    document.querySelector('.tank-copy-code')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const code = String(button.dataset.code || state.code || '');
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Código copiado';
        window.setTimeout(() => {
          if (button.isConnected) button.textContent = 'Copiar código da sala';
        }, 1400);
      } catch {
        notice = 'Não foi possível copiar o código da sala.';
        render();
      }
    });
  }

  function bindOwnTankCells() {
    document.querySelectorAll('.my-tank-card .tank-cell').forEach((cell) => {
      cell.addEventListener('click', async () => {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        if (state.phase === 'movement') {
          await emit('movePiece', { from: { row, col } });
        }
        if (state.phase === 'development') emit('replaceFish', { position: { row, col } });
      });
    });
  }

  function bindPlayerPhaseControls() {
    document.querySelector('#undoMove')?.addEventListener('click', async () => {
      await emit('undoMove');
    });
    document.querySelector('#buyExtraMove')?.addEventListener('click', () => emit('buyExtraMove'));
    document.querySelector('#finishMovement')?.addEventListener('click', () => emit('finishMovement'));
    document.querySelector('#finishDevelopment')?.addEventListener('click', () => emit('finishDevelopment'));
    document.querySelectorAll('.color-target').forEach((button) => button.addEventListener('click', () => emit('chooseDevelopmentColor', { color: button.dataset.color })));
    document.querySelectorAll('.try-next-phase').forEach((button) => button.addEventListener('click', () => {
      const message = waitingForOtherPlayersMessage();
      if (button.dataset.waitPhase === 'movement') movementError = message;
      else notice = message;
      render();
    }));
  }

  function canUseMobileMovementPatch(previousState, nextState, action) {
    if (layout !== 'mobile' || identity.role !== 'player') return false;
    if (!previousState || previousState.status !== 'playing' || nextState?.status !== 'playing') return false;
    if (previousState.code !== nextState.code || previousState.phase !== 'movement' || nextState.phase !== 'movement') return false;
    if (Number(previousState.round) !== Number(nextState.round) || roundIntroRound) return false;
    if (!['move', 'correctionMove', 'undo', 'extraMovePurchased'].includes(action?.type)) return false;
    if (!document.querySelector('.game-shell.mobile .my-tank-card')) return false;

    const previousCurrent = previousState.players?.[identity.memberId];
    const nextCurrent = nextState.players?.[identity.memberId];
    if (!previousCurrent || !nextCurrent) return false;

    // Quando nasce/desaparece o botão mobile de concluir movimentação, fazemos
    // o render completo para preservar a ordem/layout de todos os blocos.
    const previousFinish = previousCurrent.movesRemaining === 0
      && !previousCurrent.mustMoveCarp
      && !previousCurrent.correctionRequired
      && !previousCurrent.movementReady;
    const nextFinish = nextCurrent.movesRemaining === 0
      && !nextCurrent.mustMoveCarp
      && !nextCurrent.correctionRequired
      && !nextCurrent.movementReady;
    if (previousFinish !== nextFinish || previousCurrent.movementReady !== nextCurrent.movementReady) return false;

    return true;
  }

  function refreshMobileLiveScorePanel() {
    const scorePanel = document.querySelector('.left-rail > .population-panel');
    if (!scorePanel) return;
    const html = state.mode === 'solo' ? soloScorePanelHtml() : populationScorePanelHtml();
    if (html) scorePanel.outerHTML = html;
  }

  function updateMobileMovementUi(action) {
    const current = me();
    if (!current) return false;

    if (action?.playerId === identity.memberId) {
      const boardWrap = document.querySelector('.my-tank-card .player-board-wrap');
      if (!boardWrap) return false;
      boardWrap.innerHTML = `${boardHtml(current, { interactive: true })}${roundIntroHtml()}`;

      const middleCount = document.querySelector('.my-tank-card .middle-count strong');
      if (middleCount) middleCount.textContent = String(preferredInMiddleCount(current));
      const undoButton = document.querySelector('.my-tank-card #undoMove');
      if (undoButton) {
        undoButton.outerHTML = `<button id="undoMove" class="undo-button" ${playerCanUndo(current) ? '' : 'disabled'}>↶ Desfazer jogada</button>`;
      }

      const movementPanelNode = document.querySelector('.right-rail > .action-panel');
      if (movementPanelNode) movementPanelNode.outerHTML = movementPanel(current);

      bindOwnTankCells();
      bindPlayerPhaseControls();
    } else if (action?.playerId && state.players?.[action.playerId]) {
      const opponentNode = document.querySelector(`.opponent-card[data-player-id="${action.playerId}"]`);
      if (opponentNode) opponentNode.outerHTML = opponentCardHtml(action.playerId);
    }

    refreshMobileLiveScorePanel();

    const logPanel = document.querySelector('.right-rail > .log-panel');
    if (logPanel) logPanel.outerHTML = logPanelHtml();

    return true;
  }

  function playerGameScreen() {
    const current = me();
    if (!current) return lobbyEntry();
    const panel = state.phase === 'movement'
      ? movementPanel(current)
      : state.phase === 'development'
        ? developmentPanel(current)
        : state.phase === 'circulation'
          ? circulationPanel()
          : '';
    const preferredInMiddle = preferredInMiddleCount(current);
    const canUndo = playerCanUndo(current);

    app.innerHTML = `
      <div class="game-shell ${layout}">
        ${topbarHtml()}
        ${notice ? `<div class="notice error floating">${escapeHtml(notice)}</div>` : ''}
        ${restartUiHtml()}
        ${exitUiHtml()}
        ${serverConnectionUiHtml()}
        ${disconnectedPlayersUiHtml()}
        ${scorePanel()}
        <div class="mobile-round-slot">${roundPanelHtml()}</div>
        <section class="opponents-strip">${opponentsHtml()}</section>
        <main class="game-stage">
          <aside class="left-rail">${roundPanelHtml()}${state.mode === 'solo' ? soloScorePanelHtml() : populationScorePanelHtml()}</aside>
          <section class="my-tank-card">
            ${automaLineHtml()}
            <header class="tank-card-header">
              <p class="eyebrow tank-kicker">Seu tanque</p>
              <div class="tank-room-code-wrap">
                <p class="eyebrow tank-room-code">Sala ${escapeHtml(state.code)}</p>
                <button class="tank-copy-code" type="button" data-code="${escapeHtml(state.code)}">Copiar código da sala</button>
              </div>
              <p class="eyebrow tank-round-label">${roundLabel()}</p>
              <h1 class="tank-player-name">${escapeHtml(current.name)}</h1>
              <span class="preferred-carp-label">Sua carpa preferida:<img src="${ASSETS[current.color]}" alt="Carpa ${COLOR_LABELS[current.color]}"></span>
              <div class="middle-count">Sua cor na linha central <strong>${preferredInMiddle}</strong></div>
              <button id="undoMove" class="undo-button" ${canUndo ? '' : 'disabled'}>↶ Desfazer jogada</button>
            </header>
            <div class="player-board-wrap">
              ${boardHtml(current, { interactive: state.phase === 'movement' || state.phase === 'development' })}
              ${roundIntroHtml()}
            </div>
          </section>
          ${mobilePhaseActionHtml(current)}
          <aside class="right-rail">${panel}${logPanelHtml()}</aside>
          <div class="piece-guide-slot">${pieceGuideHtml()}</div>
        </main>
      </div>`;

    bindTankCopyCode();
    bindOwnTankCells();
    bindPlayerPhaseControls();
    bindCommonGameActions();
  }

  function spectatorGameScreen() {
    const boards = state.playerOrder.map((id) => {
      const player = state.players[id];
      const status = playerPhaseStatus(player, { spectatorView: true });
      return `<article class="spectator-board-card"><header>${playerNameChip(player)}${colorBadge(player.color)}${botBadgeHtml(player, true)}${player.isBot ? '' : `<span class="connection ${player.connected ? 'online' : ''}"></span>`}</header>${state.mode === 'solo' ? automaLineHtml() : ''}${boardHtml(player, { spectator: true })}<footer class="spectator-phase-status ${status.waiting ? 'phase-waiting-footer' : ''}">${player.isBot ? 'Bot automático' : status.text}</footer></article>`;
    }).join('');

    app.innerHTML = `
      <div class="game-shell ${layout}">
        ${topbarHtml()}
        ${roundIntroHtml()}
        ${notice ? `<div class="notice error floating">${escapeHtml(notice)}</div>` : ''}
        ${restartUiHtml()}
        ${exitUiHtml()}
        ${serverConnectionUiHtml()}
        ${disconnectedPlayersUiHtml()}
        ${scorePanel()}
        <div class="mobile-round-slot">${roundPanelHtml()}</div>
        <main class="spectator-stage">
          <aside class="left-rail">${roundPanelHtml()}${state.mode === 'solo' ? soloScorePanelHtml() : populationScorePanelHtml()}</aside>
          <section class="spectator-board-grid">${boards}</section>
          <aside class="right-rail"><section class="action-panel spectator-mode"><p class="phase-kicker">Modo espectador</p><h2>Acompanhamento aberto</h2><p>Você vê todos os tanques em tempo real, mas não interfere nas decisões da partida.</p></section>${logPanelHtml()}</aside>
        </main>
      </div>`;
    bindCommonGameActions();
  }

  function gameScreen() {
    if (identity.role === 'spectator') return spectatorGameScreen();
    return playerGameScreen();
  }

  function render() {
    document.body.classList.toggle('initial-lobby-scene', !state || state.status === 'lobby');
    animateCurrentAction = Boolean(state?.lastAction && state.lastAction.id !== lastAnimatedActionId);
    if (!state) return lobbyEntry();
    if (state.status === 'lobby') return lobbyRoom();
    return gameScreen();
  }

  render();
})();
