(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const engines = new Set();
  let headerEngine = null;
  let largeEngine = null;
  let headerButton = null;
  let lastHadEmpty = null;
  let wasThinking = false;
  let respondingUntil = 0;
  let typingUntil = 0;
  let morphing = false;
  let lastLargeRect = null;

  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  function inkRGB() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    const nums = raw.split(/\s+/).map(Number).filter(Number.isFinite);
    return nums.length >= 3 ? nums.slice(0, 3) : [245, 245, 246];
  }

  function cssRgba(rgb, alpha) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }

  function makePoints(count, compact) {
    return Array.from({ length: count }, (_, i) => {
      const group = i % 7 < 3 ? 0 : i % 7 < 6 ? 1 : 2;
      const u = (i + .5) / count;
      const phi = Math.acos(1 - 2 * u);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i + group * .61;
      const shell = group === 0 ? .48 + Math.random() * .18 : group === 1 ? .76 + Math.random() * .12 : 1.02 + Math.random() * .13;
      return {
        x: Math.cos(theta) * Math.sin(phi),
        y: Math.cos(phi),
        z: Math.sin(theta) * Math.sin(phi),
        shell,
        group,
        seed: Math.random() * Math.PI * 2,
        size: compact ? .65 + Math.random() * .5 : .75 + Math.random() * .8,
      };
    });
  }

  class NeuralCore {
    constructor(canvas, { compact = false, flight = false } = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.compact = compact;
      this.flight = flight;
      this.points = makePoints(compact ? 76 : 196, compact);
      this.angle = Math.random() * Math.PI * 2;
      this.tilt = -.22;
      this.energy = .18;
      this.targetEnergy = .18;
      this.pulse = 0;
      this.state = 'idle';
      this.last = performance.now();
      this.frame = 0;
      engines.add(this);
      this.resize();
      this.loop = this.loop.bind(this);
      this.frame = requestAnimationFrame(this.loop);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width || Number(this.canvas.getAttribute('width')) || 40);
      const height = Math.max(1, rect.height || Number(this.canvas.getAttribute('height')) || 40);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = width;
      this.height = height;
    }

    setState(next) {
      this.state = next;
      const levels = { offline: .02, idle: .16, work: .28, typing: .42, responding: .74, thinking: 1 };
      this.targetEnergy = levels[next] ?? .16;
      if (next === 'responding') this.pulse = 1;
    }

    destroy() {
      cancelAnimationFrame(this.frame);
      engines.delete(this);
    }

    loop(now) {
      const dt = Math.min(32, now - this.last || 16) / 16.67;
      this.last = now;
      this.resize();
      this.energy = lerp(this.energy, this.targetEnergy, 1 - Math.pow(.88, dt));
      this.pulse *= Math.pow(.945, dt);
      if (!reduceMotion) this.angle += (.0026 + this.energy * .0105) * dt;
      this.draw(now);
      this.frame = requestAnimationFrame(this.loop);
    }

    draw(now) {
      const { ctx, width: w, height: h } = this;
      const rgb = inkRGB();
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * (this.compact ? .34 : .39);
      const thinking = this.state === 'thinking';
      const responding = this.state === 'responding';
      const work = this.state === 'work' || ($('#workspace')?.classList.contains('work-mode') && this.state === 'idle');
      const compression = thinking ? .76 : this.state === 'typing' ? .91 : 1;
      const wave = responding ? Math.sin(now * .012) * .035 + this.pulse * .12 : 0;
      const tilt = this.tilt + Math.sin(now * .00031) * .08;
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      const ct = Math.cos(tilt), st = Math.sin(tilt);

      ctx.clearRect(0, 0, w, h);

      const glowRadius = base * (.28 + this.energy * .12 + this.pulse * .08);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius * 2.2);
      gradient.addColorStop(0, cssRgba(rgb, .24 + this.energy * .26));
      gradient.addColorStop(.22, cssRgba(rgb, .10 + this.energy * .12));
      gradient.addColorStop(1, cssRgba(rgb, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      const projected = this.points.map((p, index) => {
        const orbit = p.shell * compression * (1 + wave * (p.group === 2 ? 1.3 : .55));
        let x = p.x * ca - p.z * sa;
        let z = p.x * sa + p.z * ca;
        let y = p.y;
        const y2 = y * ct - z * st;
        const z2 = y * st + z * ct;
        y = y2; z = z2;

        const asymX = p.group === 0 ? .78 : p.group === 1 ? 1.04 : 1.16;
        const asymY = p.group === 0 ? .92 : p.group === 1 ? .84 : 1.05;
        const drift = reduceMotion ? 0 : Math.sin(now * .0012 + p.seed) * (p.group === 2 ? .045 : .02);
        const perspective = .84 + (z + 1) * .08;
        return {
          x: cx + (x * asymX + drift) * base * orbit * perspective,
          y: cy + y * asymY * base * orbit * perspective,
          z,
          group: p.group,
          size: p.size,
          index,
        };
      }).sort((a, b) => a.z - b.z);

      const linkStride = this.compact ? 9 : (work || thinking ? 7 : 11);
      const linkLimit = base * (this.compact ? .64 : .48);
      ctx.lineWidth = this.compact ? .45 : .55;
      for (let i = 0; i < projected.length - linkStride; i += linkStride) {
        const a = projected[i];
        const b = projected[(i + linkStride + (a.group === 2 ? 5 : 0)) % projected.length];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > linkLimit) continue;
        const alpha = (.025 + this.energy * .06 + (work ? .035 : 0)) * clamp(1 - distance / linkLimit);
        ctx.strokeStyle = cssRgba(rgb, alpha);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const p of projected) {
        const front = clamp((p.z + 1) / 2);
        const groupAlpha = p.group === 0 ? .38 : p.group === 1 ? .26 : .17;
        const alpha = groupAlpha + front * (.28 + this.energy * .14);
        const radius = p.size * (.68 + front * .7) * (1 + this.energy * .08);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = cssRgba(rgb, alpha);
        ctx.fill();
      }

      const nucleus = this.compact ? 1.7 : 2.7;
      ctx.beginPath();
      ctx.arc(cx, cy, nucleus + this.energy * (this.compact ? .8 : 1.25), 0, Math.PI * 2);
      ctx.fillStyle = cssRgba(rgb, .86);
      ctx.fill();

      const satellites = this.compact ? 2 : 4;
      for (let i = 0; i < satellites; i += 1) {
        const a = this.angle * (i % 2 ? -1.32 : .86) + i * 1.68;
        const r = base * (.25 + i * .055) * (thinking ? .73 : 1);
        const sx = cx + Math.cos(a) * r;
        const sy = cy + Math.sin(a * 1.13) * r * .72;
        ctx.beginPath();
        ctx.arc(sx, sy, this.compact ? .72 : 1.05, 0, Math.PI * 2);
        ctx.fillStyle = cssRgba(rgb, .38 + this.energy * .2);
        ctx.fill();
      }
    }
  }

  function mountHeaderCore() {
    if (headerButton?.isConnected) return;
    const left = $('.ravin-header-left');
    const title = $('.ravin-header-title');
    if (!left || !title) return;
    headerButton = document.createElement('button');
    headerButton.id = 'ravinPersistentCore';
    headerButton.className = 'ravin-header-core';
    headerButton.type = 'button';
    headerButton.setAttribute('aria-label', 'RAVIN Core status');
    headerButton.title = 'RAVIN Core';
    headerButton.innerHTML = '<canvas width="76" height="76" aria-hidden="true"></canvas>';
    left.insertBefore(headerButton, title);
    headerEngine = new NeuralCore($('canvas', headerButton), { compact: true });
    headerButton.addEventListener('click', () => {
      headerButton.classList.remove('core-tap');
      void headerButton.offsetWidth;
      headerButton.classList.add('core-tap');
      headerEngine.pulse = 1;
      respondingUntil = performance.now() + 560;
      setTimeout(() => headerButton?.classList.remove('core-tap'), 460);
    });
  }

  function upgradeLargeCore() {
    const wrap = $('.ravin-core-wrap');
    if (!wrap || wrap.dataset.neuralCore === 'true') return wrap;
    wrap.dataset.neuralCore = 'true';
    wrap.classList.add('core-v2');
    const canvas = document.createElement('canvas');
    canvas.className = 'ravin-neural-core-large';
    canvas.width = 352;
    canvas.height = 352;
    canvas.setAttribute('aria-hidden', 'true');
    wrap.appendChild(canvas);
    largeEngine?.destroy();
    largeEngine = new NeuralCore(canvas, { compact: false });
    return wrap;
  }

  function desiredState() {
    const now = performance.now();
    if (!navigator.onLine || $('#systemStatus')?.textContent?.trim() === 'OFFLINE') return 'offline';
    const thinking = !!$('#thinkingRow') || $('#systemStatus')?.textContent?.trim() === 'THINKING';
    if (thinking) return 'thinking';
    if (now < respondingUntil) return 'responding';
    if (now < typingUntil) return 'typing';
    if ($('#workspace')?.classList.contains('work-mode')) return 'work';
    return 'idle';
  }

  function applyState() {
    const state = desiredState();
    headerEngine?.setState(state);
    largeEngine?.setState(state);
    const app = $('#ravinApp');
    if (app) app.classList.toggle('core-thinking', state === 'thinking');
    if (headerButton) {
      headerButton.classList.toggle('core-thinking', state === 'thinking');
      headerButton.classList.toggle('core-responding', state === 'responding');
      headerButton.classList.toggle('core-offline', state === 'offline');
    }
    const thinking = state === 'thinking';
    if (wasThinking && !thinking) respondingUntil = performance.now() + 1450;
    wasThinking = thinking;
  }

  function flyCore(fromRect, toRect, direction) {
    if (reduceMotion || morphing || !fromRect || !toRect || fromRect.width < 2 || toRect.width < 2) return Promise.resolve();
    morphing = true;
    const flight = document.createElement('div');
    flight.className = 'ravin-core-flight';
    flight.style.left = `${fromRect.left}px`;
    flight.style.top = `${fromRect.top}px`;
    flight.style.width = `${fromRect.width}px`;
    flight.style.height = `${fromRect.height}px`;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(80, Math.round(fromRect.width * 2));
    canvas.height = Math.max(80, Math.round(fromRect.height * 2));
    flight.appendChild(canvas);
    document.body.appendChild(flight);
    const engine = new NeuralCore(canvas, { compact: direction === 'expand', flight: true });
    engine.setState(direction === 'collapse' ? 'thinking' : 'responding');

    const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
    const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
    const scale = toRect.width / fromRect.width;
    const rotate = direction === 'collapse' ? '42deg' : '-32deg';
    const duration = direction === 'collapse' ? 720 : 760;
    const animation = flight.animate([
      { transform: 'translate3d(0,0,0) scale(1) rotate(0deg)', opacity: 1, filter: 'blur(0px)' },
      { offset: .34, transform: `translate3d(${dx * .22}px,${dy * .18}px,0) scale(${lerp(1, scale, .26)}) rotate(${direction === 'collapse' ? '9deg' : '-7deg'})`, opacity: 1, filter: 'blur(0px)' },
      { offset: .78, transform: `translate3d(${dx * .86}px,${dy * .88}px,0) scale(${lerp(1, scale, .84)}) rotate(${rotate})`, opacity: .92, filter: 'blur(.35px)' },
      { transform: `translate3d(${dx}px,${dy}px,0) scale(${scale}) rotate(${direction === 'collapse' ? '56deg' : '-44deg'})`, opacity: .16, filter: 'blur(1.8px)' },
    ], { duration, easing: 'cubic-bezier(.16,.84,.2,1)', fill: 'forwards' });

    return animation.finished.catch(() => {}).then(() => {
      engine.destroy();
      flight.remove();
      morphing = false;
    });
  }

  async function syncPresence() {
    mountHeaderCore();
    const empty = $('.ravin-empty');
    const hasEmpty = !!empty;
    const wrap = hasEmpty ? upgradeLargeCore() : null;
    if (wrap) {
      const rect = wrap.getBoundingClientRect();
      if (rect.width > 2) lastLargeRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    if (lastHadEmpty === null) {
      headerButton?.classList.toggle('is-visible', !hasEmpty);
      lastHadEmpty = hasEmpty;
      return;
    }
    if (lastHadEmpty === hasEmpty) return;

    if (lastHadEmpty && !hasEmpty) {
      const from = lastLargeRect;
      const to = headerButton?.getBoundingClientRect?.();
      await flyCore(from, to, 'collapse');
      headerButton?.classList.add('is-visible');
      headerEngine?.setState('responding');
      respondingUntil = performance.now() + 1200;
      largeEngine?.destroy();
      largeEngine = null;
    } else if (!lastHadEmpty && hasEmpty && wrap) {
      const from = headerButton?.getBoundingClientRect?.();
      const to = wrap.getBoundingClientRect();
      wrap.classList.add('is-morphing');
      await flyCore(from, to, 'expand');
      headerButton?.classList.remove('is-visible');
      wrap.classList.remove('is-morphing');
      largeEngine?.setState($('#workspace')?.classList.contains('work-mode') ? 'work' : 'idle');
    }
    lastHadEmpty = hasEmpty;
  }

  function bindSignals() {
    const input = $('#messageInput');
    if (input && input.dataset.coreBound !== 'true') {
      input.dataset.coreBound = 'true';
      input.addEventListener('input', () => {
        if (input.value.trim()) typingUntil = performance.now() + 900;
        else typingUntil = 0;
      });
      input.addEventListener('keydown', () => {
        if (input.value.trim()) typingUntil = performance.now() + 900;
      });
    }
  }

  function tickSignals() {
    applyState();
    requestAnimationFrame(tickSignals);
  }

  function init() {
    mountHeaderCore();
    bindSignals();
    syncPresence();

    const observer = new MutationObserver(() => {
      bindSignals();
      requestAnimationFrame(() => syncPresence());
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', () => engines.forEach((engine) => engine.resize()), { passive: true });
    addEventListener('online', applyState);
    addEventListener('offline', applyState);
    requestAnimationFrame(tickSignals);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
