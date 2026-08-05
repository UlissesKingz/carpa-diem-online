(() => {
  const DISCORD_URL = 'https://discord.gg/EJCHTwQjDz';
  const COPYRIGHT_TEXT = 'Jogo criado por Ulisses Reis © 2026 — Propriedade intelectual protegida. Reprodução, distribuição ou uso não autorizado são proibidos.';

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
    forceDiscordLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeContact();
  });

  // A interface principal é renderizada novamente durante a partida.
  const observer = new MutationObserver(forceDiscordLinks);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
