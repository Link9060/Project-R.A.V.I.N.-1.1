import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import * as THREE from "https://esm.sh/three@0.179.1";
import { PulsingBorder as PaperPulsingBorder } from "https://esm.sh/@paper-design/shaders-react@0.0.61?external=react,react-dom&deps=@paper-design/shaders@0.0.61";

const h = React.createElement;
const BACKEND_URL = "https://ravin-hyeq.onrender.com";
const AUTH_URL = "https://bzjudqhjrbwglxdfbkmj.supabase.co/functions/v1/ravin-auth";
const WEBGL_SUPPORTED = (() => {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    const supported = Boolean(context) && navigator.webdriver !== true;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return supported;
  } catch {
    return false;
  }
})();
const AUTH_KEYS = {
  access: "ravin_access_token",
  refresh: "ravin_refresh_token",
  user: "ravin_user",
  expires: "ravin_token_expires_at",
};

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function useStoredState(key, fallback) {
  const [value, setValue] = useState(() => readJSON(key, fallback));
  const update = useCallback((next) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  }, [key]);
  return [value, update];
}

function useStoredText(key, fallback = "") {
  const [value, setValue] = useState(() => localStorage.getItem(key) ?? fallback);
  const update = useCallback((next) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      localStorage.setItem(key, resolved);
      return resolved;
    });
  }, [key]);
  return [value, update];
}

