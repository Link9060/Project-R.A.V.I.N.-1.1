(() => {
  const EXPERIENCE_KEY = 'ravin_experience';
  const PALETTE_KEY = 'ravin_palette';
  const LEGACY_ACCENT_KEY = 'ravin_accent';
  const INTENSITY_KEY = 'ravin_experience_intensity';
  const LOCK_IN_KEY = 'ravin_experience_lock_in';
  const CONTEXT_KEY = 'ravin_context_collapsed';

  const DEFAULT_EXPERIENCE = 'flow';
  const DEFAULT_PALETTE = 'monochrome';
  const DEFAULT_INTENSITY = 55;

  const EXPERIENCES = [
    { id: 'flow', name: 'Flow', signature: 'Balanced', description: 'Balanced motion and familiar Resonant surfaces.' },
    { id: 'still', name: 'Still', signature: 'Quiet', description: 'Quiet structure, restrained motion and focused surfaces with only essential signals.' },
    { id: 'nexus', name: 'Nexus', signature: 'Cinematic', description: 'A reactive technical network with angular panels and signal-like motion.' },
    { id: 'aura', name: 'Aura', signature: 'Calm', description: 'Soft geometry, gentle movement and a calm, welcoming rhythm.' },
    { id: 'slate', name: 'Slate', signature: 'Organized', description: 'Editorial structure, strong typography and orderly sections.' },
    { id: 'spark', name: 'Spark', signature: 'Playful', description: 'Responsive, energetic interactions with expressive micro-motion.' },
    { id: 'lucid', name: 'Lucid', signature: 'Dimensional', description: 'Layered translucent surfaces with controlled blur, depth and reflection.' },
    { id: 'vivid', name: 'Vivid', signature: 'Color-rich', description: 'Uses your selected color more boldly across panels, borders, controls and surfaces.' },
  ];

  const PALETTES = [
    { id: 'monochrome', name: 'Monochrome', light: '#111111', dark: '#f4f4f5', secondaryLight: '#111111', secondaryDark: '#f4f4f5' },
    { id: 'cobalt', name: 'Cobalt', light: '#2563eb', dark: '#60a5fa', secondaryLight: '#2563eb', secondaryDark: '#60a5fa' },
    { id: 'violet', name: 'Violet', light: '#7c3aed', dark: '#a78bfa', secondaryLight: '#7c3aed', secondaryDark: '#a78bfa' },
    { id: 'rose', name: 'Rose', light: '#e11d48', dark: '#fb7185', secondaryLight: '#e11d48', secondaryDark: '#fb7185' },
    { id: 'cyan', name: 'Cyan', light: '#0891b2', dark: '#22d3ee', secondaryLight: '#0891b2', secondaryDark: '#22d3ee' },
    { id: 'emerald', name: 'Emerald', light: '#059669', dark: '#34d399', secondaryLight: '#059669', secondaryDark: '#34d399' },
    { id: 'amber', name: 'Amber', light: '#d97706', dark: '#fbbf24', secondaryLight: '#d97706', secondaryDark: '#fbbf24' },
    { id: 'fuchsia', name: 'Fuchsia', light: '#c026d3', dark: '#e879f9', secondaryLight: '#c026d3', secondaryDark: '#e879f9' },
    { id: 'scarlet', name: 'Scarlet', light: '#dc2626', dark: '#f87171', secondaryLight: '#dc2626', secondaryDark: '#f87171' },
    { id: 'orange', name: 'Orange', light: '#ea580c', dark: '#fb923c', secondaryLight: '#ea580c', secondaryDark: '#fb923c' },
    { id: 'lime', name: 'Lime', light: '#65a30d', dark: '#a3e635', secondaryLight: '#65a30d', secondaryDark: '#a3e635' },
    { id: 'sky', name: 'Sky', light: '#0284c7', dark: '#38bdf8', secondaryLight: '#0284c7', secondaryDark: '#38bdf8' },
    { id: 'indigo', name: 'Indigo', light: '#4f46e5', dark: '#818cf8', secondaryLight: '#4f46e5', secondaryDark: '#818cf8' },
    { id: 'aurora', name: 'Aurora', light: '#7c3aed', dark: '#a78bfa', secondaryLight: '#0891b2', secondaryDark: '#22d3ee', duo: true },
    { id: 'ember', name: 'Ember', light: '#e11d48', dark: '#fb7185', secondaryLight: '#d97706', secondaryDark: '#fbbf24', duo: true },
    { id: 'tide', name: 'Tide', light: '#2563eb', dark: '#60a5fa', secondaryLight: '#059669', secondaryDark: '#34d399', duo: true },
    { id: 'candy', name: 'Candy', light: '#db2777', dark: '#f472b6', secondaryLight: '#7c3aed', secondaryDark: '#a78bfa', duo: true },
    { id: 'solar', name: 'Solar', light: '#ea580c', dark: '#fb923c', secondaryLight: '#ca8a04', secondaryDark: '#fde047', duo: true },
    { id: 'pulse', name: 'Pulse', light: '#c026d3', dark: '#e879f9', secondaryLight: '#0891b2', secondaryDark: '#22d3ee', duo: true },
    { id: 'citrus', name: 'Citrus', light: '#65a30d', dark: '#a3e635', secondaryLight: '#ea580c', secondaryDark: '#fb923c', duo: true },
    { id: 'dusk', name: 'Dusk', light: '#4f46e5', dark: '#818cf8', secondaryLight: '#e11d48', secondaryDark: '#fb7185', duo: true },
  ];

  const EXPERIENCE_IDS = new Set(EXPERIENCES.map(({ id }) => id));
  const PALETTE_IDS = new Set(PALETTES.map(({ id }) => id));
  const $ = (selector, root = document) => root.querySelector(selector);

  const legacyExperience = {
    clean: 'still',
    focus: 'still',
    glass: 'lucid',
    midnight: 'flow',
    duo: 'vivid',
    scifi: 'nexus',
  };
  const legacyPalette = {
    mono: 'monochrome',
    ice: 'sky',
    forest: 'emerald',
    rose: 'candy',
    aurora: 'aurora',
    ember: 'ember',
  };

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function migrateLegacyPreferences() {
    const rawExperience = localStorage.getItem(EXPERIENCE_KEY);
    if (rawExperience && !EXPERIENCE_IDS.has(rawExperience) && legacyExperience[rawExperience]) {
      localStorage.setItem(EXPERIENCE_KEY, legacyExperience[rawExperience]);
      if (rawExperience === 'focus' && localStorage.getItem(LOCK_IN_KEY) == null) localStorage.setItem(LOCK_IN_KEY, 'true');
    }

    if (!localStorage.getItem(PALETTE_KEY)) {
      const oldAccent = localStorage.getItem(LEGACY_ACCENT_KEY);
      if (oldAccent && legacyPalette[oldAccent]) localStorage.setItem(PALETTE_KEY, legacyPalette[oldAccent]);
    }
    localStorage.removeItem(LEGACY_ACCENT_KEY);
  }

  function readAppearance() {
    migrateLegacyPreferences();
    const rawExperience = localStorage.getItem(EXPERIENCE_KEY);
    const rawPalette = localStorage.getItem(PALETTE_KEY);
    const rawIntensity = Number(localStorage.getItem(INTENSITY_KEY));
    return {
      experience: EXPERIENCE_IDS.has(rawExperience) ? rawExperience : DEFAULT_EXPERIENCE,
      palette: PALETTE_IDS.has(rawPalette) ? rawPalette : DEFAULT_PALETTE,
      intensity: Number.isFinite(rawIntensity) ? clamp(rawIntensity, 0, 100) : DEFAULT_INTENSITY,
      lockIn: localStorage.getItem(LOCK_IN_KEY) === 'true',
    };
  }

  function applyAppearance(next = readAppearance()) {
    const root = document.documentElement;
    root.dataset.ravinExperience = next.experience;
    root.dataset.ravinPalette = next.palette;
    root.dataset.ravinLockIn = String(Boolean(next.lockIn));
    delete root.dataset.ravinAccent;
    root.style.setProperty('--ravin-experience-intensity', String(clamp(next.intensity, 0, 100) / 100));
    root.style.setProperty('--ravin-experience-intensity-percent', `${clamp(next.intensity, 0, 100)}%`);
    return next;
  }

  function saveAppearance(patch = {}) {
    const current = readAppearance();
    const next = { ...current, ...patch };
    if (!EXPERIENCE_IDS.has(next.experience)) next.experience = DEFAULT_EXPERIENCE;
    if (!PALETTE_IDS.has(next.palette)) next.palette = DEFAULT_PALETTE;
    next.intensity = clamp(Number(next.intensity) || 0, 0, 100);
    next.lockIn = Boolean(next.lockIn);
    localStorage.setItem(EXPERIENCE_KEY, next.experience);
    localStorage.setItem(PALETTE_KEY, next.palette);
    localStorage.setItem(INTENSITY_KEY, String(next.intensity));
    localStorage.setItem(LOCK_IN_KEY, String(next.lockIn));
    applyAppearance(next);
    window.dispatchEvent(new CustomEvent('ravin:experience-change', { detail: next }));
    return next;
  }

  function resetAppearance() {
    localStorage.removeItem(EXPERIENCE_KEY);
    localStorage.removeItem(PALETTE_KEY);
    localStorage.removeItem(INTENSITY_KEY);
    localStorage.removeItem(LOCK_IN_KEY);
    return applyAppearance({ experience: DEFAULT_EXPERIENCE, palette: DEFAULT_PALETTE, intensity: DEFAULT_INTENSITY, lockIn: false });
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

  function paletteMarkup(option, selected) {
    return `<button type="button" class="ravin-palette-option${selected ? ' selected' : ''}" data-ravin-palette-option="${option.id}" aria-pressed="${selected}" title="${option.name}">
      <span class="ravin-palette-swatch" style="--swatch-light-a:${option.light};--swatch-light-b:${option.secondaryLight};--swatch-dark-a:${option.dark};--swatch-dark-b:${option.secondaryDark}" aria-hidden="true"></span>
      <span class="ravin-palette-name">${option.name}</span>
      ${option.duo ? '<span class="ravin-duo-tag">Duo</span>' : ''}
    </button>`;
  }

  function appearanceMarkup() {
    const current = readAppearance();
    const singles = PALETTES.filter((item) => !item.duo);
    const duos = PALETTES.filter((item) => item.duo);
    return `
      <section class="ravin-experience-controls" data-ravin-appearance>
        <div class="ravin-experience-head">
          <div>
            <h3>RAVIN Experience</h3>
            <p>Choose how RAVIN moves, feels and uses color. Your palette and light or dark mode shape the final look.</p>
          </div>
        </div>

        <div class="ravin-experience-options">
          ${EXPERIENCES.map((option) => `<button type="button" class="ravin-experience-option${current.experience === option.id ? ' selected' : ''}" data-ravin-experience-option="${option.id}" data-experience-preview="${option.id}" aria-pressed="${current.experience === option.id}">
            <span class="ravin-experience-option-top">
              <span class="ravin-experience-copy"><strong>${option.name}</strong><small>${option.signature}</small></span>
              <span class="ravin-mode-preview" aria-hidden="true"><i></i><i></i><i></i></span>
            </span>
            <span class="ravin-experience-description">${option.description}</span>
          </button>`).join('')}
        </div>

        <div class="ravin-experience-section ravin-palette-section">
          <div class="ravin-section-head"><strong>Color palette</strong><span>${PALETTES.length} options</span></div>
          <p class="ravin-section-help">Most modes use color as an accent. Vivid uses lighter and darker shades of your selected primary color across more of the interface.</p>
          <div class="ravin-palette-group">
            <div class="ravin-palette-group-label">Single colors</div>
            <div class="ravin-palette-grid">${singles.map((option) => paletteMarkup(option, current.palette === option.id)).join('')}</div>
          </div>
          <div class="ravin-palette-group">
            <div class="ravin-palette-group-label">Two-color palettes</div>
            <div class="ravin-palette-grid">${duos.map((option) => paletteMarkup(option, current.palette === option.id)).join('')}</div>
          </div>
        </div>

        <label class="ravin-experience-section ravin-intensity-setting">
          <span class="ravin-intensity-head"><strong>Visual intensity</strong><output>${current.intensity}%</output></span>
          <input class="ravin-experience-intensity" type="range" min="0" max="100" step="1" value="${current.intensity}" aria-label="Visual intensity" style="--particle-fill:${current.intensity}%" />
          <span class="ravin-intensity-hints"><span>Calm</span><span>Expressive</span></span>
        </label>

        <div class="ravin-experience-section">
          <button type="button" class="ravin-lock-in-toggle${current.lockIn ? ' selected' : ''}" data-ravin-lock-in aria-pressed="${current.lockIn}">
            <span class="ravin-lock-in-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></span>
            <span class="ravin-lock-in-copy"><strong>Lock-In</strong><small>Hide nonessential motion and attention signals while you focus.</small></span>
            <span class="ravin-lock-in-switch" aria-hidden="true"><i></i></span>
          </button>
        </div>

        <div class="ravin-experience-footer">
          <button type="button" class="ravin-reset-experience" data-ravin-reset>Reset experience</button>
          <p>Light and dark mode are controlled separately.</p>
        </div>
      </section>`;
  }

  function syncSettingsControls(setting, state = readAppearance()) {
    setting.querySelectorAll('[data-ravin-experience-option]').forEach((button) => {
      const selected = button.dataset.ravinExperienceOption === state.experience;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    setting.querySelectorAll('[data-ravin-palette-option]').forEach((button) => {
      const selected = button.dataset.ravinPaletteOption === state.palette;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const slider = setting.querySelector('.ravin-experience-intensity');
    const output = setting.querySelector('.ravin-intensity-head output');
    if (slider) {
      slider.value = String(state.intensity);
      slider.style.setProperty('--particle-fill', `${state.intensity}%`);
    }
    if (output) output.textContent = `${state.intensity}%`;
    const lock = setting.querySelector('[data-ravin-lock-in]');
    if (lock) {
      lock.classList.toggle('selected', state.lockIn);
      lock.setAttribute('aria-pressed', String(state.lockIn));
    }
  }

  function bindAppearanceControls(setting) {
    setting.addEventListener('pointerdown', (event) => event.stopPropagation());
    setting.addEventListener('click', (event) => {
      event.stopPropagation();
      const experienceButton = event.target.closest('[data-ravin-experience-option]');
      const paletteButton = event.target.closest('[data-ravin-palette-option]');
      const lockButton = event.target.closest('[data-ravin-lock-in]');
      const resetButton = event.target.closest('[data-ravin-reset]');
      let state = readAppearance();
      if (experienceButton) state = saveAppearance({ experience: experienceButton.dataset.ravinExperienceOption });
      if (paletteButton) state = saveAppearance({ palette: paletteButton.dataset.ravinPaletteOption });
      if (lockButton) state = saveAppearance({ lockIn: !state.lockIn });
      if (resetButton) state = resetAppearance();
      if (experienceButton || paletteButton || lockButton || resetButton) syncSettingsControls(setting, state);
    });

    const slider = setting.querySelector('.ravin-experience-intensity');
    slider?.addEventListener('input', (event) => {
      event.stopPropagation();
      const value = clamp(Number(event.target.value), 0, 100);
      const state = saveAppearance({ intensity: value });
      syncSettingsControls(setting, state);
    });
  }

  function augmentSettings() {
    requestAnimationFrame(() => {
      const pop = $('.ravin-popover');
      if (!pop || pop.querySelector('[data-ravin-appearance]')) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = appearanceMarkup();
      const setting = wrap.firstElementChild;
      const themeRow = pop.querySelector('[data-action="theme"]');
      const divider = pop.querySelector('hr');
      if (themeRow) pop.insertBefore(setting, themeRow);
      else if (divider) pop.insertBefore(setting, divider);
      else pop.appendChild(setting);

      pop.classList.add('ravin-settings-popover');
      pop.style.removeProperty('width');
      pop.style.removeProperty('left');
      pop.style.removeProperty('top');
      bindAppearanceControls(setting);
      syncSettingsControls(setting);
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