(() => {
  // v0.2's Markdown enhancer already understands the legacy coreFlowActive flag.
  // Mirror the new particle-field flow state into that flag so the enhancer
  // pauses while lines are being physically reflowed, then resumes afterward.
  const sync = (body) => {
    if (!(body instanceof HTMLElement) || !body.classList.contains('ravin-message-body')) return;
    if (body.classList.contains('ravin-force-flow-active')) body.dataset.coreFlowActive = 'true';
    else delete body.dataset.coreFlowActive;
  };

  const init = () => {
    const root = document.querySelector('#messages');
    if (!root) return;
    root.querySelectorAll('.ravin-message-body').forEach(sync);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') sync(mutation.target);
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.classList.contains('ravin-message-body')) sync(node);
          node.querySelectorAll?.('.ravin-message-body').forEach(sync);
        });
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
