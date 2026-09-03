(function () {
  let conversationId = null;

  async function request(path, options = {}) {
    const token = window.RavinAuth?.getAccessToken?.() || window.RavinAuthState?.accessToken || "";
    const headers = { ...(options.headers || {}), "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || `RAVIN request failed (HTTP ${response.status}).`);
    }

    return data;
  }

  async function chat(message) {
    if (!window.RavinAuth?.isSignedIn?.()) {
      throw new Error("Please sign in to RAVIN before sending a message.");
    }

    const data = await request("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
      }),
    });

    if (data?.conversation_id) conversationId = data.conversation_id;
    return data;
  }

  function clearConversation() {
    conversationId = null;
  }

  window.RavinAPI = {
    chat,
    clearConversation,
    getConversationId: () => conversationId,
  };
})();
