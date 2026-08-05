(() => {
  const assets = {
    yellow: '/assets/carp-yellow.png',
    white: '/assets/carp-white.png',
    red: '/assets/carp-red.png',
    gray: '/assets/carp-gray.png',
    algae: '/assets/algae.png',
    shoal: '/assets/shoal.png'
  };

  const alt = {
    yellow: 'Carpa amarela',
    white: 'Carpa branca',
    red: 'Carpa vermelha',
    gray: 'Carpa cinza',
    algae: 'Alga',
    shoal: 'Cardume'
  };

  function pieceImage(type, rotation = 0) {
    return `<img src="${assets[type]}" alt="${alt[type]}" style="transform:rotate(${rotation}deg)">`;
  }

  function renderSetupGrid() {
    const grid = document.querySelector('#setupGrid');
    if (!grid) return;
    const arrangement = [
      'yellow','red','red','white','gray','algae','red',
      'white','red','white','gray','red','gray','white',
      'white','algae','yellow',null,'gray','yellow','algae',
      'white','red','yellow','algae','gray','gray','yellow',
      'gray','yellow','algae','shoal','red','yellow','white'
    ];
    const rotations = [0,180,0,0,0,180,0,180,0,0,0,180,0,180,0,0,0,0,180,0,180,0,90,0,180,0,180,0,0,180,0,0,180,0,90];
    grid.innerHTML = arrangement.map((type, index) => {
      if (!type) return '<span class="manual-grid-cell empty" aria-label="Espaço central vazio"></span>';
      const pieceClass = ['yellow','white','red','gray'].includes(type) ? 'carp' : type;
      return `<span class="manual-grid-cell ${pieceClass}">${pieceImage(type, rotations[index])}</span>`;
    }).join('');
  }

  function miniGrid(cells) {
    return `<div class="example-mini-grid">${cells.map((cell) => {
      if (!cell) return '<span class="example-mini-cell empty"></span>';
      const type = typeof cell === 'string' ? cell : cell.type;
      const rotation = typeof cell === 'string' ? 0 : (cell.rotation || 0);
      const cls = type === 'shoal' ? 'shoal' : '';
      return `<span class="example-mini-cell ${cls}">${pieceImage(type, rotation)}</span>`;
    }).join('')}</div>`;
  }

  function renderMovementExamples() {
    document.querySelectorAll('[data-example="carp"]').forEach((container) => {
      container.innerHTML = `${miniGrid(['red', null, 'gray', 'algae'])}<span class="example-arrow">→</span>${miniGrid([null, { type: 'red', rotation: 270 }, 'gray', 'algae'])}`;
    });
    document.querySelectorAll('[data-example="shoal"]').forEach((container) => {
      container.innerHTML = `${miniGrid(['yellow', null, 'shoal', 'gray'])}<span class="example-arrow">→</span>${miniGrid(['yellow', 'shoal', null, 'gray'])}`;
    });
  }

  function renderCurrent() {
    const origin = document.querySelector('#currentOrigin');
    const destination = document.querySelector('#currentDestination');
    if (!origin || !destination) return;
    const sequence = ['yellow','algae','yellow','shoal','red','yellow','white'];
    const html = sequence.map((type) => {
      const cls = ['yellow','white','red','gray'].includes(type) ? 'carp' : type;
      return `<span class="current-piece ${cls}">${pieceImage(type, type === 'shoal' ? 90 : 90)}</span>`;
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
    renderSetupGrid();
    renderMovementExamples();
    renderCurrent();
    setupScrollSpy();
    setupToTop();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
