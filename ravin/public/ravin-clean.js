(() => {
  const EXPERIENCE_KEY = 'ravin_experience';
  const ACCENT_KEY = 'ravin_accent';
  const CONTEXT_KEY = 'ravin_context_collapsed';
  const EXPERIENCES = ['clean', 'focus', 'glass', 'midnight', 'duo', 'scifi'];
  const ACCENTS = ['mono', 'ice', 'aurora', 'ember', 'forest', 'rose'];

  const $ = (selector, root = document) => root.querySelector(selector);

  function normalize(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function applyAppearance() {
    const experience = normalize(localStorage.getItem(EXPERIENCE_KEY), EXPERIENCES, 'clean');
    const accent = normalize(localStorage.getItem(ACCENT_KEY), ACCENTS, 'mono');
    document.documentElement.dataset.ravinExperience = experience;
    document.documentElement.dataset.ravinAccent = accent;
  }

  function setExperience(value) {
    const next = normalize(value, EXPERIENCES, 'clean');
    localStorage.setItem(EXPERIENCE_KEY, next);
    document.documentElement.dataset.ravinExperience = next;
  }

  function setAccent(value) {
    const next = normalize(value, ACCENTS, 'mono');
    localStorage.setItem(ACCENT_KEY, next);
    document.documentElement.dataset.ravinAccent = next;
  }

  function contextCollapsed() {
    return localStorage.getItem(CONTEXT_KEY) === 'true';
  }

  function syncContextState() {
    const app = $('#ravinApp');
    const button = $('#contextToggleBtn');
    if (!app) return;
    const collapsed = contextCollapsed();
    app.classList.toggle('ravin-context-collapsed', collapsed);
    if (button) {
      button.setAttribute('aria-pressed', String(!collapsed));
      button.title = collapsed ? 'Show context' : 'Hide context';
    }
  }

  function addContextToggle() {
    const right = $('.ravin-header-right');
    if (!right || $('#contextToggleBtn')) return;
    const button = document.createElement('button');
    button.className = 'ravin-icon-button ravin-context-toggle';
    button.id = 'contextToggleBtn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Toggle work context');
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M15 4v16"/></svg>';
    button.addEventListener('click', () => {
      localStorage.setItem(CONTEXT_KEY, String(!contextCollapsed()));
      syncContextState();
    });
    right.insertBefore(button, $('#settingsBtn'));
    syncContextState();
  }

  function addSidebarWorkspaceLabel() {
    const sidebar = $('.ravin-sidebar');
    const search = $('.ravin-search-wrap');
    if (!sidebar || !search || $('.ravin-clean-nav')) return;

    const nav = document.createElement('div');
    nav.className = 'ravin-clean-nav';
    nav.innerHTML = `
      <button class="ravin-clean-nav-item active" type="button" data-ravin-nav="chats" aria-current="page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/></svg>
        <span>Chats</span>
      </button>`;
    sidebar.insertBefore(nav, search);
    nav.querySelector('[data-ravin-nav="chats"]').addEventListener('click', () => {
      $('#historySearch')?.focus();
      $('#historyList')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    });
  }

  function appearanceMarkup() {
    const experience = document.documentElement.dataset.ravinExperience || 'clean';
    const accent = document.documentElement.dataset.ravinAccent || 'mono';
    return `
      <div class="ravin-appearance-setting" data-ravin-appearance>
        <div class="ravin-appearance-label">Experience</div>
        <div class="ravin-experience-grid">
          ${EXPERIENCES.map((item) => `<button type="button" class="${item === experience ? 'selected' : ''}" data-ravin-experience-option="${item}">${item === 'scifi' ? 'Sci-Fi' : item[0].toUpperCase() + item.slice(1)}</button>`).join('')}
        </div>
        <div class="ravin-appearance-label ravin-accent-label">Accent</div>
        <div class="ravin-accent-grid" role="group" aria-label="RAVIN accent color">
          ${ACCENTS.map((item) => `<button type="button" class="ravin-accent-swatch ${item === accent ? 'selected' : ''}" data-ravin-accent-option="${item}" aria-label="${item}" title="${item}"><span></span></button>`).join('')}
        </div>
      </div>`;
  }

  function augmentSettings() {
    requestAnimationFrame(() => {
      const pop = $('.ravin-popover');
      if (!pop || pop.querySelector('[data-ravin-appearance]')) return;
      const divider = pop.querySelector('hr');
      const wrap = document.createElement('div');
      wrap.innerHTML = appearanceMarkup();
      const setting = wrap.firstElementChild;
      if (divider) pop.insertBefore(setting, divider);
      else pop.appendChild(setting);
      pop.classList.add('ravin-settings-popover');
      pop.style.width = '286px';

      setting.addEventListener('pointerdown', (event) => event.stopPropagation());
      setting.addEventListener('click', (event) => {
        event.stopPropagation();
        const experienceButton = event.target.closest('[data-ravin-experience-option]');
        const accentButton = event.target.closest('[data-ravin-accent-option]');
        if (experienceButton) {
          setExperience(experienceButton.dataset.ravinExperienceOption);
          setting.querySelectorAll('[data-ravin-experience-option]').forEach((button) => button.classList.toggle('selected', button === experienceButton));
        }
        if (accentButton) {
          setAccent(accentButton.dataset.ravinAccentOption);
          setting.querySelectorAll('[data-ravin-accent-option]').forEach((button) => button.classList.toggle('selected', button === accentButton));
        }
      });
    });
  }

  function bindSettings() {
    const settings = $('#settingsBtn');
    if (!settings || settings.dataset.cleanBound) return;
    settings.dataset.cleanBound = 'true';
    settings.addEventListener('click', augmentSettings);
  }

  function removeLegacyParticleSurfaces() {
    document.querySelectorAll('#ravinParticleFieldV3, #ravinParticleField, .ravin-field-canvas').forEach((node) => node.remove());
  }

  function init() {
    applyAppearance();
    const app = $('#ravinApp');
    if (!app) {
      setTimeout(init, 60);
      return;
    }

    addContextToggle();
    addSidebarWorkspaceLabel();
    bindSettings();
    syncContextState();
    removeLegacyParticleSurfaces();

    const observer = new MutationObserver(() => removeLegacyParticleSurfaces());
    observer.observe(document.body, { childList: true });
  }

  applyAppearance();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();