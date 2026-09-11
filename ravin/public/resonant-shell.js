(() => {
  const BACKEND_URL = "https://ravin-hyeq.onrender.com";
  const SUPABASE_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co";
  const SUPABASE_KEY = "sb_publishable_wVnTPMs0hUuWdt1_LGMIYQ_D-aXveMV";
  const AUTH_URL = `${SUPABASE_URL}/functions/v1/ravin-auth`;
  const AUTH_KEYS = {
    access: "ravin_access_token",
    refresh: "ravin_refresh_token",
    user: "ravin_user",
    expires: "ravin_token_expires_at",
  };
  const MODE_KEY = "ravin_mode";
  const SIDEBAR_KEY = "ravin_sidebar_collapsed";
  const conversationKeys = {
    conversation: "ravin_conversation_id_conversation",
    work: "ravin_conversation_id_work",
  };

  const state = {
    mode: localStorage.getItem(MODE_KEY) === "work" ? "work" : "conversation",
    conversations: [],
    activeConversation: "",
    busy: false,
    authMode: "signin",
    sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === "true",
    coreFrame: 0,
    coreParticles: [],
    coreAngle: 0,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const parseJSON = (raw, fallback = null) => {
    try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
  };
  const currentUser = () => parseJSON(localStorage.getItem(AUTH_KEYS.user), null);
  const currentToken = () => localStorage.getItem(AUTH_KEYS.access) || "";
  const currentConversationId = (mode = state.mode) => localStorage.getItem(conversationKeys[mode]) || "";
  const setConversationId = (id, mode = state.mode) => {
    if (id) localStorage.setItem(conversationKeys[mode], id);
    else localStorage.removeItem(conversationKeys[mode]);
    if (mode === state.mode) state.activeConversation = id || "";
  };

  const icon = (name) => {
    const paths = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3v-4h.04A1.7 1.7 0 0 0 4.6 8.92a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.83-2.83.06.06a1.7 1.7 0 0 0 1.87.34A1.7 1.7 0 0 0 10 3V3h4v.04a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.87A1.7 1.7 0 0 0 21 10v4a1.7 1.7 0 0 0-1.6 1z"/>',
      chevron: '<path d="m14 6-6 6 6 6"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      send: '<path d="M5 12h14M14 7l5 5-5 5"/>',
      dots: '<circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"/>',
      paperclip: '<path d="M9 12.5 15.5 6a3 3 0 1 1 4.24 4.24L11.5 18.5a5 5 0 0 1-7.07-7.07L13 2.86"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
  };

  function persistSession(session, user) {
    if (!session?.access_token) throw new Error("Authentication returned no access token.");
    localStorage.setItem(AUTH_KEYS.access, session.access_token);
    if (session.refresh_token) localStorage.setItem(AUTH_KEYS.refresh, session.refresh_token);
    localStorage.setItem(AUTH_KEYS.user, JSON.stringify(user || session.user || {}));
    const expiresAt = session.expires_at
      ? Number(session.expires_at) * 1000
      : Date.now() + Number(session.expires_in || 3600) * 1000;
    localStorage.setItem(AUTH_KEYS.expires, String(expiresAt));
  }

  function clearSession() {
    Object.values(AUTH_KEYS).forEach((key) => localStorage.removeItem(key));
    state.conversations = [];
    state.activeConversation = "";
  }

  async function authRequest(action, email = "", password = "", extras = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email, password, ...extras }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Authentication failed (${response.status}).`);
      return data;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Authentication timed out.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function refreshAccessToken() {
    const refreshToken = localStorage.getItem(AUTH_KEYS.refresh) || "";
    if (!refreshToken) throw new Error("Your RAVIN session expired. Sign in again.");
    const data = await authRequest("refresh", "", "", { refresh_token: refreshToken });
    persistSession(data.session, data.user);
    return data.session.access_token;
  }

  async function ensureToken(force = false) {
    let token = currentToken();
    const expiresAt = Number(localStorage.getItem(AUTH_KEYS.expires) || 0);
    if (!token) throw new Error("Sign in to RAVIN first.");
    if (force || (expiresAt && expiresAt < Date.now() + 60000)) token = await refreshAccessToken();
    return token;
  }

  async function backend(path, options = {}, retry = true) {
    let token = await ensureToken(false);
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    let response = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
    if (response.status === 401 && retry) {
      token = await ensureToken(true);
      headers.set("Authorization", `Bearer ${token}`);
      response = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) throw new Error(data?.error || `RAVIN request failed (${response.status}).`);
    return data;
  }

  async function supabase(path) {
    const token = await ensureToken(false);
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await response.text();
    let data = [];
    try { data = text ? JSON.parse(text) : []; } catch { data = []; }
    if (!response.ok) throw new Error(data?.message || data?.error || `Supabase request failed (${response.status}).`);
    return data;
  }

  function buildShell() {
    document.body.insertAdjacentHTML("beforeend", `
      <div id="ravinApp" class="${state.sidebarCollapsed ? "sidebar-collapsed" : ""}">
        <aside class="ravin-sidebar" aria-label="RAVIN navigation">
          <div class="ravin-brand">
            <span class="ravin-brand-mark" aria-hidden="true"></span>
            <span class="ravin-brand-copy"><strong>RAVIN</strong><small>RESONANT ASSIST</small></span>
          </div>
          <button class="ravin-sidebar-action primary" id="newChatBtn">${icon("plus")}<span class="ravin-action-label">New chat</span></button>
          <div class="ravin-search-wrap">${icon("search")}<input class="ravin-search" id="historySearch" placeholder="Search chats" autocomplete="off" /></div>
          <div class="ravin-section-label">Chats</div>
          <div class="ravin-history" id="historyList"></div>
          <div class="ravin-sidebar-bottom">
            <button class="ravin-account-row" id="accountBtn">
              <span class="ravin-avatar" id="avatar">?</span>
              <span class="ravin-account-copy"><strong id="accountName">Guest</strong><small id="accountSub">Sign in to RAVIN</small></span>
              <span class="ravin-collapse" id="collapseBtn" aria-label="Collapse sidebar">${icon("chevron")}</span>
            </button>
          </div>
        </aside>

        <main class="ravin-main">
          <header class="ravin-header">
            <div class="ravin-header-left">
              <button class="ravin-icon-button ravin-mobile-menu" id="mobileMenuBtn" aria-label="Open sidebar">${icon("menu")}</button>
              <div class="ravin-header-title"><strong id="headerConversationTitle">New conversation</strong><small id="headerModeLabel">RAVIN · CONVERSATION</small></div>
              <div class="ravin-mode-switch" role="tablist" aria-label="RAVIN mode">
                <button id="conversationModeBtn" role="tab">Conversation</button>
                <button id="workModeBtn" role="tab">Work</button>
              </div>
            </div>
            <div class="ravin-header-right">
              <span class="ravin-status-pill"><i></i><span id="systemStatus">READY</span></span>
              <button class="ravin-icon-button" id="settingsBtn" aria-label="Settings">${icon("settings")}</button>
            </div>
          </header>

          <div class="ravin-workspace" id="workspace">
            <section class="ravin-chat-column">
              <div class="ravin-messages" id="messageScroller">
                <div class="ravin-messages-inner" id="messages"></div>
              </div>
              <div class="ravin-composer-zone">
                <form class="ravin-composer" id="composer">
                  <div class="ravin-composer-row">
                    <button type="button" class="ravin-add" id="addBtn" aria-label="Add context">${icon("paperclip")}</button>
                    <input id="messageInput" placeholder="Ask RAVIN anything..." autocomplete="off" />
                    <button class="ravin-send" id="sendBtn" type="submit" aria-label="Send">${icon("send")}</button>
                  </div>
                  <div class="ravin-composer-meta"><span id="composerMode">CONVERSATION · GRANITE</span><span id="composerStatus">READY</span></div>
                </form>
              </div>
            </section>

            <aside class="ravin-context" id="workContext">
              <h3>Work context</h3><p>RAVIN exposes more workspace context here when Work mode is active.</p>
              <div class="ravin-context-card"><small>MODEL</small><strong>Gemma 4 26B A4B</strong><span>Reasoning-focused model for longer and more complex work.</span></div>
              <div class="ravin-context-card"><small>TOOLS</small><strong>Ready</strong><span>Files, planning, code and future RAVIN tools will surface here.</span></div>
              <div class="ravin-context-card"><small>SESSION</small><strong id="contextSession">No active thread</strong><span id="contextMessageCount">Start a Work conversation to create context.</span></div>
            </aside>
          </div>
        </main>
      </div>
    `);
  }

  function renderUser() {
    const user = currentUser();
    const avatar = $("#avatar");
    const name = $("#accountName");
    const sub = $("#accountSub");
    if (!user?.id) {
      avatar.textContent = "?";
      name.textContent = "Guest";
      sub.textContent = "Sign in to RAVIN";
      return;
    }
    const label = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "RAVIN user";
    avatar.textContent = label.slice(0, 1).toUpperCase();
    name.textContent = label;
    sub.textContent = user.email || "Signed in";
  }

  function relativeLabel(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const then = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((start - then) / 86400000);
    if (diff <= 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return "Previous 7 days";
    return "Earlier";
  }

  function renderHistory(filter = "") {
    const root = $("#historyList");
    if (!root) return;
    root.replaceChildren();
    const query = filter.trim().toLowerCase();
    const rows = state.conversations.filter((item) => !query || String(item.title || "Untitled").toLowerCase().includes(query));
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "ravin-empty-history";
      empty.textContent = currentUser()?.id ? "No conversations here yet." : "Sign in to load your conversations.";
      root.appendChild(empty);
      return;
    }
    let lastGroup = "";
    for (const row of rows) {
      const group = relativeLabel(row.created_at);
      if (group !== lastGroup) {
        const label = document.createElement("div");
        label.className = "ravin-section-label";
        label.textContent = group;
        root.appendChild(label);
        lastGroup = group;
      }
      const button = document.createElement("button");
      const mode = String(row?.metadata?.mode || "conversation") === "work" ? "work" : "conversation";
      button.className = `ravin-history-item ${row.id === state.activeConversation ? "active" : ""}`;
      button.dataset.mode = mode;
      button.innerHTML = `<span class="ravin-history-copy"><span class="ravin-history-title"></span><span class="ravin-history-meta">${mode === "work" ? "WORK" : "CONVERSATION"}</span></span><i class="ravin-mode-dot"></i>`;
      $(".ravin-history-title", button).textContent = row.title || "Untitled";
      button.addEventListener("click", () => openConversation(row));
      root.appendChild(button);
    }
  }

  function emptyState() {
    const root = $("#messages");
    root.innerHTML = `
      <div class="ravin-empty">
        <div class="ravin-core-wrap"><canvas id="ravinCoreCanvas" width="292" height="292"></canvas><i class="ravin-core-center"></i></div>
        <h1>${state.mode === "work" ? "What should we work on?" : "What's on your mind?"}</h1>
        <p>${state.mode === "work" ? "Use Work for reasoning, planning, code, files, and heavier tasks." : "Fast, focused conversation with RAVIN."}</p>
        <span class="ravin-mode-copy">${state.mode === "work" ? "WORK · GEMMA" : "CONVERSATION · GRANITE"}</span>
      </div>`;
    startCore();
  }

  function renderMessages(rows = []) {
    cancelAnimationFrame(state.coreFrame);
    const root = $("#messages");
    root.replaceChildren();
    const visible = rows.filter((row) => row.role === "user" || row.role === "assistant");
    if (!visible.length) { emptyState(); updateContext(0); return; }
    for (const row of visible) appendMessage(row.role, row.content, row.created_at, false);
    updateContext(visible.length);
    requestAnimationFrame(() => { const scroller = $("#messageScroller"); scroller.scrollTop = scroller.scrollHeight; });
  }

  function appendMessage(role, text, createdAt = new Date(), animate = true) {
    const root = $("#messages");
    if ($(".ravin-empty", root)) root.replaceChildren();
    const article = document.createElement("article");
    article.className = `ravin-message ${role} ${animate ? "" : "no-animate"}`;
    const time = new Date(createdAt);
    article.innerHTML = `<div class="ravin-message-role">${role === "assistant" ? "RAVIN" : role === "user" ? "YOU" : "SYSTEM"}</div><div class="ravin-message-body"></div>`;
    $(".ravin-message-body", article).textContent = String(text ?? "");
    const stamp = document.createElement("span");
    stamp.className = "ravin-message-time";
    stamp.textContent = time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $(".ravin-message-body", article).appendChild(stamp);
    root.appendChild(article);
    const scroller = $("#messageScroller");
    requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
    updateContext($$(".ravin-message", root).length);
    return article;
  }

  function showThinking() {
    const root = $("#messages");
    const row = document.createElement("div");
    row.className = "ravin-thinking";
    row.id = "thinkingRow";
    row.innerHTML = `<span>RAVIN is thinking</span><span class="ravin-thinking-dots"><i></i><i></i><i></i></span>`;
    root.appendChild(row);
    const scroller = $("#messageScroller");
    requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  }

  function updateContext(count = 0) {
    const session = $("#contextSession");
    const messageCount = $("#contextMessageCount");
    if (session) session.textContent = state.activeConversation ? "Active thread" : "No active thread";
    if (messageCount) messageCount.textContent = count ? `${count} messages in context.` : "Start a Work conversation to create context.";
  }

  function setBusy(value) {
    state.busy = value;
    $("#messageInput").disabled = value;
    $("#sendBtn").disabled = value;
    $("#composerStatus").textContent = value ? "THINKING…" : "READY";
    $("#systemStatus").textContent = value ? "THINKING" : "READY";
  }

  function syncModeUI() {
    localStorage.setItem(MODE_KEY, state.mode);
    $("#conversationModeBtn").classList.toggle("active", state.mode === "conversation");
    $("#workModeBtn").classList.toggle("active", state.mode === "work");
    $("#workspace").classList.toggle("work-mode", state.mode === "work");
    $("#headerModeLabel").textContent = `RAVIN · ${state.mode.toUpperCase()}`;
    $("#composerMode").textContent = state.mode === "work" ? "WORK · GEMMA" : "CONVERSATION · GRANITE";
    $("#messageInput").placeholder = state.mode === "work" ? "Tell RAVIN what to work on..." : "Ask RAVIN anything...";
  }

  async function loadConversations() {
    if (!currentUser()?.id) { state.conversations = []; renderHistory(); return; }
    try {
      const rows = await supabase(`/rest/v1/conversations?user_id=eq.${encodeURIComponent(currentUser().id)}&select=id,title,metadata,created_at&order=created_at.desc&limit=100`);
      state.conversations = rows || [];
      renderHistory($("#historySearch")?.value || "");
    } catch (error) {
      console.error("[RAVIN history list]", error);
      state.conversations = [];
      renderHistory();
    }
  }

  async function resolveConversation(mode = state.mode) {
    const stored = currentConversationId(mode);
    if (stored) {
      const existing = state.conversations.find((row) => row.id === stored);
      if (existing) return existing;
    }
    const found = state.conversations.find((row) => String(row?.metadata?.mode || "conversation") === mode)
      || (mode === "conversation" ? state.conversations.find((row) => !row?.metadata?.mode) : null);
    if (found) setConversationId(found.id, mode);
    return found || null;
  }

  async function loadMessagesFor(row) {
    if (!row?.id || !currentUser()?.id) { emptyState(); return; }
    $("#headerConversationTitle").textContent = row.title || "Untitled conversation";
    try {
      const messages = await supabase(`/rest/v1/messages?conversation_id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(currentUser().id)}&select=id,role,content,created_at&order=created_at.asc&limit=250`);
      renderMessages(messages || []);
    } catch (error) {
      console.error("[RAVIN messages]", error);
      renderMessages([]);
      appendMessage("error", `Couldn't load this conversation: ${error.message || error}`);
    }
  }

  async function openConversation(row) {
    if (state.busy) return;
    const rowMode = String(row?.metadata?.mode || "conversation") === "work" ? "work" : "conversation";
    state.mode = rowMode;
    setConversationId(row.id, rowMode);
    syncModeUI();
    renderHistory($("#historySearch")?.value || "");
    await loadMessagesFor(row);
    if (innerWidth <= 700) $("#ravinApp").classList.remove("mobile-sidebar-open");
  }

  async function loadCurrentMode() {
    syncModeUI();
    if (!currentUser()?.id) { state.activeConversation = ""; $("#headerConversationTitle").textContent = "New conversation"; emptyState(); return; }
    if (!state.conversations.length) await loadConversations();
    const row = await resolveConversation(state.mode);
    if (row) {
      state.activeConversation = row.id;
      await loadMessagesFor(row);
    } else {
      state.activeConversation = "";
      $("#headerConversationTitle").textContent = "New conversation";
      emptyState();
    }
    renderHistory($("#historySearch")?.value || "");
  }

  async function switchMode(mode) {
    if (state.busy || state.mode === mode) return;
    state.mode = mode;
    state.activeConversation = currentConversationId(mode);
    await loadCurrentMode();
  }

  function newChat() {
    if (state.busy) return;
    setConversationId("", state.mode);
    state.activeConversation = "";
    $("#headerConversationTitle").textContent = "New conversation";
    emptyState();
    renderHistory($("#historySearch")?.value || "");
    $("#messageInput").focus();
    if (innerWidth <= 700) $("#ravinApp").classList.remove("mobile-sidebar-open");
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.busy) return;
    const input = $("#messageInput");
    const text = input.value.trim();
    if (!text) return;
    if (!currentUser()?.id || !currentToken()) { openAuth(); return; }

    input.value = "";
    appendMessage("user", text);
    showThinking();
    setBusy(true);
    try {
      const data = await backend("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, mode: state.mode, conversation_id: state.activeConversation || null }),
      });
      $("#thinkingRow")?.remove();
      if (data?.conversation_id) {
        const wasNew = !state.activeConversation;
        setConversationId(data.conversation_id, state.mode);
        if (wasNew) $("#headerConversationTitle").textContent = text.slice(0, 80);
      }
      appendMessage("assistant", data?.reply || "RAVIN returned no visible response.");
      await loadConversations();
    } catch (error) {
      $("#thinkingRow")?.remove();
      appendMessage("error", `RAVIN error: ${error.message || error}`);
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function buildPopover(anchor, contents) {
    $(".ravin-popover")?.remove();
    const pop = document.createElement("div");
    pop.className = "ravin-popover";
    pop.innerHTML = contents;
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const width = 230;
    pop.style.left = `${Math.min(innerWidth - width - 10, Math.max(10, rect.right - width))}px`;
    pop.style.top = `${Math.min(innerHeight - pop.offsetHeight - 10, rect.bottom + 7)}px`;
    const close = (event) => {
      if (!pop.contains(event.target) && event.target !== anchor) { pop.remove(); document.removeEventListener("pointerdown", close, true); }
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true));
    return pop;
  }

  function settingsPopover() {
    const pop = buildPopover($("#settingsBtn"), `
      <button data-action="new">New chat</button>
      <button data-action="collapse">${state.sidebarCollapsed ? "Expand" : "Collapse"} sidebar</button>
      <hr />
      <button data-action="logout">Sign out</button>
    `);
    pop.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action === "new") newChat();
      if (action === "collapse") toggleSidebar();
      if (action === "logout") signOut();
      pop.remove();
    });
  }

  function accountPopover() {
    if (!currentUser()?.id) { openAuth(); return; }
    const pop = buildPopover($("#accountBtn"), `
      <button data-action="new">New chat</button>
      <button data-action="settings">RAVIN settings</button>
      <hr />
      <button data-action="logout">Sign out</button>
    `);
    pop.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action === "new") newChat();
      if (action === "settings") settingsPopover();
      if (action === "logout") signOut();
      pop.remove();
    });
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem(SIDEBAR_KEY, String(state.sidebarCollapsed));
    $("#ravinApp").classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  }

  function openAuth(mode = "signin") {
    state.authMode = mode;
    $("#ravinAuthBackdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.id = "ravinAuthBackdrop";
    backdrop.className = "ravin-auth-backdrop";
    backdrop.innerHTML = `
      <section class="ravin-auth-card" role="dialog" aria-modal="true" aria-label="RAVIN authentication">
        <div class="ravin-auth-brand"><span class="ravin-brand-mark"></span><span class="ravin-brand-copy"><strong>RAVIN</strong><small>RESONANT ASSIST</small></span></div>
        <h2>${mode === "signin" ? "Welcome back" : "Create your account"}</h2>
        <p>${mode === "signin" ? "Sign in to continue your RAVIN conversations." : "Create an account to keep conversations and memory connected."}</p>
        <form id="authForm">
          <input id="authEmail" type="email" placeholder="Email" autocomplete="email" required />
          <input id="authPassword" type="password" placeholder="Password" autocomplete="${mode === "signin" ? "current-password" : "new-password"}" minlength="8" required />
          <button class="ravin-auth-submit" id="authSubmit" type="submit">${mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}</button>
        </form>
        <div class="ravin-auth-error" id="authError"></div>
        <button class="ravin-auth-switch" id="authSwitch">${mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}</button>
      </section>`;
    document.body.appendChild(backdrop);
    $("#authSwitch").addEventListener("click", () => openAuth(mode === "signin" ? "signup" : "signin"));
    $("#authForm").addEventListener("submit", handleAuth);
    $("#authEmail").focus();
  }

  async function handleAuth(event) {
    event.preventDefault();
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    const submit = $("#authSubmit");
    const error = $("#authError");
    submit.disabled = true;
    submit.textContent = "PLEASE WAIT…";
    error.textContent = "";
    try {
      const data = await authRequest(state.authMode, email, password, { redirect_to: location.href.split("#")[0] });
      if (data.session?.access_token) {
        persistSession(data.session, data.user);
        $("#ravinAuthBackdrop")?.remove();
        renderUser();
        await loadConversations();
        await loadCurrentMode();
      } else {
        error.textContent = data?.message || "Check your email to finish creating your account.";
      }
    } catch (err) {
      error.textContent = err.message || String(err);
    } finally {
      submit.disabled = false;
      submit.textContent = state.authMode === "signin" ? "SIGN IN" : "CREATE ACCOUNT";
    }
  }

  function signOut() {
    clearSession();
    renderUser();
    renderHistory();
    newChat();
    openAuth();
  }

  function startCore() {
    cancelAnimationFrame(state.coreFrame);
    const canvas = $("#ravinCoreCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = 292;
    const center = size / 2;
    const count = 190;
    if (!state.coreParticles.length) {
      state.coreParticles = Array.from({ length: count }, (_, i) => {
        const phi = Math.acos(1 - 2 * (i + .5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        return { x: Math.cos(theta) * Math.sin(phi), y: Math.cos(phi), z: Math.sin(theta) * Math.sin(phi), seed: Math.random() };
      });
    }
    const draw = () => {
      state.coreAngle += state.busy ? .012 : .0045;
      ctx.clearRect(0, 0, size, size);
      const ca = Math.cos(state.coreAngle), sa = Math.sin(state.coreAngle);
      const points = state.coreParticles.map((p) => {
        const x = p.x * ca - p.z * sa;
        const z = p.x * sa + p.z * ca;
        const perspective = .82 + (z + 1) * .07;
        return { x: center + x * 105 * perspective, y: center + p.y * 105 * perspective, z, seed: p.seed };
      }).sort((a,b) => a.z - b.z);
      for (const p of points) {
        const alpha = .18 + (p.z + 1) * .3;
        const r = p.z > .3 ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245,245,246,${alpha})`;
        ctx.fill();
      }
      state.coreFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  function bindEvents() {
    $("#newChatBtn").addEventListener("click", newChat);
    $("#conversationModeBtn").addEventListener("click", () => switchMode("conversation"));
    $("#workModeBtn").addEventListener("click", () => switchMode("work"));
    $("#composer").addEventListener("submit", sendMessage);
    $("#historySearch").addEventListener("input", (event) => renderHistory(event.target.value));
    $("#collapseBtn").addEventListener("click", (event) => { event.stopPropagation(); toggleSidebar(); });
    $("#accountBtn").addEventListener("click", accountPopover);
    $("#settingsBtn").addEventListener("click", settingsPopover);
    $("#mobileMenuBtn").addEventListener("click", () => $("#ravinApp").classList.toggle("mobile-sidebar-open"));
    $("#addBtn").addEventListener("click", () => {
      const pop = buildPopover($("#addBtn"), `<button>File upload — coming with Work tools</button><button>Image — coming with Work tools</button>`);
      pop.style.top = `${Math.max(10, $("#addBtn").getBoundingClientRect().top - pop.offsetHeight - 8)}px`;
    });
    addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#historySearch")?.focus(); }
      if (event.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) { event.preventDefault(); $("#messageInput")?.focus(); }
      if (event.key === "Escape") $("#ravinApp").classList.remove("mobile-sidebar-open");
    });
  }

  async function initializeSession() {
    renderUser();
    syncModeUI();
    if (!currentToken() || !currentUser()?.id) {
      renderHistory();
      emptyState();
      openAuth();
      return;
    }
    try {
      await ensureToken(false);
      await loadConversations();
      await loadCurrentMode();
    } catch (error) {
      console.warn("[RAVIN session]", error);
      clearSession();
      renderUser();
      renderHistory();
      emptyState();
      openAuth();
    }
  }

  function init() {
    buildShell();
    bindEvents();
    initializeSession();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
