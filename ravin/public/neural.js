/** Signals share the ambient field's exact line and node styling. */
(() => {
  const canvas = document.createElement("canvas");
  canvas.id = "neuralEnergy";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let width = 0;
  let height = 0;
  let dpr = 1;
  let active = false;
  let overdrive = false;
  let signals = [];
  let burst = null;

  function color(forceRed = false) {
    if (forceRed) return [145, 26, 34];
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent").trim() || "#8fa7ff";
    const number = parseInt(value.slice(1), 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    width = innerWidth;
    height = innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function origin() {
    const bounds = document.getElementById("core")?.getBoundingClientRect();
    return bounds
      ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      : { x: width / 2, y: height / 2 };
  }

  function nearest(nodes, x, y) {
    let result = null;
    let distance = Infinity;
    for (const node of nodes) {
      const nextDistance = Math.hypot(node.x - x, node.y - y);
      if (nextDistance < distance) {
        result = node;
        distance = nextDistance;
      }
    }
    return result;
  }

  function createPath() {
    const nodes = window.ravinField?.getNodes?.() || [];
    if (nodes.length < 2) return null;

    const start = origin();
    let current = nearest(nodes, start.x, start.y);
    if (!current) return null;

    const linkDistance = window.ravinField?.getLinkDistance?.() || 188;
    const path = [start, current];
    const used = new Set([current]);

    for (let step = 0; step < 22; step += 1) {
      const choices = nodes
        .filter(node => node !== current && !used.has(node))
        .map(node => ({
          node,
          distance: Math.hypot(node.x - current.x, node.y - current.y),
          outward: Math.hypot(node.x - width / 2, node.y - height / 2),
        }))
        .filter(choice => choice.distance <= linkDistance)
        .sort((first, second) =>
          second.outward - first.outward + (Math.random() - 0.5) * linkDistance);

      if (!choices.length) break;
      current = choices[Math.floor(Math.random() * Math.min(3, choices.length))].node;
      used.add(current);
      path.push(current);
      if (current.x < 30 || current.x > width - 30 || current.y < 30 || current.y > height - 30) break;
    }
    return path.length >= 4 ? path : null;
  }

  function spawn(delay = 0, boosted = false) {
    setTimeout(() => {
      if (!active) return;
      const path = createPath();
      if (!path) return;
      signals.push({
        path,
        progress: 0,
        speed: boosted ? 0.11 : 0.055 + Math.random() * 0.022,
        visibleSegments: boosted ? 5 : 3,
        boosted,
      });
    }, delay);
  }

  function startOverdrive() {
    active = true;
    overdrive = true;
    const start = origin();
    burst = {
      x: start.x,
      y: start.y,
      startedAt: performance.now(),
      duration: 1150,
      maxRadius: Math.hypot(width, height) * 0.68,
    };
    signals = [];
    for (let index = 0; index < 12; index += 1) spawn(index * 48, true);
  }

  function drawSignal(signal, rgb, style) {
    signal.progress += signal.speed;
    const head = Math.floor(signal.progress);
    if (head >= signal.path.length - 1) return false;

    const firstVisible = Math.max(0, head - signal.visibleSegments + 1);
    for (let segment = firstVisible; segment <= head; segment += 1) {
      const from = signal.path[segment];
      const to = signal.path[Math.min(segment + 1, signal.path.length - 1)];
      const progress = segment === head ? signal.progress - head : 1;
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      const age = head - segment;
      const alpha = style.lineAlpha * (1 - age / (signal.visibleSegments + 1));

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.strokeStyle = `rgba(${rgb.join(",")},${signal.boosted ? alpha * 1.2 : alpha})`;
      ctx.lineWidth = style.lineWidth;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, style.dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.join(",")},${style.dotAlpha})`;
      ctx.fill();
    }
    return true;
  }

  function drawBurst() {
    if (!burst) return;
    const elapsed = Math.min(1, (performance.now() - burst.startedAt) / burst.duration);
    const eased = 1 - (1 - elapsed) ** 3;
    ctx.beginPath();
    ctx.arc(burst.x, burst.y, 30 + burst.maxRadius * eased, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(150,24,32,${(1 - elapsed) * 0.42})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (elapsed >= 1) burst = null;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    canvas.style.opacity = active || burst ? "1" : "0";
    drawBurst();

    const rgb = color(overdrive);
    const style = window.ravinField?.getReactiveStyle?.() || {
      dotRadius: 1.9,
      dotAlpha: 0.68,
      lineAlpha: 0.3,
      lineWidth: 0.75,
    };
    if (active && Math.random() < (overdrive ? 0.085 : 0.025)) spawn(0, overdrive);
    signals = signals.filter(signal => drawSignal(signal, rgb, style));
    requestAnimationFrame(draw);
  }

  addEventListener("resize", resize);
  addEventListener("ravin-neural", event => {
    active = Boolean(event.detail?.active);
    overdrive = Boolean(event.detail?.overdrive);
    if (active && !overdrive) {
      signals = [];
      for (let index = 0; index < 3; index += 1) spawn(index * 120);
    }
    if (!active) setTimeout(() => { signals = []; }, 350);
  });
  addEventListener("ravin-overdrive", event => {
    if (event.detail?.active) startOverdrive();
    else {
      overdrive = false;
      burst = null;
      signals = [];
    }
  });

  resize();
  draw();
})();
