(() => {
  const SUPABASE_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co";
  const SUPABASE_KEY = "sb_publishable_wVnTPMs0hUuWdt1_LGMIYQ_D-aXveMV";
  const MODE_KEY = "ravin_mode";
  const AUTH_KEYS = { access: "ravin_access_token", user: "ravin_user" };
  const conversationKeys = {
    conversation: "ravin_conversation_id_conversation",
    work: "ravin_conversation_id_work",
  };

  const parseJSON = (raw, fallback = null) => {
    try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
  };
  const mode = () => localStorage.getItem(MODE_KEY) === "work" ? "work" : "conversation";
  const activeConversationId = () => localStorage.getItem(conversationKeys[mode()]) || "";
  const user = () => parseJSON(localStorage.getItem(AUTH_KEYS.user), null);
  const token = () => localStorage.getItem(AUTH_KEYS.access) || "";

  function injectStyles() {
    if (document.getElementById("ravinConversationActionStyles")) return;
    const style = document.createElement("style");
    style.id = "ravinConversationActionStyles";
    style.textContent = `
      .ravin-delete-chat-button{color:rgb(var(--ink-faint))}
      .ravin-delete-chat-button:hover{color:rgb(var(--danger));background:rgba(248,113,113,.08)!important}
      .ravin-delete-chat-button[hidden]{display:none!important}
      .ravin-delete-backdrop{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.46);backdrop-filter:blur(8px);animation:ravinDeleteFade 150ms ease both}
      .ravin-delete-card{width:min(420px,100%);border:1px solid rgb(var(--border));border-radius:16px;background:rgb(var(--surface-raised));box-shadow:0 24px 80px rgba(0,0,0,.28);padding:20px;animation:ravinDeleteCard 180ms cubic-bezier(.22,1,.36,1) both}
      .ravin-delete-icon{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;margin-bottom:16px;background:rgba(248,113,113,.1);color:rgb(var(--danger))}
      .ravin-delete-icon svg{width:18px;height:18px}
      .ravin-delete-card h2{margin:0;font:600 18px/1.2 "Space Grotesk",system-ui,sans-serif;letter-spacing:-.02em}
      .ravin-delete-card p{margin:9px 0 0;color:rgb(var(--ink-muted));font-size:11px;line-height:1.55}
      .ravin-delete-title{display:block;margin-top:5px;color:rgb(var(--ink));font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ravin-delete-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
      .ravin-delete-actions button{appearance:none;border:1px solid rgb(var(--border));border-radius:9px;padding:8px 12px;background:rgb(var(--surface));color:rgb(var(--ink));font-size:10px;font-weight:600;cursor:pointer}
      .ravin-delete-actions .danger{border-color:rgba(248,113,113,.28);background:rgb(var(--danger));color:white}
      .ravin-delete-actions button:disabled{opacity:.55;cursor:default}
      .ravin-delete-error{min-height:14px;margin-top:10px;color:rgb(var(--danger));font-size:9px}
      @keyframes ravinDeleteFade{from{opacity:0}to{opacity:1}}
      @keyframes ravinDeleteCard{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
      html[data-theme="light"] .ravin-delete-backdrop{background:rgba(15,23,42,.22)}
    `;
    document.head.appendChild(style);
  }

  const trashIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>`;

  function ensureDeleteButton() {
    const right = document.querySelector(".ravin-header-right");
    if (!right) return;
    let button = document.getElementById("deleteChatBtn");
    if (!button) {
      button = document.createElement("button");
      button.id = "deleteChatBtn";
      button.type = "button";
      button.className = "ravin-icon-button ravin-delete-chat-button";
      button.setAttribute("aria-label", "Delete current chat");
      button.title = "Delete chat";
      button.innerHTML = trashIcon();
      button.addEventListener("click", openDeleteDialog);
      const settings = document.getElementById("settingsBtn");
      right.insertBefore(button, settings || null);
    }
    button.hidden = !activeConversationId();
  }

  function currentTitle() {
    return document.getElementById("headerConversationTitle")?.textContent?.trim() || "this conversation";
  }

  function closeDeleteDialog() {
    document.getElementById("ravinDeleteBackdrop")?.remove();
  }

  function openDeleteDialog() {
    const id = activeConversationId();
    if (!id) return;
    closeDeleteDialog();
    const backdrop = document.createElement("div");
    backdrop.id = "ravinDeleteBackdrop";
    backdrop.className = "ravin-delete-backdrop";
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
    backdrop.querySelector(".ravin-delete-title").textContent = currentTitle();
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest('[data-action="cancel"]')) closeDeleteDialog();
      if (event.target.closest('[data-action="delete"]')) deleteConversation(backdrop);
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-action="cancel"]')?.focus();
  }

  async function deleteConversation(backdrop) {
    const id = activeConversationId();
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

      if (localStorage.getItem(conversationKeys[mode()]) === id) localStorage.removeItem(conversationKeys[mode()]);
      if (localStorage.getItem("ravin_conversation_id") === id) localStorage.removeItem("ravin_conversation_id");
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
      if (event.target.closest("#newChatBtn,#conversationModeBtn,#workModeBtn,.ravin-history-item")) {
        setTimeout(ensureDeleteButton, 0);
        setTimeout(ensureDeleteButton, 120);
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.getElementById("ravinDeleteBackdrop")) closeDeleteDialog();
    });
    const history = document.getElementById("historyList");
    if (history) new MutationObserver(ensureDeleteButton).observe(history, { childList: true, subtree: true });
    const title = document.getElementById("headerConversationTitle");
    if (title) new MutationObserver(ensureDeleteButton).observe(title, { childList: true, subtree: true, characterData: true });
  }

  function init() {
    injectStyles();
    ensureDeleteButton();
    bindRefreshHooks();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();