function hexToRgb(hex) {
  const clean = String(hex || "#8fa7ff").replace("#", "");
  const value = Number.parseInt(clean.length === 3
    ? clean.split("").map((part) => part + part).join("")
    : clean, 16);
  return Number.isFinite(value)
    ? [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    : [143, 167, 255];
}

function loadSession() {
  return {
    accessToken: localStorage.getItem(AUTH_KEYS.access) || "",
    refreshToken: localStorage.getItem(AUTH_KEYS.refresh) || "",
    user: readJSON(AUTH_KEYS.user, null),
    expiresAt: Number(localStorage.getItem(AUTH_KEYS.expires) || 0),
  };
}

function persistSession(session, user) {
  const next = {
    accessToken: session?.access_token || "",
    refreshToken: session?.refresh_token || "",
    user: user || session?.user || null,
    expiresAt: session?.expires_at
      ? Number(session.expires_at) * 1000
      : Date.now() + Number(session?.expires_in || 3600) * 1000,
  };
  if (!next.accessToken) throw new Error("Authentication returned no access token.");
  localStorage.setItem(AUTH_KEYS.access, next.accessToken);
  localStorage.setItem(AUTH_KEYS.refresh, next.refreshToken);
  localStorage.setItem(AUTH_KEYS.user, JSON.stringify(next.user));
  localStorage.setItem(AUTH_KEYS.expires, String(next.expiresAt));
  return next;
}

function clearSessionStorage() {
  Object.values(AUTH_KEYS).forEach((key) => localStorage.removeItem(key));
  return { accessToken: "", refreshToken: "", user: null, expiresAt: 0 };
}

async function authRequest(action, email, password, extras = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, email, password, ...extras }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Authentication failed (${response.status}).`);
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Authentication timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function apiRequest(pathname, token, options = {}) {
  if (!token) throw new Error("Please sign in to RAVIN first.");
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${BACKEND_URL}${pathname}`, { ...options, headers });
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return { error: text }; } })() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `RAVIN backend error (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function PulsatingBorder({
  children,
  colors = ["#8fa7ff", "#ffffff", "#5f7cff"],
  colorBack = "rgba(0,0,0,0)",
  speed = 1,
  radius = 35,
  thickness = 4,
  softness = 100,
  intensity = 38,
  bloom = 28,
  spotSize = 30,
  spread = 38,
  zIndex = 80,
  className = "",
  style,
}) {
  const hostRef = useRef(null);
  const [rect, setRect] = useState({ left: 0, top: 0, w: 0, h: 0 });
  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => setPortalTarget(document.body), []);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      const bounds = host.getBoundingClientRect();
      const next = { left: bounds.left, top: bounds.top, w: host.clientWidth, h: host.clientHeight };
      setRect((previous) => Object.keys(next).every((key) => previous[key] === next[key]) ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    addEventListener("scroll", schedule, true);
    addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener("scroll", schedule, true);
      removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, []);

  const worldW = rect.w + spread * 2;
  const worldH = rect.h + spread * 2;
  const marginX = worldW > 0 ? spread / worldW : 0;
  const marginY = worldH > 0 ? spread / worldH : 0;
  const room = Math.min(480, Math.ceil(0.4 * Math.min(worldW, worldH)));
  const bleed = spread + room;
  const measured = rect.w > 0 && rect.h > 0;
  const layer = measured && WEBGL_SUPPORTED ? h(PaperPulsingBorder, {
    colors,
    colorBack,
    speed,
    roundness: radius / 100,
    thickness: thickness / 100,
    softness: softness / 100,
    intensity: intensity / 100,
    bloom: bloom / 100,
    spots: 3,
    spotSize: (spotSize / 100) * 0.5,
    pulse: 0,
    smoke: 0.35,
    smokeSize: 0.63,
    worldWidth: worldW,
    worldHeight: worldH,
    fit: "none",
    marginLeft: marginX,
    marginRight: marginX,
    marginTop: marginY,
    marginBottom: marginY,
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    originX: 0.5,
    originY: 0.5,
    frame: 0,
    style: {
      position: "fixed",
      left: rect.left - bleed,
      top: rect.top - bleed,
      width: rect.w + bleed * 2,
      height: rect.h + bleed * 2,
      zIndex,
      pointerEvents: "none",
    },
  }) : null;

  return h("div", {
    ref: hostRef,
    className: `pulse-host ${WEBGL_SUPPORTED ? "" : "shader-fallback"} ${className}`,
    style: { position: "relative", ...style },
  }, children, portalTarget && layer ? createPortal(layer, portalTarget) : null);
}

function HoverBorder({ accent, overdrive }) {
  const targetRef = useRef(null);
  const frameRef = useRef(0);
  const [outline, setOutline] = useState({ visible: false, left: 0, top: 0, width: 0, height: 0, radius: "16px" });
  useEffect(() => {
    const measure = () => {
      frameRef.current = 0;
      const target = targetRef.current;
      if (!target?.isConnected) {
        setOutline((current) => ({ ...current, visible: false }));
        return;
      }
      const rect = target.getBoundingClientRect();
      setOutline({
        visible: true,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        radius: getComputedStyle(target).borderRadius || "16px",
      });
    };
    const schedule = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(measure);
    };
    const over = (event) => {
      const next = event.target.closest?.("[data-pulse]") || null;
      if (!next || next === targetRef.current) return;
      targetRef.current = next;
      measure();
    };
    const out = (event) => {
      const next = event.relatedTarget?.closest?.("[data-pulse]") || null;
      if (next) {
        targetRef.current = next;
        measure();
        return;
      }
      targetRef.current = null;
      setOutline((current) => ({ ...current, visible: false }));
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    addEventListener("scroll", schedule, true);
    addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      removeEventListener("scroll", schedule, true);
      removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, []);
  return h("div", {
    className: `hover-shader-anchor ${outline.visible ? "is-active" : ""} ${overdrive ? "overdrive" : ""}`,
    style: {
      left: outline.left,
      top: outline.top,
      width: outline.width,
      height: outline.height,
      borderRadius: outline.radius,
      "--hover-accent": overdrive ? "#d22b38" : accent,
    },
  });
}

// RAVIN's center piece, adapted from the supplied ParticleSphereRefactor.
// It keeps the globe's rotation, cursor push-away, click scatter, and spring return.
function ParticleSphere({ accent, state, overdrive }) {
  const hostRef = useRef(null);
  const values = useRef({ accent, state, overdrive });
  useEffect(() => { values.current = { accent, state, overdrive }; }, [accent, state, overdrive]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    if (!WEBGL_SUPPORTED) {
      host.classList.add("particle-sphere-fallback");
      return () => host.classList.remove("particle-sphere-fallback");
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10);
    camera.position.z = 3.25;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    const count = innerWidth < 700 ? 1800 : 4200;
    const positions = new Float32Array(count * 3), base = new Float32Array(count * 3), velocity = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const y = 1 - i / (count - 1) * 2, ring = Math.sqrt(1 - y * y), theta = Math.PI * (3 - Math.sqrt(5)) * i, o = i * 3, r = 0.87 + (Math.random() - .5) * .025;
      base[o] = Math.cos(theta) * ring * r; base[o + 1] = y * r; base[o + 2] = Math.sin(theta) * ring * r;
      positions[o] = base[o]; positions[o + 1] = base[o + 1]; positions[o + 2] = base[o + 2];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: .018, sizeAttenuation: true, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending });
    const globe = new THREE.Points(geometry, material); scene.add(globe);
    const pointer = new THREE.Vector3(99, 99, 99);
    const setPointer = (event) => {
      const rect = host.getBoundingClientRect(), x = ((event.clientX - rect.left) / rect.width) * 2 - 1, y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      if (Math.hypot(x, y) > 1.2) pointer.set(99, 99, 99); else pointer.set(x * 1.12, y * 1.12, .15);
    };
    const scatter = (event) => {
      setPointer(event); if (pointer.x > 10) return;
      for (let i = 0; i < count; i += 1) { const o = i * 3, dx = positions[o] - pointer.x, dy = positions[o + 1] - pointer.y, dz = positions[o + 2] - pointer.z, d = Math.hypot(dx, dy, dz) || .001, f = Math.max(0, 1 - d / 1.55) * .07; velocity[o] += dx / d * f; velocity[o + 1] += dy / d * f; velocity[o + 2] += dz / d * f; }
    };
    const resize = () => { const { width, height } = host.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    const core = host.closest(".ravin-core");
    addEventListener("pointermove", setPointer, { passive: true }); core?.addEventListener("pointerdown", scatter);
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let frame = 0;
    const render = (now) => {
      const current = values.current, active = current.state !== "idle";
      material.color.set(current.overdrive ? "#e13e48" : current.accent); material.size = active ? .021 : .018; material.opacity = active ? 1 : .84;
      globe.rotation.y += active ? .007 : .0024; globe.rotation.x = Math.sin(now * .00022) * .12;
      for (let i = 0; i < count; i += 1) { const o = i * 3, dx = positions[o] - pointer.x, dy = positions[o + 1] - pointer.y, dz = positions[o + 2] - pointer.z, d = Math.hypot(dx, dy, dz) || .001; if (d < .58) { const f = (.58 - d) / .58 * .01; velocity[o] += dx / d * f; velocity[o + 1] += dy / d * f; velocity[o + 2] += dz / d * f; } velocity[o] += (base[o] - positions[o]) * .015; velocity[o + 1] += (base[o + 1] - positions[o + 1]) * .015; velocity[o + 2] += (base[o + 2] - positions[o + 2]) * .015; velocity[o] *= .94; velocity[o + 1] *= .94; velocity[o + 2] *= .94; positions[o] += velocity[o]; positions[o + 1] += velocity[o + 1]; positions[o + 2] += velocity[o + 2]; }
      geometry.attributes.position.needsUpdate = true; renderer.render(scene, camera); frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); removeEventListener("pointermove", setPointer); core?.removeEventListener("pointerdown", scatter); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, []);
  return h("div", { ref: hostRef, className: "particle-sphere", "aria-hidden": "true" });
}

function NeuralField({ coreRef, state, overdrive, overdriveStarting, accent }) {
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const runtime = {
      width: innerWidth,
      height: innerHeight,
      dpr: 1,
      nodes: [],
      pointer: { x: -1000, y: -1000, active: false },
      signals: [],
      burst: null,
      state: "idle",
      overdrive: false,
      overdriveStarting: false,
      accent,
      lastSignal: 0,
      frame: 0,
    };
    runtimeRef.current = runtime;

    const resize = () => {
      runtime.width = innerWidth;
      runtime.height = innerHeight;
      runtime.dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(runtime.width * runtime.dpr);
      canvas.height = Math.round(runtime.height * runtime.dpr);
      canvas.style.width = `${runtime.width}px`;
      canvas.style.height = `${runtime.height}px`;
      context.setTransform(runtime.dpr, 0, 0, runtime.dpr, 0, 0);
      const count = runtime.width < 700 ? 26 : 46;
      runtime.nodes = Array.from({ length: count }, () => ({
        x: 35 + Math.random() * (runtime.width - 70),
        y: 45 + Math.random() * (runtime.height - 90),
        offsetX: 0,
        offsetY: 0,
      }));
    };

    const updatePointer = (event) => {
      runtime.pointer.x = event.clientX;
      runtime.pointer.y = event.clientY;
      runtime.pointer.active = true;
    };
    const clearPointer = () => {
      runtime.pointer.active = false;
    };

    const coreOrigin = () => {
      const bounds = coreRef.current?.getBoundingClientRect();
      return bounds
        ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        : { x: runtime.width / 2, y: runtime.height / 2 };
    };

    const makePath = () => {
      const origin = coreOrigin();
      const angle = Math.random() * Math.PI * 2;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const candidates = runtime.nodes.map((node) => {
        const dx = node.x - origin.x;
        const dy = node.y - origin.y;
        return {
          node,
          forward: dx * direction.x + dy * direction.y,
          sideways: Math.abs(dx * direction.y - dy * direction.x),
        };
      }).filter((choice) => choice.forward > 44 && choice.sideways < 145)
        .sort((a, b) => a.forward - b.forward);
      const path = [origin];
      let lastForward = 0;
      for (const choice of candidates) {
        if (choice.forward - lastForward < 68) continue;
        path.push(choice.node);
        lastForward = choice.forward;
        if (path.length >= 7) break;
      }
      const edgeDistance = Math.hypot(runtime.width, runtime.height) * 0.72;
      path.push({
        x: origin.x + direction.x * edgeDistance,
        y: origin.y + direction.y * edgeDistance,
      });
      return path;
    };

    const spawnSignal = (boosted = false) => {
      const path = makePath();
      if (path) runtime.signals.push({ path, progress: 0, speed: boosted ? 0.14 : 0.07, boosted });
    };

    runtime.activate = (nextState, nextOverdrive, starting) => {
      const wasActive = runtime.state !== "idle";
      runtime.state = nextState;
      runtime.overdrive = nextOverdrive;
      runtime.overdriveStarting = starting;
      if (starting) {
        const origin = coreOrigin();
        runtime.burst = { ...origin, start: performance.now(), duration: 1450 };
        runtime.signals = [];
        for (let index = 0; index < 22; index += 1) {
          setTimeout(() => spawnSignal(true), index * 42);
        }
      } else if (!wasActive && nextState !== "idle") {
        for (let index = 0; index < 4; index += 1) setTimeout(() => spawnSignal(false), index * 100);
      }
    };

    const draw = (now) => {
      context.clearRect(0, 0, runtime.width, runtime.height);
      const rgb = runtime.overdrive || runtime.overdriveStarting ? [151, 24, 34] : hexToRgb(runtime.accent);
      const link = runtime.width < 700 ? 155 : 188;
      const nodeRadius = 1.45;
      const baseAlpha = runtime.overdrive ? 0.24 : 0.18;

      runtime.nodes.forEach((node) => {
        let targetX = 0;
        let targetY = 0;
        if (runtime.pointer.active) {
          const dx = node.x + node.offsetX - runtime.pointer.x;
          const dy = node.y + node.offsetY - runtime.pointer.y;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance < 175) {
            const force = ((175 - distance) / 175) ** 1.45 * 28;
            targetX = dx / distance * force;
            targetY = dy / distance * force;
          }
        }
        node.offsetX += (targetX - node.offsetX) * 0.13;
        node.offsetY += (targetY - node.offsetY) * 0.13;
      });

      for (let first = 0; first < runtime.nodes.length; first += 1) {
        for (let second = first + 1; second < runtime.nodes.length; second += 1) {
          const a = runtime.nodes[first];
          const b = runtime.nodes[second];
          const ax = a.x + a.offsetX;
          const ay = a.y + a.offsetY;
          const bx = b.x + b.offsetX;
          const by = b.y + b.offsetY;
          const distance = Math.hypot(ax - bx, ay - by);
          if (distance > link) continue;
          context.beginPath();
          context.moveTo(ax, ay);
          context.lineTo(bx, by);
          context.strokeStyle = `rgba(${rgb.join(",")},${baseAlpha * (1 - distance / link)})`;
          context.lineWidth = 0.65;
          context.stroke();
        }
      }

      runtime.nodes.forEach((node) => {
        context.beginPath();
        context.arc(node.x + node.offsetX, node.y + node.offsetY, nodeRadius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${rgb.join(",")},0.42)`;
        context.fill();
      });

      if (runtime.burst) {
        const elapsed = Math.min(1, (now - runtime.burst.start) / runtime.burst.duration);
        const radius = 28 + (Math.hypot(runtime.width, runtime.height) * 0.65) * (1 - (1 - elapsed) ** 3);
        context.beginPath();
        context.arc(runtime.burst.x, runtime.burst.y, radius, 0, Math.PI * 2);
        context.strokeStyle = `rgba(175,26,38,${(1 - elapsed) * 0.5})`;
        context.lineWidth = 0.9;
        context.stroke();
        if (elapsed >= 1) runtime.burst = null;
      }

      runtime.signals = runtime.signals.filter((signal) => {
        signal.progress += signal.speed;
        const head = Math.floor(signal.progress);
        if (head >= signal.path.length - 1) return false;
        const start = Math.max(0, head - 3);
        for (let segment = start; segment <= head; segment += 1) {
          const from = signal.path[segment];
          const to = signal.path[segment + 1];
          const fraction = segment === head ? signal.progress - head : 1;
          const x = from.x + (to.x - from.x) * fraction;
          const y = from.y + (to.y - from.y) * fraction;
          const alpha = 0.42 * (1 - (head - segment) / 5);
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(x, y);
          context.strokeStyle = `rgba(${rgb.join(",")},${alpha})`;
          context.lineWidth = 0.85;
          context.stroke();
          context.beginPath();
          context.arc(x, y, nodeRadius + 0.45, 0, Math.PI * 2);
          context.fillStyle = `rgba(${rgb.join(",")},0.8)`;
          context.fill();
        }
        return true;
      });

      if ((runtime.state !== "idle" || runtime.overdrive) && now - runtime.lastSignal > (runtime.overdrive ? 450 : 1250)) {
        runtime.lastSignal = now;
        spawnSignal(runtime.overdrive);
      }
      runtime.frame = requestAnimationFrame(draw);
    };

    resize();
    addEventListener("resize", resize);
    addEventListener("pointermove", updatePointer, { passive: true });
    addEventListener("pointerleave", clearPointer);
    addEventListener("blur", clearPointer);
    runtime.frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(runtime.frame);
      removeEventListener("resize", resize);
      removeEventListener("pointermove", updatePointer);
      removeEventListener("pointerleave", clearPointer);
      removeEventListener("blur", clearPointer);
    };
  }, [coreRef]);

  useEffect(() => {
    if (!runtimeRef.current) return;
    runtimeRef.current.accent = accent;
    runtimeRef.current.activate(state, overdrive, overdriveStarting);
  }, [state, overdrive, overdriveStarting, accent]);

  return h("canvas", { ref: canvasRef, className: "neural-field", "aria-hidden": "true" });
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return h("div", { className: "system-readout" },
    h("time", { className: "clock" }, now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
    h("span", { className: "date" }, now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }).toUpperCase()),
    h("span", { className: "system-ready" }, h("i"), "SYSTEM READY"),
  );
}

