(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let canvas, ctx;
  let rect = { left: 0, top: 0, width: 1, height: 1 };
  let points = [];
  let writers = [];
  let phase = 'idle';
  let phaseStarted = performance.now();
  let concentration = 0;
  let responseMassUsed = 0;
  let currentArticle = null;
  let currentBody = null;
  let lastLength = 0;
  let lastEndpoint = null;
  let currentLineY = null;
  let currentLineStart = null;
  let focused = false;
  let typingUntil = 0;
  let lastFrame = performance.now();
  let releaseTimer = 0;
  let releaseGuard = false;
  let resizeObserver = null;
  let streamObserver = null;
  let statusObserver = null;
  let sendObserver = null;
  let pointerX = .5;
  let pointerY = .5;

  const isLight = () => document.documentElement.dataset.theme === 'light';
  const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const inkRGB = () => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    const nums = raw.split(/\s+/).map(Number).filter(Number.isFinite);
    return nums.length >= 3 ? nums.slice(0, 3) : (isLight() ? [17, 17, 17] : [245, 245, 246]);
  };

  function pointCount() {
    if (innerWidth <= 460) return 145;
    if (innerWidth <= 700) return 185;
    return 285;
  }

  function center() {
    return {
      x: rect.width / 2,
      y: rect.height * (innerWidth <= 700 ? .42 : .44),
    };
  }

  function randomVelocity(depth = .6) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (.0010 + Math.random() * .0026) * (.58 + depth * .62);
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }

  function makePoint(index = 0) {
    const depth = .18 + Math.pow(Math.random(), .72) * .82;
    const rare = Math.random() < .09;
    return {
      x: Math.random() * rect.width,
      y: Math.random() * rect.height,
      ...randomVelocity(depth),
      depth,
      cluster: index % 5,
      size: rare ? 1.9 + Math.random() * .9 : .55 + depth * 1.25 + Math.random() * .45,
      alpha: .10 + depth * .28 + (rare ? .1 : 0),
      seed: Math.random() * Math.PI * 2,
      seed2: Math.random() * Math.PI * 2,
      ox: 0, oy: 0, tx: 0, ty: 0,
      curve: (Math.random() - .5) * 2,
      collapseDelay: Math.random() * .22,
      releaseDelay: Math.random() * .17,
      releaseCurve: (Math.random() - .5) * 2,
    };
  }

  function ensurePoints() {
    const wanted = pointCount();
    if (points.length === wanted) return;
    const next = Array.from({ length: wanted }, (_, i) => makePoint(i));
    const copy = Math.min(points.length, next.length);
    for (let i = 0; i < copy; i += 1) {
      next[i].x = clamp(points[i].x, 0, rect.width);
      next[i].y = clamp(points[i].y, 0, rect.height);
      next[i].vx = points[i].vx;
      next[i].vy = points[i].vy;
    }
    points = next;
  }

  function syncCanvas() {
    const scroller = $('#messageScroller');
    if (!scroller || !canvas) return;
    const box = scroller.getBoundingClientRect();
    if (box.width < 20 || box.height < 20) return;

    const oldW = rect.width || box.width;
    const oldH = rect.height || box.height;
    rect = { left: box.left, top: box.top, width: box.width, height: box.height };

    canvas.style.left = `${box.left}px`;
    canvas.style.top = `${box.top}px`;
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(box.width * dpr));
    const h = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (oldW > 1 && oldH > 1) {
        points.forEach((p) => {
          p.x = p.x / oldW * box.width;
          p.y = p.y / oldH * box.height;
        });
      }
    }
    ensurePoints();
  }

  function clusterTarget(cluster, now) {
    const phaseA = now * .000018 + cluster * 1.37;
    const phaseB = now * .000014 + cluster * 1.91;
    return {
      x: rect.width * (.5 + Math.sin(phaseA) * .32),
      y: rect.height * (.5 + Math.cos(phaseB) * .28),
    };
  }

  function idleEnergy(now) {
    if (reduceMotion) return .35;
    const focusBoost = focused ? 1.28 : 1;
    const typingBoost = now < typingUntil ? 1.10 : 1;
    return focusBoost * typingBoost;
  }

  function updateIdlePoint(p, dt, now) {
    const energy = idleEnergy(now);
    const target = clusterTarget(p.cluster, now);
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy) || 1;

    const flowAngle =
      Math.sin(p.y * .007 + now * .000055 + p.seed) * 1.15 +
      Math.cos(p.x * .005 - now * .000043 + p.seed2) * .92;

    const flowStrength = .0000062 * (.45 + p.depth * .85) * energy;
    const pullStrength = .00000125 * (.35 + p.depth) * energy;

    p.vx += Math.cos(flowAngle) * flowStrength * dt;
    p.vy += Math.sin(flowAngle) * flowStrength * dt;
    p.vx += (dx / dist) * pullStrength * dt;
    p.vy += (dy / dist) * pullStrength * dt;

    const max = (.0032 + p.depth * .0032) * energy;
    const mag = Math.hypot(p.vx, p.vy) || 1;
    if (mag > max) {
      p.vx = p.vx / mag * max;
      p.vy = p.vy / mag * max;
    }

    const drag = Math.pow(.9987, dt);
    p.vx *= drag;
    p.vy *= drag;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const parallaxX = (pointerX - .5) * p.depth * .018 * dt;
    const parallaxY = (pointerY - .5) * p.depth * .014 * dt;
    p.x += parallaxX;
    p.y += parallaxY;

    if (p.x < -10) p.x = rect.width + 10;
    if (p.x > rect.width + 10) p.x = -10;
    if (p.y < -10) p.y = rect.height + 10;
    if (p.y > rect.height + 10) p.y = -10;
  }

  function collapse() {
    clearTimeout(releaseTimer);
    releaseGuard = false;
    if (phase === 'collapse' || phase === 'thinking') return;
    const c = center();
    points.forEach((p) => {
      p.ox = p.x;
      p.oy = p.y;
      p.tx = c.x + Math.cos(p.seed) * (1.2 + Math.random() * 4.2);
      p.ty = c.y + Math.sin(p.seed2) * (1.2 + Math.random() * 4.2);
      p.curve = (Math.random() - .5) * 2;
      p.collapseDelay = Math.random() * .22;
    });
    phase = reduceMotion ? 'thinking' : 'collapse';
    phaseStarted = performance.now();
    concentration = reduceMotion ? 1 : 0;
    responseMassUsed = 0;
    currentArticle = null;
    currentBody = null;
    lastLength = 0;
    lastEndpoint = null;
    currentLineY = null;
    currentLineStart = null;
    writers = [];
  }

  function startResponding(article, body) {
    clearTimeout(releaseTimer);
    releaseGuard = false;
    if (phase === 'idle' || phase === 'release') collapse();
    phase = 'responding';
    phaseStarted = performance.now();
    concentration = 1;
    responseMassUsed = 0;
    currentArticle = article;
    currentBody = body;
    lastLength = 0;
    lastEndpoint = null;
    currentLineY = null;
    currentLineStart = null;
    article?.classList.add('ravin-field-writing');
  }

  function nudgeLegacyRelease() {
    const messages = $('#messages');
    if (!messages) return;
    messages.classList.toggle('ravin-field-release-tick');
    requestAnimationFrame(() => messages.classList.toggle('ravin-field-release-tick'));
    setTimeout(() => {
      messages.classList.toggle('ravin-field-release-tick-2');
      requestAnimationFrame(() => messages.classList.toggle('ravin-field-release-tick-2'));
    }, 70);
  }

  function release(delay = 0) {
    clearTimeout(releaseTimer);
    if (releaseGuard || phase === 'idle' || phase === 'release') return;
    releaseGuard = true;

    releaseTimer = setTimeout(() => {
      const c = center();
      currentArticle?.classList.remove('ravin-field-writing');

      points.forEach((p) => {
        p.ox = c.x + Math.cos(p.seed) * (2 + Math.random() * 3);
        p.oy = c.y + Math.sin(p.seed2) * (2 + Math.random() * 3);
        p.tx = Math.random() * rect.width;
        p.ty = Math.random() * rect.height;
        p.releaseDelay = Math.random() * .17;
        p.releaseCurve = (Math.random() - .5) * 2;
      });

      phase = 'release';
      phaseStarted = performance.now();
      currentArticle = null;
      currentBody = null;
      lastLength = 0;
      lastEndpoint = null;
      currentLineY = null;
      currentLineStart = null;
      nudgeLegacyRelease();
    }, reduceMotion ? 0 : delay);
  }

  function cubicPoint(t, a, b, c, d) {
    const inv = 1 - t;
    return {
      x: inv * inv * inv * a.x + 3 * inv * inv * t * b.x + 3 * inv * t * t * c.x + t * t * t * d.x,
      y: inv * inv * inv * a.y + 3 * inv * inv * t * b.y + 3 * inv * t * t * c.y + t * t * t * d.y,
    };
  }

  function addWriterPath(body, end, deltaLength, lineChanged, first) {
    const c = center();
    const bodyRect = body.getBoundingClientRect();
    const lineStart = {
      x: clamp(bodyRect.left - rect.left + 2, 8, rect.width - 8),
      y: end.y,
    };

    currentLineStart = lineStart;

    const count = first ? 34 : lineChanged ? 22 : clamp(Math.ceil(deltaLength * .7), 4, 11);
    const now = performance.now();

    for (let i = 0; i < count; i += 1) {
      const jitter = (Math.random() - .5) * 7;
      const p0 = { x: c.x + (Math.random() - .5) * 4, y: c.y + (Math.random() - .5) * 4 };
      const p1 = {
        x: lerp(c.x, lineStart.x, .38) + (Math.random() - .5) * 18,
        y: lerp(c.y, lineStart.y, .38) + jitter,
      };
      const p2 = {
        x: lineStart.x + Math.max(0, end.x - lineStart.x) * .20 + (Math.random() - .5) * 10,
        y: lineStart.y + jitter * .38,
      };
      const p3 = {
        x: end.x + (Math.random() - .5) * 4,
        y: end.y + (Math.random() - .5) * 3,
      };

      writers.push({
        p0, p1, p2, p3,
        born: now + i * (first || lineChanged ? 8 : 5),
        duration: (first ? 500 : lineChanged ? 410 : 300) + Math.random() * 180,
        size: .55 + Math.random() * 1.35,
        alpha: .30 + Math.random() * .50,
        trail: .35 + Math.random() * .45,
      });
    }

    if (writers.length > 320) writers.splice(0, writers.length - 320);
  }

  function textEndpoint(body) {
    if (!body?.dataset?.v02Raw) return null;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent?.length) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('.ravin-message-time,.ravin-message-actions,.ravin-code-copy')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node, last = null;
    while ((node = walker.nextNode())) last = node;
    if (!last) return null;

    try {
      const range = document.createRange();
      const len = last.textContent.length;
      range.setStart(last, Math.max(0, len - 1));
      range.setEnd(last, len);
      const r = range.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return {
        x: r.right - rect.left,
        y: r.top + r.height * .55 - rect.top,
      };
    } catch {
      return null;
    }
  }

  function inspectStream() {
    const article = $('#messages .ravin-v02-streaming.assistant');
    if (!article) {
      if (phase === 'responding') release(0);
      return;
    }

    const body = $('.ravin-message-body', article);
    const raw = body?.dataset?.v02Raw || '';
    if (!body || !raw.length) return;

    if (article !== currentArticle || phase !== 'responding') startResponding(article, body);
    if (raw.length <= lastLength) return;

    const delta = raw.slice(lastLength);
    const end = textEndpoint(body);
    if (end) {
      const first = !lastEndpoint;
      const lineChanged = currentLineY != null && (Math.abs(end.y - currentLineY) > 8 || (lastEndpoint && end.x < lastEndpoint.x - 18));
      if (first || lineChanged) currentLineY = end.y;
      addWriterPath(body, end, delta.length, lineChanged, first);
      lastEndpoint = end;
    }

    responseMassUsed = clamp(
      responseMassUsed + Math.max(.0035, Math.min(.024, delta.length * .00125)),
      0,
      .92
    );
    lastLength = raw.length;

    article.classList.add('ravin-field-writing');
    clearTimeout(article._ravinFieldWritingTimer);
    article._ravinFieldWritingTimer = setTimeout(() => article.classList.remove('ravin-field-writing'), 150);
  }

  function update(now, dt) {
    const c = center();

    if (phase === 'idle') {
      concentration = 0;
      points.forEach((p) => updateIdlePoint(p, dt, now));
      return;
    }

    if (phase === 'collapse') {
      const g = clamp((now - phaseStarted) / 1120);
      let sum = 0;

      points.forEach((p) => {
        const local = clamp((g - p.collapseDelay) / (1 - p.collapseDelay));
        const q = easeInOut(local);

        const dx = p.tx - p.ox;
        const dy = p.ty - p.oy;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = -dy / dist;
        const ny = dx / dist;
        const arc = Math.sin(Math.PI * q) * Math.min(58, dist * .15) * p.curve;

        p.x = lerp(p.ox, p.tx, q) + nx * arc;
        p.y = lerp(p.oy, p.ty, q) + ny * arc;
        sum += q;
      });

      concentration = sum / Math.max(1, points.length);
      if (g >= 1) {
        phase = 'thinking';
        phaseStarted = now;
        concentration = 1;
      }
      return;
    }

    if (phase === 'thinking' || phase === 'responding') {
      concentration = 1;
      const fraction = phase === 'responding' ? clamp(1 - responseMassUsed * .82, .12, 1) : 1;
      const visible = Math.ceil(points.length * fraction);

      for (let i = 0; i < visible; i += 1) {
        const p = points[i];
        const pulse = Math.sin(now * .0044 + p.seed) * (phase === 'thinking' ? 2.3 : 1.3);
        const microOrbit = 2.2 + p.depth * 2.3 + Math.abs(pulse);
        p.x = c.x + Math.cos(p.seed * 2.1 + now * .00035 * p.depth) * microOrbit;
        p.y = c.y + Math.sin(p.seed2 * 1.7 - now * .00027 * p.depth) * microOrbit;
      }
      return;
    }

    if (phase === 'release') {
      const g = clamp((now - phaseStarted) / 920);
      let sum = 0;

      points.forEach((p) => {
        const local = clamp((g - p.releaseDelay) / (1 - p.releaseDelay));
        const q = easeOut(local);

        const dx = p.tx - p.ox;
        const dy = p.ty - p.oy;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = -dy / dist;
        const ny = dx / dist;
        const arc = Math.sin(Math.PI * q) * Math.min(90, dist * .18) * p.releaseCurve;

        p.x = lerp(p.ox, p.tx, q) + nx * arc;
        p.y = lerp(p.oy, p.ty, q) + ny * arc;
        sum += q;
      });

      concentration = 1 - sum / Math.max(1, points.length);

      if (g >= 1) {
        phase = 'idle';
        concentration = 0;
        responseMassUsed = 0;
        releaseGuard = false;
        points.forEach((p) => Object.assign(p, randomVelocity(p.depth)));
      }
    }
  }

  function drawAmbientConnections(rgb, light, now) {
    if (phase !== 'idle') return;
    ctx.lineWidth = .55;

    for (let i = 0; i < points.length; i += 6) {
      const a = points[i];
      let best = null;
      let bestDist = 92;

      for (let j = i + 1; j < Math.min(points.length, i + 28); j += 1) {
        const b = points[j];
        if (a.cluster !== b.cluster) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < bestDist) {
          bestDist = d;
          best = b;
        }
      }

      if (!best) continue;
      const closeness = 1 - bestDist / 92;
      const alpha = closeness * (.022 + a.depth * .025) * (focused ? 1.3 : 1) * (light ? 1.55 : 1);
      ctx.strokeStyle = rgba(rgb, clamp(alpha, 0, .085));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(best.x, best.y);
      ctx.stroke();
    }
  }

  function drawAmbientPoints(rgb, light, now) {
    const fraction = phase === 'responding' ? clamp(1 - responseMassUsed * .82, .12, 1) : 1;
    const visible = Math.ceil(points.length * fraction);
    const focusVisual = phase === 'idle' && focused ? 1.08 : 1;

    for (let i = 0; i < visible; i += 1) {
      const p = points[i];
      let alpha = p.alpha * (light ? 1.72 : 1);

      if (phase === 'collapse') alpha *= .58 + concentration * .72;
      if (phase === 'thinking') alpha *= .58;
      if (phase === 'responding') alpha *= .40;
      if (phase === 'release') alpha *= .54 + (1 - concentration) * .58;

      const breathe = reduceMotion ? 1 : .96 + Math.sin(now * .0010 + p.seed) * .04;
      const radius = p.size * (light ? 1.24 : 1) * breathe * focusVisual;
      const maxAlpha = light ? .88 : .72;

      if (phase === 'idle' && p.depth > .74 && i % 7 === 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2.35, 0, Math.PI * 2);
        ctx.fillStyle = rgba(rgb, clamp(alpha * (light ? .085 : .055), 0, .08));
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, clamp(alpha, 0, maxAlpha));
      ctx.fill();

      if (phase === 'idle' && p.depth > .70 && i % 5 === 0) {
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > .0015) {
          const scale = 680 * p.depth;
          ctx.strokeStyle = rgba(rgb, clamp(alpha * .10, 0, .08));
          ctx.lineWidth = Math.max(.35, radius * .28);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * scale, p.y - p.vy * scale);
          ctx.stroke();
        }
      }
    }
  }

  function drawWriterPaths(rgb, light, now) {
    if (!writers.length) return;
    const alive = [];

    for (const w of writers) {
      if (now < w.born) {
        alive.push(w);
        continue;
      }

      const p = clamp((now - w.born) / w.duration);
      if (p >= 1) continue;

      const q = easeOut(p);
      const pos = cubicPoint(q, w.p0, w.p1, w.p2, w.p3);
      const tailQ = clamp(q - .055);
      const tail = cubicPoint(tailQ, w.p0, w.p1, w.p2, w.p3);
      const fade = Math.pow(1 - p, .72);

      ctx.strokeStyle = rgba(rgb, clamp(w.alpha * w.trail * fade * (light ? 1.18 : 1), 0, .32));
      ctx.lineWidth = Math.max(.45, w.size * .42);
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, w.size * (light ? 1.18 : 1), 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, clamp(w.alpha * fade * (light ? 1.14 : 1), 0, .92));
      ctx.fill();

      alive.push(w);
    }

    writers = alive;
  }

  function drawResponseFilament(rgb, light, now) {
    if (phase !== 'responding' || !lastEndpoint || !currentLineStart) return;
    const c = center();
    const end = lastEndpoint;
    const lineStart = currentLineStart;
    const pulse = .72 + Math.sin(now * .008) * .12;
    const alpha = (light ? .12 : .075) * pulse;

    ctx.strokeStyle = rgba(rgb, alpha);
    ctx.lineWidth = .65;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.bezierCurveTo(
      lerp(c.x, lineStart.x, .42),
      lerp(c.y, lineStart.y, .42),
      lineStart.x,
      lineStart.y,
      end.x,
      end.y
    );
    ctx.stroke();

    const glow = 7 + Math.sin(now * .009) * 1.4;
    const g = ctx.createRadialGradient(end.x, end.y, 0, end.x, end.y, glow);
    g.addColorStop(0, rgba(rgb, light ? .26 : .20));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(end.x, end.y, glow, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 3; i += 1) {
      const a = now * (.003 + i * .0005) + i * 2.1;
      const r = 2.4 + i * 1.2;
      ctx.beginPath();
      ctx.arc(end.x + Math.cos(a) * r, end.y + Math.sin(a) * r, .65 + i * .12, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, light ? .52 : .42);
      ctx.fill();
    }
  }

  function drawCentralMass(rgb, light, now) {
    if (phase === 'idle' || (phase === 'release' && concentration < .015)) return;

    const c = center();
    const remaining = phase === 'responding' ? clamp(1 - responseMassUsed * .84, .12, 1) : 1;
    const mass = clamp(concentration * remaining);
    if (mass <= .005) return;

    const pulse = phase === 'thinking' ? (Math.sin(now * .0062) + 1) / 2 : .22;
    const radius = 1.45 + mass * 3.55 + pulse * .52;
    const glow = 8 + mass * 24 + pulse * 4.5;
    const boost = light ? .11 : 0;

    const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glow);
    gradient.addColorStop(0, rgba(rgb, clamp(.56 + mass * .34 + boost, 0, 1)));
    gradient.addColorStop(.18, rgba(rgb, clamp(.18 + mass * .18 + boost * .4, 0, .52)));
    gradient.addColorStop(1, rgba(rgb, 0));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(c.x, c.y, glow, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgba(rgb, clamp(.82 + mass * .16 + boost, 0, 1));
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(now) {
    if (!ctx) return;
    ctx.clearRect(0, 0, rect.width, rect.height);

    const rgb = inkRGB();
    const light = isLight();

    drawAmbientConnections(rgb, light, now);
    drawAmbientPoints(rgb, light, now);
    drawWriterPaths(rgb, light, now);
    drawResponseFilament(rgb, light, now);
    drawCentralMass(rgb, light, now);
  }

  function requestIsBusy() {
    const send = $('#sendBtn');
    const composer = $('#composerStatus')?.textContent?.trim();
    const streaming = !!$('#messages .ravin-v02-streaming.assistant');
    return streaming ||
      send?.classList.contains('ravin-stop') ||
      send?.getAttribute('aria-label') === 'Stop RAVIN' ||
      composer === 'THINKING…' ||
      composer === 'RESPONDING…';
  }

  function lifecycleGuard() {
    if ((phase === 'responding' || phase === 'thinking' || phase === 'collapse') && !requestIsBusy()) {
      release(0);
    }
  }

  function loop(now) {
    const dt = Math.min(34, now - lastFrame || 16.67);
    lastFrame = now;

    update(now, dt);
    lifecycleGuard();
    draw(now);
    requestAnimationFrame(loop);
  }

  function bind() {
    const input = $('#messageInput');
    if (input) {
      input.addEventListener('focus', () => { focused = true; });
      input.addEventListener('blur', () => { focused = false; });
      const typing = () => { typingUntil = performance.now() + 560; };
      input.addEventListener('input', typing);
      input.addEventListener('keydown', typing);
    }

    const status = $('#systemStatus');
    if (status) {
      statusObserver = new MutationObserver(() => {
        const next = status.textContent?.trim();
        if (next === 'THINKING') collapse();
        if (next === 'OFFLINE') release(0);
      });
      statusObserver.observe(status, { childList: true, subtree: true, characterData: true });
    }

    const send = $('#sendBtn');
    if (send) {
      sendObserver = new MutationObserver(() => {
        if (send.getAttribute('aria-label') === 'Send' && !$('#messages .ravin-v02-streaming.assistant')) {
          release(0);
        }
      });
      sendObserver.observe(send, { attributes: true, attributeFilter: ['aria-label', 'class', 'type'] });
    }

    const messages = $('#messages');
    if (messages) {
      let queued = false;
      streamObserver = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          inspectStream();
        });
      });
      streamObserver.observe(messages, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'data-v02-raw'],
      });
    }

    const scroller = $('#messageScroller');
    if (scroller) {
      scroller.addEventListener('pointermove', (event) => {
        const r = scroller.getBoundingClientRect();
        pointerX = clamp((event.clientX - r.left) / Math.max(1, r.width));
        pointerY = clamp((event.clientY - r.top) / Math.max(1, r.height));
      }, { passive: true });
      scroller.addEventListener('pointerleave', () => {
        pointerX = .5;
        pointerY = .5;
      }, { passive: true });
    }

    window.addEventListener('ravin:response-done', () => release(0));
    window.addEventListener('ravin:response-end', () => release(0));
  }

  function init() {
    const scroller = $('#messageScroller');
    if (!scroller) {
      setTimeout(init, 80);
      return;
    }

    canvas = document.createElement('canvas');
    canvas.id = 'ravinParticleFieldV3';
    canvas.className = 'ravin-field-canvas ravin-field-visual-v3';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');

    syncCanvas();
    ensurePoints();
    bind();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncCanvas);
      resizeObserver.observe(scroller);
    }

    addEventListener('resize', syncCanvas, { passive: true });
    document.documentElement.dataset.ravinFieldVersion = '3';
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

