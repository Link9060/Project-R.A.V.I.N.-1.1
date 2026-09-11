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
      @media(max-width:700px){.ravin-mode-switch{top:max(54px,calc(env(safe-area-inset-top) + 44px))}.ravin-mode-switch button{padding:6px 9px;font-size:9px}}
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
