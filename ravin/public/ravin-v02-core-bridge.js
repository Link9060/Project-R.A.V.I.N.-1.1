(() => {
  // The spatial Core temporarily replaces message markup with line-level flow
  // fragments. Keep the raw v0.2 Markdown source as the Core's canonical text
  // so code-block controls and other UI chrome never become part of the flow.
  const sync = () => {
    document.querySelectorAll("#messages .ravin-message-body[data-v02-raw]").forEach((body) => {
      const raw = body.dataset.v02Raw || "";
      if (body.dataset.coreOriginal !== raw) body.dataset.coreOriginal = raw;
      const time = body.dataset.v02Time || body.querySelector(".ravin-message-time")?.textContent?.trim() || "";
      if (body.dataset.coreTime !== time) body.dataset.coreTime = time;
    });
  };

  const init = () => {
    const root = document.querySelector("#messages");
    if (!root) return;
    sync();
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-v02-raw"] });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
