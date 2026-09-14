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

  const $ = (selector, root = document) => root.querySelector(selector);

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
    return { label: "LEGACY", cls: "stored" };
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
    drawer.className = "ravin-v02-drawer";
    drawer.dataset.ravinFilesDrawer = "true";
    drawer.innerHTML = `
      <header class="ravin-v02-drawer-head">
        <div><strong>RAVIN Files</strong><small>Private uploads RAVIN can use in your chats</small></div>
        <button type="button" class="ravin-v02-drawer-close" aria-label="Close">×</button>
      </header>
      <div class="ravin-v02-drawer-body">
        <div class="ravin-v02-empty-note">Loading files…</div>
      </div>`;
    $(".ravin-v02-drawer-close", drawer).addEventListener("click", closeDrawer);
    document.body.append(backdrop, drawer);
    return $(".ravin-v02-drawer-body", drawer);
  }

  function renderFileRow(file, body) {
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
    const date = file.created_at ? new Date(file.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
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
        row.remove();
        if (!body.querySelector(".ravin-file-row")) {
          body.innerHTML = '<div class="ravin-v02-empty-note">No uploaded files yet. Use the paperclip in chat to add one.</div>';
        }
      } catch (error) {
        del.disabled = false;
        del.textContent = "DELETE";
        alert(error.message || String(error));
      }
    });
    actions.appendChild(del);
    row.append(icon, copy, actions);
    body.appendChild(row);
  }

  async function openFilesDrawer() {
    const body = createDrawer();
    try {
      const data = await api("/api/v2/files");
      body.replaceChildren();
      const files = data.files || [];
      if (!files.length) {
        body.innerHTML = '<div class="ravin-v02-empty-note">No uploaded files yet. Use the paperclip in chat to add one.</div>';
        return;
      }
      const intro = document.createElement("div");
      intro.className = "ravin-files-summary";
      intro.textContent = `${files.length} private upload${files.length === 1 ? "" : "s"} · newest first`;
      body.appendChild(intro);
      files.forEach((file) => renderFileRow(file, body));
    } catch (error) {
      body.innerHTML = '<div class="ravin-v02-empty-note"></div>';
      $(".ravin-v02-empty-note", body).textContent = error.message || String(error);
    }
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
    button.addEventListener("click", openFilesDrawer);
    const settings = $("#settingsBtn");
    right.insertBefore(button, settings || null);
  }

  function apply() {
    const input = $("#ravinFileInput");
    if (input) {
      input.accept = SUPPORTED_ACCEPT;
      input.setAttribute("aria-label", "Attach a file RAVIN can read");
    }

    const add = $("#addBtn");
    if (add) {
      add.title = "Attach PDF, Word, PowerPoint, text, code, or image";
      add.setAttribute("aria-label", "Attach file");
    }
    ensureFilesButton();
  }

  function init() {
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDrawer();
    });
    document.documentElement.dataset.ravinFiles = "library";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
