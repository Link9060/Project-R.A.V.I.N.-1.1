(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let canvas, ctx, rect = { left: 0, top: 0, width: 1, height: 1 };
  let points = [], trails = [];
  let phase = 'idle';
  let phaseStarted = performance.now();
  let concentration = 0;
  let responseMassUsed = 0;
  let currentArticle = null;
  let lastLength = 0;
  let lastTarget = null;
  let focused = false;
  let typingUntil = 0;
  let lastFrame = performance.now();
  let releaseTimer = 0;

  const isLight = () => document.documentElement.dataset.theme === 'light';
  const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const inkRGB = () => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    const nums = raw.split(/\s+/).map(Number).filter(Number.isFinite);
    return nums.length >= 3 ? nums.slice(0, 3) : (isLight() ? [17,17,17] : [245,245,246]);
  };

  function count() { return innerWidth <= 460 ? 135 : innerWidth <= 700 ? 175 : 280; }
  function center() { return { x: rect.width / 2, y: rect.height * (innerWidth <= 700 ? .42 : .44) }; }
  function velocity() {
    const a = Math.random() * Math.PI * 2;
    const s = .0018 + Math.random() * .0042;
    return { vx: Math.cos(a) * s, vy: Math.sin(a) * s };
  }
  function makePoint() {
    return {
      x: Math.random() * rect.width, y: Math.random() * rect.height,
      ...velocity(), size: .95 + Math.random() * 1.25,
      alpha: .18 + Math.random() * .34, seed: Math.random() * Math.PI * 2,
      ox: 0, oy: 0, tx: 0, ty: 0,
      collapseDelay: Math.random() * .22, releaseDelay: Math.random() * .18,
    };
  }
  function ensurePoints() {
    const wanted = count();
    if (points.length === wanted) return;
    const next = Array.from({ length: wanted }, makePoint);
    for (let i = 0; i < Math.min(points.length, next.length); i++) {
      next[i].x = clamp(points[i].x, 0, rect.width);
      next[i].y = clamp(points[i].y, 0, rect.height);
    }
    points = next;
  }

  function syncCanvas() {
    const scroller = $('#messageScroller');
    if (!scroller || !canvas) return;
    const box = scroller.getBoundingClientRect();
    if (box.width < 20 || box.height < 20) return;
    const oldW = rect.width || box.width, oldH = rect.height || box.height;
    rect = { left: box.left, top: box.top, width: box.width, height: box.height };
    canvas.style.left = `${box.left}px`; canvas.style.top = `${box.top}px`;
    canvas.style.width = `${box.width}px`; canvas.style.height = `${box.height}px`;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (oldW > 1 && oldH > 1) points.forEach(p => { p.x = p.x / oldW * box.width; p.y = p.y / oldH * box.height; });
    ensurePoints();
  }

  function collapse() {
    clearTimeout(releaseTimer);
    if (phase === 'collapse' || phase === 'thinking') return;
    const c = center();
    points.forEach(p => {
      p.ox = p.x; p.oy = p.y;
      p.tx = c.x + Math.cos(p.seed) * (1.5 + Math.random() * 4.2);
      p.ty = c.y + Math.sin(p.seed * 1.37) * (1.5 + Math.random() * 4.2);
      p.collapseDelay = Math.random() * .22;
    });
    phase = reduceMotion ? 'thinking' : 'collapse';
    phaseStarted = performance.now();
    concentration = reduceMotion ? 1 : 0;
    responseMassUsed = 0; currentArticle = null; lastLength = 0; lastTarget = null; trails = [];
  }

  function respond(article) {
    clearTimeout(releaseTimer);
    if (phase === 'idle' || phase === 'release') collapse();
    phase = 'responding'; phaseStarted = performance.now(); concentration = 1;
    responseMassUsed = 0; currentArticle = article; lastLength = 0; lastTarget = null;
  }

  function release(delay = 45) {
    clearTimeout(releaseTimer);
    if (phase === 'idle' || phase === 'release') return;
    releaseTimer = setTimeout(() => {
      const c = center();
      points.forEach(p => {
        p.ox = c.x + Math.cos(p.seed) * 3.5; p.oy = c.y + Math.sin(p.seed * 1.3) * 3.5;
        p.tx = Math.random() * rect.width; p.ty = Math.random() * rect.height;
        p.releaseDelay = Math.random() * .18;
      });
      phase = 'release'; phaseStarted = performance.now();
      currentArticle = null; lastLength = 0; lastTarget = null;
    }, reduceMotion ? 0 : delay);
  }

  function updateIdle(p, dt, now) {
    const scale = (focused ? 1.10 : 1) * (now < typingUntil ? 1.18 : 1);
    const wobble = Math.sin(now * .00022 + p.seed) * .000018;
    p.vx += Math.cos(p.seed + now * .00005) * wobble;
    p.vy += Math.sin(p.seed * 1.31 + now * .000045) * wobble;
    const max = .0075 * scale, mag = Math.hypot(p.vx, p.vy) || 1;
    if (mag > max) { p.vx = p.vx / mag * max; p.vy = p.vy / mag * max; }
    p.x += p.vx * dt * scale; p.y += p.vy * dt * scale;
    if (p.x < -6) p.x = rect.width + 6; if (p.x > rect.width + 6) p.x = -6;
    if (p.y < -6) p.y = rect.height + 6; if (p.y > rect.height + 6) p.y = -6;
  }

  function update(now, dt) {
    const c = center();
    if (phase === 'idle') { concentration = 0; points.forEach(p => updateIdle(p, dt, now)); return; }
    if (phase === 'collapse') {
      const g = clamp((now - phaseStarted) / 1250); let sum = 0;
      points.forEach(p => {
        const local = clamp((g - p.collapseDelay) / (1 - p.collapseDelay)); const q = smooth(local);
        p.x = lerp(p.ox, p.tx, q); p.y = lerp(p.oy, p.ty, q); sum += q;
      });
      concentration = sum / points.length;
      if (g >= 1) { phase = 'thinking'; phaseStarted = now; concentration = 1; }
      return;
    }
    if (phase === 'thinking' || phase === 'responding') {
      concentration = 1;
      const fraction = phase === 'responding' ? clamp(1 - responseMassUsed * .78, .16, 1) : 1;
      const visible = Math.ceil(points.length * fraction);
      for (let i = 0; i < visible; i++) {
        const p = points[i]; const pulse = Math.sin(now * .0048 + p.seed) * (phase === 'thinking' ? 2 : 1.3);
        p.x = c.x + Math.cos(p.seed * 2.1) * (2.4 + Math.abs(pulse));
        p.y = c.y + Math.sin(p.seed * 1.7) * (2.4 + Math.abs(pulse));
      }
      return;
    }
    if (phase === 'release') {
      const g = clamp((now - phaseStarted) / 1050); let sum = 0;
      points.forEach(p => {
        const local = clamp((g - p.releaseDelay) / (1 - p.releaseDelay)); const q = easeOut(local);
        p.x = lerp(p.ox, p.tx, q); p.y = lerp(p.oy, p.ty, q); sum += q;
      });
      concentration = 1 - sum / points.length;
      if (g >= 1) { phase = 'idle'; concentration = 0; responseMassUsed = 0; points.forEach(p => Object.assign(p, velocity())); }
    }
  }

  function addTrail(start, end, first, deltaLength) {
    const now = performance.now(), dx = end.x - start.x, dy = end.y - start.y;
    const dist = Math.hypot(dx, dy), nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
    const n = first ? 28 : clamp(Math.ceil(deltaLength / 2), 3, 8);
    for (let i = 0; i < n; i++) {
      const bend = (Math.random() - .5) * Math.min(46, dist * .14);
      trails.push({ sx:start.x, sy:start.y, ex:end.x, ey:end.y,
        cx:(start.x+end.x)/2+nx*bend, cy:(start.y+end.y)/2+ny*bend,
        born:now+i*12, duration:280+Math.min(360,dist*.42)+Math.random()*120,
        size:.9+Math.random()*1.15, alpha:.32+Math.random()*.48 });
    }
    if (trails.length > 240) trails.splice(0, trails.length - 240);
  }

  function endpoint(body) {
    if (!body?.dataset?.v02Raw) return null;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent?.length) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('.ravin-message-time,.ravin-message-actions,.ravin-code-copy')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node, last = null; while ((node = walker.nextNode())) last = node;
    if (!last) return null;
    try {
      const range = document.createRange(), len = last.textContent.length;
      range.setStart(last, Math.max(0, len - 1)); range.setEnd(last, len);
      const r = range.getBoundingClientRect();
      return (r.width || r.height) ? { x:r.right-rect.left, y:r.top+r.height*.55-rect.top } : null;
    } catch { return null; }
  }

  function inspectStream() {
    const article = $('#messages .ravin-v02-streaming.assistant');
    if (!article) { if (currentArticle && phase === 'responding') release(); return; }
    const body = $('.ravin-message-body', article); const raw = body?.dataset?.v02Raw || '';
    if (!raw) return;
    if (article !== currentArticle || phase !== 'responding') respond(article);
    if (raw.length <= lastLength) return;
    const delta = raw.slice(lastLength), end = endpoint(body);
    if (end) { addTrail(lastTarget || center(), end, !lastTarget, delta.length); lastTarget = end; }
    responseMassUsed = clamp(responseMassUsed + Math.max(.003, Math.min(.026, delta.length * .00135)), 0, .92);
    lastLength = raw.length;
  }

  function draw(now) {
    ctx.clearRect(0, 0, rect.width, rect.height);
    const rgb = inkRGB(), light = isLight();
    const fraction = phase === 'responding' ? clamp(1 - responseMassUsed * .78, .16, 1) : 1;
    const visible = Math.ceil(points.length * fraction);
    for (let i = 0; i < visible; i++) {
      const p = points[i]; let a = p.alpha * (light ? 1.75 : 1);
      if (phase === 'collapse') a *= .60 + concentration * .68;
      if (phase === 'thinking') a *= .62; if (phase === 'responding') a *= .46;
      if (phase === 'release') a *= .58 + (1-concentration)*.54;
      const flicker = reduceMotion ? 1 : .94 + Math.sin(now*.0014+p.seed)*.06;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size*(light?1.28:1)*flicker,0,Math.PI*2);
      ctx.fillStyle = rgba(rgb, clamp(a,0,light?.86:.72)); ctx.fill();
    }
    const alive = [];
    for (const t of trails) {
      if (now < t.born) { alive.push(t); continue; }
      const p = clamp((now-t.born)/t.duration); if (p >= 1) continue;
      const q = easeOut(p), inv = 1-q;
      const x=inv*inv*t.sx+2*inv*q*t.cx+q*q*t.ex, y=inv*inv*t.sy+2*inv*q*t.cy+q*q*t.ey;
      ctx.beginPath(); ctx.arc(x,y,t.size*(light?1.22:1),0,Math.PI*2);
      ctx.fillStyle=rgba(rgb,clamp(t.alpha*(light?1.22:1)*(1-p),0,.9)); ctx.fill(); alive.push(t);
    }
    trails = alive;
    if (phase !== 'idle' && !(phase === 'release' && concentration < .02)) {
      const c=center(), remaining=phase==='responding'?clamp(1-responseMassUsed*.8,.16,1):1;
      const mass=clamp(concentration*remaining), pulse=phase==='thinking'?(Math.sin(now*.0054)+1)/2:.28;
      const radius=1.5+mass*3.45+pulse*.45, glow=8+mass*22+pulse*4, boost=light?.12:0;
      const g=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,glow);
      g.addColorStop(0,rgba(rgb,clamp(.54+mass*.34+boost,0,1))); g.addColorStop(1,rgba(rgb,0));
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(c.x,c.y,glow,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=rgba(rgb,clamp(.8+mass*.18+boost,0,1)); ctx.beginPath(); ctx.arc(c.x,c.y,radius,0,Math.PI*2); ctx.fill();
    }
  }

  function loop(now) {
    const dt = Math.min(34, now-lastFrame || 16.67); lastFrame=now;
    update(now,dt); draw(now); requestAnimationFrame(loop);
  }

  function nudgeLegacyRelease() {
    const messages = $('#messages');
    if (!messages) return;
    messages.classList.toggle('ravin-field-release-tick');
    requestAnimationFrame(() => messages.classList.toggle('ravin-field-release-tick'));
  }

  function bind() {
    const input=$('#messageInput');
    input?.addEventListener('focus',()=>focused=true); input?.addEventListener('blur',()=>focused=false);
    const typing=()=>typingUntil=performance.now()+650; input?.addEventListener('input',typing); input?.addEventListener('keydown',typing);

    const status=$('#systemStatus');
    if (status) new MutationObserver(()=>{ if(status.textContent?.trim()==='THINKING') collapse(); }).observe(status,{childList:true,subtree:true,characterData:true});

    const composerStatus=$('#composerStatus');
    if (composerStatus) new MutationObserver(()=>{
      if(composerStatus.textContent?.trim()==='READY' && !$('#messages .ravin-v02-streaming.assistant')) {
        release(35); nudgeLegacyRelease();
      }
    }).observe(composerStatus,{childList:true,subtree:true,characterData:true});

    const messages=$('#messages');
    if (messages) {
      let queued=false;
      new MutationObserver(()=>{ if(queued)return; queued=true; requestAnimationFrame(()=>{queued=false; inspectStream();}); })
        .observe(messages,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','data-v02-raw']});
    }
  }

  function init() {
    const scroller=$('#messageScroller'); if(!scroller){setTimeout(init,80);return;}
    canvas=document.createElement('canvas'); canvas.id='ravinParticleFieldV2'; canvas.className='ravin-field-canvas ravin-field-visual-v2'; canvas.setAttribute('aria-hidden','true');
    document.body.appendChild(canvas); ctx=canvas.getContext('2d'); syncCanvas(); ensurePoints(); bind();
    if(typeof ResizeObserver!=='undefined') new ResizeObserver(syncCanvas).observe(scroller);
    addEventListener('resize',syncCanvas,{passive:true}); document.documentElement.dataset.ravinFieldVersion='2'; requestAnimationFrame(loop);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
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
      const rect = settings.getBoundingClientRect();
      pop.style.left = `${Math.min(innerWidth - 280, Math.max(10, rect.right - 270))}px`;
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
        settingsAction?.addEventListener('click', () => setTimeout(augmentSoon, 0), { once: true });
      }, 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();