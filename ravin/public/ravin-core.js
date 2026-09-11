(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  let coreButton = null;
  let coreEngine = null;
  let typingUntil = 0;
  let respondingUntil = 0;
  let wasThinking = false;
  let layoutFrame = 0;
  let positionFrame = 0;
  let layingOut = false;
  let flowObserver = null;
  let resizeObserver = null;
  let lastCore = { x: 0, y: 0, radius: 96 };

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  function inkRGB() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    const nums = raw.split(/\s+/).map(Number).filter(Number.isFinite);
    return nums.length >= 3 ? nums.slice(0, 3) : [245, 245, 246];
  }

  function cssRgba(rgb, alpha) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }

  function makePoints(count) {
    return Array.from({ length: count }, (_, i) => {
      const group = i % 9 < 4 ? 0 : i % 9 < 8 ? 1 : 2;
      const u = (i + .5) / count;
      const phi = Math.acos(1 - 2 * u);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i + group * .64;
      const shell = group === 0
        ? .43 + Math.random() * .19
        : group === 1
          ? .73 + Math.random() * .15
          : .98 + Math.random() * .17;
      return {
        x: Math.cos(theta) * Math.sin(phi),
        y: Math.cos(phi),
        z: Math.sin(theta) * Math.sin(phi),
        shell,
        group,
        seed: Math.random() * Math.PI * 2,
        size: .7 + Math.random() * .85,
      };
    });
  }

  class SpatialCore {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.points = makePoints(214);
      this.angle = Math.random() * Math.PI * 2;
      this.tilt = -.24;
      this.energy = .18;
      this.targetEnergy = .18;
      this.pressure = 0;
      this.targetPressure = 0;
      this.pulse = 0;
      this.state = 'idle';
      this.last = performance.now();
      this.frame = 0;
      this.loop = this.loop.bind(this);
      this.resize();
      this.frame = requestAnimationFrame(this.loop);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width || 132);
      const height = Math.max(1, rect.height || 132);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const nextW = Math.round(width * dpr);
      const nextH = Math.round(height * dpr);
      if (this.canvas.width !== nextW || this.canvas.height !== nextH) {
        this.canvas.width = nextW;
        this.canvas.height = nextH;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = width;
      this.height = height;
    }

    setState(next) {
      this.state = next;
      const levels = { offline: .025, idle: .17, work: .31, typing: .45, responding: .76, thinking: 1 };
      this.targetEnergy = levels[next] ?? .17;
      if (next === 'responding') this.pulse = 1;
    }

    setTextPressure(value) {
      this.targetPressure = clamp(value, 0, 1);
    }

    acknowledge() {
      this.pulse = 1;
      respondingUntil = performance.now() + 760;
    }

    loop(now) {
      const dt = Math.min(32, now - this.last || 16) / 16.67;
      this.last = now;
      this.resize();
      this.energy = lerp(this.energy, this.targetEnergy, 1 - Math.pow(.88, dt));
      this.pressure = lerp(this.pressure, this.targetPressure, 1 - Math.pow(.84, dt));
      this.pulse *= Math.pow(.946, dt);
      if (!reduceMotion) this.angle += (.0027 + this.energy * .0108) * dt;
      this.draw(now);
      this.frame = requestAnimationFrame(this.loop);
    }

    draw(now) {
      const { ctx, width: w, height: h } = this;
      const rgb = inkRGB();
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * .405;
      const thinking = this.state === 'thinking';
      const responding = this.state === 'responding';
      const work = this.state === 'work' || ($('#workspace')?.classList.contains('work-mode') && this.state === 'idle');
      const stateCompression = thinking ? .74 : this.state === 'typing' ? .89 : 1;
      const pressureCompression = 1 - this.pressure * .075;
      const compression = stateCompression * pressureCompression;
      const wave = responding ? Math.sin(now * .0125) * .034 + this.pulse * .14 : this.pulse * .035;
      const tilt = this.tilt + Math.sin(now * .00033) * .075;
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      const ct = Math.cos(tilt), st = Math.sin(tilt);

      ctx.clearRect(0, 0, w, h);

      const glowRadius = base * (.28 + this.energy * .12 + this.pulse * .11 + this.pressure * .025);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius * 2.45);
      gradient.addColorStop(0, cssRgba(rgb, .19 + this.energy * .29));
      gradient.addColorStop(.2, cssRgba(rgb, .085 + this.energy * .13));
      gradient.addColorStop(1, cssRgba(rgb, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius * 2.45, 0, Math.PI * 2);
      ctx.fill();

      const projected = this.points.map((p, index) => {
        const orbit = p.shell * compression * (1 + wave * (p.group === 2 ? 1.45 : .62));
        let x = p.x * ca - p.z * sa;
        let z = p.x * sa + p.z * ca;
        let y = p.y;
        const y2 = y * ct - z * st;
        const z2 = y * st + z * ct;
        y = y2; z = z2;

        const asymX = p.group === 0 ? .76 : p.group === 1 ? 1.04 : 1.18;
        const asymY = p.group === 0 ? .94 : p.group === 1 ? .85 : 1.06;
        const drift = reduceMotion ? 0 : Math.sin(now * .00115 + p.seed) * (p.group === 2 ? .048 : .021);
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

      const linkStride = work || thinking ? 7 : 11;
      const linkLimit = base * .5;
      ctx.lineWidth = .55;
      for (let i = 0; i < projected.length - linkStride; i += linkStride) {
        const a = projected[i];
        const b = projected[(i + linkStride + (a.group === 2 ? 5 : 0)) % projected.length];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > linkLimit) continue;
        const alpha = (.022 + this.energy * .058 + (work ? .035 : 0) + this.pressure * .018) * clamp(1 - distance / linkLimit);
        ctx.strokeStyle = cssRgba(rgb, alpha);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const p of projected) {
        const front = clamp((p.z + 1) / 2);
        const groupAlpha = p.group === 0 ? .39 : p.group === 1 ? .27 : .17;
        const alpha = groupAlpha + front * (.28 + this.energy * .15);
        const radius = p.size * (.68 + front * .72) * (1 + this.energy * .08);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = cssRgba(rgb, alpha);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, 2.8 + this.energy * 1.35 + this.pulse * .55, 0, Math.PI * 2);
      ctx.fillStyle = cssRgba(rgb, .9);
      ctx.fill();

      for (let i = 0; i < 4; i += 1) {
        const a = this.angle * (i % 2 ? -1.28 : .84) + i * 1.71;
        const r = base * (.24 + i * .055) * (thinking ? .72 : 1);
        const sx = cx + Math.cos(a) * r;
        const sy = cy + Math.sin(a * 1.12) * r * .72;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.02, 0, Math.PI * 2);
        ctx.fillStyle = cssRgba(rgb, .4 + this.energy * .2);
        ctx.fill();
      }

      if (this.pulse > .02) {
        ctx.beginPath();
        ctx.arc(cx, cy, base * (.48 + (1 - this.pulse) * 1.04), 0, Math.PI * 2);
        ctx.strokeStyle = cssRgba(rgb, this.pulse * .18);
        ctx.lineWidth = .7;
        ctx.stroke();
      }
    }
  }

  function mountSpatialCore() {
    if (coreButton?.isConnected) return true;
    const scroller = $('#messageScroller');
    if (!scroller) return false;

    coreButton = document.createElement('div');
    coreButton.id = 'ravinSpatialCore';
    coreButton.className = 'ravin-spatial-core';
    coreButton.setAttribute('aria-hidden', 'true');
    coreButton.innerHTML = '<canvas width="280" height="280" aria-hidden="true"></canvas><span class="ravin-core-field" aria-hidden="true"></span>';
    document.body.appendChild(coreButton);
    coreEngine = new SpatialCore($('canvas', coreButton));
    syncCorePosition();
    return true;
  }

  function coreRadius() {
    const width = innerWidth;
    if (width <= 620) return 66;
    if (width <= 900) return 82;
    return 98;
  }

  function syncCorePosition() {
    cancelAnimationFrame(positionFrame);
    positionFrame = requestAnimationFrame(() => {
      const scroller = $('#messageScroller');
      if (!scroller || !coreButton) return;
      const rect = scroller.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      const radius = coreRadius();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height * .44;
      lastCore = { x, y, radius };
      coreButton.style.left = `${x}px`;
      coreButton.style.top = `${y}px`;
      coreButton.style.setProperty('--core-field-radius', `${radius}px`);
      scheduleFlowLayout();
    });
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
    const next = desiredState();
    coreEngine?.setState(next);
    coreButton?.classList.toggle('core-thinking', next === 'thinking');
    coreButton?.classList.toggle('core-responding', next === 'responding');
    coreButton?.classList.toggle('core-offline', next === 'offline');
    const thinking = next === 'thinking';
    if (wasThinking && !thinking) respondingUntil = performance.now() + 1450;
    wasThinking = thinking;
  }

  function bindTypingSignals() {
    const input = $('#messageInput');
    if (!input || input.dataset.spatialCoreBound === 'true') return;
    input.dataset.spatialCoreBound = 'true';
    const markTyping = () => {
      typingUntil = input.value.trim() ? performance.now() + 900 : 0;
    };
    input.addEventListener('input', markTyping);
    input.addEventListener('keydown', markTyping);
  }

  function originalMessage(body) {
    if (body.dataset.coreOriginal != null) {
      return {
        text: body.dataset.coreOriginal,
        time: body.dataset.coreTime || '',
      };
    }
    const clone = body.cloneNode(true);
    const timeNode = clone.querySelector('.ravin-message-time');
    const time = timeNode?.textContent?.trim() || '';
    timeNode?.remove();
    const text = clone.textContent?.replace(/\u00a0/g, ' ').trim() || '';
    body.dataset.coreOriginal = text;
    body.dataset.coreTime = time;
    return { text, time };
  }

  function restoreMessage(body) {
    if (body.dataset.coreFlowActive !== 'true') return;
    const { text, time } = originalMessage(body);
    body.replaceChildren(document.createTextNode(text));
    if (time) {
      const stamp = document.createElement('span');
      stamp.className = 'ravin-message-time';
      stamp.textContent = time;
      body.appendChild(stamp);
    }
    body.classList.remove('core-flow-active');
    delete body.dataset.coreFlowActive;
  }

  function fontFor(body) {
    const style = getComputedStyle(body);
    const weight = style.fontWeight || '400';
    const size = style.fontSize || '13px';
    const family = style.fontFamily || 'Inter, system-ui, sans-serif';
    return `${weight} ${size} ${family}`;
  }

  function measure(text) {
    return measureCtx.measureText(text).width;
  }

  function fitWords(words, maxWidth) {
    if (!words.length || maxWidth < 18) return '';
    let used = '';
    let count = 0;
    for (const word of words) {
      const next = used ? `${used} ${word}` : word;
      if (measure(next) <= maxWidth || count === 0) {
        used = next;
        count += 1;
        if (measure(next) > maxWidth && count === 1) break;
      } else {
        break;
      }
    }
    words.splice(0, count);
    return used;
  }

  function buildFullLine(text, lineHeight) {
    const row = document.createElement('div');
    row.className = 'core-flow-line core-flow-line-full';
    row.style.height = `${lineHeight}px`;
    const span = document.createElement('span');
    span.textContent = text;
    row.appendChild(span);
    return row;
  }

  function buildSplitLine(left, right, leftWidth, gapWidth, rightWidth, lineHeight) {
    const row = document.createElement('div');
    row.className = 'core-flow-line core-flow-line-split';
    row.style.height = `${lineHeight}px`;
    row.style.gridTemplateColumns = `${Math.max(0, leftWidth)}px ${Math.max(0, gapWidth)}px ${Math.max(0, rightWidth)}px`;
    const leftSpan = document.createElement('span');
    leftSpan.className = 'core-flow-fragment core-flow-fragment-left';
    leftSpan.textContent = left;
    const gap = document.createElement('i');
    gap.className = 'core-flow-gap';
    const rightSpan = document.createElement('span');
    rightSpan.className = 'core-flow-fragment core-flow-fragment-right';
    rightSpan.textContent = right;
    row.append(leftSpan, gap, rightSpan);
    return row;
  }

  function paragraphTokens(text) {
    const segments = text.split(/\n+/);
    const out = [];
    segments.forEach((segment, index) => {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      if (words.length) out.push({ words });
      if (index < segments.length - 1) out.push({ break: true });
    });
    return out;
  }

  function renderFlow(body) {
    const { text, time } = originalMessage(body);
    if (!text) return 0;

    const rect = body.getBoundingClientRect();
    const article = body.closest('.ravin-message');
    const articleRect = article?.getBoundingClientRect();
    const style = getComputedStyle(body);
    const lineHeight = Math.max(17, parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.68 || 22);
    const roleColumn = innerWidth <= 620 ? 0 : 92;
    const layoutLeft = articleRect ? articleRect.left + roleColumn : rect.left;
    const width = articleRect ? Math.max(0, articleRect.width - roleColumn) : (body.clientWidth || rect.width);
    if (width < 120) return 0;

    measureCtx.font = fontFor(body);
    const coreX = lastCore.x - layoutLeft;
    const radius = lastCore.radius;
    const margin = 12;
    const minLane = innerWidth <= 620 ? 48 : 72;
    const tokens = paragraphTokens(text);
    const container = document.createDocumentFragment();
    let y = rect.top + lineHeight / 2;
    let activeLines = 0;
    let pressure = 0;

    for (const segment of tokens) {
      if (segment.break) {
        const spacer = document.createElement('div');
        spacer.className = 'core-flow-paragraph-gap';
        spacer.style.height = `${lineHeight * .58}px`;
        container.appendChild(spacer);
        y += lineHeight * .58;
        continue;
      }

      const words = [...segment.words];
      while (words.length) {
        const dy = y - lastCore.y;
        const intersectsY = Math.abs(dy) < radius;
        const coreWithinX = coreX > -radius && coreX < width + radius;

        if (!intersectsY || !coreWithinX) {
          const line = fitWords(words, width);
          container.appendChild(buildFullLine(line, lineHeight));
          y += lineHeight;
          continue;
        }

        const chord = Math.sqrt(Math.max(0, radius * radius - dy * dy));
        let leftWidth = Math.max(0, coreX - chord - margin);
        let rightWidth = Math.max(0, width - (coreX + chord + margin));
        if (leftWidth < minLane) leftWidth = 0;
        if (rightWidth < minLane) rightWidth = 0;

        if (!leftWidth && !rightWidth) {
          const spacer = document.createElement('div');
          spacer.className = 'core-flow-line core-flow-line-clear';
          spacer.style.height = `${lineHeight}px`;
          container.appendChild(spacer);
          y += lineHeight;
          activeLines += 1;
          pressure = Math.max(pressure, 1 - Math.abs(dy) / radius);
          continue;
        }

        const left = leftWidth ? fitWords(words, leftWidth) : '';
        const right = rightWidth ? fitWords(words, rightWidth) : '';
        if (!left && !right && words.length) {
          const widest = leftWidth >= rightWidth ? leftWidth : rightWidth;
          const line = fitWords(words, Math.max(widest, minLane));
          if (leftWidth >= rightWidth) {
            container.appendChild(buildSplitLine(line, '', leftWidth, width - leftWidth - rightWidth, rightWidth, lineHeight));
          } else {
            container.appendChild(buildSplitLine('', line, leftWidth, width - leftWidth - rightWidth, rightWidth, lineHeight));
          }
        } else {
          const gapWidth = Math.max(0, width - leftWidth - rightWidth);
          container.appendChild(buildSplitLine(left, right, leftWidth, gapWidth, rightWidth, lineHeight));
        }
        activeLines += 1;
        pressure = Math.max(pressure, 1 - Math.abs(dy) / radius);
        y += lineHeight;
      }
    }

    layingOut = true;
    body.replaceChildren(container);
    if (time) {
      const stamp = document.createElement('span');
      stamp.className = 'ravin-message-time core-flow-time';
      stamp.textContent = time;
      body.appendChild(stamp);
    }
    body.classList.toggle('core-flow-active', activeLines > 0);
    if (activeLines > 0) body.dataset.coreFlowActive = 'true';
    else delete body.dataset.coreFlowActive;
    layingOut = false;
    return pressure;
  }

  function layoutVisibleMessages() {
    layoutFrame = 0;
    if (!coreButton || !$('#messageScroller')) return;
    let maxPressure = 0;
    const bandTop = lastCore.y - lastCore.radius - 140;
    const bandBottom = lastCore.y + lastCore.radius + 140;

    for (const article of $$('.ravin-message', $('#messages'))) {
      const body = $('.ravin-message-body', article);
      if (!body) continue;
      const rect = body.getBoundingClientRect();
      const nearBand = rect.bottom >= bandTop && rect.top <= bandBottom;
      if (!nearBand) {
        restoreMessage(body);
        continue;
      }
      maxPressure = Math.max(maxPressure, renderFlow(body));
    }
    coreEngine?.setTextPressure(maxPressure);
  }

  function scheduleFlowLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(layoutVisibleMessages);
  }

  function bindScroller() {
    const scroller = $('#messageScroller');
    if (!scroller || scroller.dataset.coreFlowBound === 'true') return;
    scroller.dataset.coreFlowBound = 'true';
    scroller.addEventListener('scroll', scheduleFlowLayout, { passive: true });
  }

  function observeMessages() {
    const messages = $('#messages');
    if (!messages || flowObserver) return;
    flowObserver = new MutationObserver((mutations) => {
      if (layingOut) return;
      const meaningful = mutations.some((m) => [...m.addedNodes, ...m.removedNodes].some((node) => {
        if (node.nodeType !== 1) return true;
        return !node.classList?.contains('core-flow-line') && !node.classList?.contains('core-flow-paragraph-gap');
      }));
      if (meaningful) scheduleFlowLayout();
    });
    flowObserver.observe(messages, { childList: true });
  }

  function observeLayout() {
    if (resizeObserver || typeof ResizeObserver === 'undefined') return;
    resizeObserver = new ResizeObserver(() => {
      syncCorePosition();
      scheduleFlowLayout();
    });
    const scroller = $('#messageScroller');
    const workspace = $('#workspace');
    if (scroller) resizeObserver.observe(scroller);
    if (workspace) resizeObserver.observe(workspace);
  }

  function tick() {
    applyState();
    requestAnimationFrame(tick);
  }

  function init() {
    if (!mountSpatialCore()) {
      setTimeout(init, 60);
      return;
    }
    bindTypingSignals();
    bindScroller();
    observeMessages();
    observeLayout();
    syncCorePosition();
    scheduleFlowLayout();

    const workspace = $('#workspace');
    if (workspace) {
      new MutationObserver(() => {
        syncCorePosition();
        scheduleFlowLayout();
      }).observe(workspace, { attributes: true, attributeFilter: ['class'] });
    }

    addEventListener('resize', () => {
      syncCorePosition();
      scheduleFlowLayout();
    }, { passive: true });
    addEventListener('online', applyState);
    addEventListener('offline', applyState);
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
