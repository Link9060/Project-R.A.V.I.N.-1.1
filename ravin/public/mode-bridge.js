(() => {
  const MODE_KEY = "ravin_mode";
  const modeIds = {
    conversation: "ravin_conversation_id_conversation",
    work: "ravin_conversation_id_work",
  };

  const normalizeMode = (value) => String(value || "").toLowerCase() === "work" ? "work" : "conversation";
  let currentMode = normalizeMode(localStorage.getItem(MODE_KEY));
  localStorage.setItem(MODE_KEY, currentMode);
  document.documentElement.dataset.ravinMode = currentMode;

  function showReplyFallback(reply, mode) {
    const existing = document.getElementById("ravinReplyFallback");
    existing?.remove();
    const card = document.createElement("section");
    card.id = "ravinReplyFallback";
    card.className = "ravin-reply-fallback";
    const label = document.createElement("small");
    label.textContent = `RAVIN · ${mode === "work" ? "WORK" : "CONVERSATION"}`;
    const body = document.createElement("div");
    body.className = "ravin-reply-fallback-body";
    body.textContent = reply;
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss RAVIN reply");
    close.textContent = "×";
    close.addEventListener("click", () => card.remove());
    card.append(label, body, close);
    document.body.appendChild(card);
  }

  function makeReplyVisible(reply, mode) {
    const panel = document.querySelector(".chat-panel");
    const opener = document.querySelector(".side-drawer-tab.drawer-left");
    if (panel?.classList.contains("closed") && opener) opener.click();

    setTimeout(() => {
      const assistantMessages = [...document.querySelectorAll(".chat-panel .message.assistant")];
      const probe = String(reply || "").trim().slice(0, 28);
      const rendered = probe && assistantMessages.some((node) => (node.textContent || "").includes(probe));
      if (!rendered && reply) showReplyFallback(reply, mode);
      document.querySelector(".chat-scroll")?.scrollTo({ top: 999999, behavior: "smooth" });
    }, 650);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const isChat = /\/api\/chat(?:\?|$)/.test(url);
    if (!isChat || String(init?.method || "GET").toUpperCase() !== "POST") {
      return originalFetch(input, init);
    }

    let body = null;
    try {
      body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }

    if (body && typeof body === "object") {
      const mode = normalizeMode(localStorage.getItem(MODE_KEY));
      body.mode = mode;
      body.conversation_id = localStorage.getItem(modeIds[mode]) || null;
      init = { ...init, body: JSON.stringify(body) };

      const response = await originalFetch(input, init);
      try {
        const data = await response.clone().json();
        if (response.ok && data?.conversation_id) {
          localStorage.setItem(modeIds[mode], data.conversation_id);
        }
        if (response.ok && typeof data?.reply === "string" && data.reply.trim()) {
          makeReplyVisible(data.reply.trim(), mode);
        }
      } catch {
        // The React app will display request errors itself.
      }
      return response;
    }

    return originalFetch(input, init);
  };

  function installModeSwitch() {
    if (document.getElementById("ravinModeSwitch")) return;

    const style = document.createElement("style");
    style.textContent = `
      .ravin-mode-switch{position:fixed;top:max(62px,calc(env(safe-area-inset-top) + 52px));left:50%;transform:translateX(-50%);z-index:9000;display:flex;gap:3px;padding:4px;border:1px solid rgba(255,255,255,.13);border-radius:999px;background:rgba(5,6,8,.72);backdrop-filter:blur(18px);box-shadow:0 12px 35px rgba(0,0,0,.28)}
      .ravin-mode-switch button{appearance:none;border:0;border-radius:999px;padding:7px 12px;background:transparent;color:rgba(255,255,255,.58);font:600 10px/1.1 Inter,system-ui,sans-serif;letter-spacing:.08em;cursor:pointer;transition:background .18s ease,color .18s ease,transform .18s ease}
      .ravin-mode-switch button:hover{color:#fff}
      .ravin-mode-switch button.active{background:rgba(255,255,255,.13);color:#fff}
      .ravin-mode-switch button:active{transform:scale(.97)}
      .ravin-mode-switch .mode-dot{display:inline-block;width:5px;height:5px;margin-right:6px;border-radius:50%;background:currentColor;vertical-align:1px}
      .ravin-reply-fallback{position:fixed;right:22px;bottom:92px;z-index:12000;width:min(420px,calc(100vw - 44px));max-height:42vh;overflow:auto;padding:16px 42px 16px 16px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(7,9,13,.94);color:#f4f6fb;box-shadow:0 20px 60px rgba(0,0,0,.46);backdrop-filter:blur(20px);font:400 13px/1.55 Inter,system-ui,sans-serif}
      .ravin-reply-fallback small{display:block;margin-bottom:8px;color:rgba(255,255,255,.48);font:600 8px/1 IBM Plex Mono,monospace;letter-spacing:.14em}
      .ravin-reply-fallback button{position:absolute;top:8px;right:10px;border:0;background:transparent;color:rgba(255,255,255,.6);font-size:22px;cursor:pointer}
      .ravin-reply-fallback-body{white-space:pre-wrap;overflow-wrap:anywhere}
      @media(max-width:700px){.ravin-mode-switch{top:max(54px,calc(env(safe-area-inset-top) + 44px))}.ravin-mode-switch button{padding:6px 9px;font-size:9px}.ravin-reply-fallback{right:12px;bottom:78px;width:calc(100vw - 24px)}}
    `;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = "ravinModeSwitch";
    root.className = "ravin-mode-switch";
    root.setAttribute("role", "tablist");
    root.setAttribute("aria-label", "RAVIN AI mode");

    const modes = [
      ["conversation", "CONVERSATION"],
      ["work", "WORK"],
    ];

    const render = () => {
      currentMode = normalizeMode(localStorage.getItem(MODE_KEY));
      document.documentElement.dataset.ravinMode = currentMode;
      root.querySelectorAll("button").forEach((button) => {
        const active = button.dataset.mode === currentMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
    };

    for (const [mode, label] of modes) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mode = mode;
      button.setAttribute("role", "tab");
      button.innerHTML = `<span class="mode-dot"></span>${label}`;
      button.addEventListener("click", () => {
        localStorage.setItem(MODE_KEY, mode);
        currentMode = mode;
        render();
        window.dispatchEvent(new CustomEvent("ravin-mode-changed", { detail: { mode } }));
      });
      root.appendChild(button);
    }

    document.body.appendChild(root);
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installModeSwitch, { once: true });
  } else {
    installModeSwitch();
  }
})();
