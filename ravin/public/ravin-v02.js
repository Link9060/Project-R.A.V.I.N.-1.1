(() => {
  const BACKEND_URL = "https://ravin-hyeq.onrender.com";
  const SUPABASE_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co";
  const AUTH_URL = `${SUPABASE_URL}/functions/v1/ravin-auth`;
  const AUTH_KEYS = {
    access: "ravin_access_token",
    refresh: "ravin_refresh_token",
    user: "ravin_user",
    expires: "ravin_token_expires_at",
  };
  const ENV_KEY = "ravin_environment";
  const MEMORY_KEY = "ravin_memory_enabled";
  const MAX_FILES = 4;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    controller: null,
    attachments: [],
    environment: localStorage.getItem(ENV_KEY) || ((innerWidth <= 700 && matchMedia("(pointer: coarse)").matches) ? "phone" : "desktop"),
    memoryEnabled: localStorage.getItem(MEMORY_KEY) !== "false",
    firstToken: false,
  };

  function parseJson(value, fallback = null) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }

  function currentUser() { return parseJson(localStorage.getItem(AUTH_KEYS.user), null); }
  function currentMode() { return localStorage.getItem("ravin_mode") === "work" ? "work" : "conversation"; }
  function conversationKey(mode = currentMode()) { return `ravin_conversation_id_${mode}`; }
  function currentConversationId() { return localStorage.getItem(conversationKey()) || ""; }

  async function refreshToken() {
    const refresh = localStorage.getItem(AUTH_KEYS.refresh) || "";
    if (!refresh) throw new Error("Your RAVIN session expired. Sign in again.");
    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh", refresh_token: refresh }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.session?.access_token) throw new Error(data?.error || "RAVIN couldn't refresh your session.");
    localStorage.setItem(AUTH_KEYS.access, data.session.access_token);
    if (data.session.refresh_token) localStorage.setItem(AUTH_KEYS.refresh, data.session.refresh_token);
    if (data.user || data.session.user) localStorage.setItem(AUTH_KEYS.user, JSON.stringify(data.user || data.session.user));
    const expiresAt = data.session.expires_at
      ? Number(data.session.expires_at) * 1000
      : Date.now() + Number(data.session.expires_in || 3600) * 1000;
    localStorage.setItem(AUTH_KEYS.expires, String(expiresAt));
    return data.session.access_token;
  }

  async function getToken(force = false) {
    let token = localStorage.getItem(AUTH_KEYS.access) || "";
    const expiresAt = Number(localStorage.getItem(AUTH_KEYS.expires) || 0);
    if (!token) throw new Error("Sign in to RAVIN first.");
    if (force || (expiresAt && expiresAt < Date.now() + 60_000)) token = await refreshToken();
    return token;
  }

  async function api(path, options = {}, retry = true) {
    let token = await getToken(false);
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    let response = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
    if (response.status === 401 && retry) {
      token = await getToken(true);
      headers.set("Authorization", `Bearer ${token}`);
      response = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `RAVIN request failed (${response.status}).`);
    return data;
  }

  function toast(message, duration = 2600) {
    $(".ravin-v02-toast")?.remove();
    const node = document.createElement("div");
    node.className = "ravin-v02-toast";
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), duration);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function inlineMarkdown(value) {
    let html = escapeHtml(value);
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    return html;
  }

  function appendTextBlocks(container, text) {
    const blocks = String(text || "").split(/\n{2,}/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n");
      const heading = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.+)$/) : null;
      if (heading) {
        const h = document.createElement(`h${heading[1].length}`);
        h.innerHTML = inlineMarkdown(heading[2]);
        container.appendChild(h);
        continue;
      }
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        const ul = document.createElement("ul");
        for (const line of lines) {
          const li = document.createElement("li");
          li.innerHTML = inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""));
          ul.appendChild(li);
        }
        container.appendChild(ul);
        continue;
      }
      if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
        const ol = document.createElement("ol");
        for (const line of lines) {
          const li = document.createElement("li");
          li.innerHTML = inlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ""));
          ol.appendChild(li);
        }
        container.appendChild(ol);
        continue;
      }
      const p = document.createElement("p");
      p.innerHTML = lines.map(inlineMarkdown).join("<br>");
      container.appendChild(p);
    }
  }

  function renderMarkdown(raw) {
    const root = document.createElement("div");
    root.className = "ravin-rich";
    const pattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
    let index = 0;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      appendTextBlocks(root, raw.slice(index, match.index));
      const wrap = document.createElement("div");
      wrap.className = "ravin-code-block";
      const head = document.createElement("div");
      head.className = "ravin-code-head";
      const language = document.createElement("span");
      language.textContent = match[1]?.trim() || "code";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "ravin-code-copy";
      copy.textContent = "COPY";
      const codeText = match[2].replace(/^\n|\n$/g, "");
      copy.addEventListener("click", async () => {
        await navigator.clipboard?.writeText(codeText);
        copy.textContent = "COPIED";
        setTimeout(() => { copy.textContent = "COPY"; }, 1200);
      });
      head.append(language, copy);
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeText;
      pre.appendChild(code);
      wrap.append(head, pre);
      root.appendChild(wrap);
      index = pattern.lastIndex;
    }
    appendTextBlocks(root, raw.slice(index));
    return root;
  }

  function extractBodyRaw(body) {
    if (body.dataset.v02Raw != null) return body.dataset.v02Raw;
    const clone = body.cloneNode(true);
    clone.querySelector(".ravin-message-time")?.remove();
    clone.querySelectorAll(".ravin-code-copy").forEach((node) => node.remove());
    return clone.textContent?.replace(/\u00a0/g, " ").trim() || "";
  }

  function bodyTime(body) {
    return body.querySelector(".ravin-message-time")?.textContent?.trim() || body.dataset.v02Time || "";
  }

  function setMessageBody(body, raw, role, { streaming = false, time = "" } = {}) {
    body.dataset.v02Raw = raw;
    if (time) body.dataset.v02Time = time;
    delete body.dataset.coreOriginal;
    delete body.dataset.coreTime;
    delete body.dataset.coreFlowActive;
    body.classList.remove("core-flow-active");
    body.replaceChildren();
    if (role === "assistant" && !streaming) body.appendChild(renderMarkdown(raw));
    else body.appendChild(document.createTextNode(raw));
    const stampText = time || body.dataset.v02Time;
    if (stampText) {
      const stamp = document.createElement("span");
      stamp.className = "ravin-message-time";
      stamp.textContent = stampText;
      body.appendChild(stamp);
    }
  }

  function addMessageActions(article) {
    if (!article || article.querySelector(":scope > .ravin-message-actions")) return;
    const role = article.classList.contains("user") ? "user" : article.classList.contains("assistant") ? "assistant" : "error";
    const body = $(".ravin-message-body", article);
    if (!body) return;
    const actions = document.createElement("div");
    actions.className = "ravin-message-actions";

    const add = (label, handler) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ravin-message-action";
      button.textContent = label;
      button.addEventListener("click", handler);
      actions.appendChild(button);
    };

    add("COPY", async () => {
      await navigator.clipboard?.writeText(extractBodyRaw(body));
      toast("Copied message");
    });

    if (role === "user") {
      add("EDIT", () => {
        const input = $("#messageInput");
        if (!input) return;
        input.value = extractBodyRaw(body);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        toast("Edit the message, then send it again");
      });
    }

    if (role === "assistant") {
      add("RETRY", () => {
        let node = article.previousElementSibling;
        while (node && !node.classList?.contains("user")) node = node.previousElementSibling;
        const previousBody = node?.querySelector?.(".ravin-message-body");
        if (!previousBody) return;
        const input = $("#messageInput");
        input.value = extractBodyRaw(previousBody);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        toast("Previous prompt loaded — send to retry");
      });
    }

    article.appendChild(actions);
  }

  function enhanceMessages() {
    for (const article of $$("#messages .ravin-message")) {
      const body = $(".ravin-message-body", article);
      if (!body) continue;
      const role = article.classList.contains("assistant") ? "assistant" : article.classList.contains("user") ? "user" : "error";
      if (body.dataset.v02Raw == null) {
        body.dataset.v02Raw = extractBodyRaw(body);
        body.dataset.v02Time = bodyTime(body);
      }
      if (role === "assistant" && body.dataset.coreFlowActive !== "true" && !article.classList.contains("ravin-v02-streaming") && !body.querySelector(".ravin-rich")) {
        setMessageBody(body, body.dataset.v02Raw, "assistant", { time: body.dataset.v02Time });
      }
      addMessageActions(article);
    }
  }

  function appendMessage(role, raw, { streaming = false, error = false } = {}) {
    const root = $("#messages");
    root?.querySelector(".ravin-empty")?.remove();
    const article = document.createElement("article");
    article.className = `ravin-message ${error ? "error" : role}${streaming ? " ravin-v02-streaming" : ""}`;
    const label = error ? "SYSTEM" : role === "assistant" ? "RAVIN" : "YOU";
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    article.innerHTML = `<div class="ravin-message-role">${label}</div><div class="ravin-message-body"></div>`;
    const body = $(".ravin-message-body", article);
    setMessageBody(body, raw, role, { streaming, time });
    root.appendChild(article);
    if (!streaming) addMessageActions(article);
    scrollBottom();
    return article;
  }

  function scrollBottom() {
    const scroller = $("#messageScroller");
    requestAnimationFrame(() => { if (scroller) scroller.scrollTop = scroller.scrollHeight; });
  }

  function setBusy(busy) {
    const input = $("#messageInput");
    const send = $("#sendBtn");
    if (input) input.disabled = busy;
    if (send) {
      send.disabled = false;
      send.type = busy ? "button" : "submit";
      send.classList.toggle("ravin-stop", busy);
      send.innerHTML = busy
        ? '<span aria-hidden="true" style="display:block;width:9px;height:9px;border-radius:2px;background:currentColor"></span>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>';
      send.setAttribute("aria-label", busy ? "Stop RAVIN" : "Send");
    }
    if ($("#composerStatus")) $("#composerStatus").textContent = busy ? "THINKING…" : "READY";
    if ($("#systemStatus")) $("#systemStatus").textContent = busy ? "THINKING" : "READY";
  }

  function handleStop(event) {
    if (!state.controller) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.controller.abort();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
      reader.onerror = () => reject(reader.error || new Error("Couldn't read the file."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadAttachment(file) {
    const data = await fileToBase64(file);
    const result = await api("/api/v2/files", {
      method: "POST",
      body: JSON.stringify({
        file: { name: file.name, type: file.type || "application/octet-stream", size: file.size, data_base64: data },
      }),
    });
    return result.file;
  }

  function renderAttachments() {
    const tray = $("#ravinAttachmentTray");
    if (!tray) return;
    tray.replaceChildren();
    tray.classList.toggle("has-files", state.attachments.length > 0);
    state.attachments.forEach((file, index) => {
      const chip = document.createElement("div");
      chip.className = "ravin-attachment-chip";
      const label = document.createElement("span");
      label.textContent = file.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.addEventListener("click", () => {
        state.attachments.splice(index, 1);
        renderAttachments();
      });
      chip.append(label, remove);
      tray.appendChild(chip);
    });
  }

  function addFiles(files) {
    for (const file of files) {
      if (state.attachments.length >= MAX_FILES) { toast(`RAVIN supports up to ${MAX_FILES} attachments per message right now.`); break; }
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name} is over the 8 MB attachment limit.`); continue; }
      if (state.attachments.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue;
      state.attachments.push(file);
    }
    renderAttachments();
  }

  async function readSse(response, handlers) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const process = (block) => {
      if (!block.trim()) return;
      let event = "message";
      const dataLines = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) return;
      let payload = {};
      try { payload = JSON.parse(dataLines.join("\n")); } catch { payload = { text: dataLines.join("\n") }; }
      handlers[event]?.(payload);
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() || "";
      chunks.forEach(process);
    }
    buffer += decoder.decode();
    if (buffer) process(buffer);
  }

  async function streamRequest(payload, handlers, retry = true) {
    let token = await getToken(false);
    const request = () => fetch(`${BACKEND_URL}/api/v2/chat/stream`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: state.controller.signal,
    });
    let response = await request();
    if (response.status === 401 && retry) {
      token = await getToken(true);
      response = await request();
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `RAVIN request failed (${response.status}).`);
    }
    await readSse(response, handlers);
  }

  async function submitMessage(event) {
    event?.preventDefault();
    event?.stopImmediatePropagation();
    if (state.controller) return;
    const input = $("#messageInput");
    const text = input?.value?.trim() || "";
    if (!text) return;
    if (!currentUser()?.id) { toast("Sign in to RAVIN first."); return; }
    const mode = currentMode();
    if (mode !== "work" && state.attachments.some((file) => String(file.type || "").startsWith("image/"))) {
      toast("Image analysis is in Work mode right now — switch to Work and send again.", 3600);
      return;
    }

    state.controller = new AbortController();
    state.firstToken = false;
    setBusy(true);
    let assistant = null;
    let accumulated = "";
    let aborted = false;
    try {
      let uploaded = [];
      if (state.attachments.length) {
        if ($("#composerStatus")) $("#composerStatus").textContent = "UPLOADING…";
        for (const file of state.attachments) uploaded.push(await uploadAttachment(file));
      }
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      appendMessage("user", text);
      assistant = appendMessage("assistant", "", { streaming: true });
      const body = $(".ravin-message-body", assistant);
      const payload = {
        message: text,
        mode,
        conversation_id: currentConversationId() || null,
        environment: state.environment,
        memory_enabled: state.memoryEnabled,
        attachment_ids: uploaded.map((file) => file.id),
      };

      await streamRequest(payload, {
        meta: (data) => {
          if (data.conversation_id) {
            const isNew = !currentConversationId();
            localStorage.setItem(conversationKey(mode), data.conversation_id);
            if (isNew && $("#headerConversationTitle")) $("#headerConversationTitle").textContent = text.slice(0, 80);
          }
        },
        token: (data) => {
          if (!state.firstToken) {
            state.firstToken = true;
            if ($("#systemStatus")) $("#systemStatus").textContent = "READY";
            if ($("#composerStatus")) $("#composerStatus").textContent = "RESPONDING…";
          }
          accumulated += data.text || "";
          setMessageBody(body, accumulated, "assistant", { streaming: true, time: body.dataset.v02Time });
          scrollBottom();
        },
        done: (data) => {
          accumulated = data.reply || accumulated;
        },
        error: (data) => { throw new Error(data.message || "RAVIN streaming failed."); },
      });

      assistant.classList.remove("ravin-v02-streaming");
      setMessageBody(body, accumulated || "RAVIN returned no visible response.", "assistant", { time: body.dataset.v02Time });
      addMessageActions(assistant);
      state.attachments = [];
      renderAttachments();
    } catch (error) {
      aborted = error?.name === "AbortError";
      if (assistant) {
        assistant.classList.remove("ravin-v02-streaming");
        const body = $(".ravin-message-body", assistant);
        if (aborted && accumulated) {
          setMessageBody(body, `${accumulated}\n\n[Stopped]`, "assistant", { time: body.dataset.v02Time });
          addMessageActions(assistant);
        } else if (aborted) {
          assistant.remove();
          toast("RAVIN stopped");
        } else {
          assistant.classList.add("error");
          setMessageBody(body, `RAVIN error: ${error.message || error}`, "error", { time: body.dataset.v02Time });
          addMessageActions(assistant);
        }
      } else if (!aborted) {
        appendMessage("error", `RAVIN error: ${error.message || error}`, { error: true });
      }
    } finally {
      state.controller = null;
      setBusy(false);
      input.disabled = false;
      input.focus();
      enhanceMessages();
    }
  }

  function closeDrawer() {
    $(".ravin-v02-drawer")?.remove();
    $(".ravin-v02-drawer-backdrop")?.remove();
  }

  function createDrawer(title, subtitle = "") {
    closeDrawer();
    const backdrop = document.createElement("div");
    backdrop.className = "ravin-v02-drawer-backdrop";
    backdrop.addEventListener("click", closeDrawer);
    const drawer = document.createElement("section");
    drawer.className = "ravin-v02-drawer";
    drawer.innerHTML = `
      <header class="ravin-v02-drawer-head">
        <div><strong></strong><small></small></div>
        <button type="button" class="ravin-v02-drawer-close" aria-label="Close">×</button>
      </header>
      <div class="ravin-v02-drawer-body"></div>`;
    $("strong", drawer).textContent = title;
    $("small", drawer).textContent = subtitle;
    $(".ravin-v02-drawer-close", drawer).addEventListener("click", closeDrawer);
    document.body.append(backdrop, drawer);
    return $(".ravin-v02-drawer-body", drawer);
  }

  async function openMemoryDrawer() {
    const body = createDrawer("RAVIN Memory", "What RAVIN can carry forward between conversations");
    body.innerHTML = '<div class="ravin-v02-empty-note">Loading memory…</div>';
    try {
      const data = await api("/api/memories");
      body.replaceChildren();
      const controls = document.createElement("section");
      controls.className = "ravin-v02-section";
      controls.innerHTML = '<h3 class="ravin-v02-section-title">Memory controls</h3>';
      const toggleRow = document.createElement("div");
      toggleRow.className = "ravin-v02-toggle-row";
      const label = document.createElement("span");
      label.textContent = "Use and automatically learn durable memory";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = `ravin-v02-toggle ${state.memoryEnabled ? "on" : ""}`;
      toggle.innerHTML = "<i></i>";
      toggle.addEventListener("click", () => {
        state.memoryEnabled = !state.memoryEnabled;
        localStorage.setItem(MEMORY_KEY, String(state.memoryEnabled));
        toggle.classList.toggle("on", state.memoryEnabled);
      });
      toggleRow.append(label, toggle);
      controls.appendChild(toggleRow);
      const add = document.createElement("form");
      add.className = "ravin-memory-add";
      add.innerHTML = '<input placeholder="Add something RAVIN should remember" maxlength="700"><button type="submit">ADD</button>';
      add.addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = $("input", add);
        const value = input.value.trim();
        if (!value) return;
        await api("/api/memories", { method: "POST", body: JSON.stringify({ content: value, category: "fact", importance: 3, metadata: { source: "manual_v02" } }) });
        input.value = "";
        toast("Memory added");
        openMemoryDrawer();
      });
      controls.appendChild(add);
      body.appendChild(controls);

      const renderGroup = (title, rows, kind) => {
        const section = document.createElement("section");
        section.className = "ravin-v02-section";
        const heading = document.createElement("h3");
        heading.className = "ravin-v02-section-title";
        heading.textContent = `${title} · ${rows.length}`;
        section.appendChild(heading);
        if (!rows.length) {
          const empty = document.createElement("div");
          empty.className = "ravin-v02-empty-note";
          empty.textContent = `No ${title.toLowerCase()} yet.`;
          section.appendChild(empty);
        }
        rows.slice(0, 40).forEach((row) => {
          const item = document.createElement("div");
          item.className = "ravin-memory-row";
          const copy = document.createElement("div");
          const p = document.createElement("p");
          p.textContent = kind === "project" ? `${row.key}: ${row.value}` : kind === "session" ? row.summary : row.content;
          const meta = document.createElement("small");
          meta.textContent = kind === "permanent" ? `${row.category || "fact"} · importance ${row.importance || 3}` : kind;
          copy.append(p, meta);
          item.appendChild(copy);
          if (kind === "permanent") {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "ravin-memory-delete";
            del.textContent = "×";
            del.setAttribute("aria-label", "Delete memory");
            del.addEventListener("click", async () => {
              await api(`/api/memories/${encodeURIComponent(row.id)}`, { method: "DELETE" });
              item.remove();
            });
            item.appendChild(del);
          }
          section.appendChild(item);
        });
        body.appendChild(section);
      };
      renderGroup("Permanent", data.permanent || [], "permanent");
      renderGroup("Project", data.project || [], "project");
      renderGroup("Session summaries", data.session || [], "session");
    } catch (error) {
      body.innerHTML = `<div class="ravin-v02-empty-note"></div>`;
      $(".ravin-v02-empty-note", body).textContent = error.message || String(error);
    }
  }

  function environmentButtonLabel() {
    const labels = { desktop: "DESKTOP", phone: "PHONE", portable_core: "CORE", relay: "RELAY", vehicle: "CAR", garage: "GARAGE" };
    return labels[state.environment] || state.environment.toUpperCase();
  }

  function syncEnvironmentButton() {
    const button = $("#ravinEnvironmentBtn");
    if (button) button.textContent = environmentButtonLabel();
  }

  async function openEnvironmentDrawer() {
    const body = createDrawer("RAVIN Environment", "Software capability simulator for the future RAVIN platform");
    body.innerHTML = '<div class="ravin-v02-empty-note">Loading environments…</div>';
    try {
      const data = await api(`/api/v2/capabilities?environment=${encodeURIComponent(state.environment)}`);
      body.replaceChildren();
      const section = document.createElement("section");
      section.className = "ravin-v02-section";
      const heading = document.createElement("h3");
      heading.className = "ravin-v02-section-title";
      heading.textContent = "Environment simulator";
      section.appendChild(heading);
      for (const env of data.environments || []) {
        const row = document.createElement("div");
        row.className = `ravin-environment-row ${env.id === state.environment ? "active" : ""}`;
        row.innerHTML = "<strong></strong><p></p><small></small>";
        $("strong", row).textContent = `${env.name}${env.simulated ? " · SIMULATED" : ""}`;
        $("p", row).textContent = env.description;
        $("small", row).textContent = `${env.senses.length} senses · ${env.actions.length} actions · ${env.connectedSystems.join(", ")}`;
        row.addEventListener("click", () => {
          state.environment = env.id;
          localStorage.setItem(ENV_KEY, env.id);
          syncEnvironmentButton();
          closeDrawer();
          toast(`RAVIN environment: ${env.name}`);
        });
        section.appendChild(row);
      }
      body.appendChild(section);
      const note = document.createElement("div");
      note.className = "ravin-v02-empty-note";
      note.textContent = "Simulated environments change the context/capabilities RAVIN receives, but they do not claim real hardware is connected. Later, real docks and devices can register the same capability contract.";
      body.appendChild(note);
    } catch (error) {
      body.innerHTML = '<div class="ravin-v02-empty-note"></div>';
      $(".ravin-v02-empty-note", body).textContent = error.message || String(error);
    }
  }

  function injectControls() {
    const composer = $("#composer");
    const row = $(".ravin-composer-row", composer);
    if (composer && row && !$("#ravinAttachmentTray")) {
      const tray = document.createElement("div");
      tray.id = "ravinAttachmentTray";
      tray.className = "ravin-attachment-tray";
      composer.insertBefore(tray, row);
    }

    if (!$("#ravinFileInput")) {
      const input = document.createElement("input");
      input.id = "ravinFileInput";
      input.type = "file";
      input.multiple = true;
      input.hidden = true;
      input.accept = "image/*,.txt,.md,.markdown,.json,.csv,.js,.mjs,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.xml,.yaml,.yml,.toml,.ini,.log,.sql,.sh,.pdf";
      input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; });
      document.body.appendChild(input);
    }

    const right = $(".ravin-header-right");
    if (right && !$("#ravinEnvironmentBtn")) {
      const env = document.createElement("button");
      env.id = "ravinEnvironmentBtn";
      env.type = "button";
      env.className = "ravin-environment-button";
      env.setAttribute("aria-label", "RAVIN environment");
      env.addEventListener("click", openEnvironmentDrawer);
      right.insertBefore(env, right.firstChild);
      syncEnvironmentButton();
    }
    if (right && !$("#ravinMemoryBtn")) {
      const memory = document.createElement("button");
      memory.id = "ravinMemoryBtn";
      memory.type = "button";
      memory.className = "ravin-icon-button";
      memory.setAttribute("aria-label", "RAVIN memory");
      memory.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5A3.5 3.5 0 0 0 5.5 8v1A3.5 3.5 0 0 0 4 15.35V16a3.5 3.5 0 0 0 5 3.18M15 4.5A3.5 3.5 0 0 1 18.5 8v1a3.5 3.5 0 0 1 1.5 6.35V16a3.5 3.5 0 0 1-5 3.18M9 4.5V20M15 4.5V20M9 9h2M13 15h2M13 8h2M9 16h2"/></svg>';
      memory.addEventListener("click", openMemoryDrawer);
      const settings = $("#settingsBtn");
      right.insertBefore(memory, settings || null);
    }
  }

  function bindProductEvents() {
    const composer = $("#composer");
    const add = $("#addBtn");
    const send = $("#sendBtn");
    if (composer && !composer.dataset.v02Bound) {
      composer.dataset.v02Bound = "true";
      composer.addEventListener("submit", submitMessage, true);
      ["dragenter", "dragover"].forEach((type) => composer.addEventListener(type, (event) => {
        event.preventDefault();
        composer.classList.add("ravin-drop-active");
      }));
      ["dragleave", "drop"].forEach((type) => composer.addEventListener(type, (event) => {
        event.preventDefault();
        composer.classList.remove("ravin-drop-active");
      }));
      composer.addEventListener("drop", (event) => addFiles([...event.dataTransfer.files]));
    }
    if (add && !add.dataset.v02Bound) {
      add.dataset.v02Bound = "true";
      add.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        $("#ravinFileInput")?.click();
      }, true);
    }
    if (send && !send.dataset.v02Bound) {
      send.dataset.v02Bound = "true";
      send.addEventListener("click", handleStop, true);
    }
    for (const selector of ["#newChatBtn", "#conversationModeBtn", "#workModeBtn"]) {
      const button = $(selector);
      if (button && !button.dataset.v02AbortBound) {
        button.dataset.v02AbortBound = "true";
        button.addEventListener("click", () => state.controller?.abort(), true);
      }
    }
  }

  function initObserver() {
    const root = $("#messages");
    if (!root) return;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        enhanceMessages();
      });
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    injectControls();
    bindProductEvents();
    enhanceMessages();
    initObserver();
    addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDrawer();
    });
    document.documentElement.dataset.ravinV02 = "true";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
