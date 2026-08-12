/**
 * RAVIN signature background — a quiet field of drifting dots that
 * link together gently near the cursor. Tuned to stay in the background:
 * ambient links are barely visible, and only brighten meaningfully right
 * around the mouse.
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
    mouseRadius: 220,       // radius of influence around the cursor/touch — larger = easier to trigger
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

  function step() {
    ctx.clearRect(0, 0, width, height);

    // Soft halo that follows the cursor/finger directly — always visible the
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

    // update + draw particles
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;

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

    if (!prefersReducedMotion) {
      requestAnimationFrame(step);
    }
  }

  window.addEventListener("resize", resize);

  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });

  window.addEventListener("mouseleave", () => {
    mouse.active = false;
  });

  function updateTouch(e) {
    if (e.touches.length > 0) {
      mouse.x = e.touches[0].clientX;
      mouse.y = e.touches[0].clientY;
      mouse.active = true;
    }
  }

  window.addEventListener("touchstart", updateTouch, { passive: true });
  window.addEventListener("touchmove", updateTouch, { passive: true });

  window.addEventListener("touchend", () => {
    mouse.active = false;
  });
  window.addEventListener("touchcancel", () => {
    mouse.active = false;
  });

  readParticleColor();
  resize();

  if (prefersReducedMotion) {
    // Draw a single static frame instead of a running animation loop.
    step();
  } else {
    requestAnimationFrame(step);
  }
})();