function Markup({ text }) {
  const blocks = String(text).split(/(```[\s\S]*?```)/g);
  return h(React.Fragment, null, ...blocks.map((block, index) => {
    if (block.startsWith("```")) {
      const content = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      return h("pre", { key: index }, h("code", null, content));
    }
    const lines = block.split("\n");
    return h(React.Fragment, { key: index }, ...lines.map((line, lineIndex) => {
      const list = /^[-*]\s+/.test(line);
      const heading = /^(#{1,3})\s+/.exec(line);
      if (heading) return h(`h${Math.min(3, heading[1].length + 1)}`, { key: lineIndex }, line.replace(/^#{1,3}\s+/, ""));
      if (list) return h("div", { className: "message-list-line", key: lineIndex }, h("span", null, "•"), line.replace(/^[-*]\s+/, ""));
      return h("span", { className: "message-line", key: lineIndex }, line, lineIndex < lines.length - 1 ? h("br") : null);
    }));
  }));
}

function Chevron({ direction = "right" }) {
  const paths = {
    left: "M14.5 5 8 12l6.5 7",
    right: "M9.5 5 16 12l-6.5 7",
    up: "M5 14.5 12 8l7 6.5",
    down: "M5 9.5 12 16l7-6.5",
  };
  return h("svg", { className: "chat-chevron", viewBox: "0 0 24 24", "aria-hidden": "true" },
    h("path", { d: paths[direction] || paths.right }),
  );
}

function ChatPanel({ open, setOpen, messages }) {
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages]);
  return h(React.Fragment, null,
    h("aside", { className: `chat-panel side-drawer drawer-left glass ${open ? "open" : "closed"}`, "aria-label": "RAVIN chat", "aria-hidden": !open },
    h("div", { className: "panel-head" },
      h("span", null, "CHAT"),
      h("button", { type: "button", className: "collapse-button", onClick: () => setOpen(false), "aria-label": "Collapse chat" },
        h(Chevron, { direction: "left" })),
    ),
    h("div", { className: "chat-scroll" },
      messages.length === 0 ? h("div", { className: "chat-empty" }, h("strong", null, "RAVIN"), h("span", null, "Ask when you’re ready.")) : null,
      ...messages.map((message) => h("article", { className: `message ${message.role}`, key: message.id },
        h("small", null, message.role === "assistant" ? "RAVIN" : message.role === "user" ? "YOU" : "SYSTEM"),
        h("div", null, h(Markup, { text: message.text })))),
      h("div", { ref: endRef }),
    ),
    ),
    !open ? h("button", { type: "button", className: "side-drawer-tab drawer-left glass", onClick: () => setOpen(true), "aria-label": "Open chat" }, h(Chevron, { direction: "right" })) : null,
  );
}

function Core({ coreRef, state, conversationMode, overdrive, overdriveStarting, accent, onPointerDown, onPointerUp, onPointerCancel }) {
  const status = overdriveStarting
    ? "INITIALIZING OVERDRIVE"
    : state !== "idle"
      ? state.toUpperCase()
      : overdrive
        ? "DOUBLE TAP TO DISENGAGE"
        : conversationMode
          ? "TAP TO EXIT CONVERSATION"
          : "TAP · ASK    HOLD · CONVERSATION    DOUBLE · OVERDRIVE";
  const colors = overdrive || overdriveStarting
    ? ["#4d050b", "#e13945", "#74101a"]
    : [accent, "#ffffff", accent];
  return h("section", { className: "core-stage" },
    h("div", { className: `overdrive-word ${overdrive ? "show" : ""}` }, "OVERDRIVE"),
    h("div", { className: "core-stack" },
      h(PulsatingBorder, {
        className: "core-shader-host",
        colors,
        speed: overdrive ? 2.2 : state === "idle" ? 0.62 : 1.45,
        radius: 100,
        spread: overdrive ? 58 : 44,
        thickness: overdrive ? 5 : 3,
        intensity: overdrive ? 65 : 27,
        bloom: overdrive ? 52 : 22,
        spotSize: 38,
      }, h("button", {
        ref: coreRef,
        type: "button",
        className: `ravin-core state-${state} ${overdrive ? "overdrive" : ""} ${overdriveStarting ? "overdrive-starting" : ""}`,
        "aria-label": "Activate RAVIN",
        onPointerDown,
        onPointerUp,
        onPointerCancel,
      },
        h("span", { className: "core-aura" }),
        h("span", { className: "core-shell" }),
        h("span", { className: "core-orbit orbit-one" }),
        h("span", { className: "core-orbit orbit-two" }),
        h("span", { className: "core-lens" },
          h(ParticleSphere, { accent, state, overdrive: overdrive || overdriveStarting }),
        ),
      )),
      h("div", { className: "core-status" }, status),
    ),
  );
}

function Composer({ inputRef, value, setValue, state, overdrive, disabled, onSubmit }) {
  return h("form", { className: "composer glass", onSubmit, "data-pulse": "true" },
    h("span", { className: "composer-state" }, overdrive ? `OVR · ${state.toUpperCase()}` : state.toUpperCase()),
    h("input", {
      ref: inputRef,
      value,
      onChange: (event) => setValue(event.target.value),
      placeholder: state === "listening" ? "Type a quick question…" : "Ask RAVIN anything…",
      disabled,
      "aria-label": "Message RAVIN",
    }),
    h("button", { type: "submit", disabled, "aria-label": "Send" },
      h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, h("path", { d: "M4 12h16m0 0-6-6m6 6-6 6" }))),
  );
}

