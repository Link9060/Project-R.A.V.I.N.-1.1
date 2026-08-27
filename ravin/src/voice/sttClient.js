import { WebSocket } from "ws";

const ELEVENLABS_STT_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

export function createElevenLabsSttStream({ onTranscript, onUtteranceEnd, onError }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY in .env.");

  const params = new URLSearchParams({
    model_id: process.env.ELEVENLABS_STT_MODEL || "scribe_v2_realtime",
    audio_format: "pcm_16000",
    commit_strategy: "vad",
    vad_silence_threshold_secs: process.env.ELEVENLABS_VAD_SILENCE_SECS || "0.9",
    vad_threshold: process.env.ELEVENLABS_VAD_THRESHOLD || "0.4",
    min_speech_duration_ms: process.env.ELEVENLABS_MIN_SPEECH_MS || "100",
    min_silence_duration_ms: process.env.ELEVENLABS_MIN_SILENCE_MS || "100",
    no_verbatim: "true",
  });

  const socket = new WebSocket(`${ELEVENLABS_STT_URL}?${params.toString()}`, {
    headers: { "xi-api-key": apiKey },
  });

  let ready = false;
  let closed = false;
  const pending = [];

  socket.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (["auth_error", "quota_exceeded", "transcriber_error", "input_error", "invalid_request", "error", "rate_limited", "queue_overflow", "resource_exhausted", "session_time_limit_exceeded", "chunk_size_exceeded", "unaccepted_terms"].includes(msg.message_type)) {
      onError?.(new Error(msg.error || msg.message || msg.message_type));
      return;
    }

    if (msg.message_type === "partial_transcript" || msg.message_type === "final_transcript") {
      const text = String(msg.text || "").trim();
      if (text) onTranscript?.(text, msg.message_type === "final_transcript");
      return;
    }

    if (msg.message_type === "committed_transcript") {
      const text = String(msg.text || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      onTranscript?.(text, true);
      onUtteranceEnd?.(text);
    }
  });

  socket.on("open", () => {
    ready = true;
    for (const chunk of pending.splice(0)) sendChunk(chunk);
  });

  socket.on("error", err => onError?.(err));
  socket.on("close", () => { closed = true; ready = false; });

  function sendChunk(chunk) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    socket.send(JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: buffer.toString("base64"),
      sample_rate: 16000,
    }));
  }

  return {
    sendAudio(chunk) {
      if (closed) return;
      if (ready && socket.readyState === WebSocket.OPEN) sendChunk(chunk);
      else pending.push(Buffer.from(chunk));
    },
    close() {
      if (closed) return;
      try { socket.close(); } catch {}
      closed = true;
    },
  };
}
