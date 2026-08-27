(() => {
  const KEY = "ravin_voice_enabled";
  let enabled = localStorage.getItem(KEY) === "true";
  let ws = null;
  let audioContext = null;
  let micStream = null;
  let micNode = null;
  let micSource = null;
  let startingMic = false;
  let playbackQueueTime = 0;

  const isConversation = () => Boolean(window.RavinCore?.isConversationMode?.());
  const getWsUrl = () => {
    const backend = (window.RavinAPI?.getBackendUrl?.() || window.RAVIN_CONFIG?.backendUrl || "").replace(/\/$/, "");
    if (!backend) throw new Error("RAVIN backend URL is not configured.");
    const url = new URL(backend);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws/voice";
    const token = window.RavinAuth?.getAccessToken?.() || "";
    url.search = `?token=${encodeURIComponent(token)}`;
    return url.toString();
  };

  async function ensureAudioContext() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") await audioContext.resume();
    return audioContext;
  }

  function downsampleTo16k(float32, inputRate) {
    const ratio = inputRate / 16000;
    const out = new Int16Array(Math.floor(float32.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32[Math.floor(i * ratio)]));
      out[i] = sample * 0x7fff;
    }
    return out;
  }

  async function startMic() {
    if (startingMic || micStream || !ws || ws.readyState !== WebSocket.OPEN || !isConversation()) return;
    startingMic = true;
    try {
      const ctx = await ensureAudioContext();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micSource = ctx.createMediaStreamSource(micStream);
      micNode = ctx.createScriptProcessor(4096, 1, 1);
      micNode.onaudioprocess = event => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !isConversation()) return;
        const pcm16 = downsampleTo16k(event.inputBuffer.getChannelData(0), ctx.sampleRate);
        if (pcm16.length) ws.send(pcm16.buffer);
      };
      micSource.connect(micNode);
      micNode.connect(ctx.destination);
    } catch (err) {
      console.error("[Hermes voice] microphone error", err);
      window.RavinCore?.setState("idle");
    } finally { startingMic = false; }
  }

  function stopMic() {
    micNode?.disconnect();
    micSource?.disconnect();
    micStream?.getTracks().forEach(track => track.stop());
    micNode = null; micSource = null; micStream = null;
  }

  async function playAudioChunk(arrayBuffer) {
    const ctx = await ensureAudioContext();
    try {
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime + 0.01, playbackQueueTime);
      source.start(startAt);
      playbackQueueTime = startAt + buffer.duration;
      source.onended = () => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "playback_finished" }));
      };
    } catch (err) {
      console.warn("[Hermes voice] audio decode failed", err);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "playback_finished" }));
    }
  }

  function connect() {
    if (ws || !enabled || !isConversation()) return;
    try { ws = new WebSocket(getWsUrl()); } catch (err) { console.error("[Hermes voice]", err); return; }
    ws.binaryType = "arraybuffer";
    ws.onopen = () => startMic();
    ws.onmessage = event => {
      if (event.data instanceof ArrayBuffer) { playAudioChunk(event.data); return; }
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "state") {
        window.RavinCore?.setState(msg.state);
        if (msg.state === "listening") startMic(); else stopMic();
      } else if (msg.type === "transcript") {
        window.dispatchEvent(new CustomEvent("ravin:voice-transcript", { detail: msg }));
      } else if (msg.type === "reply_text") {
        window.dispatchEvent(new CustomEvent("ravin:voice-reply", { detail: msg }));
      } else if (msg.type === "error") console.error("[Hermes voice]", msg.message);
    };
    ws.onerror = err => console.error("[Hermes voice] websocket error", err);
    ws.onclose = () => { stopMic(); ws = null; playbackQueueTime = 0; };
  }

  function disconnect() {
    stopMic();
    try { ws?.close(); } catch {}
    ws = null;
    playbackQueueTime = 0;
  }

  window.addEventListener("ravin:state", event => {
    if (!enabled) return;
    const state = event.detail?.state;
    if (!isConversation()) { disconnect(); return; }
    if (!ws && (state === "listening" || state === "conversation")) connect();
    if (state === "listening") startMic(); else stopMic();
  });

  const toggle = document.getElementById("voiceToggle");
  if (toggle) {
    toggle.setAttribute("aria-checked", String(enabled));
    toggle.classList.toggle("active", enabled);
    toggle.addEventListener("click", () => {
      enabled = !enabled;
      localStorage.setItem(KEY, String(enabled));
      toggle.setAttribute("aria-checked", String(enabled));
      toggle.classList.toggle("active", enabled);
      if (!enabled) disconnect();
      else if (isConversation()) connect();
    });
  }

  window.RavinVoice = { connect, disconnect, isEnabled: () => enabled };
})();
