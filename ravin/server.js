import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askRavin } from "./src/groqClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message can't be empty." });
  }

  try {
    const reply = await askRavin(message.trim());
    res.json({ reply });
  } catch (err) {
    console.error("[RAVIN error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`RAVIN web is up: http://localhost:${PORT}`);
});
