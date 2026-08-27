const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export async function synthesizeSpeech(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY in .env.");
  if (!voiceId) throw new Error("Missing ELEVENLABS_VOICE_ID in .env.");

  const response = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey, Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5",
      output_format: process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128",
      voice_settings: { stability: 0.45, similarity_boost: 0.8 },
    }),
  });

  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${details}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.length) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export function createSentenceChunker(onSentence) {
  let buffer = "";
  return {
    push(token) {
      buffer += token;
      const matches = buffer.match(/[^.!?]+[.!?]+[\s]?/g);
      if (!matches) return;
      let consumed = 0;
      for (const match of matches) {
        if (consumed + match.length < buffer.length) {
          onSentence(match.trim());
          consumed += match.length;
        }
      }
      buffer = buffer.slice(consumed);
    },
    flush() {
      const rest = buffer.trim();
      buffer = "";
      if (rest) onSentence(rest);
    },
  };
}
