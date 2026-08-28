/*
 * RAVIN pulsing borders.
 *
 * Plain-JS port of the supplied Originkit component's important behavior:
 * the effect lives in a fixed, body-level canvas, tracks each target's
 * viewport rectangle, paints outside the element, and never intercepts input.
 */
(() => {
  const core = document.getElementById("core");
  if (!core) return;

  const canvas = document.createElement("canvas");
  canvas.id = "ravinBorderFx";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  const activeButtons = new Set();
  const root = document.documentElement;
  let dpr = 1;
  let viewportWidth = 0;
  let viewportHeight = 0;

  function resize() {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewportWidth * dpr);
    canvas.height = Math.round(viewportHeight * dpr);
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buttonFrom(target) {
    return target instanceof Element ? target.closest("button:not(.core)") : null;
  }

  document.addEventListener("pointerover", event => {
    const button = buttonFrom(event.target);
    if (button && !button.contains(event.relatedTarget)) activeButtons.add(button);
  });

  document.addEventListener("pointerout", event => {
    const button = buttonFrom(event.target);
    if (button && !button.contains(event.relatedTarget)) activeButtons.delete(button);
  });

  document.addEventListener("focusin", event => {
    const button = buttonFrom(event.target);
    if (button) activeButtons.add(button);
  });

  document.addEventListener("focusout", event => {
    const button = buttonFrom(event.target);
    if (button && !button.contains(event.relatedTarget)) activeButtons.delete(button);
  });

  window.addEventListener("resize", resize, { passive: true });
  resize();

  function roundedRectPath(x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, r);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function accentColor() {
    return getComputedStyle(root).getPropertyValue("--accent").trim() || "#8fa7ff";
  }

  function alpha(color, opacity) {
    const hex = color.match(/^#([\da-f]{6})$/i);
    if (!hex) return color;
    const value = Number.parseInt(hex[1], 16);
    return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${opacity})`;
  }

  function radiusFor(element, rect) {
    const declared = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius);
    return Number.isFinite(declared) ? Math.min(declared, rect.width / 2, rect.height / 2) : 14;
  }

  function drawBorder(element, time, isCore) {
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) return true;

    const pad = isCore ? 4 : 1.5;
    const x = rect.left - pad;
    const y = rect.top - pad;
    const width = rect.width + pad * 2;
    const height = rect.height + pad * 2;
    const radius = radiusFor(element, rect) + pad;
    const perimeter = Math.max(1, 2 * (width + height - 4 * radius) + 2 * Math.PI * radius);
    const overdrive = root.classList.contains("overdrive") || root.classList.contains("overdrive-starting");
    const accent = overdrive ? "#b32331" : accentColor();
    const colors = overdrive
      ? ["#ff6470", "#8f1721", "#f6d4d6"]
      : [accent, "#f4f7ff", "#37b8aa"];
    const stateBoost = document.getElementById("stage")?.classList.contains("active") ? 1.25 : 1;
    const intensity = (isCore ? 0.68 : 0.94) * stateBoost;
    const speed = isCore ? 0.052 : 0.105;
    const spotLength = perimeter * (isCore ? 0.2 : 0.16);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    roundedRectPath(x, y, width, height, radius);
    ctx.lineWidth = isCore ? 1.2 : 1;
    ctx.strokeStyle = alpha(accent, isCore ? 0.16 : 0.1);
    ctx.shadowColor = alpha(accent, 0.36);
    ctx.shadowBlur = isCore ? 13 : 8;
    ctx.setLineDash([]);
    ctx.stroke();

    colors.forEach((color, index) => {
      roundedRectPath(x, y, width, height, radius);
      ctx.lineWidth = isCore ? 2 : 1.65;
      ctx.strokeStyle = alpha(color, Math.min(1, intensity));
      ctx.shadowColor = alpha(color, isCore ? 0.7 : 0.86);
      ctx.shadowBlur = isCore ? 18 : 11;
      ctx.setLineDash([spotLength, perimeter - spotLength]);
      ctx.lineDashOffset = -(time * speed + (perimeter * index) / colors.length);
      ctx.stroke();
    });
    ctx.restore();
    return true;
  }

  function frame(time) {
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    drawBorder(core, time, true);
    activeButtons.forEach(button => {
      if (!drawBorder(button, time, false)) activeButtons.delete(button);
    });
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
