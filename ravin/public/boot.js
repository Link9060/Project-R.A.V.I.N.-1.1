(() => {
  const root = document.documentElement;
  const boot = document.getElementById("ravinBoot");
  const canvas = document.getElementById("ravinBootCanvas");
  const trigger = document.getElementById("ravinBootCore");
  if (!boot || !canvas || !trigger) return;

  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = innerWidth;
  let height = innerHeight;
  let dpr = 1;
  let running = false;
  let start = 0;
  let frame = 0;
  let particles = [];
  let sphere = [];

  function resize() {
    width = innerWidth;
    height = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeParticles() {
    const cx = width / 2;
    const cy = height / 2;
    const count = width < 700 ? 54 : 82;
    particles = Array.from({ length: count }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 75 + Math.random() * 245;
      return {
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: .65 + Math.random() * 1.45,
        delay: i * 3 + Math.random() * 55,
      };
    });

    const radius = Math.min(width, height) * (width < 700 ? .16 : .19);
    const sphereCount = width < 700 ? 190 : 330;
    sphere = Array.from({ length: sphereCount }, (_, i) => {
      const phi = Math.acos(1 - 2 * (i + .5) / sphereCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const x3 = Math.cos(theta) * Math.sin(phi);
      const y3 = Math.cos(phi);
      const z3 = Math.sin(theta) * Math.sin(phi);
      const perspective = .76 + (z3 + 1) * .12;
      return {
        tx: cx + x3 * radius * perspective,
        ty: cy + y3 * radius * perspective,
        z: z3,
        seed: Math.random(),
      };
    });
  }

  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeInOut = (t) => {
    t = clamp(t);
    return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  function draw(now) {
    const elapsed = now - start;
    const cx = width / 2;
    const cy = height / 2;
    ctx.clearRect(0, 0, width, height);

    // 1) Ignition particles shoot out and lose energy.
    const blastT = clamp((elapsed - 120) / 820);
    if (blastT > 0 && blastT < 1) {
      particles.forEach((p) => {
        const local = clamp((elapsed - 120 - p.delay) / 720);
        if (!local) return;
        const travel = easeOut(local);
        const x = cx + p.vx * travel * .72;
        const y = cy + p.vy * travel * .72;
        const alpha = (1 - local) * .86;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
      });
    }

    // 2) Nodes condense out of the core and assemble into the sphere.
    const buildT = easeInOut((elapsed - 470) / 1250);
    if (buildT > 0) {
      const visible = Math.floor(sphere.length * clamp(buildT * 1.22));
      for (let i = 0; i < visible; i += 1) {
        const p = sphere[i];
        const stagger = clamp((buildT - p.seed * .22) / .78);
        const t = easeOut(stagger);
        const wobble = Math.sin(elapsed * .003 + i) * (1 - t) * 8;
        const x = cx + (p.tx - cx) * t + wobble;
        const y = cy + (p.ty - cy) * t;
        const alpha = (.28 + (p.z + 1) * .28) * t;
        ctx.beginPath();
        ctx.arc(x, y, p.z > .25 ? 1.15 : .78, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
      }

      // Sparse neural links grow after enough nodes exist.
      if (buildT > .32) {
        const linkAlpha = clamp((buildT - .32) / .5) * .12;
        const step = width < 700 ? 11 : 9;
        for (let i = 0; i < visible - step; i += step) {
          const a = sphere[i];
          const b = sphere[(i + step) % sphere.length];
          if (Math.hypot(a.tx - b.tx, a.ty - b.ty) > 78) continue;
          ctx.beginPath();
          ctx.moveTo(cx + (a.tx - cx) * buildT, cy + (a.ty - cy) * buildT);
          ctx.lineTo(cx + (b.tx - cx) * buildT, cy + (b.ty - cy) * buildT);
          ctx.strokeStyle = `rgba(255,255,255,${linkAlpha})`;
          ctx.lineWidth = .55;
          ctx.stroke();
        }
      }
    }

    if (elapsed < 2050) frame = requestAnimationFrame(draw);
  }

  function playWakeTone() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const audio = new AudioContext();
      const master = audio.createGain();
      master.gain.setValueAtTime(.0001, audio.currentTime);
      master.gain.exponentialRampToValueAtTime(.075, audio.currentTime + .018);
      master.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .48);
      master.connect(audio.destination);

      // Low resonant body — deliberately softer/shorter than a sonar ping.
      const low = audio.createOscillator();
      const lowGain = audio.createGain();
      low.type = "sine";
      low.frequency.setValueAtTime(116, audio.currentTime);
      low.frequency.exponentialRampToValueAtTime(72, audio.currentTime + .42);
      lowGain.gain.setValueAtTime(.7, audio.currentTime);
      lowGain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .44);
      low.connect(lowGain).connect(master);
      low.start();
      low.stop(audio.currentTime + .46);

      // Tiny clean confirmation chirp layered on top.
      const high = audio.createOscillator();
      const highGain = audio.createGain();
      high.type = "sine";
      high.frequency.setValueAtTime(780, audio.currentTime + .09);
      high.frequency.exponentialRampToValueAtTime(1120, audio.currentTime + .19);
      highGain.gain.setValueAtTime(.0001, audio.currentTime);
      highGain.gain.exponentialRampToValueAtTime(.2, audio.currentTime + .095);
      highGain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .22);
      high.connect(highGain).connect(master);
      high.start(audio.currentTime + .08);
      high.stop(audio.currentTime + .24);
      setTimeout(() => audio.close().catch(() => {}), 800);
    } catch (_) {}
  }

  function reveal() {
    root.classList.add("ravin-ui-reveal");
    root.classList.remove("ravin-preboot");
    boot.classList.add("is-finished");
    setTimeout(() => boot.remove(), 760);
  }

  function startBoot() {
    if (running) return;
    running = true;
    boot.classList.add("is-running");
    playWakeTone();

    if (reduced) {
      boot.classList.add("is-pulsing");
      setTimeout(reveal, 260);
      return;
    }

    makeParticles();
    start = performance.now();
    frame = requestAnimationFrame(draw);

    // Heartbeat / network power-on.
    setTimeout(() => boot.classList.add("is-pulsing"), 1760);
    // Let the pulse cross the screen, then bring the actual interface online.
    setTimeout(reveal, 2160);
  }

  trigger.addEventListener("click", startBoot, { once: true });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startBoot();
    }
  });
  addEventListener("resize", () => {
    resize();
    if (running) makeParticles();
  });

  resize();
})();
