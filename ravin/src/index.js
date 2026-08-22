import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { runAgent } from "./agent/agent.js";
import { buildFeature } from "./self/selfBuilder.js";

const rl = readline.createInterface({ input: stdin, output: stdout });

function banner() {
  console.log("========================================");
  console.log("  RAVIN — online.");
  console.log("  Agent system: enabled.");
  console.log("");
  console.log("  Normal message:");
  console.log("    Ask RAVIN anything.");
  console.log("");
  console.log("  Builder mode:");
  console.log("    /build <engineering task>");
  console.log("");
  console.log("  Type 'exit' or 'quit' to shut me down.");
  console.log("========================================\n");
}

async function main() {
  banner();
  while (true) {
    const input = (await rl.question("You: ")).trim();
    if (!input) continue;
    if (["exit", "quit"].includes(input.toLowerCase())) {
      console.log("\nRAVIN: Powering down. Try not to break anything while I'm gone, Sir.\n");
      break;
    }
    try {
      if (input.toLowerCase().startsWith("/build ")) {
        const request = input.slice(7).trim();
        if (!request) { console.log("\nRAVIN: Give me an engineering task after /build, Sir.\n"); continue; }
        console.log("\nRAVIN: Entering builder mode...\n");
        const result = await buildFeature(request);
        console.log(`RAVIN: ${result.reply}\n`);
        continue;
      }

      let streamed = false;
      const result = await runAgent(input, {
        onToken: (token) => {
          if (!streamed) { process.stdout.write("\nRAVIN: "); streamed = true; }
          process.stdout.write(token);
        },
      });
      if (streamed) process.stdout.write("\n\n");
      else console.log(`\nRAVIN: ${result.reply}\n`);
    } catch (err) {
      console.log(`\nRAVIN: [error] ${err.message}\n`);
    }
  }
  rl.close();
}

main().catch((err) => {
  console.error("[Fatal RAVIN error]", err);
  rl.close();
  process.exit(1);
});
