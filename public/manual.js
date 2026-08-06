(() => {
  const assets = {
    yellow: '/assets/carp-yellow.png',
    white: '/assets/carp-white.png',
    red: '/assets/carp-red.png',
    gray: '/assets/carp-gray.png',
    algae: '/assets/algae.png',
    shoal: '/assets/tesourinhas.png',
    sturgeon: '/assets/sturgeon.png',
    dojo: '/assets/dojo.png',
    papaTerra: '/assets/papa-terra.png'
  };

  const alt = {
    yellow: 'Carpa amarela',
    white: 'Carpa branca',
    red: 'Carpa vermelha',
    gray: 'Carpa cinza',
    algae: 'Alga',
    shoal: 'Tesourinhas',
    sturgeon: 'Esturjão',
    dojo: 'Dojô',
    papaTerra: 'Papa-terra'
  };

  function pieceImage(type, rotation = 0, extraClass = '') {
    return `<img class="${extraClass}" src="${assets[type]}" alt="${alt[type]}" style="transform:rotate(${rotation}deg)">`;
  }

  function renderGrid(gridId, arrangement, rotations) {
    const grid = document.querySelector(gridId);
    if (!grid) return;
    grid.innerHTML = arrangement.map((type, index) => {
      if (!type) return '<span class="manual-grid-cell empty" aria-label="Espaço central vazio"></span>';
      const pieceClass = ['yellow', 'white', 'red', 'gray'].includes(type) ? 'carp' : type;
      return `<span class="manual-grid-cell ${pieceClass}">${pieceImage(type, rotations[index] || 0)}</span>`;
    }).join('');
  }

  function renderSetupGrid() {
    const arrangement = [
      'yellow','red','red','white','gray','algae','red',
      'white','red','white','gray','red','gray','white',
      'white','algae','yellow',null,'gray','yellow','algae',
      'white','red','yellow','algae','gray','gray','yellow',
      'gray','yellow','sturgeon','shoal','red','yellow','white'
    ];
    const rotations = [90,0,0,90,90,0,0,90,0,90,90,0,90,90,90,0,90,0,180,90,0,90,0,90,0,180,90,90,90,90,0,0,0,90,90];
    renderGrid('#setupGrid', arrangement, rotations);
  }

  function renderHeroGrid() {
    const arrangement = [
      'yellow','white','algae','red','gray','red','white',
      'gray','gray','white','yellow','red','algae','gray',
      'white','yellow','red',null,'gray','white','yellow',
      'gray','algae','white','red','yellow','gray','red',
      'dojo','red','yellow','white','algae','yellow','papaTerra'
    ];
    const rotations = [90,90,0,0,90,0,90,0,90,90,90,0,0,0,90,90,90,0,180,90,90,90,0,90,0,90,90,0,0,90,90,90,0,0,90];
    renderGrid('#heroGrid', arrangement, rotations);
  }

  function exampleBoard(cells, cols = 3, cellClass = '') {
    return `<div class="example-board" style="--cols:${cols}">${cells.map((cell) => {
      if (!cell) return '<span class="example-board-cell empty"></span>';
      const type = typeof cell === 'string' ? cell : cell.type;
      const rotation = typeof cell === 'string' ? 0 : (cell.rotation || 0);
      const extra = typeof cell === 'string' ? '' : (cell.className || '');
      const cls = ['yellow','white','red','gray'].includes(type) ? 'carp' : type;
      return `<span class="example-board-cell ${cls} ${cellClass} ${extra}">${pieceImage(type, rotation)}</span>`;
    }).join('')}</div>`;
  }

  function renderMovementExamples() {
    document.querySelectorAll('[data-example="carp"]').forEach((container) => {
      container.innerHTML = [
        exampleBoard([
          { type: 'red', rotation: 90 },
          null,
          { type: 'gray', rotation: 90 },
          { type: 'algae', rotation: 0 },
          { type: 'white', rotation: 90 },
          { type: 'yellow', rotation: 90 }
        ], 3),
        '<span class="example-arrow">→</span>',
        exampleBoard([
          null,
          { type: 'red', rotation: 0, className: 'highlight moved-into' },
          { type: 'gray', rotation: 90 },
          { type: 'algae', rotation: 0 },
          { type: 'white', rotation: 90 },
          { type: 'yellow', rotation: 90 }
        ], 3)
      ].join('');
    });

    document.querySelectorAll('[data-example="algae"]').forEach((container) => {
      container.innerHTML = [
        exampleBoard([
          { type: 'algae', rotation: 0 },
          null,
          { type: 'white', rotation: 90 },
          { type: 'gray', rotation: 90 },
          { type: 'red', rotation: 90 },
          { type: 'yellow', rotation: 90 }
        ], 3),
        '<span class="example-arrow">→</span>',
        `<div class="algae-step-flow">
          <div class="algae-step"><span class="step-label">1</span>${pieceImage('algae', 0, 'step-piece moved-into')}<small>alga move grátis</small></div>
          <div class="algae-step"><span class="step-label">2</span>${pieceImage('white', 90)}<small>carpa obrigatória</small></div>
        </div>`
      ].join('');
    });

    document.querySelectorAll('[data-example="shoal"]').forEach((container) => {
      container.innerHTML = [
        exampleBoard([
          { type: 'yellow', rotation: 90 },
          null,
          { type: 'white', rotation: 90 },
          { type: 'gray', rotation: 90 },
          { type: 'shoal', rotation: 0 },
          { type: 'red', rotation: 90 }
        ], 3),
        '<span class="example-arrow">→</span>',
        exampleBoard([
          { type: 'yellow', rotation: 90 },
          { type: 'shoal', rotation: 0, className: 'highlight moved-into' },
          { type: 'white', rotation: 90 },
          { type: 'gray', rotation: 90 },
          null,
          { type: 'red', rotation: 90 }
        ], 3)
      ].join('');
    });
  }

  function renderCurrent() {
    const origin = document.querySelector('#currentOrigin');
    const destination = document.querySelector('#currentDestination');
    if (!origin || !destination) return;
    const sequence = ['yellow','algae','yellow','shoal','red','yellow','white'];
    const html = sequence.map((type) => {
      const cls = ['yellow','white','red','gray'].includes(type) ? 'carp' : type;
      return `<span class="current-piece ${cls}">${pieceImage(type, type === 'shoal' ? 0 : 90)}</span>`;
    }).join('');
    origin.innerHTML = html;
    destination.innerHTML = html;
  }

  function setupScrollSpy() {
    const links = [...document.querySelectorAll('.manual-index a')];
    const sections = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
    }, { rootMargin: '-20% 0px -68% 0px', threshold: [0, .15, .4] });
    sections.forEach((section) => observer.observe(section));
  }

  function setupToTop() {
    const button = document.querySelector('#manualToTop');
    if (!button) return;
    const update = () => button.classList.toggle('visible', window.scrollY > 700);
    window.addEventListener('scroll', update, { passive: true });
    button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    update();
  }

  function initialize() {
    renderHeroGrid();
    renderSetupGrid();
    renderMovementExamples();
    renderCurrent();
    setupScrollSpy();
    setupToTop();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