const DOCK_ITEMS = ["calendar", "workshop", "core", "email", "settings"];

function Dock({ active, onSelect }) {
  return h("nav", { className: "dock glass", "aria-label": "RAVIN workspace" },
    ...DOCK_ITEMS.map((item) => h("button", {
      key: item,
      type: "button",
      className: active === item ? "active" : "",
      onClick: () => onSelect(item),
    }, h("span", null, item.toUpperCase()))),
  );
}

function Toggle({ checked, onChange, label }) {
  return h("button", { type: "button", className: `toggle ${checked ? "on" : ""}`, role: "switch", "aria-checked": checked, "aria-label": label, onClick: () => onChange(!checked) }, h("span"));
}

function SettingsView({ accent, setAccent, glassOpacity, setGlassOpacity, sound, setSound, session, signOut, signIn, clearConversation, memories, addMemory }) {
  const [draft, setDraft] = useState("");
  const saveMemory = async () => {
    const text = draft.trim();
    if (!text) return;
    await addMemory(text);
    setDraft("");
  };
  return h("section", { className: "workspace-window settings-view glass" },
    h("header", { className: "view-header" }, h("div", null, h("small", null, "RAVIN"), h("strong", null, "SYSTEM SETTINGS"))),
    h("div", { className: "settings-scroll" },
    h("div", { className: "account-row" }, h("span", null, session.user?.email || "Not signed in"), h("button", { onClick: session.user ? signOut : signIn, ...(session.user ? {} : { "data-pulse": "true" }) }, session.user ? "SIGN OUT" : "SIGN IN")),
    h("div", { className: "setting-row" }, h("span", null, "Accent"), h("label", { className: "accent-picker" }, h("input", { type: "color", value: accent, onChange: (event) => setAccent(event.target.value) }), h("code", null, accent.toUpperCase()))),
    h("div", { className: "setting-row glass-opacity-row" }, h("span", null, "Glass opacity"), h("label", { className: "glass-opacity-control" }, h("input", { type: "range", min: "2", max: "96", value: glassOpacity, onChange: (event) => setGlassOpacity(Number(event.target.value)), "aria-label": "Glass opacity" }), h("code", null, `${glassOpacity}%`))),
    h("div", { className: "setting-row" }, h("span", null, "Interface sound"), h(Toggle, { checked: sound, onChange: setSound, label: "Interface sound" })),
    h("div", { className: "settings-divider" }),
    h("div", { className: "memory-heading" }, h("span", null, "REMEMBERED"), h("code", null, String(memories.length))),
    session.user ? h("div", { className: "memory-add" }, h("input", { value: draft, onChange: (event) => setDraft(event.target.value), onKeyDown: (event) => { if (event.key === "Enter") saveMemory(); }, placeholder: "Add something to remember…" }), h("button", { onClick: saveMemory }, "ADD")) : h("p", { className: "settings-hint" }, "Sign in to manage permanent memory."),
    session.user && memories.length ? h("div", { className: "settings-memory-list" },
      ...memories.slice(0, 6).map((memory) => h("div", { key: memory.id || memory.content }, h("span", null, memory.content || String(memory))))) : null,
    h("button", { className: "clear-conversation", onClick: clearConversation }, "CLEAR CONVERSATION")),
  );
}

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function WeeklyTodo({ open, setOpen }) {
  const todayIndex = (new Date().getDay() + 6) % 7;
  const [openDay, setOpenDay] = useState(WEEK_DAYS[todayIndex]);
  const [tasks, setTasks] = useStoredState("ravin_weekly_tasks", {});
  const [drafts, setDrafts] = useState({});
  const addTask = (day) => {
    const title = String(drafts[day] || "").trim();
    if (!title) return;
    setTasks((current) => ({ ...current, [day]: [...(current[day] || []), { id: crypto.randomUUID(), title, done: false }] }));
    setDrafts((current) => ({ ...current, [day]: "" }));
  };
  const updateTask = (day, id, changes) => setTasks((current) => ({
    ...current,
    [day]: (current[day] || []).map((task) => task.id === id ? { ...task, ...changes } : task),
  }));
  const removeTask = (day, id) => setTasks((current) => ({ ...current, [day]: (current[day] || []).filter((task) => task.id !== id) }));
  return h(React.Fragment, null,
    h("aside", { className: `weekly-todo side-drawer drawer-right glass ${open ? "open" : "closed"}`, "aria-label": "Weekly to-do list", "aria-hidden": !open },
    h("header", null,
      h("div", null, h("small", null, "THIS WEEK"), h("strong", null, "TO-DO")),
      h("button", { type: "button", className: "collapse-button", onClick: () => setOpen(false), "aria-label": "Collapse weekly to-do list" }, h(Chevron, { direction: "right" }))),
    h("div", { className: "week-days" }, ...WEEK_DAYS.map((day, index) => {
      const expanded = openDay === day;
      return h("section", { className: `week-day ${expanded ? "expanded" : ""}`, key: day },
        h("button", { type: "button", onClick: () => setOpenDay(expanded ? null : day), "aria-expanded": expanded },
          h("span", { className: "day-index" }, String(index + 1).padStart(2, "0")),
          h("strong", null, day),
          h(Chevron, { direction: expanded ? "up" : "down" })),
        h("div", { className: "day-content", "aria-hidden": !expanded }, h("div", { className: "day-content-inner" },
          ...(tasks[day] || []).map((task) => h("div", { className: "todo-item", key: task.id },
            h("input", { type: "checkbox", checked: task.done, onChange: (event) => updateTask(day, task.id, { done: event.target.checked }), "aria-label": `Complete ${task.title}` }),
            h("input", { className: task.done ? "done" : "", value: task.title, onChange: (event) => updateTask(day, task.id, { title: event.target.value }), "aria-label": `Edit ${day} task` }),
            h("button", { type: "button", onClick: () => removeTask(day, task.id), "aria-label": `Delete ${task.title}` }, "×"))),
          h("div", { className: "todo-add" },
            h("input", { value: drafts[day] || "", onChange: (event) => setDrafts((current) => ({ ...current, [day]: event.target.value })), onKeyDown: (event) => { if (event.key === "Enter") addTask(day); }, placeholder: "Add a task…", "aria-label": `Add task for ${day}` }),
            h("button", { type: "button", onClick: () => addTask(day), "aria-label": `Save task for ${day}` }, "+")))));
    })),
    ),
    !open ? h("button", { type: "button", className: "side-drawer-tab drawer-right glass", onClick: () => setOpen(true), "aria-label": "Open weekly to-do list" }, h(Chevron, { direction: "left" })) : null,
  );
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date) {
  return addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -((date.getDay() + 6) % 7));
}

