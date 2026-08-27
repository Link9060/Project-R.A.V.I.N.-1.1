import { WebSocketServer } from "ws";
import { createDeepgramStream } from "./sttClient.js";
import { synthesizeSpeech, createSentenceChunker } from "./ttsClient.js";
import { runHermes } from "../agent/hermesAgent.js";

export function attachVoiceServer(httpServer, authenticate) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/voice" });

  wss.on("connection", async (client, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    if (!req.headers.authorization && token) req.headers.authorization = `Bearer ${token}`;

    const auth = authenticate ? await authenticate(req) : { user: { id: "anonymous" } };
    if (!auth) {
      client.send(JSON.stringify({ type: "error", message: "Sign in required for voice mode." }));
      client.close();
      return;
    }

    const history = [];
    let deepgram = null;
    let hermesBusy = false;
    let ttsHadError = false;
    let pendingPlayback = 0;
    let finishTimer = null;

    const send = payload => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(payload));
    };

    const maybeFinish = () => {
      if (hermesBusy || pendingPlayback > 0) return;
      clearTimeout(finishTimer);
      finishTimer = setTimeout(() => {
        send({ type: "state", state: "finished" });
        if (!ttsHadError) setTimeout(() => send({ type: "state", state: "listening" }), 650);
      }, 80);
    };

    async function handleUtterance(transcript) {
      if (!transcript.trim() || hermesBusy) return;
      hermesBusy = true;
      ttsHadError = false;
      pendingPlayback = 0;
      send({ type: "state", state: "thinking" });

      let speechChain = Promise.resolve();
      let speakingStarted = false;
      const queueSentence = sentence => {
        speechChain = speechChain.then(async () => {
          if (!speakingStarted) {
            speakingStarted = true;
            send({ type: "state", state: "speaking" });
          }
          try {
            const audio = await synthesizeSpeech(sentence);
            if (client.readyState === client.OPEN) {
              pendingPlayback += 1;
              client.send(audio);
            }
          } catch (err) {
            ttsHadError = true;
            send({ type: "error", message: `TTS failed: ${err.message}` });
          }
        });
      };

      const chunker = createSentenceChunker(queueSentence);
      try {
        const { reply } = await runHermes(transcript, { history, onToken: token => chunker.push(token) });
        chunker.flush();
        await speechChain;
        history.push({ role: "user", content: transcript });
        history.push({ role: "assistant", content: reply });
        send({ type: "reply_text", text: reply });
      } catch (err) {
        send({ type: "error", message: `Hermes failed: ${err.message}` });
        ttsHadError = true;
      } finally {
        hermesBusy = false;
        if (pendingPlayback === 0) {
          if (ttsHadError) {
            send({ type: "state", state: "finished" });
          } else {
            maybeFinish();
          }
        }
      }
    }

    deepgram = createDeepgramStream({
      onTranscript: (text, isFinal) => send({ type: "transcript", text, isFinal }),
      onUtteranceEnd: text => handleUtterance(text),
      onError: err => send({ type: "error", message: `STT error: ${err.message}` }),
    });

    client.on("message", (data, isBinary) => {
      if (isBinary) {
        deepgram?.sendAudio(data);
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === "playback_finished") {
        pendingPlayback = Math.max(0, pendingPlayback - 1);
        maybeFinish();
      }
    });

    client.on("close", () => {
      clearTimeout(finishTimer);
      deepgram?.close();
    });

    send({ type: "state", state: "listening" });
  });

  return wss;
}
