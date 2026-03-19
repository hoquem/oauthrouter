#!/usr/bin/env node
/**
 * QA Test Suite for OAuthRouter
 * Tests Anthropic → Google fallback configuration
 */

import { readFileSync } from "fs";

const config = JSON.parse(readFileSync("config.local.json", "utf8"));
const BASE_URL = `http://127.0.0.1:${config.port}`;
const AUTH_TOKEN = config.authToken;

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

let passed = 0;
let failed = 0;
const failures = [];

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function assert(condition, testName, expected, actual) {
  if (condition) {
    passed++;
    log(`✓ ${testName}`, colors.green);
  } else {
    failed++;
    const msg = `✗ ${testName}\n  Expected: ${JSON.stringify(expected)}\n  Actual: ${JSON.stringify(actual)}`;
    log(msg, colors.red);
    failures.push(testName);
  }
}

async function testConfigValidation() {
  log("\n" + colors.bold + "=== Config Validation ===" + colors.reset);

  // Test 1: Only Anthropic and Google providers
  const providers = Object.keys(config.providers || {});
  assert(
    providers.length === 2 && providers.includes("anthropic") && providers.includes("google"),
    "Config has exactly 2 providers (anthropic, google)",
    ["anthropic", "google"],
    providers,
  );

  // Test 2: Anthropic API key present
  const anthropicKey = config.providers?.anthropic?.authHeader?.value;
  assert(
    anthropicKey && anthropicKey.startsWith("sk-ant-"),
    "Anthropic API key configured",
    "sk-ant-...",
    anthropicKey?.slice(0, 10),
  );

  // Test 3: Google API key present
  const googleAuth = config.providers?.google?.authHeader;
  const googleKey =
    typeof googleAuth === "string" ? googleAuth.replace(/^Bearer\s+/i, "") : googleAuth?.value;
  assert(
    googleKey && googleKey.startsWith("AIza"),
    "Google API key configured",
    "AIza...",
    googleKey?.slice(0, 10),
  );

  // Test 4: Rate limit fallback enabled
  assert(
    config.rateLimitFallback?.enabled === true,
    "Rate limit fallback enabled",
    true,
    config.rateLimitFallback?.enabled,
  );

  // Test 5: Fallback chain only includes Google
  const fallbackChain = config.rateLimitFallback?.chain || [];
  assert(
    fallbackChain.length === 1 && fallbackChain[0].provider === "google",
    "Fallback chain has only Google",
    [{ provider: "google" }],
    fallbackChain.map((c) => ({ provider: c.provider })),
  );

  // Test 6: fromProviders includes anthropic
  const fromProviders = config.rateLimitFallback?.fromProviders || [];
  assert(
    fromProviders.includes("anthropic"),
    "fromProviders includes anthropic",
    ["anthropic"],
    fromProviders,
  );

  // Test 7: Routing config has correct tier fallbacks
  const tiers = config.routingConfig?.tiers || {};
  const simpleFallback = tiers.SIMPLE?.fallback || [];
  const mediumFallback = tiers.MEDIUM?.fallback || [];
  assert(
    simpleFallback.includes("google/gemini-2.5-flash"),
    "SIMPLE tier fallback includes Google Flash",
    ["google/gemini-2.5-flash"],
    simpleFallback,
  );
  assert(
    mediumFallback.includes("google/gemini-2.5-flash"),
    "MEDIUM tier fallback includes Google Flash",
    ["google/gemini-2.5-flash"],
    mediumFallback,
  );
}

async function testAnthropicProvider() {
  log("\n" + colors.bold + "=== Anthropic Provider Test ===" + colors.reset);

  const req = {
    model: "anthropic/claude-haiku-4-5",
    messages: [{ role: "user", content: "Say 'QA test pass' and nothing else." }],
    max_tokens: 20,
  };

  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(req),
    });

    const data = await res.json();

    assert(res.status === 200, "Anthropic request returns 200", 200, res.status);
    assert(data.choices?.length > 0, "Response has choices", true, data.choices?.length > 0);
    assert(
      typeof data.choices?.[0]?.message?.content === "string",
      "Response has content",
      "string",
      typeof data.choices?.[0]?.message?.content,
    );

    log(`  Response: "${data.choices?.[0]?.message?.content?.slice(0, 50)}"`, colors.cyan);
  } catch (err) {
    failed++;
    log(`✗ Anthropic request failed: ${err.message}`, colors.red);
    failures.push("Anthropic request");
  }
}

