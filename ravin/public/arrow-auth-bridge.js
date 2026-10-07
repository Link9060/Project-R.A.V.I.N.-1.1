(() => {
  const SUPABASE_URL = "https://cnorozrjugxpanpfmssa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_yVNPiB7opT0WRvBfKTZ2BA_s5bOQLRg";
  const BETA = location.hostname === "link9060.github.io" && location.pathname.startsWith("/Resonant-Relay/arrow/");
  const SHARED_KEY = "sb-cnorozrjugxpanpfmssa-auth-token";
  const LEGACY_KEYS = {
    access: "ravin_access_token",
    refresh: "ravin_refresh_token",
    user: "ravin_user",
    expires: "ravin_token_expires_at",
  };

  const state = {
    accessToken: "",
    refreshToken: "",
    user: null,
    expiresAt: 0,
  };

  function readShared() {
    try {
      return JSON.parse(localStorage.getItem(SHARED_KEY) || "null");
    } catch {
      return null;
    }
  }

  function writeShared(session) {
    localStorage.setItem(SHARED_KEY, JSON.stringify(session));
  }

  function mirror(session = readShared()) {
    const owner = session?.user?.id || '';
    const previousOwner = localStorage.getItem('ravin_conversation_owner_v1') || '';
    if (owner !== previousOwner) {
      for (const key of ['ravin_conversation_id_conversation','ravin_conversation_id_work','ravin_conversation_id']) localStorage.removeItem(key);
      localStorage.setItem('ravin_conversation_owner_v1',owner);
    }
    if (!session?.access_token) {
      state.accessToken = "";
      state.refreshToken = "";
      state.user = null;
      state.expiresAt = 0;
      Object.values(LEGACY_KEYS).forEach(key => localStorage.removeItem(key));
      emit();
      return false;
    }

    state.accessToken = session.access_token;
    state.refreshToken = session.refresh_token || "";
    state.user = session.user || null;
    state.expiresAt = session.expires_at
      ? Number(session.expires_at) * 1000
      : Date.now() + Number(session.expires_in || 3600) * 1000;

    localStorage.setItem(LEGACY_KEYS.access, state.accessToken);
    if (state.refreshToken) localStorage.setItem(LEGACY_KEYS.refresh, state.refreshToken);
    else localStorage.removeItem(LEGACY_KEYS.refresh);
    if (state.user) localStorage.setItem(LEGACY_KEYS.user, JSON.stringify(state.user));
    else localStorage.removeItem(LEGACY_KEYS.user);
    localStorage.setItem(LEGACY_KEYS.expires, String(state.expiresAt));
    emit();
    return true;
  }

  function emit() {
    window.RavinAuthState = state;
    window.dispatchEvent(new CustomEvent("ravin-auth-changed", {
      detail: { signedIn: Boolean(state.accessToken && state.user), user: state.user },
    }));
  }

  let refreshing = null;
  async function performRefresh() {
    const current = readShared();
    const refreshToken = current?.refresh_token;
    if (!refreshToken) return false;

    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(12000),
    });

    const next = await response.json().catch(() => ({}));
    if (!response.ok || !next?.access_token) return false;

    if (readShared()?.refresh_token !== refreshToken) return false;
    writeShared(next);
    mirror(next);
    return true;
  }

  async function refreshSession() {
    if (refreshing) return refreshing;
    const pending = performRefresh();
    refreshing = pending;
    try { return await pending; }
    finally { if (refreshing === pending) refreshing = null; }
  }

  async function ensureSession() {
    const current = readShared();
    if (!current?.access_token) return false;
    mirror(current);

    const expiresAt = current.expires_at
      ? Number(current.expires_at) * 1000
      : state.expiresAt;

    if (!expiresAt || expiresAt - Date.now() > 60_000) return true;
    return refreshSession();
  }

  function open() {
    if (BETA) { localStorage.setItem("arrow-post-auth-url-v1", location.href); location.assign("/Resonant-Relay/login/"); return; }
    const login = new URL("/", window.location.origin);
    login.searchParams.set("next", "/ravin/");
    window.location.assign(login.toString());
  }

  function signOut() {
    if (BETA) {
      const token=readShared()?.access_token;
      localStorage.removeItem(SHARED_KEY); mirror();
      void (async()=>{try {if(token)await fetch(SUPABASE_URL+"/auth/v1/logout",{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+token},signal:AbortSignal.timeout(12000)});}catch{}finally{location.assign("/Resonant-Relay/login/");}})();return;
    }
    window.location.assign("/signout/");
  }

  window.RavinAuth = {
    open,
    close() {},
    isSignedIn() {
      return Boolean(readShared()?.access_token);
    },
    ensureSession,
    refreshSession,
    getUser() {
      return readShared()?.user || state.user;
    },
    getAccessToken() {
      return readShared()?.access_token || state.accessToken;
    },
    signOut,
  };

  mirror();

  window.addEventListener("storage", event => {
    if (event.key === SHARED_KEY) mirror();
  });

  window.setInterval(() => {
    void ensureSession().catch(() => {});
  }, 45_000);
})();
