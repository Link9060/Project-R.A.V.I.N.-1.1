import { streamChatWithOmniRoute, chatWithOmniRoute } from "../omniRouteClient.js";
import { HERMES_SYSTEM_PROMPT } from "./hermesPrompt.js";

const HERMES_MAX_TOKENS = 220;
const HERMES_MODEL = process.env.HERMES_MODEL || process.env.OMNIROUTE_FAST_MODEL || "hy3-free";

export async function runHermes(userMessage, { history = [], onToken = null } = {}) {
  const messages = [
    { role: "system", content: HERMES_SYSTEM_PROMPT },
    ...history.slice(-6),
    { role: "user", content: userMessage.trim() },
  ];

  const requestOptions = {
    tools: [],
    temperature: 0.7,
    maxTokens: HERMES_MAX_TOKENS,
    model: HERMES_MODEL,
    reasoning: { effort: "low" },
  };

  const message = onToken
    ? await streamChatWithOmniRoute(messages, requestOptions, onToken)
    : await chatWithOmniRoute(messages, requestOptions);
  const reply = (message.content || "").trim();
  if (!reply) throw new Error("Hermes returned no visible content.");
  return { reply, raw: message };
}
