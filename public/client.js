(() => {
  const socket = io();
  const app = document.querySelector('#app');
  const layout = document.body.dataset.layout || 'desktop';
  const config = window.CARPAS_CONFIG || {};

  const COLORS = ['yellow', 'white', 'red', 'gray'];
  const COLOR_LABELS = { yellow: 'Amarela', white: 'Branca', red: 'Vermelha', gray: 'Cinza' };
  const PHASE_LABELS = {
    lobby: 'Sala de espera',
    movement: 'Fase da movimentação',
    development: 'Fase de Venda e reposição',
    circulation: 'Fase da Correnteza',
    finished: 'Fase do resultado final'
  };
  const ASSETS = {
    yellow: '/assets/carp-yellow.png',
    white: '/assets/carp-white.png',
    red: '/assets/carp-red.png',
    gray: '/assets/carp-gray.png',
    algae: '/assets/algae.png',
    shoal: '/assets/tesourinhas.png',
    sturgeon: '/assets/sturgeon.png',
    dojo: '/assets/dojo.png',
    papaTerra: '/assets/papa-terra.png',
    coin: '/assets/coin.png',
    moneyBag: '/assets/money-bag.png',
    fishAnimation: '/assets/fish-animation.gif'
  };

  const SOUND_URLS = {
    move: 'https://res.cloudinary.com/dzjwlafsx/video/upload/v1785869993/fish_move_htw4ys.mp3',
    current: 'https://res.cloudinary.com/dzjwlafsx/video/upload/v1785875411/canal_aberto_longo_lw0d8w.mp3',
    replace: 'https://res.cloudinary.com/dzjwlafsx/video/upload/v1785869993/change_fish_inwrkc.mp3'
  };
  const SOUND_VOLUMES = { move: 0.46, current: 0.58, replace: 0.54 };
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
  let interactionLockedUntil = 0;
  let serverConnected = socket.connected;
  let reconnectingToRoom = false;

  function isCompactMobile() {
    return layout === 'mobile' || window.matchMedia('(max-width: 720px)').matches;
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

  function emit(event, payload = {}, options = {}) {
    return new Promise((resolve) => {
      socket.emit(event, payload, (response) => {
        if (!response?.ok) {
          const message = response?.error || 'Não foi possível concluir a ação.';
          if (!options.silent) {
            if (['movePiece', 'finishMovement', 'undoMove', 'buyExtraMove'].includes(event)) {
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

  function playActionSound(action) {
    if (!action || Date.now() - Number(action.at || 0) > 3500) return;
    if (action.type === 'move' || action.type === 'correctionMove' || action.type === 'undo') playSound('move');
    if (action.type === 'circulationStart') playSound('current');
    if (action.type === 'replace') playSound('replace');
  }


  socket.on('roomState', (room) => {
    serverConnected = true;
    reconnectingToRoom = false;
    const isNewAction = Boolean(room.lastAction && room.lastAction.id !== lastAnimatedActionId);
    const phaseChanged = state?.phase && state.phase !== room.phase;
    const ownMovementSucceeded = room.lastAction?.playerId === identity.memberId
      && ['move', 'correctionMove', 'undo'].includes(room.lastAction?.type);
    state = room;
    notice = '';
    if (phaseChanged || ownMovementSucceeded || room.phase !== 'movement') movementError = '';
    localRestartConfirm = false;
    animateCurrentAction = isNewAction;
    render();
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
      : { roomCode: identity.roomCode, playerToken: identity.memberToken, name: identity.name, color: identity.color };
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

  function pieceAnimation(playerId, row, col, piece) {
    const emptyAnimation = { shellClass: '', shellStyle: '', orientationClass: '', orientationStyle: '' };
    if (!animateCurrentAction || !state?.lastAction || !piece) return emptyAnimation;
    const action = state.lastAction;

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

    if (action.type === 'undo' && action.playerId === playerId && action.positions?.some((position) => position.row === row && position.col === col)) {
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
    const rotation = Number(piece.rotation || 0);
    const src = piece.type === 'carp' ? ASSETS[piece.color] : ASSETS[piece.type];
    const SPECIAL_LABELS = { shoal: 'Tesourinhas', sturgeon: 'Esturjão', dojo: 'Dojô', papaTerra: 'Papa-terra' };
    const label = piece.type === 'carp' ? `Carpa ${COLOR_LABELS[piece.color]}` : piece.type === 'algae' ? 'Planta' : (SPECIAL_LABELS[piece.type] || 'Peça especial');
    const lastMoved = state?.phase === 'movement' && state?.players?.[playerId]?.lastMovedPieceId === piece.id;
    const orientationStyle = animation.orientationStyle || `--piece-rotation:${rotation}deg;--start-rotation:${rotation}deg;`;
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
        class="piece-art piece-${piece.type} ${lastMoved ? 'last-moved-art' : ''}"
        src="${src}"
        alt="${label}"
        title="${label}"
        draggable="false"
      >
    </span>
  </span>
`;
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
        <span class="channel-marker right" aria-hidden="true">›</span>
      </div>`;
  }

  function liquidFilterSvg() {
    return `<svg class="liquid-filter-defs" aria-hidden="true" width="0" height="0">
      <filter id="liquidRipple" x="-8%" y="-8%" width="116%" height="116%">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.018" numOctaves="2" seed="4" result="noise">
          <animate attributeName="baseFrequency" dur="11s" values="0.008 0.018;0.012 0.024;0.009 0.015;0.008 0.018" repeatCount="indefinite"></animate>
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
      </filter>
    </svg>`;
  }

  function logoHtml(className = 'brand-logo') {
    return `<img class="${className}" src="/assets/logo.png" alt="Carpa Diem">`;
  }

  function externalButton(label, key, icon) {
    return `<button class="top-action external-link" data-link-key="${key}"><span aria-hidden="true">${icon}</span>${label}</button>`;
  }

  function initialExternalActionsHtml() {
    return `<nav class="initial-external-actions" aria-label="Links do jogo">${externalButton('Manual', 'manual', '▤')}${externalButton('Discord', 'discord', '◉')}</nav>`;
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
          <span class="eyebrow">Sala ${state.code}</span>
          <strong>${state.status === 'lobby' ? (state.mode === 'solo' ? 'Modo solo' : 'Aguardando jogadores') : `${state.mode === 'solo' ? 'Solo · ' : ''}Rodada ${state.round}/${state.constants.maxRounds}`}</strong>
          <span class="phase-pill">${PHASE_LABELS[state.phase]}</span>
        </div>
        <div class="topbar-brand">${logoHtml('topbar-logo')}</div>
        <div class="topbar-controls">
          <nav class="topbar-actions" aria-label="Ações da partida">
            ${canRestart ? '<button id="restartGame" class="top-action danger-outline">↻ Reiniciar</button>' : ''}
            ${externalButton('Manual', 'manual', '▤')}
            ${externalButton('Discord', 'discord', '◉')}
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
      return [
        `Faça ${state.constants.movesPerRound} movimentos usando o espaço vazio.`,
        'Mover uma planta não gasta movimento; depois dela, mova uma carpa.',
        'Peças especiais se ativam automaticamente, com prioridade: Tesourinhas, Papa-terra, Dojô e Esturjão.',
        'Tesourinhas e Dojô gastam 1; Esturjão gasta 3; Papa-terra é gratuito.',
        'Se o vazio terminar na linha central, preencha-o com um movimento extra.',
        `A cada ${state.constants.extraMoveCost} moedas, compre 1 movimento extra.`
      ];
    }
    if (state.phase === 'development') {
      return [
        'Conte sua cor preferida na linha central.',
        'Escolha a menor cor presente entre as demais.',
        'Troque as peças da menor cor até ela acabar.',
        'Se ela acabar antes do total conquistado, escolha a próxima menor cor.',
        'Cada carpa retirada rende 1 moeda imediatamente.'
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
    if (state.mode === 'solo') return ['Some as carpas preferidas que saíram pela Correnteza às que ficaram no tanque.', 'Esse total é o seu resultado solo.', 'Tente superar o recorde salvo neste navegador.'];
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
          <p class="eyebrow">Carpas Online · MVP 6</p>
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
      </main>`;

    bindExternalLinks();

    document.querySelectorAll('.role-tab').forEach((button) => {
      button.addEventListener('click', () => {
        entryRole = button.dataset.role;
        notice = '';
        render();
      });
    });

    document.querySelector('#createRoom')?.addEventListener('click', async () => {
      const name = document.querySelector('#playerName').value.trim();
      const color = document.querySelector('input[name="color"]:checked')?.value;
      if (!name) { notice = 'Digite seu nome.'; return render(); }
      const mode = entryRole === 'solo' ? 'solo' : 'multiplayer';
      const response = await emit('createRoom', { name, color, mode });
      if (response?.ok) {
        saveIdentity({ name, color, ...response });
        render();
      }
    });

    document.querySelector('#joinRoom')?.addEventListener('click', async () => {
      const name = document.querySelector('#playerName').value.trim();
      const roomCode = document.querySelector('#roomCode').value.trim().toUpperCase();
      if (!name || roomCode.length !== 4) { notice = 'Informe seu nome e o código da sala.'; return render(); }
      if (entryRole === 'spectator') {
        const response = await emit('joinSpectator', { name, roomCode });
        if (response?.ok) { saveIdentity({ name, color: null, ...response }); render(); }
        return;
      }
      const color = document.querySelector('input[name="color"]:checked')?.value;
      const response = await emit('joinRoom', { name, color, roomCode });
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
          ${notice ? `<div class="notice error">${escapeHtml(notice)}</div>` : ''}
          <div class="player-list">
            ${players.map((player) => `<article class="player-row"><span class="connection ${player.connected ? 'online' : ''}"></span>${playerNameChip(player)}${colorBadge(player.color)}${player.id === state.hostId ? '<em>Anfitrião</em>' : ''}</article>`).join('')}
          </div>
          <p class="muted">${state.mode === 'solo' ? 'Modo solo · espectadores podem entrar usando este código.' : `${players.length}/4 jogadores · Cores livres: ${available.map((color) => COLOR_LABELS[color]).join(', ') || 'nenhuma'}`}</p>
          <section class="spectator-list"><h2>Espectadores <span>${spectators.length}</span></h2>${spectators.length ? spectators.map((spectator) => `<p><span class="connection ${spectator.connected ? 'online' : ''}"></span>${escapeHtml(spectator.name)}</p>`).join('') : '<p class="muted">Nenhum espectador conectado.</p>'}</section>
          ${current?.id === state.hostId ? `<button id="startGame" class="primary-button" ${state.mode !== 'solo' && players.length < 2 ? 'disabled' : ''}>${state.mode === 'solo' ? 'Iniciar modo solo' : 'Iniciar partida'}</button>` : identity.role === 'spectator' ? '<p class="waiting">Você está assistindo à sala de espera.</p>' : '<p class="waiting">Aguardando o anfitrião iniciar...</p>'}
          </section>
        </div>
        ${serverConnectionUiHtml()}
      </main>`;

    bindExternalLinks();

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
    document.querySelector('#startGame')?.addEventListener('click', () => emit('startGame'));
  }

  function playerHasFinishedCurrentPhase(player) {
    if (state.phase === 'movement') return Boolean(player?.movementReady);
    if (state.phase === 'development') return Boolean(player?.development?.done);
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
      const limit = player.moveLimit || state.constants.movesPerRound;
      return { text: `${limit - player.movesRemaining}/${limit}`, waiting: false };
    }
    if (state.phase === 'development') {
      if (player.development?.done) return { text: 'Fase concluída', waiting: false };
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

  function opponentsHtml() {
    return state.playerOrder
      .filter((id) => id !== identity.memberId)
      .map((id) => {
        const player = state.players[id];
        const status = playerPhaseStatus(player);
        return `<article class="opponent-card"><header>${playerNameChip(player)}${colorBadge(player.color)}</header>${boardHtml(player, { miniature: true })}<footer class="${status.waiting ? 'phase-waiting-footer' : ''}"><span class="connection ${player.connected ? 'online' : ''}"></span>${status.text}</footer></article>`;
      }).join('');
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
    let instruction = 'Clique em uma peça ortogonalmente adjacente ao espaço vazio.';
    if (current.mustMoveCarp) instruction = 'A alga foi movida: agora mova obrigatoriamente uma carpa.';
    if (current.correctionRequired) instruction = 'Preencha o vazio da linha central usando a peça imediatamente acima ou abaixo, ou compre um movimento extra.';
    if (current.movementReady) instruction = waitingForOtherPlayersMessage() || 'Movimentação concluída. Preparando a próxima fase.';
    const canFinish = current.movesRemaining === 0 && !current.mustMoveCarp && !current.correctionRequired && !current.movementReady;
    const dots = Array.from({ length: totalMoves }, (_, index) => `<i class="${index < completed ? 'done' : ''}"></i>`).join('');
    return `
      <section class="action-panel movement-dashboard">
        <p class="phase-kicker">Fase da movimentação</p>
        <h2>Faça ${totalMoves} movimentos</h2>
        <div class="movement-score"><strong>${completed}</strong><span>/${totalMoves}</span></div>
        <div class="movement-progress" style="--progress:${totalMoves ? (completed / totalMoves) * 100 : 0}%"><span></span></div>
        <div class="movement-dots" style="--moves-count:${totalMoves}">${dots}</div>
        <p class="instruction">${instruction}</p>
        <div class="coin-rule-note"><img src="${ASSETS.coin}" alt=""><span><strong>${state.constants.extraMoveCost} moedas</strong> compram 1 movimento extra. As moedas gastas são abatidas.</span></div>
        ${!isCompactMobile() && canFinish ? '<button id="finishMovement" class="primary-button">Concluir movimentação</button>' : ''}
        ${!isCompactMobile() && current.movementReady && waitingForOtherPlayersMessage() ? '<button class="secondary-button try-next-phase" data-wait-phase="movement">Continuar para a próxima fase</button>' : ''}
        ${current.specialAlert ? `<p class="special-action-alert" role="status">${escapeHtml(current.specialAlert)}</p>` : ''}
        <p class="movement-alert ${movementError ? 'visible' : ''}" role="alert" aria-live="assertive">${movementError ? escapeHtml(movementError) : '&nbsp;'}</p>
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
      ? 'Sua linha central sai pela esquerda e a linha exibida pelo Automa entra pela direita, na mesma sequência.'
      : 'As peças saem pela esquerda e entram no próximo tanque na mesma sequência.';
    return `<section class="action-panel circulation-panel"><p class="phase-kicker">Fase da Correnteza</p><h2>As peças seguem a correnteza</h2><div class="flow-graphic"><span>◀</span><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p>${description}</p></section>`;
  }

  function scorePanel() {
    if (!state.winner) return '';
    if (state.winner.solo) {
      const player = state.players[state.winner.playerIds[0]];
      const score = Number(state.winner.soloScore || state.winner.score || 0);
      const recordKey = `carpasSoloRecord:${player.color}`;
      const previousRecord = Number(localStorage.getItem(recordKey) || 0);
      const record = Math.max(previousRecord, score);
      localStorage.setItem(recordKey, String(record));
      return `<div class="modal-backdrop final-results-backdrop"><section class="result-card final-results-card solo-result-card">${logoHtml('result-logo')}<p class="eyebrow">Resultado do modo solo</p><h1>Parabéns, ${escapeHtml(player.name)}!</h1><div class="solo-final-score"><strong>${score}</strong><span>carpas preferidas</span></div><p>${state.winner.exitedPreferred} saíram pela Correnteza e ${state.winner.remainingPreferred} permaneceram no tanque.</p><p class="solo-record">Seu recorde salvo neste navegador: <strong>${record}</strong></p><p class="print-suggestion">Tire um print do resultado e compartilhe seu recorde.</p><div class="final-result-actions"><button id="finalRestartGame" class="primary-button">↻ Reiniciar partida</button><button id="finalExitGame" class="secondary-button">Sair</button></div></section></div>`;
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
    return `<div class="modal-backdrop final-results-backdrop"><section class="result-card final-results-card">${logoHtml('result-logo')}<p class="eyebrow">Resultado final</p><h1>${title}</h1><p class="result-rule">Primeiro conta-se o total de carpas. Em empate, vence quem tiver mais moedas.</p><div class="ranking">${ranking.map(({ player, score, coins }, index) => `<div class="${index === 0 ? 'winner-row' : ''}"><strong>${index + 1}º</strong>${playerNameChip(player)}${colorBadge(player.color)}<span>${score} carpas</span><span class="ranking-coins"><img src="${ASSETS.coin}" alt="">${coins}</span></div>`).join('')}</div><div class="final-result-actions">${restartButton}<button id="finalExitGame" class="secondary-button">Sair</button></div></section></div>`;
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
    return '<button type="button" class="danger-button wait-exit-game">Sair</button>';
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
    return `<div class="modal-backdrop player-wait-backdrop"><section class="modal-card wait-card"><img class="wait-fish-gif" src="${ASSETS.fishAnimation}" alt="" aria-hidden="true"><p class="eyebrow">Partida pausada</p><h2>Jogador ${escapeHtml(first.name)} saiu${extra}</h2><p>Aguardando retorno do jogador ${escapeHtml(first.name)}. A partida continua automaticamente quando todos estiverem presentes.</p>${absent.length > 1 ? `<div class="absent-list">${absent.map((player) => playerNameChip(player)).join('')}</div>` : ''}${waitExitButtonHtml()}</section></div>`;
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
    const preferredInMiddle = current.board
      ? current.board[state.constants.middleRow].filter((piece) => piece?.type === 'carp' && piece.color === current.color).length
      : 0;

    app.innerHTML = `
      <div class="game-shell ${layout}">
        ${liquidFilterSvg()}
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
            <header>
              <div class="tank-player-heading"><p class="eyebrow">Seu tanque</p><div class="player-title-line"><h1>${escapeHtml(current.name)}</h1><span class="preferred-carp-label">Sua carpa preferida:<img src="${ASSETS[current.color]}" alt="Carpa ${COLOR_LABELS[current.color]}"></span></div></div>
              <div class="tank-header-actions">
                <div class="middle-count">Sua cor na linha <strong>${preferredInMiddle}</strong></div>
                <button id="buyExtraMove" class="money-button" ${state.phase !== 'movement' || current.movementReady || current.coins < state.constants.extraMoveCost || !serverConnected || (state.disconnectedPlayerIds || []).length ? 'disabled' : ''} title="Gaste ${state.constants.extraMoveCost} moedas para comprar 1 movimento extra"><img src="${ASSETS.coin}" alt="Moedas"><strong>${current.coins}</strong><small>${state.constants.extraMoveCost} = +1 movimento</small></button>
                <button id="undoMove" class="undo-button" ${state.phase !== 'movement' || current.movementReady || !current.movementHistoryLength ? 'disabled' : ''}>↶ Desfazer jogada</button>
              </div>
            </header>
            ${boardHtml(current, { interactive: state.phase === 'movement' || state.phase === 'development' })}
          </section>
          ${mobilePhaseActionHtml(current)}
          <aside class="right-rail">${panel}${logPanelHtml()}</aside>
        </main>
      </div>`;

    document.querySelectorAll('.my-tank-card .tank-cell').forEach((cell) => {
      cell.addEventListener('click', async () => {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        if (state.phase === 'movement') {
          if (Date.now() < interactionLockedUntil) {
            movementError = 'Aguarde a animação do movimento anterior terminar.';
            render();
            return;
          }
          const response = await emit('movePiece', { from: { row, col } });
          if (response?.ok) interactionLockedUntil = Date.now() + (response.specialMoved ? 920 : 620);
        }
        if (state.phase === 'development') emit('replaceFish', { position: { row, col } });
      });
    });
    document.querySelector('#undoMove')?.addEventListener('click', async () => {
      if (Date.now() < interactionLockedUntil) {
        movementError = 'Aguarde a animação do movimento anterior terminar.';
        render();
        return;
      }
      const response = await emit('undoMove');
      if (response?.ok) interactionLockedUntil = Date.now() + 360;
    });
    document.querySelector('#buyExtraMove')?.addEventListener('click', () => emit('buyExtraMove'));
    document.querySelector('#finishMovement')?.addEventListener('click', () => emit('finishMovement'));
    document.querySelectorAll('.color-target').forEach((button) => button.addEventListener('click', () => emit('chooseDevelopmentColor', { color: button.dataset.color })));
    document.querySelectorAll('.try-next-phase').forEach((button) => button.addEventListener('click', () => {
      const message = waitingForOtherPlayersMessage();
      if (button.dataset.waitPhase === 'movement') movementError = message;
      else notice = message;
      render();
    }));
    bindCommonGameActions();
  }

  function spectatorGameScreen() {
    const boards = state.playerOrder.map((id) => {
      const player = state.players[id];
      const status = playerPhaseStatus(player, { spectatorView: true });
      return `<article class="spectator-board-card"><header>${playerNameChip(player)}${colorBadge(player.color)}<span class="connection ${player.connected ? 'online' : ''}"></span></header>${state.mode === 'solo' ? automaLineHtml() : ''}${boardHtml(player, { spectator: true })}<footer class="spectator-phase-status ${status.waiting ? 'phase-waiting-footer' : ''}">${status.text}</footer></article>`;
    }).join('');

    app.innerHTML = `
      <div class="game-shell ${layout}">
        ${liquidFilterSvg()}
        ${topbarHtml()}
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
