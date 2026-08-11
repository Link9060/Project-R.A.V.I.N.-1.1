import { RAVIN_SYSTEM_PROMPT } from "./systemPrompt.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Sends a single user message to Groq's chat completion API and returns
 * RAVIN's reply as a string.
 *
 * Phase 1 is stateless: only the system prompt + the current user message
 * are sent. Conversation memory comes in a later phase.
 */
export async function askRavin(userMessage) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  if (!apiKey) {
    throw new Error(
      "Missing GROQ_API_KEY. Copy .env.example to .env and add your Groq API key."
    );
  }

  let response;
  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: RAVIN_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.8,
      }),
    });
  } catch (networkErr) {
    throw new Error(
      `Couldn't reach Groq's servers. Check your internet connection. (${networkErr.message})`
    );
  }

  if (!response.ok) {
    let details = "";
    try {
      const errBody = await response.json();
      details = errBody?.error?.message || JSON.stringify(errBody);
    } catch {
      details = await response.text();
    }

    if (response.status === 401) {
      throw new Error("Groq rejected the API key (401). Double-check GROQ_API_KEY in .env.");
    }
    if (response.status === 429) {
      throw new Error("Hit Groq's rate limit (429). Wait a moment and try again.");
    }
    throw new Error(`Groq API error (${response.status}): ${details}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content;

  if (!reply) {
    throw new Error("Groq returned an empty or unexpected response.");
  }

  return reply.trim();
}
