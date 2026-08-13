/*
 * RAVIN's system prompt now lives exclusively on the backend:
 *
 *   src/systemPrompt.js
 *
 * The browser must never contain RAVIN's private system prompt
 * or the Groq API key.
 *
 * This file is intentionally kept as a no-op compatibility file
 * until the script reference can be removed from public/index.html.
 */