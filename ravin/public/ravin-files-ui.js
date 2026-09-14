(() => {
  const SUPPORTED_ACCEPT = [
    "image/*",
    ".pdf",
    ".docx",
    ".pptx",
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".html",
    ".css",
    ".xml",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".log",
    ".sql",
    ".sh",
  ].join(",");

  function apply() {
    const input = document.querySelector("#ravinFileInput");
    if (input) {
      input.accept = SUPPORTED_ACCEPT;
      input.setAttribute("aria-label", "Attach a file RAVIN can read");
    }

    const add = document.querySelector("#addBtn");
    if (add) {
      add.title = "Attach PDF, Word, PowerPoint, text, code, or image";
      add.setAttribute("aria-label", "Attach file");
    }
  }

  function init() {
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    document.documentElement.dataset.ravinFiles = "documents";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();