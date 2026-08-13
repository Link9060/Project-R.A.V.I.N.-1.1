/**
 * RAVIN Memory System (Phase 3, layer 1: Permanent Memory)
 *
 * Wraps Supabase for storage. Uses the same "bring your own credentials"
 * pattern as the Groq key: RAVIN talks to YOUR Supabase project directly
 * from the browser using your anon key, stored only in localStorage.
 *
 * Exposes window.RavinMemory with everything app.js needs.
 */
(function () {
  const URL_KEY = "ravin_supabase_url";
  const ANON_KEY = "ravin_supabase_key";

  let client = null;

  function getStoredUrl() {
    return (localStorage.getItem(URL_KEY) || "").trim();
  }

  function getStoredAnonKey() {
    return (localStorage.getItem(ANON_KEY) || "").trim();
  }

  function isConfigured() {
    return Boolean(getStoredUrl() && getStoredAnonKey());
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client) {
      client = window.supabase.createClient(getStoredUrl(), getStoredAnonKey());
    }
    return client;
  }

  function saveCredentials(url, anonKey) {
    if (url) localStorage.setItem(URL_KEY, url.trim());
    else localStorage.removeItem(URL_KEY);

    if (anonKey) localStorage.setItem(ANON_KEY, anonKey.trim());
    else localStorage.removeItem(ANON_KEY);

    client = null; // force re-init with new credentials
  }

  // ---------- Permanent Memory ----------

  async function listPermanentMemories() {
    const db = getClient();
    if (!db) return [];
    const { data, error } = await db
      .from("permanent_memories")
      .select("id, content, category, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[RavinMemory] listPermanentMemories failed:", error.message);
      return [];
    }
    return data || [];
  }

  async function addPermanentMemory(content, category) {
    const db = getClient();
    if (!db) throw new Error("Memory isn't set up yet — add your Supabase credentials in Settings.");
    const { data, error } = await db
      .from("permanent_memories")
      .insert({ content: content.trim(), category: category || "fact" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function deletePermanentMemory(id) {
    const db = getClient();
    if (!db) throw new Error("Memory isn't set up yet — add your Supabase credentials in Settings.");
    const { error } = await db.from("permanent_memories").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async function updatePermanentMemory(id, newContent) {
    const db = getClient();
    if (!db) throw new Error("Memory isn't set up yet — add your Supabase credentials in Settings.");
    const { data, error } = await db
      .from("permanent_memories")
      .update({ content: newContent.trim(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Builds the block of text injected into RAVIN's system prompt so it
  // knows what it remembers, WITH ids so it can reference specific memories
  // precisely when using the remember/forget/update tools.
  async function buildMemoryContext() {
    if (!isConfigured()) return "";
    const memories = await listPermanentMemories();
    if (memories.length === 0) return "";

    const lines = memories
      .map((m) => `- [id:${m.id}] (${m.category}) ${m.content}`)
      .join("\n");

    return `\n\nPERSISTENT MEMORY — things you already know about Levi from past conversations:\n${lines}\n\nYou can update this memory using the remember_fact, forget_fact, and update_fact tools when Levi tells you something worth remembering, asks you to forget something, or corrects something you know.`;
  }

  window.RavinMemory = {
    isConfigured,
    getStoredUrl,
    getStoredAnonKey,
    saveCredentials,
    listPermanentMemories,
    addPermanentMemory,
    deletePermanentMemory,
    updatePermanentMemory,
    buildMemoryContext,
  };
})();
