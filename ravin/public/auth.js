(function () {
  const SUPABASE_URL = "https://cnorozrjugxpanpfmssa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_yVNPiB7opT0WRvBfKTZ2BA_s5bOQLRg";
  const AUTH_STORAGE_KEY = "sb-cnorozrjugxpanpfmssa-auth-token";
  const ON_ENTERARROW = ["enterarrow.com", "www.enterarrow.com"].includes(location.hostname);

  const state = {
    accessToken: "",
    refreshToken: "",
    user: null,
    expiresAt: 0,
  };

  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: AUTH_STORAGE_KEY,
    },
  });

  function emit() {
    window.dispatchEvent(new CustomEvent("ravin-auth-changed", {
      detail: { signedIn: isSignedIn(), user: state.user },
    }));
  }

  function isSignedIn() {
    return Boolean(state.accessToken && state.user);
  }

  function adoptSession(session) {
    state.accessToken = session?.access_token || "";
    state.refreshToken = session?.refresh_token || "";
    state.user = session?.user || null;
    state.expiresAt = session?.expires_at ? Number(session.expires_at) * 1000 : 0;
    emit();
    updateAuthUI();
    updateMainUI();
  }

  async function ensureSession() {
    if (!client) return false;

    const { data, error } = await client.auth.getSession();
    if (error) {
      console.warn("[RAVIN auth] could not read the ARROW session", error);
      adoptSession(null);
      return false;
    }

    if (!data.session) {
      adoptSession(null);
      return false;
    }

    // Ask Supabase for the authenticated user so RAVIN never trusts only
    // browser-stored identity data for server-bound requests.
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      console.warn("[RAVIN auth] ARROW session could not be verified", userError);
      adoptSession(null);
      return false;
    }

    adoptSession({ ...data.session, user: userData.user });
    return true;
  }

  function signInUrl() {
    if (ON_ENTERARROW) {
      const url = new URL("/", location.origin);
      url.searchParams.set("next", "/ravin/");
      return url.toString();
    }
    return "https://link9060.github.io/Resonant-Orbit/";
  }

  function openSignIn() {
    location.assign(signInUrl());
  }

  function injectStyles() {
    if (document.getElementById("ravinAuthStyles")) return;
    const style = document.createElement("style");
    style.id = "ravinAuthStyles";
    style.textContent = `.ravin-auth-backdrop{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.78);backdrop-filter:blur(12px)}.ravin-auth-backdrop[hidden]{display:none}.ravin-auth-card{width:min(420px,100%);padding:28px;border:1px solid rgba(255,255,255,.12);border-radius:20px;background:#111116;color:#fff;text-align:center}.ravin-auth-card p{color:#aaa;line-height:1.5}.ravin-auth-button{width:100%;margin-top:10px;padding:12px;border:0;border-radius:10px;background:#fff;color:#111;font-weight:700;cursor:pointer}`;
    document.head.appendChild(style);
  }

  function createAuthUI() {
    injectStyles();
    const backdrop = document.createElement("div");
    backdrop.id = "ravinAuthBackdrop";
    backdrop.className = "ravin-auth-backdrop";
    backdrop.hidden = true;
    backdrop.innerHTML = `<div class="ravin-auth-card"><h2>RAVIN is part of ARROW now.</h2><p>Use your ARROW account here too — no separate RAVIN login.</p><button class="ravin-auth-button" id="ravinArrowSignIn" type="button">Continue to ARROW sign in</button></div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#ravinArrowSignIn")?.addEventListener("click", openSignIn);
  }

  function updateMainUI() {
    const intro = document.querySelector(".intro-sub");
    const status = document.getElementById("statusText");
    if (intro && !intro.dataset.surfaceContext) {
      intro.textContent = isSignedIn()
        ? `Connected to ARROW as ${state.user?.email || "your account"}.`
        : "Connect your ARROW account to begin.";
    }
    if (status) status.textContent = isSignedIn() ? "READY" : "ARROW SIGN IN";
  }

  function updateAuthUI() {
    const backdrop = document.getElementById("ravinAuthBackdrop");
    if (backdrop) backdrop.hidden = isSignedIn();

    const settings = document.getElementById("settingsPanel");
    if (!settings) return;

    let row = document.getElementById("ravinAccountRow");
    if (!row) {
      row = document.createElement("div");
      row.id = "ravinAccountRow";
      row.className = "settings-row settings-row-column";
      settings.prepend(row);
    }

    if (isSignedIn()) {
      row.innerHTML = `<div class="settings-row-header"><span>ARROW account</span><span class="key-status">Connected</span></div><div class="settings-hint key-hint">${state.user?.email || "Signed in through ARROW"}</div><button class="settings-action" id="ravinSignOut" type="button">Sign out of ARROW</button>`;
    } else {
      row.innerHTML = `<div class="settings-row-header"><span>ARROW account</span><span class="key-status">Required</span></div><button class="settings-action" id="ravinSignIn" type="button">Sign in through ARROW</button>`;
    }

    document.getElementById("ravinSignIn")?.addEventListener("click", openSignIn);
    document.getElementById("ravinSignOut")?.addEventListener("click", async () => {
      if (ON_ENTERARROW) {
        location.assign("/signout/");
        return;
      }
      await client?.auth.signOut({ scope: "local" });
      adoptSession(null);
    });
  }

  window.RavinAuthState = state;
  window.RavinAuth = {
    open: openSignIn,
    close() {},
    isSignedIn,
    ensureSession,
    getUser: () => state.user,
    getAccessToken: () => state.accessToken,
    async refreshSession() {
      if (!client) return false;
      const { data, error } = await client.auth.refreshSession();
      if (error || !data.session) return false;
      adoptSession(data.session);
      return true;
    },
    async signOut() {
      if (ON_ENTERARROW) {
        location.assign("/signout/");
        return;
      }
      await client?.auth.signOut({ scope: "local" });
      adoptSession(null);
    },
  };

  document.addEventListener("DOMContentLoaded", async () => {
    createAuthUI();
    const signedIn = await ensureSession();
    updateAuthUI();
    updateMainUI();
    if (!signedIn) document.getElementById("ravinAuthBackdrop").hidden = false;

    client?.auth.onAuthStateChange((_event, session) => {
      adoptSession(session);
    });
  });
})();
