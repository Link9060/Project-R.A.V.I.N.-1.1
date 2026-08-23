/**
 * RAVIN Memory Client
 *
 * Memory is owned by the authenticated RAVIN account and accessed through
 * the RAVIN backend. Supabase credentials never need to be entered into the browser.
 */
(function () {
  async function listPermanentMemories() {
    const data = await window.RavinAPI.request("/api/memories");
    return data?.permanent || [];
  }

  async function addPermanentMemory(content, category) {
    const data = await window.RavinAPI.request("/api/memories", {
      method: "POST",
      body: JSON.stringify({ content: content.trim(), category: category || "fact" })
    });
    return data?.memory || null;
  }

  async function deletePermanentMemory(id) {
    await window.RavinAPI.request(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function updatePermanentMemory(id, newContent) {
    throw new Error("Memory editing is not exposed by the production API yet.");
  }

  async function buildMemoryContext() {
    const memories = await listPermanentMemories();
    if (!memories.length) return "";
    const lines = memories.map((m) => `- [id:${m.id}] (${m.category}) ${m.content}`).join("\n");
    return `\n\nPERSISTENT MEMORY — things you already know about Levi from past conversations:\n${lines}`;
  }

  window.RavinMemory = {
    isConfigured: () => Boolean(window.RavinAuth?.isSignedIn?.()),
    getStoredUrl: () => window.RavinAPI?.getBackendUrl?.() || "",
    getStoredAnonKey: () => "",
    saveCredentials: () => { throw new Error("RAVIN manages Supabase credentials on the server."); },
    listPermanentMemories,
    addPermanentMemory,
    deletePermanentMemory,
    updatePermanentMemory,
    buildMemoryContext,
  };
})();