async function testGoogleProvider() {
  log("\n" + colors.bold + "=== Google Provider Test ===" + colors.reset);

  const req = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: "Say 'QA test pass' and nothing else." }],
    max_tokens: 20,
  };

  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(req),
    });

    const data = await res.json();

    assert(res.status === 200, "Google request returns 200", 200, res.status);
    assert(data.choices?.length > 0, "Response has choices", true, data.choices?.length > 0);
    assert(
      typeof data.choices?.[0]?.message?.content === "string",
      "Response has content",
      "string",
      typeof data.choices?.[0]?.message?.content,
    );

    log(`  Response: "${data.choices?.[0]?.message?.content?.slice(0, 50)}"`, colors.cyan);
  } catch (err) {
    failed++;
    log(`✗ Google request failed: ${err.message}`, colors.red);
    failures.push("Google request");
  }
}

async function testModelNormalization() {
  log("\n" + colors.bold + "=== Model ID Normalization Test ===" + colors.reset);

  const testCases = [
    { input: "anthropic/claude-sonnet-4-5", provider: "anthropic" },
    { input: "google/gemini-2.5-pro", provider: "google" },
  ];

  for (const tc of testCases) {
    const req = {
      model: tc.input,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    };

    try {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify(req),
      });

      assert(
        res.status === 200 || res.status === 400,
        `Model ${tc.input} is recognized`,
        "200 or 400",
        res.status,
      );
    } catch (err) {
      failed++;
      log(`✗ Model ${tc.input} normalization failed: ${err.message}`, colors.red);
      failures.push(`Model normalization: ${tc.input}`);
    }
  }
}

async function testAutoRouting() {
  log("\n" + colors.bold + "=== Auto-routing Test ===" + colors.reset);

  const testCases = [
    { prompt: "What is 2+2?", expectedTier: "SIMPLE" },
    { prompt: "Write a Python function to sort a list", expectedTier: "MEDIUM" },
  ];

  for (const tc of testCases) {
    const req = {
      model: "oauthrouter/auto",
      messages: [{ role: "user", content: tc.prompt }],
      max_tokens: 50,
    };

    try {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify(req),
      });

      assert(
        res.status === 200,
        `Auto-routing for "${tc.prompt.slice(0, 30)}..." works`,
        200,
        res.status,
      );

      if (res.status === 200) {
        const data = await res.json();
        log(`  Routed to: ${data.model || "unknown"}`, colors.cyan);
      }
    } catch (err) {
      failed++;
      log(`✗ Auto-routing test failed: ${err.message}`, colors.red);
      failures.push(`Auto-routing: ${tc.expectedTier}`);
    }
  }
}

async function testHealthEndpoints() {
  log("\n" + colors.bold + "=== Health Endpoints Test ===" + colors.reset);

  // Test 1: Debug dashboard accessible
  try {
    const res = await fetch(`${BASE_URL}/debug/dashboard?token=${AUTH_TOKEN}`);
    assert(res.status === 200, "Debug dashboard accessible", 200, res.status);
  } catch (err) {
    failed++;
    log(`✗ Debug dashboard failed: ${err.message}`, colors.red);
    failures.push("Debug dashboard");
  }

  // Test 2: Trace endpoint
  try {
    const res = await fetch(`${BASE_URL}/debug/trace?token=${AUTH_TOKEN}`);
    assert(
      res.status === 200 || res.status === 404,
      "Trace endpoint responds",
      "200 or 404",
      res.status,
    );
  } catch (err) {
    failed++;
    log(`✗ Trace endpoint failed: ${err.message}`, colors.red);
    failures.push("Trace endpoint");
  }
}

async function runAllTests() {
  log(colors.bold + "\n🧪 OAuthRouter QA Test Suite" + colors.reset);
  log(colors.yellow + "Testing Anthropic → Google fallback configuration\n" + colors.reset);

  await testConfigValidation();
  await testAnthropicProvider();
  await testGoogleProvider();
  await testModelNormalization();
  await testAutoRouting();
  await testHealthEndpoints();

  log("\n" + colors.bold + "=== Test Summary ===" + colors.reset);
  log(`${colors.green}Passed: ${passed}${colors.reset}`);
  log(`${colors.red}Failed: ${failed}${colors.reset}`);

  if (failed > 0) {
    log("\n" + colors.red + "Failed tests:" + colors.reset);
    failures.forEach((f) => log(`  - ${f}`, colors.red));
    process.exit(1);
  } else {
    log("\n" + colors.green + colors.bold + "✅ All tests passed!" + colors.reset);
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  log(`\n${colors.red}Fatal error: ${err.message}${colors.reset}`);
  console.error(err.stack);
  process.exit(1);
});
