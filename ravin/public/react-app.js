import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { PulsingBorder as PaperPulsingBorder } from "https://esm.sh/@paper-design/shaders-react@0.0.61?external=react,react-dom&deps=@paper-design/shaders@0.0.61";

const h = React.createElement;
const BACKEND_URL = "https://ravin-ap66.onrender.com";
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
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener("scroll", schedule, true);
      removeEventListener("resize", schedule);
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
  const [target, setTarget] = useState(null);
  useEffect(() => {
    const enter = (event) => {
      const next = event.target.closest?.("[data-pulse]");
      if (next) setTarget(next);
    };
    const leave = (event) => {
      if (!target) return;
      const next = event.relatedTarget;
      if (!next || !target.contains(next)) setTarget(null);
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    return () => {
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
    };
  }, [target]);
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  return h("div", {
    className: "hover-shader-anchor",
    style: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  }, h(PulsatingBorder, {
    colors: overdrive ? ["#4d050b", "#d22b38", "#74101a"] : [accent, "#ffffff", accent],
    radius: 28,
    spread: 24,
    thickness: 3,
    intensity: 30,
    bloom: 18,
    zIndex: 160,
  }));
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
      const count = runtime.width < 700 ? 29 : Math.min(58, Math.max(40, Math.round(runtime.width / 28)));
      runtime.nodes = Array.from({ length: count }, (_, index) => ({
        x: (index * 149.3 % runtime.width) + Math.random() * 24 - 12,
        y: (index * 83.7 % runtime.height) + Math.random() * 24 - 12,
        homeX: 0,
        homeY: 0,
        vx: 0,
        vy: 0,
        phase: Math.random() * Math.PI * 2,
      })).map((node) => ({ ...node, homeX: node.x, homeY: node.y }));
    };

    const coreOrigin = () => {
      const bounds = coreRef.current?.getBoundingClientRect();
      return bounds
        ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        : { x: runtime.width / 2, y: runtime.height / 2 };
    };

    const makePath = () => {
      const origin = coreOrigin();
      let currentIndex = runtime.nodes.reduce((best, node, index) =>
        Math.hypot(node.x - origin.x, node.y - origin.y) < Math.hypot(runtime.nodes[best].x - origin.x, runtime.nodes[best].y - origin.y) ? index : best, 0);
      const path = [origin, runtime.nodes[currentIndex]];
      const used = new Set([currentIndex]);
      for (let step = 0; step < 18; step += 1) {
        const current = runtime.nodes[currentIndex];
        const choices = runtime.nodes.map((node, index) => ({
          index,
          node,
          distance: Math.hypot(node.x - current.x, node.y - current.y),
          outward: Math.hypot(node.x - runtime.width / 2, node.y - runtime.height / 2),
        })).filter((choice) => !used.has(choice.index) && choice.distance < 215)
          .sort((a, b) => b.outward - a.outward + (Math.random() - 0.5) * 110);
        if (!choices.length) break;
        currentIndex = choices[Math.floor(Math.random() * Math.min(3, choices.length))].index;
        used.add(currentIndex);
        path.push(runtime.nodes[currentIndex]);
      }
      return path.length >= 4 ? path : null;
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

    const pointerMove = (event) => {
      runtime.pointer.x = event.clientX;
      runtime.pointer.y = event.clientY;
      runtime.pointer.active = true;
    };
    const pointerLeave = () => { runtime.pointer.active = false; };

    const draw = (now) => {
      context.clearRect(0, 0, runtime.width, runtime.height);
      const rgb = runtime.overdrive || runtime.overdriveStarting ? [151, 24, 34] : hexToRgb(runtime.accent);
      const link = runtime.width < 700 ? 155 : 188;
      const nodeRadius = 1.45;
      const baseAlpha = runtime.overdrive ? 0.2 : 0.14;

      runtime.nodes.forEach((node) => {
        const dx = node.x - runtime.pointer.x;
        const dy = node.y - runtime.pointer.y;
        const distance = Math.hypot(dx, dy) || 1;
        if (runtime.pointer.active && distance < 150) {
          const force = (150 - distance) / 150;
          node.vx += (dx / distance) * force * 0.13;
          node.vy += (dy / distance) * force * 0.13;
        }
        node.vx += (node.homeX - node.x) * 0.0007;
        node.vy += (node.homeY - node.y) * 0.0007;
        node.vx *= 0.965;
        node.vy *= 0.965;
        node.x += node.vx + Math.sin(now * 0.00018 + node.phase) * 0.018;
        node.y += node.vy + Math.cos(now * 0.00016 + node.phase) * 0.018;
      });

      for (let first = 0; first < runtime.nodes.length; first += 1) {
        for (let second = first + 1; second < runtime.nodes.length; second += 1) {
          const a = runtime.nodes[first];
          const b = runtime.nodes[second];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > link) continue;
          const pointerDistance = runtime.pointer.active
            ? Math.min(Math.hypot(a.x - runtime.pointer.x, a.y - runtime.pointer.y), Math.hypot(b.x - runtime.pointer.x, b.y - runtime.pointer.y))
            : 999;
          const reaction = pointerDistance < 180 ? (180 - pointerDistance) / 180 : 0;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.strokeStyle = `rgba(${rgb.join(",")},${baseAlpha * (1 - distance / link) + reaction * 0.2})`;
          context.lineWidth = 0.65 + reaction * 0.25;
          context.stroke();
        }
      }

      runtime.nodes.forEach((node) => {
        const pointerDistance = runtime.pointer.active ? Math.hypot(node.x - runtime.pointer.x, node.y - runtime.pointer.y) : 999;
        const reaction = pointerDistance < 170 ? (170 - pointerDistance) / 170 : 0;
        context.beginPath();
        context.arc(node.x, node.y, nodeRadius + reaction * 0.75, 0, Math.PI * 2);
        context.fillStyle = `rgba(${rgb.join(",")},${0.34 + reaction * 0.46})`;
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
    addEventListener("pointermove", pointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", pointerLeave);
    runtime.frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(runtime.frame);
      removeEventListener("resize", resize);
      removeEventListener("pointermove", pointerMove);
      document.documentElement.removeEventListener("pointerleave", pointerLeave);
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

function ChatPanel({ open, setOpen, messages }) {
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages]);
  return h("aside", { className: `chat-panel glass ${open ? "open" : "collapsed"}`, "aria-label": "RAVIN chat" },
    h("div", { className: "panel-head" },
      h("span", null, "CHAT"),
      h("button", { type: "button", className: "collapse-button", onClick: () => setOpen(!open), "aria-label": open ? "Collapse chat" : "Open chat", "data-pulse": true },
        h("span"), h("span")),
    ),
    open ? h("div", { className: "chat-scroll" },
      messages.length === 0 ? h("div", { className: "chat-empty" }, h("strong", null, "RAVIN"), h("span", null, "Ask when you’re ready.")) : null,
      ...messages.map((message) => h("article", { className: `message ${message.role}`, key: message.id },
        h("small", null, message.role === "assistant" ? "RAVIN" : message.role === "user" ? "YOU" : "SYSTEM"),
        h("div", null, h(Markup, { text: message.text })))),
      h("div", { ref: endRef }),
    ) : null,
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
        h("span", { className: "core-lens" }, h("i"), h("i"), h("i")),
      )),
      h("div", { className: "core-status" }, status),
    ),
  );
}

