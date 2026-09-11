(() => {
  const BACKEND_URL = "https://ravin-hyeq.onrender.com";
  const SUPABASE_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co";
  const SUPABASE_KEY = "sb_publishable_wVnTPMs0hUuWdt1_LGMIYQ_D-aXveMV";
  const AUTH_URL = `${SUPABASE_URL}/functions/v1/ravin-auth`;
  const MODE_KEY = "ravin_mode";
  const AUTH_KEYS = {
    access: "ravin_access_token",
    refresh: "ravin_refresh_token",
    user: "ravin_user",
    expires: "ravin_token_expires_at",
  };
  const conversationKeys = {
    conversation: "ravin_conversation_id_conversation",
    work: "ravin_conversation_id_work",
  };

  let currentMode = localStorage.getItem(MODE_KEY) === "work" ? "work" : "conversation";
  let busy = false;
  let lastSessionFingerprint = "";
  const els = {};

  const parseJson = (value, fallback = null) => {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  };

  const user = () => parseJson(localStorage.getItem(AUTH_KEYS.user), null);
  const conversationId = (mode = currentMode) => localStorage.getItem(conversationKeys[mode]) || "";
  const setConversationId = (id, mode = currentMode) => {
    if (id) localStorage.setItem(conversationKeys[mode], id);
    else localStorage.removeItem(conversationKeys[mode]);
  };

  const persistSession = (session, nextUser) => {
    if (!session?.access_token) throw new Error("Authentication refresh returned no access token.");
    localStorage.setItem(AUTH_KEYS.access, session.access_token);
    if (session.refresh_token) localStorage.setItem(AUTH_KEYS.refresh, session.refresh_token);
    if (nextUser || session.user) localStorage.setItem(AUTH_KEYS.user, JSON.stringify(nextUser || session.user));
    const expiresAt = session.expires_at
      ? Number(session.expires_at) * 1000
      : Date.now() + Number(session.expires_in || 3600) * 1000;
    localStorage.setItem(AUTH_KEYS.expires, String(expiresAt));
    return session.access_token;
  };

  async function refreshAccessToken() {
    const refreshToken = localStorage.getItem(AUTH_KEYS.refresh) || "";
    if (!refreshToken) throw new Error("Your RAVIN session expired. Sign in again.");
    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh", refresh_token: refreshToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Session refresh failed (${response.status}).`);
    return persistSession(data.session, data.user);
  }

  async function ensureToken(forceRefresh = false) {
    let token = localStorage.getItem(AUTH_KEYS.access) || "";
    const expiresAt = Number(localStorage.getItem(AUTH_KEYS.expires) || 0);
    if (!token) throw new Error("Sign in to RAVIN first.");
    if (forceRefresh || (expiresAt && expiresAt <= Date.now() + 60_000)) token = await refreshAccessToken();
    return token;
  }

  async function backend(path, options = {}, retry = true) {
    const token = await ensureToken(false);
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    let response = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
    if (response.status === 401 && retry) {
      const refreshed = await ensureToken(true);
      headers.set("Authorization", `Bearer ${refreshed}`);
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
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const text = await response.text();
    let data = [];
    try { data = text ? JSON.parse(text) : []; } catch { data = []; }
    if (!response.ok) throw new Error(data?.message || data?.error || `History request failed (${response.status}).`);
    return data;
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.id = "ravinStableChatStyles";
    style.textContent = `
      .chat-panel.side-drawer,.side-drawer-tab.drawer-left,.composer,.ravin-mode-switch,#ravinReplyFallback{display:none!important}
      #ravinStableChat{position:fixed;z-index:9500;left:14px;top:88px;bottom:82px;width:min(390px,calc(100vw - 28px));display:grid;grid-template-rows:auto 1fr auto;border:1px solid rgba(255,255,255,.13);border-radius:24px;background:rgba(7,9,13,.86);backdrop-filter:blur(24px) saturate(140%);box-shadow:0 24px 70px rgba(0,0,0,.42);overflow:hidden;color:#f4f6fb;font-family:Inter,system-ui,sans-serif}
      #ravinStableChat.collapsed{display:none}
      #ravinStableChatHeader{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
      #ravinStableChatHeader strong{font:600 10px/1 Space Grotesk,system-ui,sans-serif;letter-spacing:.14em;margin-right:auto}
      #ravinStableChatHeader button,#ravinStableChatComposer button,#ravinStableChatOpen{appearance:none;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);color:rgba(255,255,255,.72);cursor:pointer}
      #ravinStableChatHeader button{border-radius:999px;padding:6px 8px;font:600 8px/1 IBM Plex Mono,monospace;letter-spacing:.08em}
      #ravinStableChatHeader button.active{background:rgba(255,255,255,.14);color:#fff}
      #ravinStableChatStatus{padding:8px 14px 0;color:rgba(255,255,255,.42);font:500 8px/1.3 IBM Plex Mono,monospace;letter-spacing:.08em}
      #ravinStableChatMessages{min-height:0;overflow-y:auto;padding:12px 14px 14px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin}
      .ravin-stable-empty{margin:auto;color:rgba(255,255,255,.38);font-size:12px;text-align:center}
      .ravin-stable-message{max-width:88%;padding:10px 12px;border:1px solid rgba(255,255,255,.075);border-radius:15px;background:rgba(255,255,255,.028);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
      .ravin-stable-message.user{align-self:flex-end;background:rgba(143,167,255,.065);border-color:rgba(143,167,255,.17)}
      .ravin-stable-message.error{color:#ff9aa3;border-color:rgba(255,100,115,.2)}
      .ravin-stable-message small{display:block;margin-bottom:5px;color:rgba(255,255,255,.38);font:600 7px/1 IBM Plex Mono,monospace;letter-spacing:.13em}
      #ravinStableChatComposer{display:flex;gap:8px;padding:11px;border-top:1px solid rgba(255,255,255,.08)}
      #ravinStableChatComposer input{min-width:0;flex:1;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.035);color:#fff;padding:10px 12px;outline:none;font:400 12px/1 Inter,system-ui,sans-serif}
      #ravinStableChatComposer input:focus{border-color:rgba(255,255,255,.24)}
      #ravinStableChatComposer button{width:42px;border-radius:14px;font-weight:700}
      #ravinStableChatComposer input:disabled,#ravinStableChatComposer button:disabled{opacity:.45;cursor:default}
      #ravinStableChatOpen{position:fixed;z-index:9501;left:0;top:50%;transform:translateY(-50%);width:34px;height:118px;border-left:0;border-radius:0 18px 18px 0;display:none}
      #ravinStableChatOpen.visible{display:block}
      @media(max-width:700px){#ravinStableChat{left:8px;right:8px;top:64px;bottom:68px;width:auto;border-radius:20px}}
    `;
    document.head.appendChild(style);
  }

  function makeMessage(role, text, createdAt = new Date()) {
    const article = document.createElement("article");
    article.className = `ravin-stable-message ${role}`;
    const label = document.createElement("small");
    label.textContent = role === "assistant" ? "RAVIN" : role === "user" ? "YOU" : "SYSTEM";
    const body = document.createElement("div");
    body.textContent = String(text ?? "");
    article.append(label, body);
    article.title = new Date(createdAt).toLocaleString();
    return article;
  }

  function renderMessages(messages = []) {
    if (!els.messages) return;
    els.messages.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "ravin-stable-empty";
      empty.textContent = user() ? "Start a conversation with RAVIN." : "Sign in to load your RAVIN conversations.";
      els.messages.appendChild(empty);
      return;
    }
    for (const message of messages) {
      if (!['user','assistant'].includes(message.role)) continue;
      els.messages.appendChild(makeMessage(message.role, message.content, message.created_at));
    }
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function appendMessage(role, text) {
    els.messages?.querySelector(".ravin-stable-empty")?.remove();
    els.messages?.appendChild(makeMessage(role, text));
    if (els.messages) els.messages.scrollTop = els.messages.scrollHeight;
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function setBusy(next) {
    busy = next;
    if (els.input) els.input.disabled = next;
    if (els.send) els.send.disabled = next;
    setStatus(next ? `${currentMode.toUpperCase()} · THINKING…` : `${currentMode.toUpperCase()} · READY`);
  }

  async function resolveConversation(mode = currentMode) {
    const currentUser = user();
    if (!currentUser?.id) return "";

    const stored = conversationId(mode);
    if (stored) {
      const rows = await supabase(`/rest/v1/conversations?id=eq.${encodeURIComponent(stored)}&user_id=eq.${encodeURIComponent(currentUser.id)}&select=id,title,metadata,created_at&limit=1`);
      if (rows?.[0]?.id) return rows[0].id;
      setConversationId("", mode);
    }

    const rows = await supabase(`/rest/v1/conversations?user_id=eq.${encodeURIComponent(currentUser.id)}&select=id,title,metadata,created_at&order=created_at.desc&limit=25`);
    const selected = rows.find((row) => String(row?.metadata?.mode || "conversation") === mode)
      || (mode === "conversation" ? rows.find((row) => !row?.metadata?.mode) : null);
    if (selected?.id) {
      setConversationId(selected.id, mode);
      return selected.id;
    }
    return "";
  }

  async function loadHistory() {
    const currentUser = user();
    if (!currentUser?.id || !localStorage.getItem(AUTH_KEYS.access)) {
      renderMessages([]);
      setStatus("SIGN IN REQUIRED");
      return;
    }
    setStatus(`${currentMode.toUpperCase()} · LOADING HISTORY…`);
    try {
      const id = await resolveConversation(currentMode);
      if (!id) {
        renderMessages([]);
        setStatus(`${currentMode.toUpperCase()} · READY`);
        return;
      }
      const rows = await supabase(`/rest/v1/messages?conversation_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(currentUser.id)}&select=id,role,content,created_at&order=created_at.asc&limit=200`);
      renderMessages(rows || []);
      setStatus(`${currentMode.toUpperCase()} · ${rows?.length || 0} MESSAGES`);
    } catch (error) {
      console.error("[RAVIN stable chat history]", error);
      renderMessages([]);
      appendMessage("error", `History error: ${error.message || error}`);
      setStatus(`${currentMode.toUpperCase()} · HISTORY ERROR`);
    }
  }

  async function sendMessage(event) {
    event?.preventDefault?.();
    if (busy) return;
    const text = els.input?.value?.trim();
    if (!text) return;
    if (!user()?.id || !localStorage.getItem(AUTH_KEYS.access)) {
      appendMessage("error", "Sign in to RAVIN before sending a message.");
      return;
    }

    els.input.value = "";
    appendMessage("user", text);
    setBusy(true);
    try {
      const data = await backend("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          mode: currentMode,
          conversation_id: conversationId(currentMode) || null,
        }),
      });
      if (data?.conversation_id) setConversationId(data.conversation_id, currentMode);
      appendMessage("assistant", data?.reply || "RAVIN returned no visible response.");
      setStatus(`${currentMode.toUpperCase()} · ${data?.model || "READY"}`);
    } catch (error) {
      console.error("[RAVIN stable chat]", error);
      appendMessage("error", `RAVIN error: ${error.message || error}`);
      setStatus(`${currentMode.toUpperCase()} · ERROR`);
    } finally {
      setBusy(false);
      els.input?.focus();
    }
  }

  function switchMode(mode) {
    if (busy) return;
    currentMode = mode === "work" ? "work" : "conversation";
    localStorage.setItem(MODE_KEY, currentMode);
    els.conversation?.classList.toggle("active", currentMode === "conversation");
    els.work?.classList.toggle("active", currentMode === "work");
    loadHistory();
  }

  function newChat() {
    if (busy) return;
    setConversationId("", currentMode);
    renderMessages([]);
    setStatus(`${currentMode.toUpperCase()} · NEW CHAT`);
    els.input?.focus();
  }

  function buildUi() {
    if (document.getElementById("ravinStableChat")) return;
    injectStyles();

    const panel = document.createElement("section");
    panel.id = "ravinStableChat";
    panel.setAttribute("aria-label", "Stable RAVIN chat");

    const header = document.createElement("header");
    header.id = "ravinStableChatHeader";
    const title = document.createElement("strong");
    title.textContent = "RAVIN CHAT";
    const conversation = document.createElement("button");
    conversation.type = "button";
    conversation.textContent = "CONVERSATION";
    const work = document.createElement("button");
    work.type = "button";
    work.textContent = "WORK";
    const fresh = document.createElement("button");
    fresh.type = "button";
    fresh.textContent = "NEW";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Collapse chat");
    header.append(title, conversation, work, fresh, close);

    const bodyWrap = document.createElement("div");
    const status = document.createElement("div");
    status.id = "ravinStableChatStatus";
    const messages = document.createElement("div");
    messages.id = "ravinStableChatMessages";
    bodyWrap.style.minHeight = "0";
    bodyWrap.style.display = "grid";
    bodyWrap.style.gridTemplateRows = "auto 1fr";
    bodyWrap.append(status, messages);

    const form = document.createElement("form");
    form.id = "ravinStableChatComposer";
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = "Ask RAVIN anything…";
    input.setAttribute("aria-label", "Message RAVIN");
    const send = document.createElement("button");
    send.type = "submit";
    send.textContent = "→";
    send.setAttribute("aria-label", "Send");
    form.append(input, send);

    const open = document.createElement("button");
    open.id = "ravinStableChatOpen";
    open.type = "button";
    open.textContent = "CHAT";
    open.setAttribute("aria-label", "Open chat");

    panel.append(header, bodyWrap, form);
    document.body.append(panel, open);

    Object.assign(els, { panel, status, messages, form, input, send, conversation, work, fresh, close, open });
    conversation.addEventListener("click", () => switchMode("conversation"));
    work.addEventListener("click", () => switchMode("work"));
    fresh.addEventListener("click", newChat);
    close.addEventListener("click", () => { panel.classList.add("collapsed"); open.classList.add("visible"); });
    open.addEventListener("click", () => { panel.classList.remove("collapsed"); open.classList.remove("visible"); input.focus(); });
    form.addEventListener("submit", sendMessage);

    conversation.classList.toggle("active", currentMode === "conversation");
    work.classList.toggle("active", currentMode === "work");
    renderMessages([]);
    loadHistory();
  }

  function watchSession() {
    const check = () => {
      const fingerprint = `${localStorage.getItem(AUTH_KEYS.access) || ""}:${localStorage.getItem(AUTH_KEYS.user) || ""}`;
      if (fingerprint !== lastSessionFingerprint) {
        lastSessionFingerprint = fingerprint;
        loadHistory();
      }
    };
    check();
    setInterval(check, 1000);
    window.addEventListener("storage", check);
  }

  window.addEventListener("error", (event) => {
    console.error("[RAVIN UI error]", event.error || event.message);
    if (els.status) setStatus(`UI ERROR · ${event.message || "UNKNOWN"}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[RAVIN unhandled rejection]", event.reason);
    if (els.status) setStatus(`UI ERROR · ${event.reason?.message || "PROMISE"}`);
  });

  const start = () => {
    buildUi();
    watchSession();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
