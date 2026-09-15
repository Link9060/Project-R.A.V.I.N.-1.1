(() => {
  'use strict';

  const CONFIG = window.RAVIN_CONFIG || {};
  const SUPABASE_URL = String(CONFIG.supabaseUrl || '').replace(/\/$/, '');
  const SUPABASE_KEY = CONFIG.supabaseAnonKey || '';
  const AUTH_URL = CONFIG.authUrl || `${SUPABASE_URL}/functions/v1/ravin-auth`;
  const AUTH_KEYS = {
    access: 'ravin_access_token',
    refresh: 'ravin_refresh_token',
    user: 'ravin_user',
    expires: 'ravin_token_expires_at',
  };
  const MODE_KEY = 'ravin_mode';
  const SIDEBAR_KEY = 'ravin_sidebar_collapsed';
  const THEME_KEY = 'ravin_theme';
  const conversationKeys = {
    conversation: 'ravin_conversation_id_conversation',
    work: 'ravin_conversation_id_work',
  };

  const state = {
    mode: localStorage.getItem(MODE_KEY) === 'work' ? 'work' : 'conversation',
    conversations: [],
    activeConversation: '',
    authMode: 'signin',
    sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === 'true',
    historyRefreshTimer: 0,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const parseJSON = (raw, fallback = null) => {
    try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
  };
  const currentUser = () => parseJSON(localStorage.getItem(AUTH_KEYS.user), null);
  const currentToken = () => localStorage.getItem(AUTH_KEYS.access) || '';
  const currentConversationId = (mode = state.mode) => localStorage.getItem(conversationKeys[mode]) || '';
  const isStreaming = () => $('#sendBtn')?.classList.contains('ravin-stop') === true;

  function icon(name) {
    const paths = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3v-4h.04A1.7 1.7 0 0 0 4.6 8.92a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.83-2.83.06.06a1.7 1.7 0 0 0 1.87.34A1.7 1.7 0 0 0 10 3V3h4v.04a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.87A1.7 1.7 0 0 0 21 10v4a1.7 1.7 0 0 0-1.6 1z"/>',
      chevron: '<path d="m14 6-6 6 6 6"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      send: '<path d="M5 12h14M14 7l5 5-5 5"/>',
      paperclip: '<path d="M9 12.5 15.5 6a3 3 0 1 1 4.24 4.24L11.5 18.5a5 5 0 0 1-7.07-7.07L13 2.86"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
      sun: '<circle cx="12" cy="12" r="3.4"/><path d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5 17 7M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5"/>',
      moon: '<path d="M20.2 15.2A8 8 0 0 1 8.8 3.8 8.1 8.1 0 1 0 20.2 15.2Z"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  function setConversationId(id, mode = state.mode) {
    if (id) localStorage.setItem(conversationKeys[mode], id);
    else localStorage.removeItem(conversationKeys[mode]);
    if (mode === state.mode) state.activeConversation = id || '';
  }

  function persistSession(session, user) {
    if (!session?.access_token) throw new Error('Authentication returned no access token.');
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
    Object.values(conversationKeys).forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem('ravin_conversation_id');
    state.conversations = [];
    state.activeConversation = '';
  }

  async function authRequest(action, email = '', password = '', extras = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action, email, password, ...extras }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Authentication failed (${response.status}).`);
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Authentication timed out. Check your connection and try again.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function refreshAccessToken() {
    const refreshToken = localStorage.getItem(AUTH_KEYS.refresh) || '';
    if (!refreshToken) throw new Error('Your RAVIN session expired. Sign in again.');
    const data = await authRequest('refresh', '', '', { refresh_token: refreshToken });
    persistSession(data.session, data.user);
    return data.session.access_token;
  }

  async function ensureToken(force = false) {
    let token = currentToken();
    const expiresAt = Number(localStorage.getItem(AUTH_KEYS.expires) || 0);
    if (!token) throw new Error('Sign in to RAVIN first.');
    if (force || (expiresAt && expiresAt < Date.now() + 60_000)) token = await refreshAccessToken();
    return token;
  }

  async function supabase(pathname, { method = 'GET', body, prefer = '' } = {}, retry = true) {
    let token = await ensureToken(false);
    const request = async () => {
      const headers = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (prefer) headers.Prefer = prefer;
      return fetch(`${SUPABASE_URL}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    };

    let response = await request();
    if (response.status === 401 && retry) {
      token = await ensureToken(true);
      response = await request();
    }
    if (response.status === 204) return null;
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(data?.message || data?.error || `RAVIN data request failed (${response.status}).`);
    return data;
  }

  function buildShell() {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="ravinApp" class="${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
        <aside class="ravin-sidebar" aria-label="RAVIN navigation">
          <div class="ravin-brand">
            <span class="ravin-brand-mark" aria-hidden="true"></span>
            <span class="ravin-brand-copy"><strong>RAVIN</strong><small>RESONANT ASSIST</small></span>
          </div>
          <button class="ravin-sidebar-action primary" id="newChatBtn" type="button">${icon('plus')}<span class="ravin-action-label">New chat</span></button>
          <div class="ravin-search-wrap">${icon('search')}<label class="ravin-sr-only" for="historySearch">Search chats</label><input class="ravin-search" id="historySearch" placeholder="Search chats" autocomplete="off" /></div>
          <div class="ravin-section-label">Chats</div>
          <div class="ravin-history" id="historyList" aria-live="polite"></div>
          <div class="ravin-sidebar-bottom">
            <button class="ravin-account-row" id="accountBtn" type="button" aria-haspopup="menu">
              <span class="ravin-avatar" id="avatar">?</span>
              <span class="ravin-account-copy"><strong id="accountName">Guest</strong><small id="accountSub">Sign in to RAVIN</small></span>
              <span class="ravin-collapse" id="collapseBtn" role="button" tabindex="0" aria-label="Collapse sidebar">${icon('chevron')}</span>
            </button>
          </div>
        </aside>

        <main class="ravin-main">
          <header class="ravin-header">
            <div class="ravin-header-left">
              <button class="ravin-icon-button ravin-mobile-menu" id="mobileMenuBtn" type="button" aria-label="Open sidebar">${icon('menu')}</button>
              <div class="ravin-header-title"><strong id="headerConversationTitle">New conversation</strong><small id="headerModeLabel">RAVIN · CONVERSATION</small></div>
              <div class="ravin-mode-switch" role="tablist" aria-label="RAVIN mode">
                <button id="conversationModeBtn" type="button" role="tab">Conversation</button>
                <button id="workModeBtn" type="button" role="tab">Work</button>
              </div>
            </div>
            <div class="ravin-header-right">
              <span class="ravin-status-pill" aria-live="polite"><i></i><span id="systemStatus">READY</span></span>
              <button class="ravin-icon-button ravin-theme-button" id="themeBtn" type="button" aria-label="Toggle appearance">${icon('moon')}</button>
              <button class="ravin-icon-button" id="settingsBtn" type="button" aria-label="RAVIN settings" aria-haspopup="menu">${icon('settings')}</button>
            </div>
          </header>

          <div class="ravin-workspace" id="workspace">
            <section class="ravin-chat-column" aria-label="Conversation">
              <div class="ravin-messages" id="messageScroller">
                <div class="ravin-messages-inner" id="messages" aria-live="polite" aria-relevant="additions"></div>
              </div>
              <div class="ravin-composer-zone">
                <form class="ravin-composer" id="composer">
                  <div class="ravin-composer-row">
                    <button type="button" class="ravin-add" id="addBtn" aria-label="Attach file">${icon('paperclip')}</button>
                    <label class="ravin-sr-only" for="messageInput">Message RAVIN</label>
                    <textarea id="messageInput" rows="1" maxlength="24000" placeholder="Ask RAVIN anything..." autocomplete="off" enterkeyhint="send"></textarea>
                    <button class="ravin-send" id="sendBtn" type="submit" aria-label="Send">${icon('send')}</button>
                  </div>
                  <div class="ravin-composer-meta"><span id="composerMode">CONVERSATION · GRANITE</span><span id="composerStatus">READY</span></div>
                </form>
                <p class="ravin-composer-hint">Enter to send · Shift+Enter for a new line</p>
              </div>
            </section>

            <aside class="ravin-context" id="workContext" aria-label="Work context">
              <h3>Work context</h3><p>See the model, tools, and active session context RAVIN is using.</p>
              <div class="ravin-context-card"><small>MODEL</small><strong>Gemma 4 26B A4B</strong><span>Reasoning-focused model for longer and more complex work.</span></div>
              <div class="ravin-context-card"><small>TOOLS</small><strong>Available</strong><span>Files, planning, code, memory, and supported RAVIN tools surface here.</span></div>
              <div class="ravin-context-card"><small>SESSION</small><strong id="contextSession">No active thread</strong><span id="contextMessageCount">Start a Work conversation to create context.</span></div>
            </aside>
          </div>
        </main>
      </div>
      <div class="ravin-live-region ravin-sr-only" id="ravinLiveRegion" aria-live="assertive" aria-atomic="true"></div>
    `);
  }

  function notify(message, duration = 2800) {
    const live = $('#ravinLiveRegion');
    if (live) live.textContent = String(message || '');
    $('.ravin-product-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'ravin-product-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = String(message || '');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  function renderUser() {
    const user = currentUser();
    const avatar = $('#avatar');
    const name = $('#accountName');
    const sub = $('#accountSub');
    if (!user?.id) {
      avatar.textContent = '?';
      name.textContent = 'Guest';
      sub.textContent = 'Sign in to RAVIN';
      return;
    }
    const label = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'RAVIN user';
    avatar.textContent = label.slice(0, 1).toUpperCase();
    name.textContent = label;
    sub.textContent = user.email || 'Signed in';
  }

  function relativeLabel(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const then = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((start - then) / 86_400_000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return 'Previous 7 days';
    return 'Earlier';
  }

  function syncActiveConversation() {
    state.activeConversation = currentConversationId(state.mode);
  }

  function renderHistory(filter = '') {
    const root = $('#historyList');
    if (!root) return;
    root.replaceChildren();
    const query = filter.trim().toLowerCase();
    const rows = state.conversations.filter((item) => !query || String(item.title || 'Untitled').toLowerCase().includes(query));
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'ravin-empty-history';
      empty.textContent = currentUser()?.id
        ? (query ? 'No chats match your search.' : 'No conversations here yet.')
        : 'Sign in to load your conversations.';
      root.appendChild(empty);
      return;
    }

    let lastGroup = '';
    for (const row of rows) {
      const group = relativeLabel(row.created_at);
      if (group !== lastGroup) {
        const label = document.createElement('div');
        label.className = 'ravin-section-label';
        label.textContent = group;
        root.appendChild(label);
        lastGroup = group;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'ravin-history-row';
      const button = document.createElement('button');
      const mode = String(row?.metadata?.mode || 'conversation') === 'work' ? 'work' : 'conversation';
      button.type = 'button';
      button.className = `ravin-history-item ${row.id === state.activeConversation ? 'active' : ''}`;
      button.dataset.mode = mode;
      button.dataset.conversationId = row.id;
      button.setAttribute('aria-current', row.id === state.activeConversation ? 'page' : 'false');
      button.innerHTML = `<span class="ravin-history-copy"><span class="ravin-history-title"></span><span class="ravin-history-meta">${mode === 'work' ? 'WORK' : 'CONVERSATION'}</span></span><i class="ravin-mode-dot"></i>`;
      $('.ravin-history-title', button).textContent = row.title || 'Untitled';
      button.title = row.title || 'Untitled conversation';
      button.addEventListener('click', () => openConversation(row));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ravin-history-delete';
      remove.setAttribute('aria-label', `Delete ${row.title || 'conversation'}`);
      remove.title = 'Delete chat';
      remove.innerHTML = icon('trash');
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        openDeleteDialog(row);
      });
      wrapper.append(button, remove);
      root.appendChild(wrapper);
    }
  }

  function emptyState() {
    const root = $('#messages');
    if (!root) return;
    root.innerHTML = `
      <div class="ravin-empty">
        <div class="ravin-core-wrap" aria-hidden="true"><i class="ravin-core-center"></i></div>
        <h1>${state.mode === 'work' ? 'What should we work on?' : "What's on your mind?"}</h1>
        <p>${state.mode === 'work' ? 'Use Work for reasoning, planning, code, files, and heavier tasks.' : 'Fast, focused conversation with RAVIN.'}</p>
        <span class="ravin-mode-copy">${state.mode === 'work' ? 'WORK · GEMMA' : 'CONVERSATION · GRANITE'}</span>
      </div>`;
    updateContext(0);
  }

  function appendMessage(role, text, createdAt = new Date(), animate = false) {
    const root = $('#messages');
    if (!root) return null;
    $('.ravin-empty', root)?.remove();
    const article = document.createElement('article');
    article.className = `ravin-message ${role}${animate ? '' : ' no-animate'}`;
    const time = new Date(createdAt);
    article.innerHTML = `<div class="ravin-message-role">${role === 'assistant' ? 'RAVIN' : role === 'user' ? 'YOU' : 'SYSTEM'}</div><div class="ravin-message-body"></div>`;
    const body = $('.ravin-message-body', article);
    body.textContent = String(text ?? '');
    const stamp = document.createElement('span');
    stamp.className = 'ravin-message-time';
    stamp.textContent = time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    body.appendChild(stamp);
    root.appendChild(article);
    return article;
  }

  function renderMessages(rows = []) {
    const root = $('#messages');
    root.replaceChildren();
    const visible = rows.filter((row) => row.role === 'user' || row.role === 'assistant');
    if (!visible.length) {
      emptyState();
      return;
    }
    visible.forEach((row) => appendMessage(row.role, row.content, row.created_at, false));
    updateContext(visible.length);
    requestAnimationFrame(() => {
      const scroller = $('#messageScroller');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  function updateContext(count = 0) {
    const session = $('#contextSession');
    const messageCount = $('#contextMessageCount');
    if (session) session.textContent = state.activeConversation ? 'Active thread' : 'No active thread';
    if (messageCount) messageCount.textContent = count ? `${count} messages in context.` : 'Start a Work conversation to create context.';
  }

  function syncModeUI() {
    localStorage.setItem(MODE_KEY, state.mode);
    const conversation = $('#conversationModeBtn');
    const work = $('#workModeBtn');
    conversation.classList.toggle('active', state.mode === 'conversation');
    work.classList.toggle('active', state.mode === 'work');
    conversation.setAttribute('aria-selected', String(state.mode === 'conversation'));
    work.setAttribute('aria-selected', String(state.mode === 'work'));
    conversation.tabIndex = state.mode === 'conversation' ? 0 : -1;
    work.tabIndex = state.mode === 'work' ? 0 : -1;
    $('#workspace').classList.toggle('work-mode', state.mode === 'work');
    $('#headerModeLabel').textContent = `RAVIN · ${state.mode.toUpperCase()}`;
    $('#composerMode').textContent = state.mode === 'work' ? 'WORK · GEMMA' : 'CONVERSATION · GRANITE';
    $('#messageInput').placeholder = state.mode === 'work' ? 'Tell RAVIN what to work on...' : 'Ask RAVIN anything...';
  }

  async function loadConversations() {
    if (!currentUser()?.id) {
      state.conversations = [];
      renderHistory();
      return;
    }
    try {
      const rows = await supabase(`/rest/v1/conversations?user_id=eq.${encodeURIComponent(currentUser().id)}&select=id,title,metadata,created_at&order=created_at.desc&limit=100`);
      state.conversations = Array.isArray(rows) ? rows : [];
      syncActiveConversation();
      renderHistory($('#historySearch')?.value || '');
    } catch (error) {
      console.error('[RAVIN history]', error);
      notify('RAVIN could not refresh your chat history.');
    }
  }

  async function resolveConversation(mode = state.mode) {
    const stored = currentConversationId(mode);
    if (stored) {
      const existing = state.conversations.find((row) => row.id === stored);
      if (existing) return existing;
    }
    const found = state.conversations.find((row) => String(row?.metadata?.mode || 'conversation') === mode)
      || (mode === 'conversation' ? state.conversations.find((row) => !row?.metadata?.mode) : null);
    if (found) setConversationId(found.id, mode);
    return found || null;
  }

  async function loadMessagesFor(row) {
    if (!row?.id || !currentUser()?.id) {
      emptyState();
      return;
    }
    $('#headerConversationTitle').textContent = row.title || 'Untitled conversation';
    $('#messages').innerHTML = '<div class="ravin-shell-loading"><i></i><span>Loading conversation</span></div>';
    try {
      const messages = await supabase(`/rest/v1/messages?conversation_id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(currentUser().id)}&select=id,role,content,created_at&order=created_at.asc&limit=250`);
      renderMessages(Array.isArray(messages) ? messages : []);
    } catch (error) {
      console.error('[RAVIN messages]', error);
      renderMessages([]);
      appendMessage('error', `Couldn't load this conversation: ${error.message || error}`);
    }
  }

  async function openConversation(row) {
    if (isStreaming()) {
      notify('Stop the current response before switching conversations.');
      return;
    }
    const rowMode = String(row?.metadata?.mode || 'conversation') === 'work' ? 'work' : 'conversation';
    state.mode = rowMode;
    setConversationId(row.id, rowMode);
    syncModeUI();
    renderHistory($('#historySearch')?.value || '');
    await loadMessagesFor(row);
    if (innerWidth <= 700) $('#ravinApp').classList.remove('mobile-sidebar-open');
  }

  async function loadCurrentMode() {
    syncModeUI();
    if (!currentUser()?.id) {
      state.activeConversation = '';
      $('#headerConversationTitle').textContent = 'New conversation';
      emptyState();
      return;
    }
    if (!state.conversations.length) await loadConversations();
    const row = await resolveConversation(state.mode);
    if (row) {
      state.activeConversation = row.id;
      await loadMessagesFor(row);
    } else {
      state.activeConversation = '';
      $('#headerConversationTitle').textContent = 'New conversation';
      emptyState();
    }
    renderHistory($('#historySearch')?.value || '');
  }

  async function switchMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    state.activeConversation = currentConversationId(mode);
    await loadCurrentMode();
  }

  function newChat() {
    setConversationId('', state.mode);
    state.activeConversation = '';
    $('#headerConversationTitle').textContent = 'New conversation';
    emptyState();
    renderHistory($('#historySearch')?.value || '');
    $('#messageInput').focus();
    if (innerWidth <= 700) $('#ravinApp').classList.remove('mobile-sidebar-open');
  }

  function closePopovers() {
    $$('.ravin-popover').forEach((pop) => {
      pop._ravinCleanup?.();
      pop.remove();
    });
  }

  function positionPopover(pop, anchor) {
    if (!pop?.isConnected || !anchor?.isConnected) return;
    const gap = 8;
    const margin = 12;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(pop.offsetWidth || 260, innerWidth - margin * 2);
    const height = Math.min(pop.offsetHeight || 120, innerHeight - margin * 2);
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, innerWidth - width - margin));
    const below = rect.bottom + gap;
    const above = rect.top - height - gap;
    let top = below;
    if (below + height > innerHeight - margin && above >= margin) top = above;
    top = Math.max(margin, Math.min(top, innerHeight - height - margin));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.maxHeight = `${Math.max(160, innerHeight - margin * 2)}px`;
  }

  function buildPopover(anchor, contents, { className = '' } = {}) {
    closePopovers();
    const pop = document.createElement('div');
    pop.className = `ravin-popover ${className}`.trim();
    pop.setAttribute('role', 'menu');
    pop.innerHTML = contents;
    document.body.appendChild(pop);

    const place = () => positionPopover(pop, anchor);
    requestAnimationFrame(place);
    const observer = new MutationObserver(() => requestAnimationFrame(place));
    observer.observe(pop, { childList: true, subtree: true, attributes: true });
    const close = (event) => {
      if (!pop.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) {
        pop._ravinCleanup?.();
        pop.remove();
      }
    };
    const cleanup = () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      anchor.setAttribute('aria-expanded', 'false');
    };
    pop._ravinCleanup = cleanup;
    anchor.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('pointerdown', close, true));
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return pop;
  }

  function settingsPopover() {
    const pop = buildPopover($('#settingsBtn'), `
      <button data-action="new" type="button">New chat</button>
      <button data-action="collapse" type="button">${state.sidebarCollapsed ? 'Expand' : 'Collapse'} sidebar</button>
      <hr />
      <button data-action="theme" type="button"><span>Appearance</span><span class="theme-value"></span></button>
      <hr />
      <button data-action="logout" type="button">Sign out</button>
    `, { className: 'ravin-settings-base' });
    syncSettingsThemeRow(pop);
    pop.addEventListener('click', (event) => {
      const action = event.target.closest('button')?.dataset.action;
      if (!action) return;
      if (action === 'new') newChat();
      if (action === 'collapse') toggleSidebar();
      if (action === 'theme') {
        setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
        syncSettingsThemeRow(pop);
        return;
      }
      if (action === 'logout') signOut();
      if (action !== 'theme') {
        pop._ravinCleanup?.();
        pop.remove();
      }
    });
  }

  function accountPopover() {
    if (!currentUser()?.id) {
      openAuth();
      return;
    }
    const pop = buildPopover($('#accountBtn'), `
      <button data-action="new" type="button">New chat</button>
      <button data-action="settings" type="button">RAVIN settings</button>
      <hr />
      <button data-action="logout" type="button">Sign out</button>
    `);
    pop.addEventListener('click', (event) => {
      const action = event.target.closest('button')?.dataset.action;
      if (!action) return;
      if (action === 'new') newChat();
      if (action === 'settings') {
        pop._ravinCleanup?.();
        pop.remove();
        $('#settingsBtn')?.click();
        return;
      }
      if (action === 'logout') signOut();
      pop._ravinCleanup?.();
      pop.remove();
    });
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem(SIDEBAR_KEY, String(state.sidebarCollapsed));
    $('#ravinApp').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    $('#collapseBtn').setAttribute('aria-label', state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }

  function openDeleteDialog(row) {
    if (!row?.id) return;
    $('#ravinDeleteBackdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'ravinDeleteBackdrop';
    backdrop.className = 'ravin-delete-backdrop';
    backdrop.innerHTML = `
      <section class="ravin-delete-card" role="dialog" aria-modal="true" aria-labelledby="ravinDeleteTitle">
        <div class="ravin-delete-icon">${icon('trash')}</div>
        <h2 id="ravinDeleteTitle">Delete chat?</h2>
        <p>This permanently deletes the conversation and its messages.</p>
        <strong class="ravin-delete-title"></strong>
        <div class="ravin-delete-error" role="alert"></div>
        <div class="ravin-delete-actions">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="button" class="danger" data-action="delete">Delete chat</button>
        </div>
      </section>`;
    $('.ravin-delete-title', backdrop).textContent = row.title || 'Untitled conversation';
    backdrop.addEventListener('click', async (event) => {
      if (event.target === backdrop || event.target.closest('[data-action="cancel"]')) {
        backdrop.remove();
        return;
      }
      if (!event.target.closest('[data-action="delete"]')) return;
      const remove = $('[data-action="delete"]', backdrop);
      const cancel = $('[data-action="cancel"]', backdrop);
      const error = $('.ravin-delete-error', backdrop);
      remove.disabled = true;
      cancel.disabled = true;
      remove.textContent = 'Deleting…';
      try {
        const data = await supabase(
          `/rest/v1/conversations?id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(currentUser().id)}`,
          { method: 'DELETE', prefer: 'return=representation' },
        );
        if (Array.isArray(data) && data.length === 0) throw new Error('RAVIN could not verify that this chat was deleted.');
        const wasActive = Object.values(conversationKeys).some((key) => localStorage.getItem(key) === row.id);
        Object.entries(conversationKeys).forEach(([mode, key]) => {
          if (localStorage.getItem(key) === row.id) setConversationId('', mode);
        });
        backdrop.remove();
        if (wasActive && row.id === state.activeConversation) newChat();
        await loadConversations();
        notify('Chat deleted');
      } catch (err) {
        error.textContent = err?.message || String(err);
        remove.disabled = false;
        cancel.disabled = false;
        remove.textContent = 'Delete chat';
      }
    });
    document.body.appendChild(backdrop);
    $('[data-action="cancel"]', backdrop)?.focus();
  }

  function openAuth(mode = 'signin') {
    state.authMode = mode;
    $('#ravinAuthBackdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'ravinAuthBackdrop';
    backdrop.className = 'ravin-auth-backdrop';
    backdrop.innerHTML = `
      <section class="ravin-auth-card" role="dialog" aria-modal="true" aria-labelledby="ravinAuthTitle">
        <div class="ravin-auth-brand"><span class="ravin-brand-mark" aria-hidden="true"></span><span class="ravin-brand-copy"><strong>RAVIN</strong><small>RESONANT ASSIST</small></span></div>
        <h2 id="ravinAuthTitle">${mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
        <p>${mode === 'signin' ? 'Sign in to continue your RAVIN conversations.' : 'Create an account to keep conversations, files, and memory connected.'}</p>
        <form id="authForm" novalidate>
          <label for="authEmail">Email</label>
          <input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" required />
          <label for="authPassword">Password</label>
          <div class="ravin-auth-password-row">
            <input id="authPassword" type="password" placeholder="At least 8 characters" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" minlength="8" required />
            <button id="authPasswordToggle" type="button" aria-label="Show password">Show</button>
          </div>
          <button class="ravin-auth-submit" id="authSubmit" type="submit">${mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}</button>
        </form>
        <div class="ravin-auth-error" id="authError" role="alert" aria-live="polite"></div>
        <button class="ravin-auth-switch" id="authSwitch" type="button">${mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button>
        <small class="ravin-auth-note">Your account keeps chats, files, and RAVIN memory private to you.</small>
      </section>`;
    document.body.appendChild(backdrop);
    $('#authSwitch').addEventListener('click', () => openAuth(mode === 'signin' ? 'signup' : 'signin'));
    $('#authPasswordToggle').addEventListener('click', () => {
      const input = $('#authPassword');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('#authPasswordToggle').textContent = show ? 'Hide' : 'Show';
      $('#authPasswordToggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    $('#authForm').addEventListener('submit', handleAuth);
    $('#authEmail').focus();
  }

  async function handleAuth(event) {
    event.preventDefault();
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const submit = $('#authSubmit');
    const error = $('#authError');
    if (!email || !password) {
      error.textContent = 'Enter your email and password.';
      return;
    }
    if (password.length < 8) {
      error.textContent = 'Password must be at least 8 characters.';
      return;
    }
    submit.disabled = true;
    submit.textContent = 'PLEASE WAIT…';
    error.textContent = '';
    try {
      const data = await authRequest(state.authMode, email, password, { redirect_to: location.href.split('#')[0] });
      if (data.session?.access_token) {
        persistSession(data.session, data.user);
        $('#ravinAuthBackdrop')?.remove();
        renderUser();
        await loadConversations();
        await loadCurrentMode();
        notify(state.authMode === 'signin' ? 'Signed in' : 'Account created');
      } else {
        error.textContent = data?.message || 'Check your email to finish creating your account.';
      }
    } catch (err) {
      error.textContent = err?.message || String(err);
    } finally {
      submit.disabled = false;
      submit.textContent = state.authMode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT';
    }
  }

  function signOut() {
    closePopovers();
    clearSession();
    renderUser();
    renderHistory();
    newChat();
    openAuth();
  }

  function setTheme(next) {
    const theme = next === 'light' ? 'light' : 'dark';
    document.documentElement.classList.add('theme-transition');
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f7f7f9' : '#0c0c0e');
    syncThemeButton();
    clearTimeout(setTheme.timer);
    setTheme.timer = setTimeout(() => document.documentElement.classList.remove('theme-transition'), 260);
  }

  function syncThemeButton() {
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const button = $('#themeBtn');
    if (!button) return;
    button.innerHTML = icon(theme === 'light' ? 'moon' : 'sun');
    button.setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`);
    button.title = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
  }

  function syncSettingsThemeRow(root = document) {
    const value = $('.theme-value', root);
    if (value) value.textContent = document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark';
  }

  function syncOnlineState() {
    const offline = !navigator.onLine;
    $('#ravinApp')?.classList.toggle('ravin-offline', offline);
    const status = $('#systemStatus');
    if (status && !isStreaming()) status.textContent = offline ? 'OFFLINE' : 'READY';
  }

  function resizeComposer() {
    const input = $('#messageInput');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, Math.max(24, input.scrollHeight))}px`;
    $('#composer')?.classList.toggle('has-content', Boolean(input.value.trim()));
  }

  function bindEvents() {
    $('#newChatBtn').addEventListener('click', newChat);
    $('#conversationModeBtn').addEventListener('click', () => switchMode('conversation'));
    $('#workModeBtn').addEventListener('click', () => switchMode('work'));
    $('#historySearch').addEventListener('input', (event) => renderHistory(event.target.value));
    $('#collapseBtn').addEventListener('click', (event) => { event.stopPropagation(); toggleSidebar(); });
    $('#collapseBtn').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleSidebar(); }
    });
    $('#accountBtn').addEventListener('click', accountPopover);
    $('#settingsBtn').addEventListener('click', settingsPopover);
    $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
    $('#mobileMenuBtn').addEventListener('click', () => $('#ravinApp').classList.toggle('mobile-sidebar-open'));

    const messageInput = $('#messageInput');
    messageInput.addEventListener('input', resizeComposer);
    messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (messageInput.value.trim()) $('#composer').requestSubmit();
      }
    });

    addEventListener('online', syncOnlineState);
    addEventListener('offline', syncOnlineState);
    addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        $('#historySearch')?.focus();
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      }
      if (event.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
        event.preventDefault();
        $('#messageInput')?.focus();
      }
      if (event.key === 'Escape') {
        closePopovers();
        $('#ravinApp')?.classList.remove('mobile-sidebar-open');
        $('#ravinDeleteBackdrop')?.remove();
      }
    });
  }

  function observeChatCompletion() {
    const root = $('#messages');
    if (!root) return;
    const observer = new MutationObserver(() => {
      clearTimeout(state.historyRefreshTimer);
      state.historyRefreshTimer = setTimeout(() => {
        if (!currentUser()?.id || isStreaming()) return;
        syncActiveConversation();
        loadConversations().catch(() => {});
      }, 850);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  async function initializeSession() {
    renderUser();
    syncModeUI();
    syncThemeButton();
    syncOnlineState();
    resizeComposer();
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
      console.warn('[RAVIN session]', error);
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
    observeChatCompletion();
    initializeSession();
    document.documentElement.dataset.ravinShell = 'production';
    window.RAVIN_SHELL = Object.freeze({
      refreshConversations: loadConversations,
      notify,
      openAuth,
      setTheme,
      closePopovers,
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
