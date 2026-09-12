(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let canvas = null;
  let ctx = null;
  let forceNode = null;
  let points = [];
  let trails = [];
  let fieldRect = { left: 0, top: 0, width: 1, height: 1 };
  let dpr = 1;
  let phase = 'idle';
  let phaseStarted = performance.now();
  let concentration = 0;
  let responseMassUsed = 0;
  let currentStreamBody = null;
  let currentStreamArticle = null;
  let lastStreamLength = 0;
  let lastWriteTarget = null;
  let typingUntil = 0;
  let inputFocused = false;
  let layoutFrame = 0;
  let positionFrame = 0;
  let lastLayoutRadius = -1;
  let lastForce = { x: 0, y: 0, radius: 0 };
  let layingOut = false;
  let resizeObserver = null;
  let messageObserver = null;
  let statusObserver = null;
  let lastFrame = performance.now();
  let releaseTimer = 0;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  function inkRGB() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    const nums = raw.split(/\s+/).map(Number).filter(Number.isFinite);
    return nums.length >= 3 ? nums.slice(0, 3) : [245, 245, 246];
  }

  function rgba(rgb, alpha) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }

  function pointCount() {
    if (innerWidth <= 460) return 120;
    if (innerWidth <= 700) return 155;
    return 260;
  }

  function maxForceRadius() {
    if (innerWidth <= 460) return 54;
    if (innerWidth <= 700) return 66;
    if (innerWidth <= 900) return 82;
    return 102;
  }

  function center() {
    return {
      x: fieldRect.width / 2,
      y: fieldRect.height * (innerWidth <= 700 ? .42 : .44),
    };
  }

  function globalCenter() {
    const c = center();
    return { x: fieldRect.left + c.x, y: fieldRect.top + c.y };
  }

  function randomPoint() {
    const angle = Math.random() * Math.PI * 2;
    const speed = .025 + Math.random() * .085;
    return {
      x: Math.random() * fieldRect.width,
      y: Math.random() * fieldRect.height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: .45 + Math.random() * 1.05,
      alpha: .12 + Math.random() * .36,
      seed: Math.random() * Math.PI * 2,
      collapseDelay: Math.random() * .28,
      ox: 0,
      oy: 0,
      tx: 0,
      ty: 0,
      releaseDelay: Math.random() * .22,
    };
  }

  function ensurePoints() {
    const count = pointCount();
    if (points.length === count) return;
    const next = Array.from({ length: count }, () => randomPoint());
    const copy = Math.min(points.length, next.length);
    for (let i = 0; i < copy; i += 1) {
      next[i].x = clamp(points[i].x, 0, fieldRect.width);
      next[i].y = clamp(points[i].y, 0, fieldRect.height);
    }
    points = next;
  }

  function syncCanvas() {
    cancelAnimationFrame(positionFrame);
    positionFrame = requestAnimationFrame(() => {
      const scroller = $('#messageScroller');
      if (!scroller || !canvas) return;
      const rect = scroller.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      const oldWidth = fieldRect.width || rect.width;
      const oldHeight = fieldRect.height || rect.height;
      fieldRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      canvas.style.left = `${rect.left}px`;
      canvas.style.top = `${rect.top}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (oldWidth > 1 && oldHeight > 1) {
          points.forEach((p) => {
            p.x = p.x / oldWidth * rect.width;
            p.y = p.y / oldHeight * rect.height;
          });
        }
      }
      ensurePoints();
      updateForceNode(lastForce.radius);
      scheduleFlowLayout(true);
    });
  }

  function mount() {
    if (canvas?.isConnected) return true;
    if (!$('#messageScroller')) return false;
    canvas = document.createElement('canvas');
    canvas.id = 'ravinParticleField';
    canvas.className = 'ravin-field-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');

    forceNode = document.createElement('div');
    forceNode.id = 'ravinFieldForce';
    forceNode.className = 'ravin-field-force';
    forceNode.setAttribute('aria-hidden', 'true');
    document.body.appendChild(forceNode);

    syncCanvas();
    return true;
  }

  function captureCollapseOrigins() {
    const c = center();
    points.forEach((p) => {
      p.ox = p.x;
      p.oy = p.y;
      p.tx = c.x + Math.cos(p.seed) * (1.2 + Math.random() * 4.5);
      p.ty = c.y + Math.sin(p.seed * 1.37) * (1.2 + Math.random() * 4.5);
      p.collapseDelay = Math.random() * .26;
    });
  }

  function beginCollapse() {
    clearTimeout(releaseTimer);
    if (reduceMotion) {
      phase = 'thinking';
      concentration = 1;
      phaseStarted = performance.now();
      scheduleFlowLayout(true);
      return;
    }
    captureCollapseOrigins();
    phase = 'collapse';
    phaseStarted = performance.now();
    concentration = 0;
    responseMassUsed = 0;
    currentStreamBody = null;
    currentStreamArticle = null;
    lastStreamLength = 0;
    lastWriteTarget = null;
    trails = [];
  }

  function beginResponse(article, body) {
    if (phase === 'idle' || phase === 'release') beginCollapse();
    phase = 'responding';
    phaseStarted = performance.now();
    concentration = 1;
    responseMassUsed = 0;
    currentStreamArticle = article;
    currentStreamBody = body;
    lastWriteTarget = null;
    article?.classList.add('ravin-field-writing');
  }

  function beginRelease(delay = 160) {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      const c = center();
      points.forEach((p) => {
        p.ox = c.x + Math.cos(p.seed) * 3;
        p.oy = c.y + Math.sin(p.seed * 1.3) * 3;
        p.tx = Math.random() * fieldRect.width;
        p.ty = Math.random() * fieldRect.height;
        p.releaseDelay = Math.random() * .22;
      });
      phase = 'release';
      phaseStarted = performance.now();
      currentStreamArticle?.classList.remove('ravin-field-writing');
      currentStreamArticle = null;
      currentStreamBody = null;
      lastStreamLength = 0;
      lastWriteTarget = null;
    }, reduceMotion ? 0 : delay);
  }

  function forceRadius() {
    const max = maxForceRadius();
    if (phase === 'idle') return 0;
    if (phase === 'collapse') return max * Math.pow(clamp(concentration), 2.05);
    if (phase === 'thinking') return max;
    if (phase === 'responding') {
      const remainingMass = clamp(1 - responseMassUsed * .72, .24, 1);
      return max * (.34 + .66 * remainingMass);
    }
    if (phase === 'release') return max * Math.pow(clamp(concentration), 2.1);
    return 0;
  }

  function updateForceNode(radius) {
    if (!forceNode) return;
    const c = globalCenter();
    forceNode.style.left = `${c.x}px`;
    forceNode.style.top = `${c.y}px`;
    forceNode.style.setProperty('--ravin-force-radius', `${Math.max(0, radius)}px`);
    lastForce = { x: c.x, y: c.y, radius };
  }

  function updateIdlePoint(p, dt, now) {
    const focusedBoost = inputFocused ? 1.25 : 1;
    const typingBoost = now < typingUntil ? 1.38 : 1;
    const speed = focusedBoost * typingBoost;
    const wobble = Math.sin(now * .0006 + p.seed) * .0026;
    p.vx += Math.cos(p.seed + now * .00017) * wobble;
    p.vy += Math.sin(p.seed * 1.31 + now * .00015) * wobble;
    const maxSpeed = .16 * speed;
    const mag = Math.hypot(p.vx, p.vy) || 1;
    if (mag > maxSpeed) {
      p.vx = p.vx / mag * maxSpeed;
      p.vy = p.vy / mag * maxSpeed;
    }
    p.x += p.vx * dt * speed;
    p.y += p.vy * dt * speed;
    if (p.x < -4) p.x = fieldRect.width + 4;
    if (p.x > fieldRect.width + 4) p.x = -4;
    if (p.y < -4) p.y = fieldRect.height + 4;
    if (p.y > fieldRect.height + 4) p.y = -4;
  }

  function updatePhase(now, dt) {
    const c = center();
    if (phase === 'idle') {
      concentration = 0;
      points.forEach((p) => updateIdlePoint(p, dt, now));
      return;
    }

    if (phase === 'collapse') {
      const global = clamp((now - phaseStarted) / 900);
      let sum = 0;
      points.forEach((p) => {
        const local = clamp((global - p.collapseDelay) / (1 - p.collapseDelay));
        const q = smooth(local);
        p.x = lerp(p.ox, p.tx, q);
        p.y = lerp(p.oy, p.ty, q);
        sum += q;
      });
      concentration = sum / Math.max(1, points.length);
      if (global >= 1) {
        phase = 'thinking';
        phaseStarted = now;
        concentration = 1;
      }
      return;
    }

    if (phase === 'thinking' || phase === 'responding') {
      concentration = 1;
      const visibleFraction = phase === 'responding' ? clamp(1 - responseMassUsed * .76, .18, 1) : 1;
      const visible = Math.ceil(points.length * visibleFraction);
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        if (i >= visible) continue;
        const pulse = Math.sin(now * .006 + p.seed) * (phase === 'thinking' ? 2.2 : 1.6);
        p.x = c.x + Math.cos(p.seed * 2.1) * (2 + Math.abs(pulse));
        p.y = c.y + Math.sin(p.seed * 1.7) * (2 + Math.abs(pulse));
      }
      return;
    }

    if (phase === 'release') {
      const global = clamp((now - phaseStarted) / 880);
      let sum = 0;
      points.forEach((p) => {
        const local = clamp((global - p.releaseDelay) / (1 - p.releaseDelay));
        const q = easeOut(local);
        p.x = lerp(p.ox, p.tx, q);
        p.y = lerp(p.oy, p.ty, q);
        sum += q;
      });
      concentration = 1 - sum / Math.max(1, points.length);
      if (global >= 1) {
        phase = 'idle';
        concentration = 0;
        responseMassUsed = 0;
        points.forEach((p) => {
          const angle = Math.random() * Math.PI * 2;
          const speed = .025 + Math.random() * .085;
          p.vx = Math.cos(angle) * speed;
          p.vy = Math.sin(angle) * speed;
        });
        scheduleFlowLayout(true);
      }
    }
  }

  function drawCentralMass(now, rgb) {
    if (!ctx || phase === 'idle' || phase === 'release' && concentration < .02) return;
    const c = center();
    const responseRemaining = phase === 'responding' ? clamp(1 - responseMassUsed * .72, .22, 1) : 1;
    const mass = clamp(concentration * responseRemaining);
    if (mass <= .01) return;
    const pulse = phase === 'thinking' ? (Math.sin(now * .0075) + 1) / 2 : .35;
    const dotRadius = 1.45 + mass * 3.7 + pulse * .55;
    const glowRadius = 8 + mass * 25 + pulse * 4;
    const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glowRadius);
    gradient.addColorStop(0, rgba(rgb, .5 + mass * .38));
    gradient.addColorStop(.16, rgba(rgb, .2 + mass * .26));
    gradient.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(c.x, c.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(rgb, .76 + mass * .22);
    ctx.beginPath();
    ctx.arc(c.x, c.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPoints(now, rgb) {
    if (!ctx) return;
    const visibleFraction = phase === 'responding' ? clamp(1 - responseMassUsed * .76, .18, 1) : 1;
    const visible = Math.ceil(points.length * visibleFraction);
    for (let i = 0; i < points.length; i += 1) {
      if (phase === 'responding' && i >= visible) continue;
      const p = points[i];
      let alpha = p.alpha;
      if (phase === 'collapse') alpha *= .55 + concentration * .75;
      if (phase === 'thinking') alpha *= .55;
      if (phase === 'responding') alpha *= .36;
      if (phase === 'release') alpha *= .48 + (1 - concentration) * .7;
      const flicker = reduceMotion ? 1 : .86 + Math.sin(now * .0024 + p.seed) * .14;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * flicker, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, clamp(alpha, 0, .8));
      ctx.fill();
    }
  }

  function addTrail(start, end, strength = 1, count = 6) {
    const now = performance.now();
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const nx = distance ? -dy / distance : 0;
    const ny = distance ? dx / distance : 0;
    for (let i = 0; i < count; i += 1) {
      const bend = (Math.random() - .5) * Math.min(55, distance * .18);
      trails.push({
        sx: start.x + (Math.random() - .5) * 3,
        sy: start.y + (Math.random() - .5) * 3,
        ex: end.x + (Math.random() - .5) * 5,
        ey: end.y + (Math.random() - .5) * 4,
        cx: (start.x + end.x) / 2 + nx * bend,
        cy: (start.y + end.y) / 2 + ny * bend,
        born: now + i * 8,
        duration: 165 + Math.min(260, distance * .32) + Math.random() * 90,
        size: .55 + Math.random() * 1.15,
        alpha: (.28 + Math.random() * .55) * strength,
      });
    }
    if (trails.length > 220) trails.splice(0, trails.length - 220);
  }

  function drawTrails(now, rgb) {
    const alive = [];
    for (const t of trails) {
      if (now < t.born) { alive.push(t); continue; }
      const p = clamp((now - t.born) / t.duration);
      if (p >= 1) continue;
      const q = easeOut(p);
      const inv = 1 - q;
      const x = inv * inv * t.sx + 2 * inv * q * t.cx + q * q * t.ex;
      const y = inv * inv * t.sy + 2 * inv * q * t.cy + q * q * t.ey;
      const tail = clamp(1 - p);
      ctx.beginPath();
      ctx.arc(x, y, t.size * (.7 + tail * .55), 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, t.alpha * Math.min(1, p * 5) * tail);
      ctx.fill();
      alive.push(t);
    }
    trails = alive;
  }

  function draw(now) {
    if (!ctx) return;
    ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);
    const rgb = inkRGB();
    drawPoints(now, rgb);
    drawTrails(now, rgb);
    drawCentralMass(now, rgb);
  }

  function loop(now) {
    const dt = Math.min(34, now - lastFrame || 16.67);
    lastFrame = now;
    updatePhase(now, dt);
    const radius = forceRadius();
    updateForceNode(radius);
    if (Math.abs(radius - lastLayoutRadius) > 1.5) {
      lastLayoutRadius = radius;
      scheduleFlowLayout();
    }
    draw(now);
    requestAnimationFrame(loop);
  }

  function findMainTextNode(body) {
    for (const node of body.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.length) return node;
      if (node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains('ravin-message-time')) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let child;
        while ((child = walker.nextNode())) {
          if (child.textContent?.length) return child;
        }
      }
    }
    return null;
  }

  function textEndpoint(body) {
    const raw = body?.dataset?.v02Raw || '';
    if (!body || !raw) return null;
    const textNode = findMainTextNode(body);
    if (!textNode || !textNode.textContent?.length) return null;
    try {
      const len = textNode.textContent.length;
      const range = document.createRange();
      range.setStart(textNode, Math.max(0, len - 1));
      range.setEnd(textNode, len);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return null;
      return {
        x: rect.right - fieldRect.left,
        y: rect.top + rect.height * .55 - fieldRect.top,
      };
    } catch {
      return null;
    }
  }

  function handleStreamingMutation() {
    const article = $('#messages .ravin-v02-streaming.assistant');
    if (!article) {
      if (currentStreamArticle && phase === 'responding') beginRelease();
      return;
    }
    const body = $('.ravin-message-body', article);
    if (!body) return;
    const raw = body.dataset.v02Raw || '';
    if (!raw.length) return;

    if (article !== currentStreamArticle || phase !== 'responding') {
      beginResponse(article, body);
      lastStreamLength = 0;
    }

    if (raw.length <= lastStreamLength) return;
    const delta = raw.slice(lastStreamLength);
    const end = textEndpoint(body);
    if (end) {
      const start = lastWriteTarget || center();
      const first = !lastWriteTarget;
      addTrail(start, end, first ? 1 : .84, first ? 26 : clamp(Math.ceil(delta.length / 2), 3, 9));
      lastWriteTarget = end;
    }
    responseMassUsed = clamp(responseMassUsed + Math.max(.004, Math.min(.032, delta.length * .0017)), 0, .86);
    lastStreamLength = raw.length;
    article.classList.add('ravin-field-writing');
    clearTimeout(article._ravinFieldWritingTimer);
    article._ravinFieldWritingTimer = setTimeout(() => article.classList.remove('ravin-field-writing'), 180);
  }

  function bindLifecycle() {
    const status = $('#systemStatus');
    if (status && !statusObserver) {
      let last = status.textContent?.trim() || '';
      statusObserver = new MutationObserver(() => {
        const next = status.textContent?.trim() || '';
        if (next === last) return;
        if (next === 'THINKING' && last !== 'THINKING') beginCollapse();
        if (next === 'OFFLINE' && phase !== 'idle') beginRelease(0);
        last = next;
      });
      statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
    }

    const messages = $('#messages');
    if (messages && !messageObserver) {
      let queued = false;
      messageObserver = new MutationObserver((mutations) => {
        if (layingOut) return;
        const relevant = mutations.some((m) => {
          if (m.type === 'attributes') return m.attributeName === 'data-v02-raw' || m.attributeName === 'class';
          return true;
        });
        if (!relevant || queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          handleStreamingMutation();
          scheduleFlowLayout();
        });
      });
      messageObserver.observe(messages, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'data-v02-raw'],
      });
    }
  }

  function bindInput() {
    const input = $('#messageInput');
    if (!input || input.dataset.ravinFieldBound === 'true') return;
    input.dataset.ravinFieldBound = 'true';
    input.addEventListener('focus', () => { inputFocused = true; });
    input.addEventListener('blur', () => { inputFocused = false; });
    const typing = () => { typingUntil = performance.now() + 900; };
    input.addEventListener('input', typing);
    input.addEventListener('keydown', typing);
  }

  function canonicalMessage(body) {
    const raw = body.dataset.v02Raw ?? body.dataset.ravinForceOriginal;
    if (raw != null) {
      return { text: raw, time: body.dataset.v02Time || body.dataset.ravinForceTime || '' };
    }
    const clone = body.cloneNode(true);
    clone.querySelector('.ravin-message-time')?.remove();
    clone.querySelectorAll('.ravin-message-actions,.ravin-code-copy').forEach((node) => node.remove());
    const text = clone.textContent?.replace(/\u00a0/g, ' ').trim() || '';
    const time = body.querySelector('.ravin-message-time')?.textContent?.trim() || '';
    body.dataset.ravinForceOriginal = text;
    body.dataset.ravinForceTime = time;
    return { text, time };
  }

  function restoreMessage(body) {
    if (body.dataset.ravinForceFlowActive !== 'true') return;
    const { text, time } = canonicalMessage(body);
    layingOut = true;
    body.replaceChildren(document.createTextNode(text));
    if (time) {
      const stamp = document.createElement('span');
      stamp.className = 'ravin-message-time';
      stamp.textContent = time;
      body.appendChild(stamp);
    }
    body.classList.remove('ravin-force-flow-active');
    delete body.dataset.ravinForceFlowActive;
    layingOut = false;
  }

  function fontFor(body) {
    const style = getComputedStyle(body);
    return `${style.fontWeight || '400'} ${style.fontSize || '13px'} ${style.fontFamily || 'Inter, system-ui, sans-serif'}`;
  }

  function fitWords(words, maxWidth) {
    if (!words.length || maxWidth < 18) return '';
    let used = '';
    let count = 0;
    for (const word of words) {
      const next = used ? `${used} ${word}` : word;
      if (measureCtx.measureText(next).width <= maxWidth || count === 0) {
        used = next;
        count += 1;
        if (measureCtx.measureText(next).width > maxWidth && count === 1) break;
      } else break;
    }
    words.splice(0, count);
    return used;
  }

  function fullLine(text, lineHeight) {
    const row = document.createElement('div');
    row.className = 'ravin-force-line ravin-force-line-full';
    row.style.height = `${lineHeight}px`;
    const span = document.createElement('span');
    span.textContent = text;
    row.appendChild(span);
    return row;
  }

  function splitLine(left, right, leftWidth, gapWidth, rightWidth, lineHeight) {
    const row = document.createElement('div');
    row.className = 'ravin-force-line ravin-force-line-split';
    row.style.height = `${lineHeight}px`;
    row.style.gridTemplateColumns = `${Math.max(0, leftWidth)}px ${Math.max(0, gapWidth)}px ${Math.max(0, rightWidth)}px`;
    const l = document.createElement('span');
    l.className = 'ravin-force-fragment ravin-force-fragment-left';
    l.textContent = left;
    const gap = document.createElement('i');
    gap.className = 'ravin-force-gap';
    const r = document.createElement('span');
    r.className = 'ravin-force-fragment ravin-force-fragment-right';
    r.textContent = right;
    row.append(l, gap, r);
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

  function renderFlow(body, radius) {
    const { text, time } = canonicalMessage(body);
    if (!text || radius < 4) { restoreMessage(body); return; }
    if (body.closest('.ravin-v02-streaming')) return;
    if (body.querySelector('pre,table,img,video,audio')) { restoreMessage(body); return; }

    const rect = body.getBoundingClientRect();
    const article = body.closest('.ravin-message');
    const articleRect = article?.getBoundingClientRect();
    if (!articleRect) return;
    const style = getComputedStyle(body);
    const lineHeight = Math.max(17, parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.68 || 22);
    const roleColumn = innerWidth <= 620 ? 0 : 92;
    const layoutLeft = articleRect.left + roleColumn;
    const width = Math.max(0, articleRect.width - roleColumn);
    if (width < 120) return;

    measureCtx.font = fontFor(body);
    const coreX = lastForce.x - layoutLeft;
    const margin = 12;
    const minLane = innerWidth <= 620 ? 46 : 72;
    const tokens = paragraphTokens(text);
    const fragment = document.createDocumentFragment();
    let y = rect.top + lineHeight / 2;
    let active = 0;

    for (const segment of tokens) {
      if (segment.break) {
        const spacer = document.createElement('div');
        spacer.className = 'ravin-force-paragraph-gap';
        spacer.style.height = `${lineHeight * .58}px`;
        fragment.appendChild(spacer);
        y += lineHeight * .58;
        continue;
      }
      const words = [...segment.words];
      while (words.length) {
        const dy = y - lastForce.y;
        const intersectsY = Math.abs(dy) < radius;
        const coreWithinX = coreX > -radius && coreX < width + radius;
        if (!intersectsY || !coreWithinX) {
          fragment.appendChild(fullLine(fitWords(words, width), lineHeight));
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
          spacer.className = 'ravin-force-line ravin-force-line-clear';
          spacer.style.height = `${lineHeight}px`;
          fragment.appendChild(spacer);
          y += lineHeight;
          active += 1;
          continue;
        }

        const left = leftWidth ? fitWords(words, leftWidth) : '';
        const right = rightWidth ? fitWords(words, rightWidth) : '';
        if (!left && !right && words.length) {
          const widest = leftWidth >= rightWidth ? leftWidth : rightWidth;
          const line = fitWords(words, Math.max(widest, minLane));
          if (leftWidth >= rightWidth) fragment.appendChild(splitLine(line, '', leftWidth, width - leftWidth - rightWidth, rightWidth, lineHeight));
          else fragment.appendChild(splitLine('', line, leftWidth, width - leftWidth - rightWidth, rightWidth, lineHeight));
        } else {
          fragment.appendChild(splitLine(left, right, leftWidth, Math.max(0, width - leftWidth - rightWidth), rightWidth, lineHeight));
        }
        active += 1;
        y += lineHeight;
      }
    }

    layingOut = true;
    body.replaceChildren(fragment);
    if (time) {
      const stamp = document.createElement('span');
      stamp.className = 'ravin-message-time ravin-force-time';
      stamp.textContent = time;
      body.appendChild(stamp);
    }
    body.classList.toggle('ravin-force-flow-active', active > 0);
    if (active > 0) body.dataset.ravinForceFlowActive = 'true';
    else delete body.dataset.ravinForceFlowActive;
    layingOut = false;
  }

  function layoutMessages() {
    layoutFrame = 0;
    const root = $('#messages');
    if (!root) return;
    const radius = lastForce.radius;
    const bandTop = lastForce.y - radius - 150;
    const bandBottom = lastForce.y + radius + 150;
    for (const article of $$('.ravin-message', root)) {
      const body = $('.ravin-message-body', article);
      if (!body) continue;
      if (article.classList.contains('ravin-v02-streaming')) { restoreMessage(body); continue; }
      if (radius < 4) { restoreMessage(body); continue; }
      const rect = body.getBoundingClientRect();
      if (rect.bottom < bandTop || rect.top > bandBottom) restoreMessage(body);
      else renderFlow(body, radius);
    }
  }

  function scheduleFlowLayout(force = false) {
    if (force) lastLayoutRadius = -1;
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(layoutMessages);
  }

  function bindScroller() {
    const scroller = $('#messageScroller');
    if (!scroller || scroller.dataset.ravinFieldScrollBound === 'true') return;
    scroller.dataset.ravinFieldScrollBound = 'true';
    scroller.addEventListener('scroll', () => scheduleFlowLayout(true), { passive: true });
  }

  function observeLayout() {
    if (resizeObserver || typeof ResizeObserver === 'undefined') return;
    resizeObserver = new ResizeObserver(() => syncCanvas());
    const scroller = $('#messageScroller');
    const workspace = $('#workspace');
    if (scroller) resizeObserver.observe(scroller);
    if (workspace) resizeObserver.observe(workspace);
  }

  function init() {
    if (!mount()) {
      setTimeout(init, 80);
      return;
    }
    ensurePoints();
    bindInput();
    bindLifecycle();
    bindScroller();
    observeLayout();
    syncCanvas();
    addEventListener('resize', syncCanvas, { passive: true });
    addEventListener('online', () => { if (phase === 'idle') ensurePoints(); });
    addEventListener('offline', () => { if (phase !== 'idle') beginRelease(0); });
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
