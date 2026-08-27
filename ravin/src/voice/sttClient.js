import { WebSocket } from "ws";

const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";

export function createDeepgramStream({ onTranscript, onUtteranceEnd, onError }) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPGRAM_API_KEY in .env.");

  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || "nova-2",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    utterance_end_ms: "1000",
    vad_events: "true",
    smart_format: "true",
    punctuate: "true",
  });

  const socket = new WebSocket(`${DEEPGRAM_URL}?${params.toString()}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  let ready = false;
  let closed = false;
  let finalParts = [];
  let latestInterim = "";
  const pending = [];

  socket.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "UtteranceEnd") {
      const text = finalParts.join(" ").replace(/\s+/g, " ").trim() || latestInterim.trim();
      finalParts = [];
      latestInterim = "";
      if (text) onUtteranceEnd?.(text);
      return;
    }
    const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim();
    if (!transcript) return;
    const isFinal = Boolean(msg.is_final);
    if (isFinal) finalParts.push(transcript);
    else latestInterim = transcript;
    onTranscript?.(transcript, isFinal);
  });

  socket.on("open", () => {
    ready = true;
    for (const chunk of pending.splice(0)) socket.send(chunk);
  });
  socket.on("error", err => onError?.(err));
  socket.on("close", () => { closed = true; ready = false; });

  return {
    sendAudio(chunk) {
      if (closed) return;
      if (ready && socket.readyState === WebSocket.OPEN) socket.send(chunk);
      else pending.push(chunk);
    },
    close() {
      if (closed) return;
      try { if (ready) socket.send(JSON.stringify({ type: "CloseStream" })); } catch {}
      try { socket.close(); } catch {}
      closed = true;
    },
  };
}
