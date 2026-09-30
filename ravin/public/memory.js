/**
 * RAVIN memory is part of the shared ARROW account.
 * The browser never owns separate database credentials; authenticated requests
 * go through the RAVIN backend using the universal ARROW session.
 */
(function () {
  function isConfigured() {
    return Boolean(window.RavinAuth?.isSignedIn?.());
  }

  async function listPermanentMemories() {
    if (!isConfigured()) return [];
    const data = await window.RavinAPI.request("/api/memories");
    return data?.permanent || [];
  }

  async function addPermanentMemory(content, category = "fact") {
    if (!isConfigured()) throw new Error("Sign in to ARROW before saving RAVIN memory.");
    const data = await window.RavinAPI.request("/api/memories", {
      method: "POST",
      body: JSON.stringify({ content: content.trim(), category }),
    });
    return data?.memory || null;
  }

  async function deletePermanentMemory(id) {
    if (!isConfigured()) throw new Error("Sign in to ARROW before changing RAVIN memory.");
    await window.RavinAPI.request(`/api/memories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async function updatePermanentMemory(id, newContent) {
    if (!isConfigured()) throw new Error("Sign in to ARROW before changing RAVIN memory.");
    const data = await window.RavinAPI.request(`/api/memories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ content: newContent.trim() }),
    });
    return data?.memory || null;
  }

  async function buildMemoryContext() {
    // Memory context is assembled server-side alongside ARROW Field context so
    // the browser cannot accidentally send stale or cross-account memory.
    return "";
  }

  window.RavinMemory = {
    isConfigured,
    getStoredUrl: () => "",
    getStoredAnonKey: () => "",
    saveCredentials() {},
    listPermanentMemories,
    addPermanentMemory,
    deletePermanentMemory,
    updatePermanentMemory,
    buildMemoryContext,
  };
})();