function Composer({ inputRef, value, setValue, state, overdrive, disabled, onSubmit }) {
  return h("form", { className: "composer glass", onSubmit },
    h("span", { className: "composer-state" }, overdrive ? `OVR · ${state.toUpperCase()}` : state.toUpperCase()),
    h("input", {
      ref: inputRef,
      value,
      onChange: (event) => setValue(event.target.value),
      placeholder: state === "listening" ? "Type a quick question…" : "Ask RAVIN anything…",
      disabled,
      "aria-label": "Message RAVIN",
    }),
    h("button", { type: "submit", disabled, "aria-label": "Send", "data-pulse": true },
      h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, h("path", { d: "M4 12h16m0 0-6-6m6 6-6 6" }))),
  );
}

const DOCK_ITEMS = ["notes", "tasks", "memory", "projects", "logs", "settings"];

function Dock({ active, onSelect }) {
  return h("nav", { className: "dock glass", "aria-label": "RAVIN workspace" },
    ...DOCK_ITEMS.map((item) => h("button", {
      key: item,
      type: "button",
      className: active === item ? "active" : "",
      onClick: () => onSelect(item),
      "data-pulse": true,
    }, item.toUpperCase())),
  );
}

function Workspace({ tab, close, notes, setNotes, tasks, setTasks, projects, setProjects, logs, memories, loadMemories, signedIn }) {
  const [taskDraft, setTaskDraft] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  useEffect(() => { if (tab === "memory") loadMemories(); }, [tab, loadMemories]);
  if (!tab || tab === "settings") return null;
  const addTask = () => {
    const text = taskDraft.trim();
    if (!text) return;
    setTasks((items) => [...items, { id: crypto.randomUUID(), text, done: false }]);
    setTaskDraft("");
  };
  const addProject = () => {
    const text = projectDraft.trim();
    if (!text) return;
    setProjects((items) => [...items, { id: crypto.randomUUID(), text }]);
    setProjectDraft("");
  };
  const title = tab[0].toUpperCase() + tab.slice(1);
  let body;
  if (tab === "notes") body = h("textarea", { className: "notes-area", value: notes, onChange: (event) => setNotes(event.target.value), placeholder: "Capture an idea, reminder, calculation…" });
  if (tab === "tasks") body = h(React.Fragment, null,
    h("div", { className: "workspace-input" }, h("input", { value: taskDraft, onChange: (event) => setTaskDraft(event.target.value), onKeyDown: (event) => { if (event.key === "Enter") addTask(); }, placeholder: "Add a task…" }), h("button", { onClick: addTask, "data-pulse": true }, "+")),
    h("div", { className: "workspace-list" }, tasks.length ? tasks.map((task) => h("label", { className: "workspace-item", key: task.id },
      h("input", { type: "checkbox", checked: task.done, onChange: () => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, done: !item.done } : item)) }),
      h("span", { className: task.done ? "done" : "" }, task.text),
      h("button", { onClick: () => setTasks((items) => items.filter((item) => item.id !== task.id)), "aria-label": "Delete task" }, "×"))) : h("div", { className: "workspace-empty" }, "No tasks yet.")),
  );
  if (tab === "projects") body = h(React.Fragment, null,
    h("div", { className: "workspace-input" }, h("input", { value: projectDraft, onChange: (event) => setProjectDraft(event.target.value), onKeyDown: (event) => { if (event.key === "Enter") addProject(); }, placeholder: "Pin a project…" }), h("button", { onClick: addProject, "data-pulse": true }, "+")),
    h("div", { className: "workspace-list" }, projects.length ? projects.map((project) => h("div", { className: "workspace-item", key: project.id }, h("span", null, project.text), h("button", { onClick: () => setProjects((items) => items.filter((item) => item.id !== project.id)), "aria-label": "Delete project" }, "×"))) : h("div", { className: "workspace-empty" }, "No projects pinned.")),
  );
  if (tab === "memory") body = h("div", { className: "workspace-list" }, !signedIn
    ? h("div", { className: "workspace-empty" }, "Sign in to view permanent memory.")
    : memories.length
      ? memories.map((memory) => h("div", { className: "workspace-item", key: memory.id || memory.content }, h("span", null, memory.content || String(memory))))
      : h("div", { className: "workspace-empty" }, "Nothing saved yet."));
  if (tab === "logs") body = h("div", { className: "workspace-list logs" }, logs.map((entry) => h("div", { className: "log-row", key: entry.id }, h("time", null, entry.time), h("span", null, entry.text))));

  return h("section", { className: "workspace-panel glass" },
    h("header", null, h("div", null, h("small", null, "RAVIN WORKSPACE"), h("strong", null, title)), h("button", { onClick: close, "aria-label": "Close workspace", "data-pulse": true }, "×")),
    h("div", { className: "workspace-meta" }, h("span", null, tab === "notes" ? "AUTOSAVED" : tab === "memory" ? "ACCOUNT" : tab === "logs" ? "LIVE" : "LOCAL")),
    h("div", { className: "workspace-content" }, body),
  );
}

