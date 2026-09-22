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

  const SUPPORTED_ACCEPT = [
    "image/*", ".pdf", ".docx", ".pptx", ".txt", ".md", ".markdown",
    ".csv", ".json", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".html", ".css",
    ".xml", ".yaml", ".yml", ".toml", ".ini", ".log", ".sql", ".sh",
  ].join(",");
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_BATCH_FILES = 8;
  const SORT_KEY = "ravin_files_sort";

  const $ = (selector, root = document) => root.querySelector(selector);
  const state = {
    files: [],
    sort: localStorage.getItem(SORT_KEY) || "newest",
    loading: false,
  };

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

  function notify(message, duration = 2800) {
    $(".ravin-product-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "ravin-product-toast";
    toast.setAttribute("role", "status");
    toast.textContent = String(message || "");
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return "0 KB";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function fileKind(file) {
    const meta = file.metadata || {};
    if (meta.document_kind) return String(meta.document_kind).toUpperCase();
    if (String(file.mime_type || "").startsWith("image/")) return "IMAGE";
    const ext = String(file.file_name || "").split(".").pop();
    return ext ? ext.toUpperCase() : "FILE";
  }

  function statusInfo(file) {
    const meta = file.metadata || {};
    const status = meta.extraction_status;
    if (status === "ok") return { label: "READABLE", cls: "readable" };
    if (status === "image") return { label: "IMAGE", cls: "image" };
    if (status === "empty") return { label: "NO TEXT", cls: "empty" };
    if (status === "error") return { label: "ERROR", cls: "error" };
    if (status === "unsupported") return { label: "STORED", cls: "stored" };
    if (meta.text_content) return { label: "READABLE", cls: "readable" };
    return { label: "STORED", cls: "stored" };
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
      reader.onerror = () => reject(reader.error || new Error("Couldn't read the file."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadOne(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over the 8 MB upload limit.`);
    const data = await fileToBase64(file);
    const result = await api("/api/v2/files", {
      method: "POST",
      body: JSON.stringify({
        file: {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          data_base64: data,
        },
      }),
    });
    return result.file;
  }

  function closeDrawer() {
    $(".ravin-v02-drawer[data-ravin-files-drawer]")?.remove();
    $(".ravin-v02-drawer-backdrop[data-ravin-files-backdrop]")?.remove();
  }

  function createDrawer() {
    document.querySelectorAll(".ravin-v02-drawer,.ravin-v02-drawer-backdrop").forEach((node) => node.remove());
    const backdrop = document.createElement("div");
    backdrop.className = "ravin-v02-drawer-backdrop";
    backdrop.dataset.ravinFilesBackdrop = "true";
    backdrop.addEventListener("click", closeDrawer);

    const drawer = document.createElement("section");
    drawer.className = "ravin-v02-drawer ravin-files-drawer";
    drawer.dataset.ravinFilesDrawer = "true";
    drawer.innerHTML = `
      <header class="ravin-v02-drawer-head">
        <div><strong>RAVIN Files</strong><small>Private uploads RAVIN can use automatically in Work</small></div>
        <button type="button" class="ravin-v02-drawer-close" aria-label="Close">×</button>
      </header>
      <div class="ravin-v02-drawer-body">
        <div class="ravin-v02-empty-note">Loading files…</div>
      </div>`;
    $(".ravin-v02-drawer-close", drawer).addEventListener("click", closeDrawer);
    document.body.append(backdrop, drawer);
    return $(".ravin-v02-drawer-body", drawer);
  }

  function sortedFiles() {
    const rows = [...state.files];
    const byName = (a, b) => String(a.file_name || "").localeCompare(String(b.file_name || ""), undefined, { numeric: true, sensitivity: "base" });
    if (state.sort === "oldest") return rows.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    if (state.sort === "name") return rows.sort(byName);
    if (state.sort === "type") return rows.sort((a, b) => fileKind(a).localeCompare(fileKind(b)) || byName(a, b));
    if (state.sort === "size") return rows.sort((a, b) => Number(b.size_bytes || 0) - Number(a.size_bytes || 0) || byName(a, b));
    return rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  function renderFileRow(file, list) {
    const row = document.createElement("article");
    row.className = "ravin-file-row";
    row.dataset.fileId = file.id;

    const icon = document.createElement("div");
    icon.className = "ravin-file-icon";
    icon.textContent = fileKind(file).slice(0, 4);

    const copy = document.createElement("div");
    copy.className = "ravin-file-copy";
    const name = document.createElement("strong");
    name.textContent = file.file_name || "Untitled file";
    name.title = file.file_name || "";

    const status = statusInfo(file);
    const details = document.createElement("div");
    details.className = "ravin-file-details";
    const badge = document.createElement("span");
    badge.className = `ravin-file-status ${status.cls}`;
    badge.textContent = status.label;
    const meta = document.createElement("span");
    const extraction = file.metadata?.extraction || {};
    const extra = extraction.pages
      ? ` · ${extraction.pages} page${Number(extraction.pages) === 1 ? "" : "s"}`
      : extraction.slides
        ? ` · ${extraction.slides} slides`
        : "";
    const date = file.created_at
      ? new Date(file.created_at).toLocaleDateString([], { month: "short", day: "numeric" })
      : "";
    meta.textContent = `${fileKind(file)} · ${formatBytes(file.size_bytes)}${extra}${date ? ` · ${date}` : ""}`;
    details.append(badge, meta);
    copy.append(name, details);

    const actions = document.createElement("div");
    actions.className = "ravin-file-actions";
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "DELETE";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete ${file.file_name || "this file"} from RAVIN?`)) return;
      del.disabled = true;
      del.textContent = "…";
      try {
        await api(`/api/v2/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
        state.files = state.files.filter((item) => item.id !== file.id);
        renderLibrary();
        notify("File deleted");
      } catch (error) {
        del.disabled = false;
        del.textContent = "DELETE";
        notify(error.message || String(error), 3800);
      }
    });
    actions.appendChild(del);
    row.append(icon, copy, actions);
    list.appendChild(row);
  }

  function renderLibrary({ highlightId = "" } = {}) {
    const body = $(".ravin-v02-drawer[data-ravin-files-drawer] .ravin-v02-drawer-body");
    if (!body) return;
    body.replaceChildren();

    const toolbar = document.createElement("div");
    toolbar.className = "ravin-files-toolbar";
    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "ravin-files-upload";
    upload.innerHTML = '<span aria-hidden="true">＋</span><span>Upload files</span>';
    upload.addEventListener("click", () => $("#ravinLibraryFileInput")?.click());

    const sortWrap = document.createElement("label");
    sortWrap.className = "ravin-files-sort";
    const sortLabel = document.createElement("span");
    sortLabel.textContent = "Sort";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Sort files");
    [
      ["newest", "Newest"],
      ["oldest", "Oldest"],
      ["name", "Name A–Z"],
      ["type", "Type"],
      ["size", "Largest"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = state.sort;
    select.addEventListener("change", () => {
      state.sort = select.value;
      localStorage.setItem(SORT_KEY, state.sort);
      renderLibrary();
    });
    sortWrap.append(sortLabel, select);
    toolbar.append(upload, sortWrap);
    body.appendChild(toolbar);

    const summary = document.createElement("div");
    summary.className = "ravin-files-summary";
    summary.textContent = state.files.length
      ? `${state.files.length} private upload${state.files.length === 1 ? "" : "s"} · Work can search these automatically`
      : "No files uploaded yet";
    body.appendChild(summary);

    if (!state.files.length) {
      const empty = document.createElement("div");
      empty.className = "ravin-v02-empty-note ravin-files-empty";
      empty.innerHTML = "<strong>Drop files anywhere in RAVIN</strong><span>or use Upload files above. PDFs, Office docs, text, code, and images are supported.</span>";
      body.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "ravin-files-list";
    for (const file of sortedFiles()) renderFileRow(file, list);
    body.appendChild(list);

    if (highlightId) {
      requestAnimationFrame(() => {
        const row = list.querySelector(`[data-file-id="${CSS.escape(String(highlightId))}"]`);
        if (!row) return;
        row.classList.add("highlight");
        row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        setTimeout(() => row.classList.remove("highlight"), 1600);
      });
    }
  }

  async function loadLibrary({ highlightId = "" } = {}) {
    if (state.loading) return;
    state.loading = true;
    const body = $(".ravin-v02-drawer[data-ravin-files-drawer] .ravin-v02-drawer-body");
    if (body) body.innerHTML = '<div class="ravin-v02-empty-note">Loading files…</div>';
    try {
      const data = await api("/api/v2/files");
      state.files = Array.isArray(data.files) ? data.files : [];
      renderLibrary({ highlightId });
    } catch (error) {
      if (body) {
        body.innerHTML = '<div class="ravin-v02-empty-note"></div>';
        $(".ravin-v02-empty-note", body).textContent = error.message || String(error);
      }
    } finally {
      state.loading = false;
    }
  }

  async function openFilesDrawer({ highlightId = "" } = {}) {
    createDrawer();
    await loadLibrary({ highlightId });
  }

  async function uploadFiles(fileList, { openDrawer = true } = {}) {
    const files = [...(fileList || [])].filter((file) => file instanceof File).slice(0, MAX_BATCH_FILES);
    if (!files.length) return;
    if (fileList.length > MAX_BATCH_FILES) notify(`Uploading the first ${MAX_BATCH_FILES} files in this batch.`);

    if (openDrawer) {
      createDrawer();
      const body = $(".ravin-v02-drawer[data-ravin-files-drawer] .ravin-v02-drawer-body");
      body.innerHTML = '<div class="ravin-files-upload-progress"><i></i><strong>Adding files to RAVIN</strong><span>Preparing uploads…</span></div>';
    }

    const uploaded = [];
    const errors = [];
    for (let index = 0; index < files.length; index += 1) {
      const progress = $(".ravin-files-upload-progress span");
      if (progress) progress.textContent = `Uploading ${index + 1} of ${files.length} · ${files[index].name}`;
      try {
        const row = await uploadOne(files[index]);
        if (row) uploaded.push(row);
      } catch (error) {
        errors.push(error.message || String(error));
      }
    }

    if (openDrawer) await loadLibrary();
    else {
      try {
        const data = await api("/api/v2/files");
        state.files = Array.isArray(data.files) ? data.files : state.files;
      } catch {}
    }

    if (uploaded.length) {
      notify(`Added ${uploaded.length} file${uploaded.length === 1 ? "" : "s"} to RAVIN Files`);
      document.dispatchEvent(new CustomEvent("ravin:files-changed", { detail: { files: uploaded } }));
    }
    if (errors.length) notify(errors[0], 4200);
  }

  function ensureLibraryInput() {
    if ($("#ravinLibraryFileInput")) return;
    const input = document.createElement("input");
    input.id = "ravinLibraryFileInput";
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    input.accept = SUPPORTED_ACCEPT;
    input.setAttribute("aria-label", "Upload files to RAVIN Files");
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      uploadFiles(files, { openDrawer: true });
    });
    document.body.appendChild(input);
  }

  function ensureDropOverlay() {
    if ($("#ravinGlobalDrop")) return $("#ravinGlobalDrop");
    const overlay = document.createElement("div");
    overlay.id = "ravinGlobalDrop";
    overlay.className = "ravin-global-drop";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = '<div><i></i><strong>Drop to RAVIN Files</strong><span>RAVIN will store and index these for Work mode</span></div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function hasDraggedFiles(event) {
    return [...(event.dataTransfer?.types || [])].includes("Files");
  }

  function bindGlobalDrop() {
    const overlay = ensureDropOverlay();
    const show = () => overlay.classList.add("visible");
    const hide = () => overlay.classList.remove("visible");

    document.addEventListener("dragenter", (event) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      show();
    }, true);

    document.addEventListener("dragover", (event) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      show();
    }, true);

    document.addEventListener("drop", (event) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      hide();
      const files = [...(event.dataTransfer?.files || [])];
      uploadFiles(files, { openDrawer: true });
    }, true);

    window.addEventListener("dragleave", (event) => {
      if (event.relatedTarget == null) hide();
    });
    window.addEventListener("drop", hide);
  }

  function ensureFilesButton() {
    const right = $(".ravin-header-right");
    if (!right || $("#ravinFilesBtn")) return;
    const button = document.createElement("button");
    button.id = "ravinFilesBtn";
    button.type = "button";
    button.className = "ravin-icon-button ravin-files-button";
    button.setAttribute("aria-label", "RAVIN files");
    button.title = "Files";
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 8.5V6.5a2 2 0 0 1 2-2h4l2 2"/></svg>';
    button.addEventListener("click", () => openFilesDrawer());
    const settings = $("#settingsBtn");
    right.insertBefore(button, settings || null);
  }

  function apply() {
    const input = $("#ravinFileInput");
    if (input) {
      input.accept = SUPPORTED_ACCEPT;
      input.setAttribute("aria-label", "Attach a file to this message");
    }
    const add = $("#addBtn");
    if (add) {
      add.title = "Attach a file to this message";
      add.setAttribute("aria-label", "Attach file to message");
    }
    ensureLibraryInput();
    ensureFilesButton();
  }

  function init() {
    apply();
    ensureDropOverlay();
    bindGlobalDrop();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("ravin:open-files", (event) => {
      openFilesDrawer({ highlightId: event.detail?.fileId || "" });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDrawer();
    });
    document.documentElement.dataset.ravinFiles = "library";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
