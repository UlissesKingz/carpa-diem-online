(() => {
  const DISCORD_URL = 'https://discord.gg/EJCHTwQjDz';
  const COPYRIGHT_TEXT = 'Jogo criado por Ulisses Reis e Marcelo Torres © 2026 — Propriedade intelectual protegida. Reprodução, distribuição ou uso não autorizado são proibidos.';
  const BACKGROUND_MUSIC_URL = 'https://res.cloudinary.com/dzjwlafsx/video/upload/v1786108152/background_sound_a0yqgp.mp3';
  const MUSIC_ENABLED_KEY = 'carpasBackgroundMusicEnabled';
  const MUSIC_TIME_KEY = 'carpasBackgroundMusicTime';
  let backgroundMusic = null;
  let musicButton = null;
  let musicEnabled = localStorage.getItem(MUSIC_ENABLED_KEY) !== 'false';

  function ensureFooter() {
    if (document.querySelector('.copyright-footer')) return;
    const footer = document.createElement('footer');
    footer.className = 'copyright-footer';
    footer.textContent = COPYRIGHT_TEXT;
    document.body.appendChild(footer);
  }

  function closeContact() {
    document.querySelector('.contact-backdrop')?.remove();
  }

  function openContact() {
    if (document.querySelector('.contact-backdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'contact-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'contactTitle');
    backdrop.innerHTML = `
      <section class="contact-card">
        <p class="eyebrow">Contato</p>
        <h2 id="contactTitle">Fale com a comunidade</h2>
        <p>Acesse o Discord do jogo e deixe uma mensagem no canal <strong>Geral</strong>.</p>
        <div class="contact-actions">
          <a class="primary-button contact-discord-button" href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">Abrir Discord</a>
          <button class="secondary-button contact-close-button" type="button">Voltar</button>
        </div>
      </section>`;

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.closest('.contact-close-button')) closeContact();
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('.contact-close-button')?.focus();
  }

  function ensureContactButton() {
    if (document.querySelector('.contact-fab')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'contact-fab';
    button.textContent = 'Contato';
    button.setAttribute('aria-label', 'Abrir informações de contato');
    button.addEventListener('click', openContact);
    document.body.appendChild(button);
  }

  function updateMusicButton() {
    if (!musicButton) return;
    musicButton.setAttribute('aria-pressed', musicEnabled ? 'true' : 'false');
    musicButton.setAttribute('aria-label', musicEnabled ? 'Desligar som de fundo' : 'Ligar som de fundo');
    musicButton.textContent = musicEnabled ? '♫ Som' : '♫ Som off';
  }

  function persistMusicTime() {
    if (!backgroundMusic || !Number.isFinite(backgroundMusic.currentTime)) return;
    localStorage.setItem(MUSIC_TIME_KEY, String(backgroundMusic.currentTime));
  }

  async function tryPlayBackgroundMusic() {
    if (!musicEnabled || !backgroundMusic) return;
    try {
      await backgroundMusic.play();
    } catch {
      // Navegadores bloqueiam autoplay com áudio até a primeira interação.
    }
  }

  function ensureBackgroundMusic() {
    if (!backgroundMusic) {
      backgroundMusic = new Audio(BACKGROUND_MUSIC_URL);
      backgroundMusic.loop = true;
      backgroundMusic.preload = 'auto';
      backgroundMusic.volume = 0.4;
      const savedTime = Number(localStorage.getItem(MUSIC_TIME_KEY) || 0);
      if (Number.isFinite(savedTime) && savedTime > 0) {
        backgroundMusic.addEventListener('loadedmetadata', () => {
          if (backgroundMusic.duration && savedTime < backgroundMusic.duration) backgroundMusic.currentTime = savedTime;
        }, { once: true });
      }
      backgroundMusic.addEventListener('timeupdate', () => {
        if (Math.floor(backgroundMusic.currentTime) % 3 === 0) persistMusicTime();
      });
    }

    if (!musicButton) {
      musicButton = document.createElement('button');
      musicButton.type = 'button';
      musicButton.className = 'music-toggle-fab';
      musicButton.addEventListener('click', async () => {
        musicEnabled = !musicEnabled;
        localStorage.setItem(MUSIC_ENABLED_KEY, String(musicEnabled));
        updateMusicButton();
        if (musicEnabled) await tryPlayBackgroundMusic();
        else {
          persistMusicTime();
          backgroundMusic.pause();
        }
      });
      document.body.appendChild(musicButton);
    }

    updateMusicButton();
    if (musicEnabled) tryPlayBackgroundMusic();
  }

  function unlockBackgroundMusic() {
    if (musicEnabled) tryPlayBackgroundMusic();
  }

  function forceDiscordLinks() {
    if (!window.CARPAS_CONFIG) window.CARPAS_CONFIG = {};
    window.CARPAS_CONFIG.discordUrl = DISCORD_URL;

    document.querySelectorAll('[data-link-key="discord"]').forEach((button) => {
      button.dataset.discordUrl = DISCORD_URL;
    });
  }

  function initialize() {
    ensureFooter();
    ensureContactButton();
    ensureBackgroundMusic();
    forceDiscordLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeContact();
    unlockBackgroundMusic();
  });
  document.addEventListener('pointerdown', unlockBackgroundMusic, { passive: true });
  window.addEventListener('pagehide', persistMusicTime);

  // A interface principal é renderizada novamente durante a partida.
  const observer = new MutationObserver(forceDiscordLinks);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