(() => {
  const FONT_KEY = 'ravin_chat_font_scale';
  const DEFAULT_SCALE = 1.10;
  const MIN = 0.90;
  const MAX = 1.40;
  const STEP = 0.05;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function storedScale() {
    const raw = Number(localStorage.getItem(FONT_KEY));
    return Number.isFinite(raw) ? clamp(raw, MIN, MAX) : DEFAULT_SCALE;
  }

  function applyScale(value) {
    const scale = clamp(Number(value) || DEFAULT_SCALE, MIN, MAX);
    localStorage.setItem(FONT_KEY, String(scale));
    document.documentElement.style.setProperty('--ravin-chat-font-scale', scale.toFixed(2));
    document.documentElement.dataset.ravinFontScale = String(Math.round(scale * 100));
    window.dispatchEvent(new CustomEvent('ravin:font-size-change', { detail: { scale } }));
    return scale;
  }

  function makeSlider(pop) {
    if (!pop || pop.querySelector('.ravin-font-setting')) return;

    const divider = pop.querySelector('hr');
    const wrap = document.createElement('div');
    wrap.className = 'ravin-font-setting';
    wrap.innerHTML = `
      <div class="ravin-font-setting-head">
        <span>Chat font size</span>
        <output></output>
      </div>
      <input type="range" min="${MIN}" max="${MAX}" step="${STEP}" aria-label="Chat font size" />
      <div class="ravin-font-setting-hints"><span>Smaller</span><span>Larger</span></div>`;

    const slider = wrap.querySelector('input');
    const output = wrap.querySelector('output');
    const scale = storedScale();
    slider.value = String(scale);
    output.textContent = `${Math.round(scale * 100)}%`;

    const keepOpen = (event) => event.stopPropagation();
    wrap.addEventListener('click', keepOpen);
    wrap.addEventListener('pointerdown', keepOpen);
    slider.addEventListener('input', (event) => {
      event.stopPropagation();
      const next = applyScale(event.target.value);
      output.textContent = `${Math.round(next * 100)}%`;
    });
    slider.addEventListener('change', keepOpen);

    if (divider) pop.insertBefore(wrap, divider);
    else pop.appendChild(wrap);

    pop.style.width = '270px';
    const settings = document.querySelector('#settingsBtn');
    if (settings) {
      const r = settings.getBoundingClientRect();
      pop.style.left = `${Math.min(innerWidth - 280, Math.max(10, r.right - 270))}px`;
    }
  }

  function augmentSoon() {
    requestAnimationFrame(() => makeSlider(document.querySelector('.ravin-popover')));
  }

  function init() {
    applyScale(storedScale());
    const settings = document.querySelector('#settingsBtn');
    if (!settings) {
      setTimeout(init, 80);
      return;
    }

    settings.addEventListener('click', augmentSoon);
    document.querySelector('#accountBtn')?.addEventListener('click', () => {
      setTimeout(() => {
        const settingsAction = document.querySelector('.ravin-popover [data-action="settings"]');
        if (!settingsAction) return;
        settingsAction.addEventListener('click', () => setTimeout(augmentSoon, 0), { once: true });
      }, 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
