import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { askRavin } from "./groqClient.js";

const rl = readline.createInterface({ input: stdin, output: stdout });

function banner() {
  console.log("========================================");
  console.log("  RAVIN — online.");
  console.log("  Type your message and hit enter.");
  console.log("  Type 'exit' or 'quit' to shut me down.");
  console.log("========================================\n");
}

async function main() {
  banner();

  while (true) {
    const input = (await rl.question("You: ")).trim();

    if (!input) {
      continue; // ignore empty enter presses
    }

    if (["exit", "quit"].includes(input.toLowerCase())) {
      console.log("\nRAVIN: Powering down. Try not to break anything while I'm gone, Levi.");
      break;
    }

    try {
      const reply = await askRavin(input);
      console.log(`\nRAVIN: ${reply}\n`);
    } catch (err) {
      console.log(`\nRAVIN: [error] ${err.message}\n`);
    }
  }

  rl.close();
}

main();
