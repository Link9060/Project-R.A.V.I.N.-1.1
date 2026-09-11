import { streamChatWithCloudflare, chatWithCloudflare } from "../cloudflareClient.js";
import { HERMES_SYSTEM_PROMPT } from "./hermesPrompt.js";

const HERMES_MAX_TOKENS = 220;

export async function runHermes(userMessage, { history = [], onToken = null } = {}) {
  const messages = [
    { role: "system", content: HERMES_SYSTEM_PROMPT },
    ...history.slice(-6),
    { role: "user", content: userMessage.trim() },
  ];

  const requestOptions = {
    mode: "conversation",
    tools: [],
    temperature: 0.7,
    maxTokens: HERMES_MAX_TOKENS,
  };

  const message = onToken
    ? await streamChatWithCloudflare(messages, requestOptions, onToken)
    : await chatWithCloudflare(messages, requestOptions);
  const reply = (message.content || "").trim();
  if (!reply) throw new Error("Hermes returned no visible content.");
  return { reply, raw: message };
}
