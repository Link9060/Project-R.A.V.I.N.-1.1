(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  let phase = 'idle';
  let phaseStarted = performance.now();
  let radius = 0;
  let releaseFrom = 0;
  let responseMassUsed = 0;
  let currentStream = null;
  let lastStreamLength = 0;
  let layoutFrame = 0;
  let layingOut = false;
  let lastLayoutRadius = -1;
  let center = { x: 0, y: 0 };
  let resizeObserver = null;
  let mutationObserver = null;
  let lastFrame = performance.now();

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  function maxRadius() {
    if (innerWidth <= 460) return 54;
    if (innerWidth <= 700) return 66;
    if (innerWidth <= 900) return 82;
    return 102;
  }

  function syncCenter() {
    const scroller = $('#messageScroller');
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    center = {
      x: r.left + r.width / 2,
      y: r.top + r.height * (innerWidth <= 700 ? .42 : .44),
    };
    scheduleLayout(true);
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

  function beginCollapse() {
    if (phase === 'collapse' || phase === 'thinking' || phase === 'responding') return;
    phase = 'collapse';
    phaseStarted = performance.now();
    responseMassUsed = 0;
    currentStream = null;
    lastStreamLength = 0;
  }

  function beginResponding(article, rawLength = 0) {
    if (phase === 'idle' || phase === 'release') beginCollapse();
    phase = 'responding';
    phaseStarted = performance.now();
    responseMassUsed = 0;
    currentStream = article;
    lastStreamLength = rawLength;
  }

  function beginRelease() {
    if (phase === 'idle' || phase === 'release') return;
    releaseFrom = radius;
    phase = 'release';
    phaseStarted = performance.now();
    currentStream = null;
    lastStreamLength = 0;
  }

  function forceRadius(now) {
    const max = maxRadius();
    if (phase === 'idle') return 0;
    if (phase === 'collapse') {
      const p = smooth(clamp((now - phaseStarted) / 1120));
      if (p >= .999) {
        phase = 'thinking';
        phaseStarted = now;
        return max;
      }
      return max * Math.pow(p, 2.0);
    }
    if (phase === 'thinking') return max;
    if (phase === 'responding') {
      const remaining = clamp(1 - responseMassUsed * .82, .12, 1);
      return max * (.28 + .72 * remaining);
    }
    if (phase === 'release') {
      const p = clamp((now - phaseStarted) / 720);
      const next = lerp(releaseFrom, 0, easeOut(p));
      if (p >= 1) {
        phase = 'idle';
        responseMassUsed = 0;
        restoreAll();
        return 0;
      }
      return next;
    }
    return 0;
  }

  function inspectStream() {
    const article = $('#messages .ravin-v02-streaming.assistant');
    if (!article) {
      if (!requestIsBusy()) beginRelease();
      return;
    }
    const body = $('.ravin-message-body', article);
    const raw = body?.dataset?.v02Raw || '';
    if (!raw) return;

    if (article !== currentStream || phase !== 'responding') {
      beginResponding(article, 0);
    }

    if (raw.length > lastStreamLength) {
      const delta = raw.length - lastStreamLength;
      responseMassUsed = clamp(
        responseMassUsed + Math.max(.0035, Math.min(.024, delta * .00125)),
        0,
        .92
      );
      lastStreamLength = raw.length;
    }
  }

  function canonicalMessage(body) {
    const raw = body.dataset.v02Raw ?? body.dataset.ravinForceOriginal;
    const time = body.dataset.v02Time || body.dataset.ravinForceTime || body.querySelector('.ravin-message-time')?.textContent?.trim() || '';
    if (raw != null) return { text: raw, time };

    const clone = body.cloneNode(true);
    clone.querySelector('.ravin-message-time')?.remove();
    clone.querySelectorAll('.ravin-message-actions,.ravin-code-copy').forEach((n) => n.remove());
    const text = clone.textContent?.replace(/\u00a0/g, ' ').trim() || '';
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
    delete body.dataset.coreFlowActive;
    layingOut = false;
  }

  function restoreAll() {
    const root = $('#messages');
    if (!root) return;
    $$('.ravin-message-body[data-ravin-force-flow-active="true"]', root).forEach(restoreMessage);
    radius = 0;
    lastLayoutRadius = 0;
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
    const out = [];
    const segments = String(text || '').split(/\n+/);
    segments.forEach((segment, index) => {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      if (words.length) out.push({ words });
      if (index < segments.length - 1) out.push({ break: true });
    });
    return out;
  }

  function renderFlow(body) {
    if (radius < 4) {
      restoreMessage(body);
      return;
    }
    if (body.closest('.ravin-v02-streaming')) {
      restoreMessage(body);
      return;
    }
    if (body.querySelector('pre,table,img,video,audio')) {
      restoreMessage(body);
      return;
    }

    const { text, time } = canonicalMessage(body);
    if (!text) return;

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
    const forceX = center.x - layoutLeft;
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
        const dy = y - center.y;
        const intersectsY = Math.abs(dy) < radius;
        const forceWithinX = forceX > -radius && forceX < width + radius;

        if (!intersectsY || !forceWithinX) {
          fragment.appendChild(fullLine(fitWords(words, width), lineHeight));
          y += lineHeight;
          continue;
        }

        const chord = Math.sqrt(Math.max(0, radius * radius - dy * dy));
        let leftWidth = Math.max(0, forceX - chord - margin);
        let rightWidth = Math.max(0, width - (forceX + chord + margin));
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

    // Synchronously claim ownership BEFORE changing markup. This prevents the
    // Markdown enhancer from rebuilding the same message during force reflow.
    body.dataset.coreFlowActive = 'true';
    body.dataset.ravinForceFlowActive = 'true';
    body.classList.add('ravin-force-flow-active');

    layingOut = true;
    body.replaceChildren(fragment);
    if (time) {
      const stamp = document.createElement('span');
      stamp.className = 'ravin-message-time ravin-force-time';
      stamp.textContent = time;
      body.appendChild(stamp);
    }
    layingOut = false;

    if (!active) restoreMessage(body);
  }

  function layoutMessages() {
    layoutFrame = 0;
    const root = $('#messages');
    if (!root) return;

    if (radius < 4) {
      restoreAll();
      return;
    }

    const bandTop = center.y - radius - 150;
    const bandBottom = center.y + radius + 150;

    for (const article of $$('.ravin-message', root)) {
      const body = $('.ravin-message-body', article);
      if (!body) continue;
      if (article.classList.contains('ravin-v02-streaming')) {
        restoreMessage(body);
        continue;
      }
      const r = body.getBoundingClientRect();
      if (r.bottom < bandTop || r.top > bandBottom) restoreMessage(body);
      else renderFlow(body);
    }
  }

  function scheduleLayout(force = false) {
    if (force) lastLayoutRadius = -1;
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(layoutMessages);
  }

  function updateRadius(now) {
    const next = forceRadius(now);
    if (Math.abs(next - radius) > .8 || (next === 0 && radius !== 0)) {
      radius = next;
      if (Math.abs(radius - lastLayoutRadius) > .8 || radius === 0) {
        lastLayoutRadius = radius;
        scheduleLayout();
      }
    } else {
      radius = next;
    }
  }

  function lifecycleGuard() {
    inspectStream();
    if ((phase === 'collapse' || phase === 'thinking' || phase === 'responding') && !requestIsBusy()) beginRelease();
    if (phase === 'idle' && radius !== 0) {
      radius = 0;
      restoreAll();
    }
  }

  function loop(now) {
    lastFrame = now;
    lifecycleGuard();
    updateRadius(now);
    requestAnimationFrame(loop);
  }

  function bind() {
    const status = $('#systemStatus');
    if (status) {
      new MutationObserver(() => {
        const next = status.textContent?.trim();
        if (next === 'THINKING') beginCollapse();
        if (next === 'OFFLINE') beginRelease();
      }).observe(status, { childList: true, subtree: true, characterData: true });
    }

    const send = $('#sendBtn');
    if (send) {
      new MutationObserver(() => {
        if (send.getAttribute('aria-label') === 'Stop RAVIN') beginCollapse();
        else if (!requestIsBusy()) beginRelease();
      }).observe(send, { attributes: true, attributeFilter: ['aria-label', 'class', 'type'] });
    }

    const root = $('#messages');
    if (root) {
      let queued = false;
      mutationObserver = new MutationObserver(() => {
        if (layingOut || queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          inspectStream();
          scheduleLayout();
        });
      });
      mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'data-v02-raw'],
      });
    }

    const scroller = $('#messageScroller');
    scroller?.addEventListener('scroll', () => scheduleLayout(true), { passive: true });
    window.addEventListener('ravin:response-done', beginRelease);
    window.addEventListener('ravin:response-end', beginRelease);
    window.addEventListener('ravin:font-size-change', () => scheduleLayout(true));
    window.addEventListener('offline', beginRelease);
  }

  function init() {
    const scroller = $('#messageScroller');
    if (!scroller) {
      setTimeout(init, 80);
      return;
    }

    syncCenter();
    bind();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncCenter);
      resizeObserver.observe(scroller);
      const workspace = $('#workspace');
      if (workspace) resizeObserver.observe(workspace);
    }

    addEventListener('resize', syncCenter, { passive: true });
    document.documentElement.dataset.ravinForceVersion = '2';
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
