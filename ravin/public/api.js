(function () {
  const MODE_KEY = "ravin_mode";
  const conversationIds = {
    conversation: null,
    work: null,
  };

  let currentMode = localStorage.getItem(MODE_KEY) === "work" ? "work" : "conversation";

  function normalizeMode(mode) {
    return String(mode || "").toLowerCase() === "work" ? "work" : "conversation";
  }

  async function request(path, options = {}) {
    if (window.RavinAuth?.ensureSession) {
      const validSession = await window.RavinAuth.ensureSession();
      if (!validSession) {
        window.RavinAuth.open?.();
        throw new Error("Please sign in to RAVIN.");
      }
    }

    const token = window.RavinAuth?.getAccessToken?.() || window.RavinAuthState?.accessToken || "";
    const headers = { ...(options.headers || {}), "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        window.RavinAuth?.open?.();
      }
      throw new Error(data?.error || `RAVIN request failed (HTTP ${response.status}).`);
    }

    return data;
  }

  async function chat(message, options = {}) {
    if (!window.RavinAuth?.isSignedIn?.()) {
      window.RavinAuth?.open?.();
      throw new Error("Please sign in to RAVIN before sending a message.");
    }

    const mode = normalizeMode(options.mode || currentMode);
    const data = await request("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        mode,
        conversation_id: conversationIds[mode],
      }),
    });

    if (data?.conversation_id) conversationIds[mode] = data.conversation_id;
    return data;
  }

  function setMode(mode) {
    currentMode = normalizeMode(mode);
    localStorage.setItem(MODE_KEY, currentMode);
    window.dispatchEvent(new CustomEvent("ravin-mode-changed", {
      detail: { mode: currentMode },
    }));
    return currentMode;
  }

  function clearConversation(mode = currentMode) {
    conversationIds[normalizeMode(mode)] = null;
  }

  window.RavinAPI = {
    chat,
    request,
    setMode,
    getMode: () => currentMode,
    clearConversation,
    getConversationId: (mode = currentMode) => conversationIds[normalizeMode(mode)],
  };
})();
