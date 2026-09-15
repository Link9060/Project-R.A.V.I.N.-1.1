(() => {
  const SUPABASE_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co";
  const SUPABASE_KEY = "sb_publishable_wVnTPMs0hUuWdt1_LGMIYQ_D-aXveMV";
  const AUTH_KEYS = { access: "ravin_access_token", user: "ravin_user" };
  const conversationKeys = {
    conversation: "ravin_conversation_id_conversation",
    work: "ravin_conversation_id_work",
  };

  let conversationCache = [];
  let syncTimer = 0;
  let syncing = false;

  const parseJSON = (raw, fallback = null) => {
    try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
  };
  const user = () => parseJSON(localStorage.getItem(AUTH_KEYS.user), null);
  const token = () => localStorage.getItem(AUTH_KEYS.access) || "";

  function injectStyles() {
    if (document.getElementById("ravinConversationActionStyles")) return;
    const style = document.createElement("style");
    style.id = "ravinConversationActionStyles";
    style.textContent = `
      .ravin-history-item{position:relative;padding-right:35px!important}
      .ravin-history-delete{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:25px;height:25px;display:grid;place-items:center;border-radius:7px;color:rgb(var(--rv-faint,var(--ink-faint)));opacity:0;pointer-events:none;transition:opacity 140ms ease,color 140ms ease,background-color 140ms ease;z-index:2}
      .ravin-history-delete svg{width:14px!important;height:14px!important}
      .ravin-history-item:hover .ravin-history-delete,.ravin-history-item:focus-visible .ravin-history-delete,.ravin-history-item.active .ravin-history-delete{opacity:.72;pointer-events:auto}
      .ravin-history-delete:hover,.ravin-history-delete:focus-visible{opacity:1!important;color:rgb(var(--danger));background:rgba(248,113,113,.09);outline:none}
      .ravin-history-delete:active{transform:translateY(-50%) scale(.92)}
      .ravin-delete-backdrop{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.46);backdrop-filter:blur(8px);animation:ravinDeleteFade 150ms ease both}
      .ravin-delete-card{width:min(420px,100%);border:1px solid rgb(var(--rv-line,var(--border)));border-radius:14px;background:rgb(var(--rv-panel-2,var(--surface-raised)));box-shadow:0 24px 80px rgba(0,0,0,.28);padding:20px;animation:ravinDeleteCard 180ms cubic-bezier(.22,1,.36,1) both}
      .ravin-delete-icon{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;margin-bottom:16px;background:rgba(248,113,113,.1);color:rgb(var(--danger))}
      .ravin-delete-icon svg{width:18px;height:18px}
      .ravin-delete-card h2{margin:0;font:600 18px/1.2 "Space Grotesk",system-ui,sans-serif;letter-spacing:-.02em;color:rgb(var(--rv-text,var(--ink)))}
      .ravin-delete-card p{margin:9px 0 0;color:rgb(var(--rv-muted,var(--ink-muted)));font-size:11px;line-height:1.55}
      .ravin-delete-title{display:block;margin-top:5px;color:rgb(var(--rv-text,var(--ink)));font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ravin-delete-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
      .ravin-delete-actions button{appearance:none;border:1px solid rgb(var(--rv-line,var(--border)));border-radius:9px;padding:8px 12px;background:rgb(var(--rv-panel,var(--surface)));color:rgb(var(--rv-text,var(--ink)));font-size:10px;font-weight:600;cursor:pointer}
      .ravin-delete-actions .danger{border-color:rgba(248,113,113,.28);background:rgb(var(--danger));color:white}
      .ravin-delete-actions button:disabled{opacity:.55;cursor:default}
      .ravin-delete-error{min-height:14px;margin-top:10px;color:rgb(var(--danger));font-size:9px}
      @keyframes ravinDeleteFade{from{opacity:0}to{opacity:1}}
      @keyframes ravinDeleteCard{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
      html[data-theme="light"] .ravin-delete-backdrop{background:rgba(15,23,42,.22)}
      @media (hover:none){.ravin-history-delete{opacity:.62;pointer-events:auto}}
    `;
    document.head.appendChild(style);
  }

  const trashIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>`;

  function removeLegacyHeaderButton() {
    document.getElementById("deleteChatBtn")?.remove();
  }

  async function loadConversationCache() {
    const currentUser = user();
    const accessToken = token();
    if (!currentUser?.id || !accessToken) {
      conversationCache = [];
      return [];
    }

    const query = `/rest/v1/conversations?user_id=eq.${encodeURIComponent(currentUser.id)}&select=id,title,metadata,created_at&order=created_at.desc&limit=100`;
    const response = await fetch(`${SUPABASE_URL}${query}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const text = await response.text();
    let rows = [];
    try { rows = text ? JSON.parse(text) : []; } catch { rows = []; }
    if (!response.ok) throw new Error(rows?.message || rows?.error || `Couldn't load chats (${response.status}).`);
    conversationCache = Array.isArray(rows) ? rows : [];
    return conversationCache;
  }

  function visibleConversationRows() {
    const query = document.getElementById("historySearch")?.value?.trim().toLowerCase() || "";
    return conversationCache.filter((item) => !query || String(item.title || "Untitled").toLowerCase().includes(query));
  }

  function attachDeleteAction(button, row) {
    if (!button || !row) return;
    button.dataset.conversationId = row.id;
    button.dataset.conversationTitle = row.title || "Untitled";
    let action = button.querySelector(".ravin-history-delete");
    if (!action) {
      action = document.createElement("span");
      action.className = "ravin-history-delete";
      action.setAttribute("role", "button");
      action.setAttribute("tabindex", "0");
      action.setAttribute("aria-label", `Delete ${row.title || "chat"}`);
      action.title = "Delete chat";
      action.innerHTML = trashIcon();
      action.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDeleteDialog({
          id: button.dataset.conversationId || "",
          title: button.dataset.conversationTitle || "Untitled",
        });
      });
      action.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        openDeleteDialog({
          id: button.dataset.conversationId || "",
          title: button.dataset.conversationTitle || "Untitled",
        });
      });
      button.appendChild(action);
    } else {
      action.setAttribute("aria-label", `Delete ${row.title || "chat"}`);
    }
  }

  async function syncSidebarActions(forceReload = false) {
    if (syncing) return;
    const history = document.getElementById("historyList");
    if (!history) return;
    syncing = true;
    try {
      if (forceReload || !conversationCache.length) await loadConversationCache();
      const rows = visibleConversationRows();
      const buttons = [...history.querySelectorAll(".ravin-history-item")];
      buttons.forEach((button, index) => attachDeleteAction(button, rows[index]));
    } catch (error) {
      console.warn("[RAVIN sidebar delete actions]", error);
    } finally {
      syncing = false;
    }
  }

  function scheduleSync(forceReload = false) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncSidebarActions(forceReload), 40);
  }

  function closeDeleteDialog() {
    document.getElementById("ravinDeleteBackdrop")?.remove();
  }

  function openDeleteDialog(conversation) {
    const id = conversation?.id || "";
    if (!id) return;
    closeDeleteDialog();
    const backdrop = document.createElement("div");
    backdrop.id = "ravinDeleteBackdrop";
    backdrop.className = "ravin-delete-backdrop";
    backdrop.dataset.conversationId = id;
    backdrop.innerHTML = `
      <section class="ravin-delete-card" role="dialog" aria-modal="true" aria-labelledby="ravinDeleteTitle">
        <div class="ravin-delete-icon">${trashIcon()}</div>
        <h2 id="ravinDeleteTitle">Delete chat?</h2>
        <p>This permanently deletes the conversation and all of its messages.<span class="ravin-delete-title"></span></p>
        <div class="ravin-delete-error" id="ravinDeleteError"></div>
        <div class="ravin-delete-actions">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="button" class="danger" data-action="delete">Delete chat</button>
        </div>
      </section>`;
    backdrop.querySelector(".ravin-delete-title").textContent = conversation.title || "Untitled";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest('[data-action="cancel"]')) closeDeleteDialog();
      if (event.target.closest('[data-action="delete"]')) deleteConversation(backdrop);
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-action="cancel"]')?.focus();
  }

  async function deleteConversation(backdrop) {
    const id = backdrop?.dataset?.conversationId || "";
    const currentUser = user();
    const accessToken = token();
    if (!id || !currentUser?.id || !accessToken) return;

    const remove = backdrop.querySelector('[data-action="delete"]');
    const cancel = backdrop.querySelector('[data-action="cancel"]');
    const error = backdrop.querySelector("#ravinDeleteError");
    remove.disabled = true;
    cancel.disabled = true;
    remove.textContent = "Deleting…";
    error.textContent = "";

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(currentUser.id)}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          Prefer: "return=representation",
        },
      });
      const text = await response.text();
      let data = [];
      try { data = text ? JSON.parse(text) : []; } catch { data = []; }
      if (!response.ok) throw new Error(data?.message || data?.error || `Delete failed (${response.status}).`);
      if (!Array.isArray(data) || !data.some((row) => row.id === id)) throw new Error("RAVIN couldn't verify that this chat was deleted.");

      Object.values(conversationKeys).forEach((key) => {
        if (localStorage.getItem(key) === id) localStorage.removeItem(key);
      });
      if (localStorage.getItem("ravin_conversation_id") === id) localStorage.removeItem("ravin_conversation_id");
      conversationCache = conversationCache.filter((row) => row.id !== id);
      closeDeleteDialog();
      location.reload();
    } catch (err) {
      error.textContent = err?.message || String(err);
      remove.disabled = false;
      cancel.disabled = false;
      remove.textContent = "Delete chat";
    }
  }

  function bindRefreshHooks() {
    document.addEventListener("click", (event) => {
      if (event.target.closest("#newChatBtn,#conversationModeBtn,#workModeBtn")) scheduleSync(true);
    }, true);

    document.getElementById("historySearch")?.addEventListener("input", () => scheduleSync(false));

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.getElementById("ravinDeleteBackdrop")) closeDeleteDialog();
    });

    const history = document.getElementById("historyList");
    if (history) {
      new MutationObserver(() => scheduleSync(true)).observe(history, { childList: true, subtree: false });
    }
  }

  async function init() {
    injectStyles();
    removeLegacyHeaderButton();
    bindRefreshHooks();
    await syncSidebarActions(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();