(() => {
  const SUPABASE_URL = "https://cnorozrjugxpanpfmssa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_yVNPiB7opT0WRvBfKTZ2BA_s5bOQLRg";
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

  async function refreshSession() {
    const current = readShared();
    const refreshToken = current?.refresh_token || state.refreshToken;
    if (!refreshToken) return false;

    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    const next = await response.json().catch(() => ({}));
    if (!response.ok || !next?.access_token) return false;

    writeShared(next);
    mirror(next);
    return true;
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
    const login = new URL("/", window.location.origin);
    login.searchParams.set("next", "/ravin/");
    window.location.assign(login.toString());
  }

  function signOut() {
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