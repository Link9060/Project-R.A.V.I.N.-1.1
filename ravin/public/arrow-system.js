(() => {
  const root = document.getElementById("arrowSystemIsland");
  const trigger = document.getElementById("arrowSystemTrigger");
  const content = document.getElementById("arrowSystemContent");
  const orbitLink = document.getElementById("arrowOrbitLink");
  const themeButton = document.getElementById("arrowThemeButton");
  if (!root || !trigger || !content) return;

  const ORBIT_URL = "https://link9060.github.io/Resonant-Orbit/";

  let pinned = false;
  let launching = false;

  const setOpen = (open) => {
    root.dataset.open = String(open);
    trigger.setAttribute("aria-expanded", String(open));
    content.setAttribute("aria-hidden", String(!open));
    trigger.setAttribute("aria-label", open ? "Close ARROW controls" : "Open ARROW controls");
  };

  const closeIfIdle = () => {
    if (!pinned) setOpen(false);
  };

  root.addEventListener("mouseenter", () => setOpen(true));
  root.addEventListener("mouseleave", closeIfIdle);
  root.addEventListener("focusin", () => setOpen(true));
  root.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (!pinned && !root.contains(document.activeElement)) setOpen(false);
    });
  });

  trigger.addEventListener("click", () => {
    pinned = !pinned;
    root.dataset.pinned = String(pinned);
    setOpen(pinned || root.dataset.open !== "true");
  });

  document.addEventListener("pointerdown", (event) => {
    if (root.contains(event.target)) return;
    pinned = false;
    root.dataset.pinned = "false";
    setOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    pinned = false;
    root.dataset.pinned = "false";
    setOpen(false);
    trigger.focus({ preventScroll: true });
  });

  themeButton?.addEventListener("click", () => {
    const rootElement = document.documentElement;
    const current = rootElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = current === "light" ? "dark" : "light";
    rootElement.setAttribute("data-theme", next);
    localStorage.setItem("ravin_theme", next);

    const nativeThemeToggle = document.getElementById("themeToggle");
    if (nativeThemeToggle) {
      const light = next === "light";
      nativeThemeToggle.classList.toggle("on", light);
      nativeThemeToggle.setAttribute("aria-checked", String(light));
    }
  });

  orbitLink?.addEventListener("click", (event) => {
    if (launching) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    launching = true;

    const destination = new URL(ORBIT_URL);
    destination.searchParams.set("from", "ravin");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      window.location.assign(destination.toString());
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "arrow-system-launch";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = [
      '<span class="arrow-system-launch-ring ring-a" aria-hidden="true"></span>',
      '<span class="arrow-system-launch-ring ring-b" aria-hidden="true"></span>',
      '<span class="arrow-system-launch-craft" aria-hidden="true"><span></span></span>',
      '<p>Returning to Orbit</p>',
    ].join("");

    document.body.appendChild(overlay);

    window.setTimeout(() => {
      window.location.assign(destination.toString());
    }, 980);
  });
})();
