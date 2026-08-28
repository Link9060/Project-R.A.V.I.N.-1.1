/** RAVIN ambient neural field. */
(() => {
  const canvas = document.getElementById("field");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const config = {
    density: 26000,
    minNodes: 34,
    maxNodes: 105,
    linkDistance: 188,
    mouseRadius: 185,
    speed: 0.055,
    dotRadius: 1.2,
    dotAlpha: 0.25,
    lineAlpha: 0.07,
    reactiveDotAlpha: 0.68,
    reactiveLineAlpha: 0.3,
    reactiveLineWidth: 0.75,
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let nodes = [];
  let particleRgb = "225,230,238";
  const pointer = { x: -9999, y: -9999, active: false };

  function syncColor() {
    particleRgb = getComputedStyle(document.documentElement)
      .getPropertyValue("--particle-rgb")
      .trim() || particleRgb;
  }

  function seedNodes() {
    const count = Math.min(
      config.maxNodes,
      Math.max(config.minNodes, Math.floor((width * height) / config.density)),
    );
    const columns = Math.ceil(Math.sqrt((count * width) / height));
    const rows = Math.ceil(count / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;

    nodes = [];
    for (let row = 0; row < rows && nodes.length < count; row += 1) {
      for (let column = 0; column < columns && nodes.length < count; column += 1) {
        nodes.push({
          x: (column + 0.5) * cellWidth + (Math.random() - 0.5) * cellWidth * 0.72,
          y: (row + 0.5) * cellHeight + (Math.random() - 0.5) * cellHeight * 0.72,
          vx: (Math.random() - 0.5) * config.speed,
          vy: (Math.random() - 0.5) * config.speed,
        });
      }
    }
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
    seedNodes();
    draw(false);
  }

  function draw(moveNodes) {
    ctx.clearRect(0, 0, width, height);

    for (const node of nodes) {
      if (moveNodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
      }

      const distance = Math.hypot(node.x - pointer.x, node.y - pointer.y);
      const reactive = pointer.active && distance < config.mouseRadius;
      ctx.beginPath();
      ctx.arc(node.x, node.y, reactive ? 1.9 : config.dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${particleRgb},${reactive ? config.reactiveDotAlpha : config.dotAlpha})`;
      ctx.fill();
    }

    for (let index = 0; index < nodes.length; index += 1) {
      for (let next = index + 1; next < nodes.length; next += 1) {
        const first = nodes[index];
        const second = nodes[next];
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        if (distance > config.linkDistance) continue;

        const midpointX = (first.x + second.x) / 2;
        const midpointY = (first.y + second.y) / 2;
        const reactive = pointer.active
          && Math.hypot(midpointX - pointer.x, midpointY - pointer.y) < config.mouseRadius;
        const strength = 1 - distance / config.linkDistance;

        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(second.x, second.y);
        ctx.strokeStyle = `rgba(${particleRgb},${strength * (reactive ? config.reactiveLineAlpha : config.lineAlpha)})`;
        ctx.lineWidth = reactive ? config.reactiveLineWidth : 0.5;
        ctx.stroke();
      }
    }

    if (pointer.active) {
      for (const node of nodes) {
        const distance = Math.hypot(node.x - pointer.x, node.y - pointer.y);
        if (distance >= config.mouseRadius * 0.72) continue;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(pointer.x, pointer.y);
        ctx.strokeStyle = `rgba(${particleRgb},${(1 - distance / (config.mouseRadius * 0.72)) * 0.18})`;
        ctx.lineWidth = config.reactiveLineWidth;
        ctx.stroke();
      }
    }
  }

  function animate() {
    draw(true);
    requestAnimationFrame(animate);
  }

  function updatePointer(x, y) {
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
    if (reducedMotion) draw(false);
  }

  function clearPointer() {
    pointer.active = false;
    if (reducedMotion) draw(false);
  }

  window.ravinField = {
    getNodes: () => nodes,
    getLinkDistance: () => config.linkDistance,
    getReactiveStyle: () => ({
      dotRadius: 1.9,
      dotAlpha: config.reactiveDotAlpha,
      lineAlpha: config.reactiveLineAlpha,
      lineWidth: config.reactiveLineWidth,
    }),
  };

  new MutationObserver(() => {
    syncColor();
    draw(false);
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
  });

  addEventListener("resize", resize);
  addEventListener("mousemove", event => updatePointer(event.clientX, event.clientY));
  addEventListener("mouseleave", clearPointer);
  addEventListener("touchstart", event => {
    if (event.touches[0]) updatePointer(event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: true });
  addEventListener("touchmove", event => {
    if (event.touches[0]) updatePointer(event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: true });
  addEventListener("touchend", clearPointer);

  syncColor();
  resize();
  if (!reducedMotion) requestAnimationFrame(animate);
})();
