(function () {
  const DEFAULT_BACKEND_URL = "";
  const BACKEND_URL_KEY = "ravin_backend_url";

  function getBackendUrl() {
    const configured = (window.RAVIN_CONFIG?.backendUrl || localStorage.getItem(BACKEND_URL_KEY) || DEFAULT_BACKEND_URL).trim();
    return configured.replace(/\/$/, "");
  }

  async function request(path, options = {}) {
    const token = window.RavinAuth?.getAccessToken?.() || "";
    if (!token) throw new Error("Please sign in to RAVIN first.");

    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(`${getBackendUrl()}${path}`, { ...options, headers });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }

    if (response.status === 401) {
      window.RavinAuth?.signOut?.();
      throw new Error(data?.error || "Your RAVIN session expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data?.error || `RAVIN backend error (${response.status}).`);
    return data;
  }

  async function chat(message, conversationId = null) {
    const data = await request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversation_id: conversationId })
    });
    return { ...data, content: data?.reply || "" };
  }

  async function health() {
    const response = await fetch(`${getBackendUrl()}/api/health`, { headers: { Accept: "application/json" } });
    return response.json();
  }

  window.RavinAPI = { request, chat, health, getBackendUrl };
})();
