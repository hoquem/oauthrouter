#!/usr/bin/env node
/**
 * Start OAuthRouter using config.local.json
 */

import { readFileSync } from "fs";
import { startProxy } from "./dist/index.js";

const config = JSON.parse(readFileSync("config.local.json", "utf8"));

console.log("Starting OAuthRouter with config.local.json...");
console.log(`Port: ${config.port}`);
console.log(`Providers: ${Object.keys(config.providers || {}).join(", ")}`);
console.log(`Rate limit fallback: ${config.rateLimitFallback?.enabled ? "enabled" : "disabled"}`);

const handle = await startProxy(config);

console.log(`\n✅ OAuthRouter ready at http://127.0.0.1:${config.port}`);
console.log(
  `📊 Dashboard: http://127.0.0.1:${config.port}/debug/dashboard?token=${config.authToken}`,
);