function eventOccursOn(event, date) {
  const target = fromDateKey(dateKey(date));
  const start = fromDateKey(event.date);
  if (target < start) return false;
  if (event.repeatUntil && target > fromDateKey(event.repeatUntil)) return false;
  const days = Math.round((target - start) / 86400000);
  if (!event.repeat || event.repeat === "none") return days === 0;
  if (event.repeat === "daily") return true;
  if (event.repeat === "weekly") return days % 7 === 0;
  if (event.repeat === "monthly") return target.getDate() === start.getDate();
  if (event.repeat === "yearly") return target.getDate() === start.getDate() && target.getMonth() === start.getMonth();
  return false;
}

function blankEvent(date) {
  return { id: crypto.randomUUID(), title: "", date: dateKey(date), start: "09:00", end: "10:00", allDay: false, repeat: "none", repeatUntil: "", location: "", notes: "", color: "#8fa7ff" };
}

function EventEditor({ event, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(event);
  const field = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = (submitEvent) => {
    submitEvent.preventDefault();
    if (!draft.title.trim()) return;
    onSave({ ...draft, title: draft.title.trim() });
  };
  return h("div", { className: "event-editor-backdrop" }, h("form", { className: "event-editor glass", onSubmit: submit },
    h("header", null, h("div", null, h("small", null, "CALENDAR EVENT"), h("strong", null, event.__new ? "NEW EVENT" : "EDIT EVENT")), h("button", { type: "button", onClick: onClose, "aria-label": "Close event editor" }, "×")),
    h("input", { className: "event-title", value: draft.title, onChange: (e) => field("title", e.target.value), placeholder: "Event title", autoFocus: true }),
    h("div", { className: "event-form-grid" },
      h("label", null, h("span", null, "DATE"), h("input", { type: "date", value: draft.date, onChange: (e) => field("date", e.target.value) })),
      h("label", { className: "all-day-label" }, h("span", null, "ALL DAY"), h("input", { type: "checkbox", checked: draft.allDay, onChange: (e) => field("allDay", e.target.checked) })),
      !draft.allDay ? h("label", null, h("span", null, "START"), h("input", { type: "time", value: draft.start, onChange: (e) => field("start", e.target.value) })) : null,
      !draft.allDay ? h("label", null, h("span", null, "END"), h("input", { type: "time", value: draft.end, onChange: (e) => field("end", e.target.value) })) : null,
      h("label", null, h("span", null, "REPEAT"), h("select", { value: draft.repeat, onChange: (e) => field("repeat", e.target.value) },
        ...["none", "daily", "weekly", "monthly", "yearly"].map((option) => h("option", { value: option, key: option }, option.toUpperCase())))),
      draft.repeat !== "none" ? h("label", null, h("span", null, "REPEAT UNTIL"), h("input", { type: "date", value: draft.repeatUntil, onChange: (e) => field("repeatUntil", e.target.value) })) : null,
      h("label", { className: "event-wide" }, h("span", null, "LOCATION"), h("input", { value: draft.location, onChange: (e) => field("location", e.target.value), placeholder: "Add location" })),
      h("label", null, h("span", null, "COLOR"), h("input", { type: "color", value: draft.color, onChange: (e) => field("color", e.target.value) })),
      h("label", { className: "event-wide" }, h("span", null, "NOTES"), h("textarea", { value: draft.notes, onChange: (e) => field("notes", e.target.value), placeholder: "Notes" }))),
    h("footer", null, !event.__new ? h("button", { type: "button", className: "event-delete", onClick: onDelete }, "DELETE") : h("span"), h("div", null, h("button", { type: "button", onClick: onClose }, "CANCEL"), h("button", { type: "submit", className: "event-save" }, "SAVE")))));
}

function CalendarView({ events, setEvents }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState("month");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const filtered = events.filter((event) => !search.trim() || `${event.title} ${event.location} ${event.notes}`.toLowerCase().includes(search.toLowerCase()));
  const eventsFor = (date) => filtered.filter((event) => eventOccursOn(event, date)).sort((a, b) => (a.allDay ? "00:00" : a.start).localeCompare(b.allDay ? "00:00" : b.start));
  const move = (direction) => {
    const next = new Date(cursor);
    if (view === "month") next.setMonth(next.getMonth() + direction);
    else if (view === "week") next.setDate(next.getDate() + direction * 7);
    else next.setDate(next.getDate() + direction);
    setCursor(next);
  };
  const save = (event) => {
    const clean = { ...event }; delete clean.__new;
    setEvents((items) => items.some((item) => item.id === clean.id) ? items.map((item) => item.id === clean.id ? clean : item) : [...items, clean]);
    setEditing(null);
  };
  const openNew = (date = cursor) => setEditing({ ...blankEvent(date), __new: true });
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthGridStart = startOfWeek(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));
  const weekStart = startOfWeek(cursor);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const visibleDays = view === "month" ? monthDays : view === "week" ? weekDays : [cursor];
  const title = view === "month" ? cursor.toLocaleDateString([], { month: "long", year: "numeric" })
    : view === "week" ? `${weekDays[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
      : cursor.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return h("section", { className: "workspace-window calendar-view glass" },
    h("header", { className: "calendar-toolbar" },
      h("div", { className: "calendar-nav" }, h("button", { onClick: () => move(-1), "aria-label": "Previous period" }, h(Chevron, { direction: "left" })), h("button", { onClick: () => setCursor(new Date()) }, "TODAY"), h("button", { onClick: () => move(1), "aria-label": "Next period" }, h(Chevron, { direction: "right" }))),
      h("strong", null, title),
      h("div", { className: "calendar-actions" }, h("input", { value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search", "aria-label": "Search calendar" }),
        h("div", { className: "calendar-view-switch", role: "tablist" }, ...["month", "week", "day"].map((item) => h("button", { key: item, role: "tab", "aria-selected": view === item, className: view === item ? "active" : "", onClick: () => setView(item) }, item.toUpperCase()))),
        h("button", { className: "calendar-add", onClick: () => openNew() }, "+ EVENT"))),
    h("div", { className: `calendar-body ${view}-mode` },
      view !== "day" ? h("div", { className: "calendar-weekdays" }, ...WEEK_DAYS.map((day) => h("span", { key: day }, day.slice(0, 3).toUpperCase()))) : null,
      h("div", { className: "calendar-grid" }, ...visibleDays.map((date) => {
        const dayEvents = eventsFor(date);
        const outside = view === "month" && date.getMonth() !== cursor.getMonth();
        const today = dateKey(date) === dateKey(new Date());
        return h("div", { className: `calendar-day ${outside ? "outside" : ""} ${today ? "today" : ""}`, key: dateKey(date), onDoubleClick: () => openNew(date) },
          h("button", { className: "calendar-date", onClick: () => { setCursor(date); if (view === "month") setView("day"); } }, view === "day" ? date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : String(date.getDate())),
          h("div", { className: "calendar-events" }, ...(dayEvents.length ? dayEvents.slice(0, view === "month" ? 4 : 20).map((event) => h("button", { className: "calendar-event", key: `${event.id}-${dateKey(date)}`, style: { "--event-color": event.color }, onClick: () => setEditing(event) }, h("i"), h("span", null, event.allDay ? "ALL DAY" : event.start), h("strong", null, event.title))) : [h("span", { className: "calendar-empty-day", key: "empty" }, view === "day" ? "No events scheduled." : "")])));
      }))),
    editing ? h(EventEditor, { event: editing, onSave: save, onDelete: () => { setEvents((items) => items.filter((item) => item.id !== editing.id)); setEditing(null); }, onClose: () => setEditing(null) }) : null);
}

function WorkshopView() {
  return h("section", { className: "workspace-window workshop-view glass" }, h("header", { className: "view-header" }, h("div", null, h("small", null, "RAVIN WORKSPACE"), h("strong", null, "WORKSHOP"))),
    h("div", { className: "workspace-placeholder" }, h("span", { className: "placeholder-mark" }, "W"), h("strong", null, "Build with RAVIN"), h("p", null, "Projects, files, and coding tools will live here.")));
}

function EmailView({ session, request, signIn }) {
  const [category, setCategory] = useState("personal");
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("");
  const [providerReady, setProviderReady] = useState({ google: null, microsoft: null });
  useEffect(() => {
    let active = true;
    fetch(`${BACKEND_URL}/api/health`, { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Email service is unavailable.")))
      .then((data) => {
        if (!active) return;
        const readiness = { google: Boolean(data.googleEmailConfigured), microsoft: Boolean(data.microsoftEmailConfigured) };
        setProviderReady(readiness);
        if (!readiness.google || !readiness.microsoft) {
          setStatus("Live inbox connections are waiting for the missing Google or Microsoft OAuth credentials on the RAVIN server.");
        }
      })
      .catch((error) => {
        if (active) setStatus(error.message);
      });
    return () => { active = false; };
  }, []);
  const loadAccounts = useCallback(async () => {
    if (!session.user) {
      setAccounts([]);
      setSelected(null);
      setMessages([]);
      return;
    }
    try {
      const data = await request("/api/email/accounts");
      setAccounts(data?.accounts || []);
    } catch (error) { setStatus(error.message); }
  }, [session.user, request]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get("email_connection");
    if (result === "success") {
      setStatus(`${params.get("provider") || "Email"} connected.`);
      loadAccounts();
    } else if (result === "error") {
      setStatus(params.get("email_error") || "The email account could not be connected.");
    }
    if (result) {
      params.delete("email_connection"); params.delete("provider"); params.delete("email_error");
      history.replaceState({}, document.title, `${location.pathname}${params.toString() ? `?${params}` : ""}`);
    }
  }, [loadAccounts]);
  const connect = async (provider) => {
    if (providerReady[provider] === false) {
      setStatus(`${provider === "google" ? "Google" : "Microsoft"} OAuth still needs its client ID and secret configured on the RAVIN server.`);
      return;
    }
    if (!session.user) { signIn(); return; }
    setStatus(`Opening ${provider === "google" ? "Google" : "Microsoft"} authorization…`);
    try {
      const data = await request(`/api/email/connect/${provider}`, { method: "POST", body: JSON.stringify({ category }) });
      location.assign(data.url);
    } catch (error) { setStatus(error.message); }
  };
  const openInbox = async (account) => {
    setSelected(account.id); setStatus("Loading inbox…");
    try { const data = await request(`/api/email/messages?account_id=${encodeURIComponent(account.id)}`); setMessages(data?.messages || []); setStatus(""); }
    catch (error) { setStatus(error.message); }
  };
  const disconnect = async (account) => {
    await request(`/api/email/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
    if (selected === account.id) { setSelected(null); setMessages([]); }
    loadAccounts();
  };
  const visible = accounts.filter((account) => account.category === category);
  return h("section", { className: "workspace-window email-view glass" },
    h("header", { className: "view-header email-header" }, h("div", null, h("small", null, "RAVIN WORKSPACE"), h("strong", null, "EMAIL")),
      h("div", { className: "email-switch", role: "tablist", "aria-label": "Email type" }, h("button", { className: category === "personal" ? "active" : "", onClick: () => setCategory("personal"), role: "tab", "aria-selected": category === "personal" }, "PERSONAL"), h("button", { className: category === "school" ? "active" : "", onClick: () => setCategory("school"), role: "tab", "aria-selected": category === "school" }, "SCHOOL / WORK"))),
    h("div", { className: "email-layout" },
      h("aside", { className: "email-sidebar" },
        h("div", { className: "provider-actions" },
          h("button", { onClick: () => connect("google"), disabled: providerReady.google === false, title: providerReady.google === false ? "Google OAuth setup required" : "Connect Google" }, h("b", null, "G"), providerReady.google === false ? "Google setup required" : "Connect Google"),
          h("button", { onClick: () => connect("microsoft"), disabled: providerReady.microsoft === false, title: providerReady.microsoft === false ? "Microsoft OAuth setup required" : "Connect Outlook" }, h("b", null, "M"), providerReady.microsoft === false ? "Outlook setup required" : "Connect Outlook")),
        h("small", null, "CONNECTED ACCOUNTS"),
        ...visible.map((account) => h("div", { className: `email-account ${selected === account.id ? "active" : ""}`, key: account.id }, h("button", { className: "email-account-main", onClick: () => openInbox(account) }, h("span", { className: "email-avatar" }, account.provider === "google" ? "G" : "M"), h("div", null, h("strong", null, account.email), h("small", null, account.provider.toUpperCase()))), h("button", { className: "email-disconnect", onClick: () => disconnect(account), "aria-label": `Disconnect ${account.email}` }, "×"))),
        !visible.length ? h("p", { className: "email-none" }, session.user ? "No accounts connected." : "Sign in to RAVIN first.") : null),
      h("main", { className: "inbox-pane" }, h("div", { className: "inbox-status" }, status), messages.length ? messages.map((message) => h("article", { className: `inbox-message ${message.unread ? "unread" : ""}`, key: message.id }, h("div", null, h("strong", null, message.from || "Unknown sender"), h("time", null, message.date ? new Date(message.date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "")), h("h3", null, message.subject || "(No subject)"), h("p", null, message.snippet || ""))) : h("div", { className: "inbox-empty" }, h("strong", null, "INBOX"), h("span", null, selected ? "No messages returned." : "Select a connected account.")))));
}

