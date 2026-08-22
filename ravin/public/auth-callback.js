(function () {
  const ACCESS_KEY = "ravin_access_token";
  const REFRESH_KEY = "ravin_refresh_token";
  const USER_KEY = "ravin_user";
  const EXPIRES_KEY = "ravin_token_expires_at";
  const AUTH_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co/functions/v1/ravin-auth";

  function parseHash() {
    const raw = window.location.hash.replace(/^#/, "");
    return new URLSearchParams(raw);
  }

  async function handleCallback() {
    const params = parseHash();
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");
    if (!accessToken || !refreshToken || !type) return false;

    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify_access_token", access_token: accessToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.user) throw new Error(data.error || "Email verification could not be completed.");

    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    const expiresAt = params.get("expires_at");
    const expiresIn = Number(params.get("expires_in") || 0);
    if (expiresAt) localStorage.setItem(EXPIRES_KEY, String(Number(expiresAt) * 1000));
    else if (expiresIn) localStorage.setItem(EXPIRES_KEY, String(Date.now() + expiresIn * 1000));

    history.replaceState({}, document.title, window.location.pathname + window.location.search);
    window.location.reload();
    return true;
  }

  handleCallback().catch((error) => {
    console.error("RAVIN auth callback failed:", error);
    const message = document.createElement("div");
    message.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:#0a0a0d;color:#fff;font:16px system-ui;text-align:center";
    message.textContent = `RAVIN couldn't finish email verification: ${error.message}`;
    document.body.appendChild(message);
  });
})();
