import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAgent } from "./src/agent/agent.js";
import { buildFeature } from "./src/self/selfBuilder.js";

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

app.use(
  express.static(path.join(__dirname, "public"))
);

app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;

  if (
    !message ||
    typeof message !== "string" ||
    !message.trim()
  ) {
    return res.status(400).json({
      error: "Message can't be empty.",
    });
  }

  try {
    const result = await runAgent(message.trim());

    res.json({
      reply: result.reply,
      steps: result.steps,
    });
  } catch (err) {
    console.error(
      "[RAVIN agent error]",
      err
    );

    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : String(err),
    });
  }
});

app.post("/api/build", async (req, res) => {
  const message = req.body?.message;

  if (
    !message ||
    typeof message !== "string" ||
    !message.trim()
  ) {
    return res.status(400).json({
      error: "Build request can't be empty.",
    });
  }

  try {
    const result = await buildFeature(
      message.trim()
    );

    res.json({
      reply: result.reply,
      steps: result.steps,
    });
  } catch (err) {
    console.error(
      "[RAVIN builder error]",
      err
    );

    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : String(err),
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "RAVIN",
    agent: true,
    builder: true,
  });
});

app.listen(PORT, () => {
  console.log(
    `RAVIN web is up: http://localhost:${PORT}`
  );
});