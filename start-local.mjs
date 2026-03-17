import { startProxy } from "./dist/index.js";
import { readFileSync } from "fs";

const config = JSON.parse(readFileSync("./config.local.json", "utf8"));
const handle = await startProxy(config);
console.log(`Proxy listening on port ${config.port}`);
