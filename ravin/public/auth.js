(function () {
  const SUPABASE_FUNCTION_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co/functions/v1/ravin-auth";
  const TOKEN_KEY = "ravin_access_token";
  const REFRESH_KEY = "ravin_refresh_token";
  const USER_KEY = "ravin_user";
  const CONVERSATION_KEY = "ravin_conversation_id";
  const REFRESH_SKEW_MS = 60_000;

  const state = {
    accessToken: localStorage.getItem(TOKEN_KEY) || "",
    refreshToken: localStorage.getItem(REFRESH_KEY) || "",
    user: JSON.parse(localStorage.getItem(USER_KEY) || "null"),
    expiresAt: Number(localStorage.getItem("ravin_token_expires_at") || 0),
    refreshTimer: null,
    refreshInFlight: null,
  };

  function saveSession(session, user) {
    state.accessToken = session?.access_token || "";
    state.refreshToken = session?.refresh_token || state.refreshToken || "";
    state.user = user || state.user || null;
    state.expiresAt = session?.expires_at ? Number(session.expires_at) * 1000 : (session?.expires_in ? Date.now() + Number(session.expires_in) * 1000 : state.expiresAt);

    if (state.accessToken) localStorage.setItem(TOKEN_KEY, state.accessToken);
    else localStorage.removeItem(TOKEN_KEY);
    if (state.refreshToken) localStorage.setItem(REFRESH_KEY, state.refreshToken);
    else localStorage.removeItem(REFRESH_KEY);
    if (state.user) localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    else localStorage.removeItem(USER_KEY);
    if (state.expiresAt) localStorage.setItem("ravin_token_expires_at", String(state.expiresAt));
    else localStorage.removeItem("ravin_token_expires_at");
    scheduleRefresh();
  }

  function clearSession() {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
    state.refreshInFlight = null;
    state.accessToken = "";
    state.refreshToken = "";
    state.user = null;
    state.expiresAt = 0;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem("ravin_token_expires_at");
    localStorage.removeItem(CONVERSATION_KEY);
  }

  function isSignedIn() {
    return Boolean(state.accessToken && state.refreshToken && state.user);
  }

  async function authRequest(action, email, password) {
    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, email, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Authentication failed");
    return data;
  }

  async function refreshSession() {
    if (!state.refreshToken) return false;
    if (state.refreshInFlight) return state.refreshInFlight;
    state.refreshInFlight = (async () => {
      try {
        const response = await fetch(SUPABASE_FUNCTION_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "refresh", refresh_token: state.refreshToken }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.session) throw new Error(data.error || "Session refresh failed");
        saveSession(data.session, data.user);
        return true;
      } catch (error) {
        console.warn("RAVIN session refresh failed:", error);
        clearSession();
        updateAuthUI();
        return false;
      } finally {
        state.refreshInFlight = null;
      }
    })();
    return state.refreshInFlight;
  }

  function scheduleRefresh() {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    if (!state.refreshToken || !state.expiresAt) return;
    const delay = Math.max(5_000, state.expiresAt - Date.now() - REFRESH_SKEW_MS);
    state.refreshTimer = setTimeout(() => { refreshSession(); }, delay);
  }

  async function ensureFreshSession() {
    if (!state.accessToken || !state.refreshToken) return false;
    if (state.expiresAt && Date.now() >= state.expiresAt - REFRESH_SKEW_MS) return refreshSession();
    return true;
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .ravin-auth-backdrop { position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(0,0,0,.72); backdrop-filter:blur(12px); }
      .ravin-auth-card { width:min(420px,100%); padding:28px; border:1px solid rgba(255,255,255,.12); border-radius:20px; background:#111116; box-shadow:0 24px 80px rgba(0,0,0,.5); color:#fff; }
      .ravin-auth-title { margin:0 0 6px; font-size:26px; font-weight:700; }
      .ravin-auth-sub { margin:0 0 22px; opacity:.65; font-size:14px; }
      .ravin-auth-input { width:100%; box-sizing:border-box; margin:7px 0; padding:12px 13px; border:1px solid rgba(255,255,255,.13); border-radius:10px; background:#0b0b0f; color:#fff; outline:none; }
      .ravin-auth-button { width:100%; margin-top:10px; padding:12px; border:0; border-radius:10px; background:#fff; color:#111; font-weight:700; cursor:pointer; }
      .ravin-auth-switch { margin-top:14px; width:100%; border:0; background:none; color:#aaa; cursor:pointer; }
      .ravin-auth-error { min-height:18px; margin-top:10px; color:#ff7b7b; font-size:13px; }
      .ravin-auth-user { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0 14px; font-size:13px; opacity:.8; }
      .ravin-auth-signout { border:1px solid rgba(255,255,255,.14); background:none; color:inherit; border-radius:8px; padding:6px 9px; cursor:pointer; }
    `;
    document.head.appendChild(style);
  }

  function createAuthUI() {
    injectStyles();
    const backdrop = document.createElement("div");
    backdrop.className = "ravin-auth-backdrop";
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <div class="ravin-auth-card">
        <h1 class="ravin-auth-title">Welcome to RAVIN</h1>
        <p class="ravin-auth-sub" id="ravinAuthSubtitle">Sign in to your RAVIN account.</p>
        <form id="ravinAuthForm">
          <input class="ravin-auth-input" id="ravinAuthEmail" type="email" placeholder="Email" autocomplete="email" required />
          <input class="ravin-auth-input" id="ravinAuthPassword" type="password" placeholder="Password (8+ characters)" autocomplete="current-password" minlength="8" required />
          <button class="ravin-auth-button" id="ravinAuthSubmit" type="submit">Sign in</button>
          <button class="ravin-auth-switch" id="ravinAuthSwitch" type="button">Need an account? Sign up</button>
          <div class="ravin-auth-error" id="ravinAuthError"></div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const form = backdrop.querySelector("#ravinAuthForm");
    const email = backdrop.querySelector("#ravinAuthEmail");
    const password = backdrop.querySelector("#ravinAuthPassword");
    const submit = backdrop.querySelector("#ravinAuthSubmit");
    const switchBtn = backdrop.querySelector("#ravinAuthSwitch");
    const subtitle = backdrop.querySelector("#ravinAuthSubtitle");
    const error = backdrop.querySelector("#ravinAuthError");
    let mode = "signin";

    switchBtn.addEventListener("click", () => {
      mode = mode === "signin" ? "signup" : "signin";
      submit.textContent = mode === "signin" ? "Sign in" : "Create account";
      switchBtn.textContent = mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in";
      subtitle.textContent = mode === "signin" ? "Sign in to your RAVIN account." : "Create your personal RAVIN account.";
      password.setAttribute("autocomplete", mode === "signin" ? "current-password" : "new-password");
      error.textContent = "";
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      submit.textContent = mode === "signin" ? "Signing in…" : "Creating…";
      try {
        const data = await authRequest(mode, email.value.trim(), password.value);
        if (!data.session) throw new Error("Account created. Check your email to confirm it, then sign in.");
        saveSession(data.session, data.user);
        backdrop.hidden = true;
        updateAuthUI();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = mode === "signin" ? "Sign in" : "Create account";
      }
    });

    window.RavinAuth = {
      open: () => { backdrop.hidden = false; email.focus(); },
      close: () => { backdrop.hidden = true; },
      isSignedIn,
      getAccessToken: () => state.accessToken,
      getUser: () => state.user,
      ensureFreshSession,
      refreshSession,
      signOut: () => { clearSession(); updateAuthUI(); },
    };

    if (!isSignedIn()) backdrop.hidden = false;
    else scheduleRefresh();
  }

  function hideLegacyCredentialUI() {
    const groq = document.getElementById("apiKeyInput");
    const supabase = document.getElementById("supabaseUrlInput");
    [groq, supabase].forEach((input) => {
      const row = input?.closest(".settings-row-column");
      if (row) row.hidden = true;
    });
    const divider = document.querySelectorAll(".settings-divider")[0];
    if (divider) divider.hidden = true;
  }

  function updateAuthUI() {
    const settingsPanel = document.getElementById("settingsPanel");
    if (!settingsPanel || !window.RavinAuth) return;
    let row = document.getElementById("ravinAccountRow");
    if (!row) {
      row = document.createElement("div");
      row.id = "ravinAccountRow";
      row.className = "settings-row settings-row-column";
      settingsPanel.prepend(row);
    }
    if (isSignedIn()) {
      const email = state.user?.email || "Signed in";
      row.innerHTML = `<div class="ravin-auth-user"><span>${email}</span><button class="ravin-auth-signout" id="ravinSignOut">Sign out</button></div>`;
      row.querySelector("#ravinSignOut").onclick = () => window.RavinAuth.signOut();
    } else {
      row.innerHTML = `<div class="ravin-auth-user"><span>Not signed in</span><button class="ravin-auth-signout" id="ravinSignIn">Sign in</button></div>`;
      row.querySelector("#ravinSignIn").onclick = () => window.RavinAuth.open();
    }
  }

  function installMemoryBridge() {
    window.RavinMemory = {
      isConfigured: () => isSignedIn(),
      getStoredUrl: () => SUPABASE_FUNCTION_URL,
      getStoredAnonKey: () => "managed by RAVIN",
      saveCredentials: () => {},
      async listPermanentMemories() {
        if (!await ensureFreshSession()) return [];
        const response = await fetch("/api/memories", { headers: { Authorization: `Bearer ${state.accessToken}` } });
        if (!response.ok) throw new Error("Could not load memories");
        const data = await response.json();
        return data.permanent || [];
      },
      async addPermanentMemory(content, category = "fact") {
        if (!await ensureFreshSession()) throw new Error("Please sign in again.");
        const response = await fetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.accessToken}` },
          body: JSON.stringify({ content, category }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save memory");
        return data.memory;
      },
      async deletePermanentMemory(id) {
        if (!await ensureFreshSession()) throw new Error("Please sign in again.");
        const response = await fetch(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${state.accessToken}` } });
        if (!response.ok) throw new Error("Could not delete memory");
      },
    };
  }

  function installChatBridge() {
    const form = document.getElementById("composer");
    const input = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendBtn");
    const chat = document.getElementById("chat");
    if (!form || !input) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!isSignedIn()) return window.RavinAuth.open();
      if (!await ensureFreshSession()) return window.RavinAuth.open();
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      sendBtn.disabled = true;

      const userWrap = document.createElement("div");
      userWrap.className = "msg user";
      userWrap.innerHTML = `<div class="msg-header"><span class="msg-label">You</span></div><div class="msg-body"></div>`;
      userWrap.querySelector(".msg-body").textContent = message;
      chat.appendChild(userWrap);

      const thinking = document.createElement("div");
      thinking.className = "msg ravin typing";
      thinking.innerHTML = `<div class="msg-header"><span class="msg-label">RAVIN</span></div><div class="msg-body">thinking…</div>`;
      chat.appendChild(thinking);
      chat.scrollTop = chat.scrollHeight;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.accessToken}` },
          body: JSON.stringify({ message, conversation_id: localStorage.getItem(CONVERSATION_KEY) || null }),
        });
        if (response.status === 401 && await refreshSession()) {
          const retry = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.accessToken}` },
            body: JSON.stringify({ message, conversation_id: localStorage.getItem(CONVERSATION_KEY) || null }),
          });
          if (!retry.ok) throw new Error((await retry.json().catch(() => ({}))).error || "RAVIN could not respond");
          const data = await retry.json();
          if (data.conversation_id) localStorage.setItem(CONVERSATION_KEY, data.conversation_id);
          thinking.remove();
          const reply = document.createElement("div");
          reply.className = "msg ravin";
          reply.innerHTML = `<div class="msg-header"><span class="msg-label">RAVIN</span></div><div class="msg-body"></div>`;
          reply.querySelector(".msg-body").innerHTML = window.renderMarkdown ? window.renderMarkdown(data.reply || "") : "";
          chat.appendChild(reply); chat.scrollTop = chat.scrollHeight; return;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "RAVIN could not respond");
        if (data.conversation_id) localStorage.setItem(CONVERSATION_KEY, data.conversation_id);
        thinking.remove();
        const reply = document.createElement("div");
        reply.className = "msg ravin";
        reply.innerHTML = `<div class="msg-header"><span class="msg-label">RAVIN</span></div><div class="msg-body"></div>`;
        reply.querySelector(".msg-body").innerHTML = window.renderMarkdown ? window.renderMarkdown(data.reply || "") : "";
        chat.appendChild(reply); chat.scrollTop = chat.scrollHeight;
      } catch (err) {
        thinking.remove();
        const error = document.createElement("div");
        error.className = "msg error";
        error.innerHTML = `<div class="msg-header"><span class="msg-label">System</span></div><div class="msg-body"></div>`;
        error.querySelector(".msg-body").textContent = err.message;
        chat.appendChild(error);
      } finally { sendBtn.disabled = false; input.focus(); }
    }, true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    createAuthUI();
    hideLegacyCredentialUI();
    installMemoryBridge();
    installChatBridge();
    updateAuthUI();
  });
})();