function WorkspaceDeck({ active, coreProps, events, setEvents, settingsProps, emailProps }) {
  const activeIndex = DOCK_ITEMS.indexOf(active);
  return h("div", { className: "workspace-deck" }, h("div", { className: "workspace-track", style: { transform: `translate3d(-${activeIndex * 20}%,0,0)` } },
    h("div", { className: `workspace-slide calendar-scene ${active === "calendar" ? "active" : ""}`, "aria-hidden": active !== "calendar" }, h(CalendarView, { events, setEvents })),
    h("div", { className: `workspace-slide workshop-scene ${active === "workshop" ? "active" : ""}`, "aria-hidden": active !== "workshop" }, h(WorkshopView)),
    h("div", { className: `workspace-slide core-slide core-scene ${active === "core" ? "active" : ""}`, "aria-hidden": active !== "core" }, h(Core, coreProps)),
    h("div", { className: `workspace-slide email-scene ${active === "email" ? "active" : ""}`, "aria-hidden": active !== "email" }, h(EmailView, emailProps)),
    h("div", { className: `workspace-slide settings-scene ${active === "settings" ? "active" : ""}`, "aria-hidden": active !== "settings" }, h(SettingsView, settingsProps))));
}

function AuthModal({ open, close, onSession }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await authRequest(mode, email.trim(), password, mode === "signup" ? { redirect_to: `${location.origin}${location.pathname}` } : {});
      if (!data.session) {
        setError(mode === "signup" ? "Account created. Check your email, then sign in." : "No session was returned.");
      } else {
        onSession(persistSession(data.session, data.user));
        close();
      }
    } catch (nextError) {
      setError(nextError.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };
  return h("div", { className: "auth-backdrop", role: "dialog", "aria-modal": "true", "aria-label": "RAVIN account" },
    h("section", { className: "auth-card glass" },
      h("button", { className: "auth-close", onClick: close, "aria-label": "Close" }, "×"),
      h("div", { className: "auth-mark" }, h("span", null, "R")),
      h("small", null, "RESONANT ASSIST"),
      h("h1", null, mode === "signin" ? "Welcome back" : "Create your RAVIN account"),
      h("p", null, mode === "signin" ? "Sign in to continue your conversations and memory." : "Your conversations and permanent memory stay connected to your account."),
      h("form", { onSubmit: submit },
        h("input", { type: "email", value: email, onChange: (event) => setEmail(event.target.value), placeholder: "Email", autoComplete: "email", required: true }),
        h("input", { type: "password", value: password, onChange: (event) => setPassword(event.target.value), placeholder: "Password", autoComplete: mode === "signin" ? "current-password" : "new-password", minLength: 8, required: true }),
        h("button", { type: "submit", disabled: busy, ...(mode === "signin" ? { "data-pulse": "true" } : {}) }, busy ? "PLEASE WAIT…" : mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"),
      ),
      h("div", { className: "auth-error" }, error),
      h("button", { className: "auth-switch", onClick: () => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); } }, mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"),
    ),
  );
}

