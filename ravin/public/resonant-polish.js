(() => {
  const THEME_KEY = "ravin_theme";
  const root = document.documentElement;
  let theme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";

  function setTheme(next, animate = true) {
    theme = next === "light" ? "light" : "dark";
    if (animate) {
      root.classList.add("theme-transition");
      clearTimeout(setTheme.timer);
      setTheme.timer = setTimeout(() => root.classList.remove("theme-transition"), 320);
    }
    root.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#0a0a0b");
    syncThemeButton();
    syncSettingsThemeRow();
  }

  function themeIcon() {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <g class="theme-sun">
          <circle cx="12" cy="12" r="3.4"></circle>
          <path d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5 17 7M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5"></path>
        </g>
        <path class="theme-moon" d="M20.2 15.2A8 8 0 0 1 8.8 3.8 8.1 8.1 0 1 0 20.2 15.2Z"></path>
      </svg>`;
  }

  function installThemeButton() {
    if (document.getElementById("themeBtn")) return;
    const settings = document.getElementById("settingsBtn");
    if (!settings) return;
    const button = document.createElement("button");
    button.id = "themeBtn";
    button.type = "button";
    button.className = "ravin-icon-button ravin-theme-button";
    button.innerHTML = themeIcon();
    button.addEventListener("click", () => setTheme(theme === "light" ? "dark" : "light"));
    settings.before(button);
    syncThemeButton();
  }

  function syncThemeButton() {
    const button = document.getElementById("themeBtn");
    if (!button) return;
    const next = theme === "light" ? "dark" : "light";
    button.setAttribute("aria-label", `Switch to ${next} mode`);
    button.setAttribute("title", `Switch to ${next} mode`);
    button.setAttribute("aria-pressed", String(theme === "light"));
  }

  function syncSettingsThemeRow() {
    const row = document.querySelector('.ravin-popover [data-action="theme"] .theme-value');
    if (row) row.textContent = theme === "light" ? "Light" : "Dark";
  }

  function addThemeToSettingsPopover() {
    const pop = document.querySelector(".ravin-popover");
    if (!pop || pop.querySelector('[data-action="theme"]')) return;
    const divider = pop.querySelector("hr");
    const button = document.createElement("button");
    button.dataset.action = "theme";
    button.innerHTML = `<span>Appearance</span><span class="theme-value">${theme === "light" ? "Light" : "Dark"}</span>`;
    if (divider) pop.insertBefore(button, divider);
    else pop.appendChild(button);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setTheme(theme === "light" ? "dark" : "light");
      pop.remove();
    });
  }

  function syncModeTabs() {
    const conversation = document.getElementById("conversationModeBtn");
    const work = document.getElementById("workModeBtn");
    if (!conversation || !work) return;
    for (const button of [conversation, work]) {
      const active = button.classList.contains("active");
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }

  function enhanceHistory() {
    document.querySelectorAll(".ravin-history-item").forEach((button) => {
      const active = button.classList.contains("active");
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      const title = button.querySelector(".ravin-history-title")?.textContent?.trim();
      if (title) button.title = title;
    });
  }

  function syncComposerState() {
    const composer = document.getElementById("composer");
    const input = document.getElementById("messageInput");
    if (!composer || !input) return;
    composer.classList.toggle("has-content", Boolean(input.value.trim()));
  }

  function syncOnlineState() {
    const app = document.getElementById("ravinApp");
    const status = document.getElementById("systemStatus");
    if (!app || !status) return;
    const offline = !navigator.onLine;
    app.classList.toggle("ravin-offline", offline);
    if (offline) status.textContent = "OFFLINE";
    else if (status.textContent === "OFFLINE") status.textContent = "READY";
  }

  function addTooltips() {
    const labels = {
      newChatBtn: "New chat",
      historySearch: "Search chats",
      settingsBtn: "RAVIN settings",
      addBtn: "Add context",
      sendBtn: "Send message",
      mobileMenuBtn: "Open sidebar",
    };
    for (const [id, label] of Object.entries(labels)) {
      const node = document.getElementById(id);
      if (node && !node.title) node.title = label;
    }
  }

  function installObservers() {
    const conversation = document.getElementById("conversationModeBtn");
    const work = document.getElementById("workModeBtn");
    if (conversation && work) {
      const observer = new MutationObserver(syncModeTabs);
      observer.observe(conversation, { attributes: true, attributeFilter: ["class"] });
      observer.observe(work, { attributes: true, attributeFilter: ["class"] });
    }

    const history = document.getElementById("historyList");
    if (history) {
      const observer = new MutationObserver(enhanceHistory);
      observer.observe(history, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    }
  }

  function bindPolishEvents() {
    const input = document.getElementById("messageInput");
    input?.addEventListener("input", syncComposerState);

    document.getElementById("settingsBtn")?.addEventListener("click", () => {
      requestAnimationFrame(addThemeToSettingsPopover);
    });

    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        setTheme(theme === "light" ? "dark" : "light");
      }
    });
  }

  function init() {
    setTheme(theme, false);
    installThemeButton();
    syncModeTabs();
    enhanceHistory();
    syncComposerState();
    syncOnlineState();
    addTooltips();
    installObservers();
    bindPolishEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(init), { once: true });
  } else {
    requestAnimationFrame(init);
  }
})();
