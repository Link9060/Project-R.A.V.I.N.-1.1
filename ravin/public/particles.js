/**
 * RAVIN signature background — a quiet field of drifting dots that
 * link together near the cursor/touch.
 *
 * Reduce Motion handling: continuous ambient drift is genuinely the kind of
 * autoplaying motion that setting exists to suppress, so we stop it. But the
 * setting isn't meant to disable direct-manipulation feedback — a user moving
 * their own cursor and expecting a response is different from the page
 * animating on its own. So with Reduce Motion on, particles hold still, but
 * we still redraw (once per input event, not continuously) to show the glow
 * and connections following the cursor/finger.
 */
(function () {
  const canvas = document.getElementById("field");
  const ctx = canvas.getContext("2d");

  let width, height, dpr;
  let particles = [];
  let mouse = { x: -9999, y: -9999, active: false };
  let particleRGB = "242, 242, 245";

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const CONFIG = {
    density: 15000,        // px^2 per particle — lower = more particles
    maxParticles: 150,
    linkDist: 100,          // baseline constellation link distance
    mouseRadius: 220,       // radius of influence around the cursor/touch
    driftSpeed: 0.1,
    dotSize: 1.7,
    restingDotAlpha: 0.42,  // resting dot visibility
    activeDotAlpha: 1,      // dot visibility when lit up near cursor/touch
    ambientAlpha: 0.06,     // ceiling for resting constellation links
    boostedAlpha: 0.6,      // ceiling for links near the cursor/touch
    cursorLinkAlpha: 0.55,
    glowRadius: 130,        // soft halo that follows the cursor/finger directly
    glowAlpha: 0.1,         // peak opacity of that halo, fades to 0 at glowRadius
  };

  function readParticleColor() {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue("--particle-rgb")
      .trim();
    particleRGB = val || particleRGB;
  }

  // Re-read the color whenever the theme attribute changes.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === "data-theme") {
        readParticleColor();
        render(false);
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true });

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
    render(false);
  }

  function initParticles() {
    const count = Math.min(
      CONFIG.maxParticles,
      Math.floor((width * height) / CONFIG.density)
    );
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * CONFIG.driftSpeed,
      vy: (Math.random() - 0.5) * CONFIG.driftSpeed,
    }));
  }

  // Renders one frame. When updatePositions is true, particles drift first —
  // this is the "ambient motion" branch, skipped entirely under Reduce Motion.
  // The interactive parts (glow, highlighted dots, connection lines) always
  // reflect the current mouse/touch position regardless.
  function render(updatePositions) {
    ctx.clearRect(0, 0, width, height);

    // Soft halo that follows the cursor/finger directly — visible the
    // instant you move, regardless of whether any dots happen to be nearby.
    if (mouse.active) {
      const glow = ctx.createRadialGradient(
        mouse.x, mouse.y, 0,
        mouse.x, mouse.y, CONFIG.glowRadius
      );
      glow.addColorStop(0, `rgba(${particleRGB}, ${CONFIG.glowAlpha})`);
      glow.addColorStop(1, `rgba(${particleRGB}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, CONFIG.glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of particles) {
      if (updatePositions) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      }

      const distToMouse = Math.hypot(p.x - mouse.x, p.y - mouse.y);
      const nearMouse = mouse.active && distToMouse < CONFIG.mouseRadius;

      ctx.beginPath();
      ctx.arc(p.x, p.y, nearMouse ? CONFIG.dotSize * 2 : CONFIG.dotSize, 0, Math.PI * 2);
      ctx.fillStyle = nearMouse
        ? `rgba(${particleRGB}, ${CONFIG.activeDotAlpha})`
        : `rgba(${particleRGB}, ${CONFIG.restingDotAlpha})`;
      ctx.fill();
    }

    // constellation links between nearby particles (kept faint at rest)
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < CONFIG.linkDist) {
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const distMidToMouse = Math.hypot(midX - mouse.x, midY - mouse.y);
          const boosted = mouse.active && distMidToMouse < CONFIG.mouseRadius;

          const ceiling = boosted ? CONFIG.boostedAlpha : CONFIG.ambientAlpha;
          const alpha = (1 - d / CONFIG.linkDist) * ceiling;

          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${particleRGB}, ${alpha})`;
          ctx.lineWidth = boosted ? 0.85 : 0.5;
          ctx.stroke();
        }
      }
    }

    // links straight to the cursor for particles inside its radius
    if (mouse.active) {
      for (const p of particles) {
        const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        if (d < CONFIG.mouseRadius) {
          const alpha = (1 - d / CONFIG.mouseRadius) * CONFIG.cursorLinkAlpha;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.strokeStyle = `rgba(${particleRGB}, ${alpha})`;
          ctx.lineWidth = 0.75;
          ctx.stroke();
        }
      }
    }
  }

  function loop() {
    render(true);
    requestAnimationFrame(loop);
  }

  function updatePointer(x, y) {
    mouse.x = x;
    mouse.y = y;
    mouse.active = true;
    if (prefersReducedMotion) render(false);
  }

  function clearPointer() {
    mouse.active = false;
    if (prefersReducedMotion) render(false);
  }

  window.addEventListener("resize", resize);

  window.addEventListener("mousemove", (e) => {
    updatePointer(e.clientX, e.clientY);
  });

  window.addEventListener("mouseleave", clearPointer);

  function handleTouch(e) {
    if (e.touches.length > 0) {
      updatePointer(e.touches[0].clientX, e.touches[0].clientY);
    }
  }

  window.addEventListener("touchstart", handleTouch, { passive: true });
  window.addEventListener("touchmove", handleTouch, { passive: true });
  window.addEventListener("touchend", clearPointer);
  window.addEventListener("touchcancel", clearPointer);

  readParticleColor();
  resize();

  if (prefersReducedMotion) {
    render(false); // single static frame; interactivity still works via events above
  } else {
    requestAnimationFrame(loop);
  }
})();