function Toggle({ checked, onChange, label }) {
  return h("button", { type: "button", className: `toggle ${checked ? "on" : ""}`, role: "switch", "aria-checked": checked, "aria-label": label, onClick: () => onChange(!checked), "data-pulse": true }, h("span"));
}

function Settings({ close, accent, setAccent, light, setLight, sound, setSound, session, signOut, signIn, clearConversation, memories, addMemory }) {
  const [draft, setDraft] = useState("");
  const saveMemory = async () => {
    const text = draft.trim();
    if (!text) return;
    await addMemory(text);
    setDraft("");
  };
  return h("section", { className: "settings-panel glass" },
    h("header", null, h("div", null, h("small", null, "RAVIN"), h("strong", null, "SYSTEM SETTINGS")), h("button", { onClick: close, "aria-label": "Close settings", "data-pulse": true }, "×")),
    h("div", { className: "account-row" }, h("span", null, session.user?.email || "Not signed in"), h("button", { onClick: session.user ? signOut : signIn, "data-pulse": true }, session.user ? "SIGN OUT" : "SIGN IN")),
    h("div", { className: "setting-row" }, h("span", null, "Accent"), h("label", { className: "accent-picker" }, h("input", { type: "color", value: accent, onChange: (event) => setAccent(event.target.value) }), h("code", null, accent.toUpperCase()))),
    h("div", { className: "setting-row" }, h("span", null, "Light mode"), h(Toggle, { checked: light, onChange: setLight, label: "Light mode" })),
    h("div", { className: "setting-row" }, h("span", null, "Interface sound"), h(Toggle, { checked: sound, onChange: setSound, label: "Interface sound" })),
    h("div", { className: "settings-divider" }),
    h("div", { className: "memory-heading" }, h("span", null, "REMEMBERED"), h("code", null, String(memories.length))),
    session.user ? h("div", { className: "memory-add" }, h("input", { value: draft, onChange: (event) => setDraft(event.target.value), onKeyDown: (event) => { if (event.key === "Enter") saveMemory(); }, placeholder: "Add something to remember…" }), h("button", { onClick: saveMemory, "data-pulse": true }, "ADD")) : h("p", { className: "settings-hint" }, "Sign in to manage permanent memory."),
    h("button", { className: "clear-conversation", onClick: clearConversation, "data-pulse": true }, "CLEAR CONVERSATION"),
  );
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
        h("button", { type: "submit", disabled: busy, "data-pulse": true }, busy ? "PLEASE WAIT…" : mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"),
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
  const [chatOpen, setChatOpen] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useStoredState("ravin_chat_messages", []);
  const [conversationId, setConversationId] = useStoredState("ravin_conversation_id", null);
  const [notes, setNotes] = useStoredText("ravin_workspace_notes", "");
  const [tasks, setTasks] = useStoredState("ravin_workspace_tasks", []);
  const [projects, setProjects] = useStoredState("ravin_workspace_projects", []);
  const [memories, setMemories] = useState([]);
  const [logs, setLogs] = useState([]);
  const [accent, setAccentState] = useState(() => localStorage.getItem("ravin_accent") || "#8fa7ff");
  const [light, setLightState] = useState(() => localStorage.getItem("ravin_theme") === "light");
  const [sound, setSoundState] = useState(() => localStorage.getItem("ravin_sound") === "on");
  const inputRef = useRef(null);
  const coreRef = useRef(null);
  const pressTimer = useRef(null);
  const press = useRef({ holding: false, holdTriggered: false, lastTap: 0, singleTimer: null });

  const addLog = useCallback((text) => {
    const now = new Date();
    setLogs((items) => [{ id: crypto.randomUUID(), text, time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }, ...items].slice(0, 40));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setBooted(true), 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setTasks((items) => items.map((item) => ({
      id: item?.id || crypto.randomUUID(),
      text: typeof item === "string" ? item : item?.text || "",
      done: Boolean(item?.done),
    })).filter((item) => item.text));
    setProjects((items) => items.map((item) => ({
      id: item?.id || crypto.randomUUID(),
      text: typeof item === "string" ? item : item?.text || "",
    })).filter((item) => item.text));
  }, [setTasks, setProjects]);

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
      setSession(next);
      setAuthOpen(false);
    }).catch((error) => addLog(`Authentication error · ${error.message}`));
  }, [addLog]);

  useEffect(() => {
    const rgb = hexToRgb(accent);
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-rgb", rgb.join(","));
    localStorage.setItem("ravin_accent", accent);
  }, [accent]);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    localStorage.setItem("ravin_theme", light ? "light" : "dark");
  }, [light]);
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

  const refreshSession = useCallback(async () => {
    if (!session.refreshToken) throw new Error("Your RAVIN session has expired. Please sign in again.");
    const data = await authRequest("refresh", "", "", { refresh_token: session.refreshToken });
    const next = persistSession(data.session, data.user);
    setSession(next);
    addLog("Session refreshed");
    return next.accessToken;
  }, [session.refreshToken, addLog]);

  const request = useCallback(async (pathname, options = {}) => {
    let token = session.accessToken;
    if (!token) throw new Error("Please sign in to RAVIN first.");
    if (session.expiresAt && session.expiresAt <= Date.now() + 60_000) {
      token = await refreshSession();
    }
    try {
      return await apiRequest(pathname, token, options);
    } catch (error) {
      if (error.status !== 401) throw error;
      token = await refreshSession();
      return apiRequest(pathname, token, options);
    }
  }, [session.accessToken, session.expiresAt, refreshSession]);

  const loadMemories = useCallback(async () => {
    if (!session.accessToken) return;
    try {
      const data = await request("/api/memories");
      setMemories(data?.permanent || []);
    } catch (error) {
      addLog(`Memory error · ${error.message}`);
      if (error.status === 401) {
        setSession(clearSessionStorage());
        setAuthOpen(true);
      }
    }
  }, [session.accessToken, request, addLog]);

  const addMemory = useCallback(async (content) => {
    const data = await request("/api/memories", { method: "POST", body: JSON.stringify({ content, category: "fact" }) });
    if (data?.memory) setMemories((items) => [data.memory, ...items]);
  }, [request]);

  useEffect(() => { if (session.user) loadMemories(); }, [session.user, loadMemories]);

  const toggleOverdrive = useCallback(() => {
    playTone(overdrive ? 300 : 110, overdrive ? 0.05 : 0.22);
    if (overdrive || overdriveStarting) {
      setOverdrive(false);
      setOverdriveStarting(false);
      addLog("Overdrive disengaged");
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
        setSession(clearSessionStorage());
        setAuthOpen(true);
      }
      setTimeout(() => setState(conversationMode ? "conversation" : "idle"), 900);
    }
  };

  const selectDock = (item) => {
    setWorkspaceTab((current) => current === item ? null : item);
    if (item === "memory") loadMemories();
  };

  const clearConversation = () => {
    setMessages([]);
    setConversationId(null);
    setWorkspaceTab(null);
    addLog("Conversation cleared");
  };

  useEffect(() => {
    const keydown = (event) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setWorkspaceTab(null);
        setPromptVisible(false);
        if (conversationMode) exitConversation();
      }
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [conversationMode, exitConversation]);

  return h("div", { className: `ravin-app ${booted ? "ready" : ""} ${overdrive ? "overdrive-mode" : ""} ${overdriveStarting ? "overdrive-boot" : ""}` },
    h(NeuralField, { coreRef, state, overdrive, overdriveStarting, accent }),
    h("div", { className: "ambient-wash", "aria-hidden": "true" }),
    h("header", { className: "topbar" }, h(Clock), h("div", { className: "brand-lockup" }, h("span", null, "RAVIN"), h("small", null, "RESONANT ASSIST"))),
    h(ChatPanel, { open: chatOpen, setOpen: setChatOpen, messages }),
    !chatOpen ? h("button", { className: "chat-open glass", onClick: () => setChatOpen(true), "aria-label": "Open chat", "data-pulse": true }, h("span"), h("span")) : null,
    h(Core, { coreRef, state, conversationMode, overdrive, overdriveStarting, accent, onPointerDown: coreDown, onPointerUp: coreUp, onPointerCancel: coreCancel }),
    h(Workspace, { tab: workspaceTab, close: () => setWorkspaceTab(null), notes, setNotes, tasks, setTasks, projects, setProjects, logs, memories, loadMemories, signedIn: Boolean(session.user) }),
    workspaceTab === "settings" ? h(Settings, {
      close: () => setWorkspaceTab(null), accent, setAccent: setAccentState, light, setLight: setLightState, sound, setSound: setSoundState,
      session, signOut: () => { setSession(clearSessionStorage()); setAuthOpen(true); }, signIn: () => setAuthOpen(true), clearConversation, memories, addMemory,
    }) : null,
    promptVisible ? h("div", { className: "conversation-prompt glass" }, h("span", null, "Enter Conversation Mode?"), h("button", { onClick: enterConversation, "data-pulse": true }, "ENTER"), h("button", { onClick: () => setPromptVisible(false), "aria-label": "Dismiss" }, "×")) : null,
    h(Dock, { active: workspaceTab, onSelect: selectDock }),
    h(Composer, { inputRef, value: input, setValue: setInput, state, overdrive, disabled: state === "thinking" || state === "speaking", onSubmit: submit }),
    h(HoverBorder, { accent, overdrive: overdrive || overdriveStarting }),
    h(AuthModal, { open: authOpen, close: () => setAuthOpen(false), onSession: (next) => { setSession(next); addLog("Signed in"); } }),
    h(BootScreen, { done: booted }),
    h("div", { className: "overdrive-flash", "aria-hidden": "true" }),
    h("div", { className: "overdrive-shockwave", "aria-hidden": "true" }),
  );
}

createRoot(document.getElementById("root")).render(h(App));