function BootScreen({ done }) {
  return h("div", { className: `boot-screen ${done ? "done" : ""}` },
    h("div", { className: "boot-symbol" }, h("span", null, "R")),
    h("span", null, "INITIALIZING RAVIN"),
    h("i"),
  );
}

function App() {
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState(loadSession);
  const [authOpen, setAuthOpen] = useState(() => !loadSession().user);
  const [state, setState] = useState("idle");
  const [conversationMode, setConversationMode] = useState(false);
  const [overdrive, setOverdrive] = useState(false);
  const [overdriveStarting, setOverdriveStarting] = useState(false);
  const [overdriveExiting, setOverdriveExiting] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(true);
  const [promptVisible, setPromptVisible] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState("core");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useStoredState("ravin_chat_messages", []);
  const [conversationId, setConversationId] = useStoredState("ravin_conversation_id", null);
  const [calendarEvents, setCalendarEvents] = useStoredState("ravin_calendar_events", []);
  const [memories, setMemories] = useState([]);
  const [logs, setLogs] = useState([]);
  const [accent, setAccentState] = useState(() => localStorage.getItem("ravin_accent") || "#8fa7ff");
  const [glassOpacity, setGlassOpacityState] = useState(() => Number(localStorage.getItem("ravin_glass_opacity") || 44));
  const [sound, setSoundState] = useState(() => localStorage.getItem("ravin_sound") === "on");
  const inputRef = useRef(null);
  const coreRef = useRef(null);
  const sessionRef = useRef(session);
  const refreshPromiseRef = useRef(null);
  const pressTimer = useRef(null);
  const press = useRef({ holding: false, holdTriggered: false, lastTap: 0, singleTimer: null });

  const addLog = useCallback((text) => {
    const now = new Date();
    setLogs((items) => [{ id: crypto.randomUUID(), text, time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }, ...items].slice(0, 40));
  }, []);

  const adoptSession = useCallback((next) => {
    sessionRef.current = next;
    setSession(next);
    return next;
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const timer = setTimeout(() => setBooted(true), 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");
    if (!accessToken || !refreshToken || !type) return;
    authRequest("verify_access_token", "", "", { access_token: accessToken }).then((data) => {
      const next = persistSession({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: params.get("expires_at"),
        expires_in: params.get("expires_in"),
      }, data.user);
      history.replaceState({}, document.title, location.pathname + location.search);
      adoptSession(next);
      setAuthOpen(false);
    }).catch((error) => addLog(`Authentication error · ${error.message}`));
  }, [addLog, adoptSession]);

  useEffect(() => {
    const rgb = hexToRgb(accent);
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-rgb", rgb.join(","));
    localStorage.setItem("ravin_accent", accent);
  }, [accent]);
  useEffect(() => {
    const normalized = Math.min(0.96, Math.max(0.02, glassOpacity / 100));
    document.documentElement.style.setProperty("--glass-opacity", String(normalized));
    document.documentElement.style.setProperty("--glass-sheen-opacity", String(0.16 + normalized * 0.66));
    document.documentElement.style.setProperty("--glass-blur", `${18 + normalized * 30}px`);
    localStorage.setItem("ravin_glass_opacity", String(glassOpacity));
  }, [glassOpacity]);
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    localStorage.removeItem("ravin_theme");
  }, []);
  useEffect(() => localStorage.setItem("ravin_sound", sound ? "on" : "off"), [sound]);
  useEffect(() => addLog(`Core → ${state}${overdrive ? " · OVERDRIVE" : ""}`), [state, overdrive, addLog]);

  const playTone = useCallback((frequency = 440, duration = 0.06) => {
    if (!sound) return;
    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.025, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + duration);
    } catch { /* sound is optional */ }
  }, [sound]);

  const refreshSession = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const refreshToken = sessionRef.current.refreshToken;
    if (!refreshToken) return Promise.reject(new Error("Your RAVIN session has expired. Please sign in again."));
    const pending = authRequest("refresh", "", "", { refresh_token: refreshToken })
      .then((data) => {
        const next = adoptSession(persistSession(data.session, data.user));
        addLog("Session refreshed");
        return next.accessToken;
      })
      .catch((error) => {
        if (sessionRef.current.refreshToken === refreshToken) {
          adoptSession(clearSessionStorage());
          setAuthOpen(true);
          addLog(`Session ended · ${error.message}`);
        }
        throw new Error("Your RAVIN session expired. Please sign in again.");
      })
      .finally(() => {
        if (refreshPromiseRef.current === pending) refreshPromiseRef.current = null;
      });
    refreshPromiseRef.current = pending;
    return pending;
  }, [adoptSession, addLog]);

  const request = useCallback(async (pathname, options = {}) => {
    const current = sessionRef.current;
    let token = current.accessToken;
    if (!token) throw new Error("Please sign in to RAVIN first.");
    if (current.expiresAt && current.expiresAt <= Date.now() + 60_000) {
      token = await refreshSession();
    }
    try {
      return await apiRequest(pathname, token, options);
    } catch (error) {
      if (error.status !== 401) throw error;
      token = await refreshSession();
      return apiRequest(pathname, token, options);
    }
  }, [refreshSession]);

  const loadMemories = useCallback(async () => {
    if (!session.accessToken) return;
    try {
      const data = await request("/api/memories");
      setMemories(data?.permanent || []);
    } catch (error) {
      addLog(`Memory error · ${error.message}`);
      if (error.status === 401) {
        adoptSession(clearSessionStorage());
        setAuthOpen(true);
      }
    }
  }, [session.accessToken, request, addLog, adoptSession]);

  const addMemory = useCallback(async (content) => {
    const data = await request("/api/memories", { method: "POST", body: JSON.stringify({ content, category: "fact" }) });
    if (data?.memory) setMemories((items) => [data.memory, ...items]);
  }, [request]);

  useEffect(() => { if (session.user) loadMemories(); }, [session.user, loadMemories]);

  const toggleOverdrive = useCallback(() => {
    playTone(overdrive ? 300 : 110, overdrive ? 0.05 : 0.22);
    if (overdrive || overdriveStarting) {
      setOverdriveStarting(false);
      setOverdriveExiting(true);
      addLog("Overdrive shutdown started");
      setTimeout(() => {
        setOverdrive(false);
        setOverdriveExiting(false);
        addLog("Overdrive disengaged");
      }, 820);
      return;
    }
    setOverdriveStarting(true);
    setPromptVisible(false);
    addLog("Overdrive initialization started");
    setTimeout(() => {
      setOverdriveStarting(false);
      setOverdrive(true);
      addLog("Overdrive online");
    }, 1480);
  }, [overdrive, overdriveStarting, playTone, addLog]);

  const quickQuestion = useCallback(() => {
    if (state === "thinking" || state === "speaking") return;
    setConversationMode(false);
    setState("listening");
    setChatOpen(true);
    playTone(540);
    inputRef.current?.focus();
  }, [state, playTone]);

  const enterConversation = useCallback(() => {
    setConversationMode(true);
    setState("conversation");
    setChatOpen(true);
    setPromptVisible(false);
    playTone(620);
    inputRef.current?.focus();
  }, [playTone]);

  const exitConversation = useCallback(() => {
    setConversationMode(false);
    setState("idle");
    inputRef.current?.blur();
  }, []);

  const coreDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    press.current.holding = true;
    press.current.holdTriggered = false;
    pressTimer.current = setTimeout(() => {
      if (!press.current.holding) return;
      press.current.holdTriggered = true;
      enterConversation();
    }, 520);
  };

  const coreUp = (event) => {
    event.preventDefault();
    press.current.holding = false;
    clearTimeout(pressTimer.current);
    if (press.current.holdTriggered) return;
    const now = Date.now();
    if (now - press.current.lastTap < 310) {
      clearTimeout(press.current.singleTimer);
      press.current.lastTap = 0;
      toggleOverdrive();
      return;
    }
    press.current.lastTap = now;
    press.current.singleTimer = setTimeout(() => {
      if (conversationMode) exitConversation(); else quickQuestion();
    }, 315);
  };

  const coreCancel = () => {
    press.current.holding = false;
    clearTimeout(pressTimer.current);
  };

  const submit = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || state === "thinking" || state === "speaking") return;
    if (!session.accessToken) {
      setAuthOpen(true);
      return;
    }
    setInput("");
    setChatOpen(true);
    setPromptVisible(false);
    const userMessage = { id: crypto.randomUUID(), role: "user", text };
    setMessages((items) => [...items, userMessage]);
    setState("thinking");
    playTone(220, 0.08);
    try {
      const data = await request("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, conversation_id: conversationId }),
      });
      if (data?.conversation_id) setConversationId(data.conversation_id);
      const reply = data?.reply || "RAVIN returned no visible response.";
      setState("speaking");
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", text: reply }]);
      playTone(680, 0.09);
      setTimeout(() => {
        setState(conversationMode ? "conversation" : "idle");
        if (!conversationMode) {
          setPromptVisible(true);
          setTimeout(() => setPromptVisible(false), 5500);
        }
      }, Math.min(1400, Math.max(380, reply.length * 4)));
    } catch (error) {
      setState("error");
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "error", text: `RAVIN error: ${error.message}` }]);
      if (error.status === 401) {
        adoptSession(clearSessionStorage());
        setAuthOpen(true);
      }
      setTimeout(() => setState(conversationMode ? "conversation" : "idle"), 900);
    }
  };

  const selectDock = (item) => {
    setWorkspaceTab(item);
    setPromptVisible(false);
  };

  const clearConversation = () => {
    setMessages([]);
    setConversationId(null);
    addLog("Conversation cleared");
  };

  useEffect(() => {
    const keydown = (event) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setWorkspaceTab("core");
        setPromptVisible(false);
        if (conversationMode) exitConversation();
      }
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [conversationMode, exitConversation]);

  return h("div", { className: `ravin-app ${booted ? "ready" : ""} ${overdrive ? "overdrive-mode" : ""} ${overdriveStarting ? "overdrive-boot" : ""} ${overdriveExiting ? "overdrive-exit" : ""}` },
    h(NeuralField, { coreRef, state, overdrive, overdriveStarting, accent }),
    h("div", { className: "ambient-wash", "aria-hidden": "true" }),
    h("header", { className: "topbar" }, h(Clock), h("div", { className: "brand-lockup" }, h("span", null, "RAVIN"), h("small", null, "RESONANT ASSIST"))),
    h(ChatPanel, { open: chatOpen, setOpen: setChatOpen, messages }),
    h(WeeklyTodo, { open: todoOpen, setOpen: setTodoOpen }),
    h(WorkspaceDeck, {
      active: workspaceTab,
      events: calendarEvents,
      setEvents: setCalendarEvents,
      coreProps: { coreRef, state, conversationMode, overdrive, overdriveStarting, accent, onPointerDown: coreDown, onPointerUp: coreUp, onPointerCancel: coreCancel },
      settingsProps: {
        accent, setAccent: setAccentState, glassOpacity, setGlassOpacity: setGlassOpacityState, sound, setSound: setSoundState,
        session, signOut: () => { adoptSession(clearSessionStorage()); setAuthOpen(true); }, signIn: () => setAuthOpen(true), clearConversation, memories, addMemory,
      },
      emailProps: { session, request, signIn: () => setAuthOpen(true) },
    }),
    promptVisible ? h("div", { className: "conversation-prompt glass" }, h("span", null, "Enter Conversation Mode?"), h("button", { onClick: enterConversation }, "ENTER"), h("button", { onClick: () => setPromptVisible(false), "aria-label": "Dismiss" }, "×")) : null,
    h(Dock, { active: workspaceTab, onSelect: selectDock }),
    h(Composer, { inputRef, value: input, setValue: setInput, state, overdrive, disabled: state === "thinking" || state === "speaking", onSubmit: submit }),
    h(HoverBorder, { accent, overdrive: overdrive || overdriveStarting }),
    h(AuthModal, { open: authOpen, close: () => setAuthOpen(false), onSession: (next) => { adoptSession(next); addLog("Signed in"); } }),
    h(BootScreen, { done: booted }),
    h("div", { className: "overdrive-flash", "aria-hidden": "true" }),
    h("div", { className: "overdrive-shockwave", "aria-hidden": "true" }),
  );
}

createRoot(document.getElementById("root")).render(h(App));
