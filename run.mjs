import { startProxy } from "./dist/index.js";
import { readFile } from "node:fs/promises";

async function main() {
  try {
    const configRaw = await readFile("./config.local.json", "utf8");
    const config = JSON.parse(configRaw);
    console.log("Starting proxy with config:", config);
    await startProxy(config);
    console.log(`Proxy listening on port ${config.port || 8099}`);
  } catch (err) {
    console.error("Failed to start proxy:", err);
    process.exit(1);
  }
}

main();
