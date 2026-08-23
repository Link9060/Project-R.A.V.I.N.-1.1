(function () {
  const SUPABASE_FUNCTION_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co/functions/v1/ravin-auth";
  const TOKEN_KEY = "ravin_access_token";
  const REFRESH_KEY = "ravin_refresh_token";
  const USER_KEY = "ravin_user";
  const EXPIRES_KEY = "ravin_token_expires_at";
  const state = { accessToken: localStorage.getItem(TOKEN_KEY) || "", refreshToken: localStorage.getItem(REFRESH_KEY) || "", user: JSON.parse(localStorage.getItem(USER_KEY) || "null"), expiresAt: Number(localStorage.getItem(EXPIRES_KEY) || 0) };

  function emit() { window.dispatchEvent(new CustomEvent("ravin-auth-changed", { detail: { signedIn: isSignedIn(), user: state.user } })); }
  function isSignedIn() { return !!(state.accessToken && state.refreshToken && state.user); }
  function saveSession(session, user) {
    if (!session?.access_token) throw new Error("Authentication succeeded, but no access token was returned.");
    state.accessToken = session.access_token;
    state.refreshToken = session.refresh_token || "";
    state.user = user || session.user || null;
    state.expiresAt = session.expires_at ? Number(session.expires_at) * 1000 : Date.now() + Number(session.expires_in || 3600) * 1000;
    localStorage.setItem(TOKEN_KEY, state.accessToken);
    localStorage.setItem(REFRESH_KEY, state.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    localStorage.setItem(EXPIRES_KEY, String(state.expiresAt));
    emit();
  }
  function clearSession() { state.accessToken = ""; state.refreshToken = ""; state.user = null; state.expiresAt = 0; [TOKEN_KEY, REFRESH_KEY, USER_KEY, EXPIRES_KEY].forEach(k => localStorage.removeItem(k)); emit(); }

  async function authRequest(action, email, password) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const payload = { action, email, password };
      if (action === "signup") payload.redirect_to = `${location.origin}${location.pathname}`;
      const response = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      console.debug("[RAVIN auth]", action, response.status, { hasUser: !!data.user, hasSession: !!data.session });
      if (!response.ok) throw new Error(data.error || `Authentication failed (HTTP ${response.status}).`);
      return data;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Authentication timed out.");
      throw e;
    } finally { clearTimeout(timer); }
  }

  function injectStyles() {
    if (document.getElementById("ravinAuthStyles")) return;
    const s = document.createElement("style"); s.id = "ravinAuthStyles"; s.textContent = `.ravin-auth-backdrop{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.78);backdrop-filter:blur(12px)}.ravin-auth-backdrop[hidden]{display:none}.ravin-auth-card{width:min(420px,100%);padding:28px;border:1px solid rgba(255,255,255,.12);border-radius:20px;background:#111116;color:#fff}.ravin-auth-input{width:100%;box-sizing:border-box;margin:7px 0;padding:12px;border:1px solid #333;border-radius:10px;background:#0b0b0f;color:#fff}.ravin-auth-button{width:100%;margin-top:10px;padding:12px;border:0;border-radius:10px;background:#fff;color:#111;font-weight:700;cursor:pointer}.ravin-auth-button:disabled{opacity:.5}.ravin-auth-switch{margin-top:14px;width:100%;border:0;background:none;color:#aaa;cursor:pointer}.ravin-auth-error{min-height:20px;margin-top:10px;color:#ff7777;font-size:13px}`; document.head.appendChild(s);
  }

  function createAuthUI() {
    injectStyles();
    const backdrop = document.createElement("div"); backdrop.id = "ravinAuthBackdrop"; backdrop.className = "ravin-auth-backdrop"; backdrop.hidden = true;
    backdrop.innerHTML = `<div class="ravin-auth-card"><h2>Welcome to RAVIN</h2><p id="ravinAuthSubtitle">Sign in to your RAVIN account.</p><form id="ravinAuthForm"><input class="ravin-auth-input" id="ravinAuthEmail" type="email" placeholder="Email" autocomplete="email" required><input class="ravin-auth-input" id="ravinAuthPassword" type="password" placeholder="Password" autocomplete="current-password" minlength="8" required><button class="ravin-auth-button" id="ravinAuthSubmit" type="submit">Sign in</button><button class="ravin-auth-switch" id="ravinAuthSwitch" type="button">Need an account? Sign up</button><div class="ravin-auth-error" id="ravinAuthError"></div></form></div>`;
    document.body.appendChild(backdrop);
    const form = backdrop.querySelector("#ravinAuthForm"), email = backdrop.querySelector("#ravinAuthEmail"), password = backdrop.querySelector("#ravinAuthPassword"), submit = backdrop.querySelector("#ravinAuthSubmit"), switchBtn = backdrop.querySelector("#ravinAuthSwitch"), subtitle = backdrop.querySelector("#ravinAuthSubtitle"), error = backdrop.querySelector("#ravinAuthError");
    let mode = "signin";
    switchBtn.onclick = () => { mode = mode === "signin" ? "signup" : "signin"; submit.textContent = mode === "signin" ? "Sign in" : "Create account"; switchBtn.textContent = mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"; subtitle.textContent = mode === "signin" ? "Sign in to your RAVIN account." : "Create your personal RAVIN account."; password.autocomplete = mode === "signin" ? "current-password" : "new-password"; error.textContent = ""; };
    form.onsubmit = async (event) => {
      event.preventDefault(); error.textContent = ""; submit.disabled = true; submit.textContent = mode === "signin" ? "Signing in…" : "Creating…";
      try {
        const data = await authRequest(mode, email.value.trim(), password.value);
        if (!data.session) { error.textContent = mode === "signup" ? "Account created. Check your email, then sign in." : "No session was returned."; return; }
        saveSession(data.session, data.user);
        backdrop.hidden = true;
        updateAuthUI(); updateMainUI();
        console.info("[RAVIN auth] SIGNED IN", data.user?.email || "user");
      } catch (e) { console.error("[RAVIN auth] sign-in failed", e); error.textContent = e.message || "Authentication failed."; }
      finally { submit.disabled = false; submit.textContent = mode === "signin" ? "Sign in" : "Create account"; }
    };
    window.RavinAuth = { open(){ backdrop.hidden = false; setTimeout(() => email.focus(), 0); }, close(){ backdrop.hidden = true; }, isSignedIn, getUser(){ return state.user; }, getAccessToken(){ return state.accessToken; }, signOut(){ clearSession(); backdrop.hidden = false; updateAuthUI(); updateMainUI(); } };
    backdrop.hidden = isSignedIn();
  }

  function updateMainUI() { const intro = document.querySelector(".intro-sub"); const status = document.getElementById("statusText"); if (intro) intro.textContent = isSignedIn() ? `Signed in as ${state.user?.email || "your RAVIN account"}.` : "Sign in to begin."; if (status) status.textContent = isSignedIn() ? "READY" : "ONLINE"; }
  function updateAuthUI() {
    const settings = document.getElementById("settingsPanel"); if (!settings || !window.RavinAuth) return;
    let row = document.getElementById("ravinAccountRow"); if (!row) { row = document.createElement("div"); row.id = "ravinAccountRow"; settings.prepend(row); }
    if (isSignedIn()) row.innerHTML = `<span>${state.user?.email || "Signed in"}</span> <button id="ravinSignOut" type="button">Sign out</button>`; else row.innerHTML = `<span>Not signed in</span> <button id="ravinSignIn" type="button">Sign in</button>`;
    const signIn = document.getElementById("ravinSignIn"), signOut = document.getElementById("ravinSignOut"); if (signIn) signIn.onclick = () => window.RavinAuth.open(); if (signOut) signOut.onclick = () => window.RavinAuth.signOut();
  }
  window.RavinAuthState = state;
  document.addEventListener("DOMContentLoaded", () => { createAuthUI(); updateAuthUI(); updateMainUI(); });
})();
