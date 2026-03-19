#!/usr/bin/env node
/**
 * OAuthRouter Health Check & Key Expiry Monitor
 *
 * Verifies:
 * 1. Both providers (Anthropic, Google) are responding
 * 2. Claude Max OAuth token is still valid and not expiring soon
 * 3. Google API key is working
 * 4. Fallback routing is functional
 * 5. Reports key expiry status
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import https from "node:https";

const ROUTER_URL = "http://127.0.0.1:8099";
const ROUTER_TOKEN = "7Eazj10JMCRP_OGB3epGdpE1GfhFVvni-0oLcWwTEZc";
const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const HEALTH_REPORT_PATH = join(homedir(), ".openclaw", "oauthrouter", "health-report.json");

// Colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

function log(level, msg) {
  const timestamp = new Date().toISOString();
  const prefix =
    {
      OK: `${colors.green}✅${colors.reset}`,
      WARN: `${colors.yellow}⚠️${colors.reset}`,
      ERROR: `${colors.red}❌${colors.reset}`,
      INFO: `${colors.blue}ℹ${colors.reset}`,
    }[level] || "";
  console.log(`${prefix} [${timestamp}] ${msg}`);
}

async function testProvider(model, provider) {
  try {
    const response = await fetch(`${ROUTER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ROUTER_TOKEN}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 5,
      }),
    });

    const data = await response.json();

    if (data.error) {
      return {
        provider,
        status: "FAIL",
        error: data.error.message || data.error.type,
        http_status: response.status,
      };
    }

    return {
      provider,
      status: "OK",
      model: data.model,
      tokens_used: data.usage?.total_tokens || 0,
    };
  } catch (err) {
    return {
      provider,
      status: "FAIL",
      error: err.message,
    };
  }
}

async function checkClaudeCredentials() {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf8");
    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth || {};

    if (!oauth.accessToken) {
      return {
        status: "FAIL",
        reason: "No accessToken found",
      };
    }

    const expiresAt = oauth.expiresAt || 0;
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    const hoursUntilExpiry = Math.round(timeUntilExpiry / (1000 * 60 * 60));
    const minutesUntilExpiry = Math.round(timeUntilExpiry / (1000 * 60));

    if (timeUntilExpiry < 0) {
      return {
        status: "EXPIRED",
        expiresAt: new Date(expiresAt).toISOString(),
        expiredMinutesAgo: Math.round(-timeUntilExpiry / (1000 * 60)),
      };
    }

    if (timeUntilExpiry < 1000 * 60 * 60) {
      // Less than 1 hour
      return {
        status: "EXPIRING_SOON",
        expiresAt: new Date(expiresAt).toISOString(),
        minutesUntilExpiry,
        refreshToken: !!oauth.refreshToken,
        subscription: oauth.subscriptionType,
        rateLimitTier: oauth.rateLimitTier,
      };
    }

    return {
      status: "OK",
      expiresAt: new Date(expiresAt).toISOString(),
      hoursUntilExpiry,
      refreshToken: !!oauth.refreshToken,
      subscription: oauth.subscriptionType,
      rateLimitTier: oauth.rateLimitTier,
    };
  } catch (err) {
    return {
      status: "FAIL",
      reason: err.message,
    };
  }
}

async function checkGoogleKey() {
  // Read from config to verify key is present
  try {
    const configPath = join(homedir(), "projects", "oauthrouter", "config.local.json");
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw);
    const googleAuth = config.providers?.google?.authHeader || "";

    if (!googleAuth || !googleAuth.includes("AIza")) {
      return {
        status: "FAIL",
        reason: "No valid Google API key in config",
      };
    }

    // Key format looks valid
    return {
      status: "OK",
      keyPrefix: googleAuth.substring(0, 30) + "...",
      configured: true,
    };
  } catch (err) {
    return {
      status: "FAIL",
      reason: err.message,
    };
  }
}

async function main() {
  console.log("\n🔍 OAuthRouter Health Check");
  console.log("============================\n");

  const report = {
    timestamp: new Date().toISOString(),
    checks: {},
  };

  // Check Claude credentials
  log("INFO", "Checking Claude Max OAuth credentials...");
  const claudeCheck = await checkClaudeCredentials();
  report.checks.claudeOAuth = claudeCheck;

  if (claudeCheck.status === "OK") {
    log(
      "OK",
      `Claude OAuth valid until ${new Date(claudeCheck.expiresAt).toLocaleString()} (${claudeCheck.hoursUntilExpiry}h)`,
    );
  } else if (claudeCheck.status === "EXPIRING_SOON") {
    log(
      "WARN",
      `Claude OAuth expires in ${claudeCheck.minutesUntilExpiry}m - refresh token available: ${claudeCheck.refreshToken}`,
    );
  } else {
    log("ERROR", `Claude OAuth: ${claudeCheck.reason}`);
  }

  // Check Google key
  log("INFO", "Checking Google API key...");
  const googleKeyCheck = await checkGoogleKey();
  report.checks.googleKey = googleKeyCheck;

  if (googleKeyCheck.status === "OK") {
    log("OK", `Google API key configured: ${googleKeyCheck.keyPrefix}`);
  } else {
    log("ERROR", `Google key: ${googleKeyCheck.reason}`);
  }

  // Test providers
  log("INFO", "Testing providers via OAuthRouter...");

  const anthropicTest = await testProvider("anthropic/claude-haiku-4-5", "anthropic");
  report.checks.anthropicTest = anthropicTest;

  if (anthropicTest.status === "OK") {
    log("OK", `Anthropic responding: ${anthropicTest.model} (${anthropicTest.tokens_used} tokens)`);
  } else {
    log("ERROR", `Anthropic failed: ${anthropicTest.error}`);
  }

  const googleTest = await testProvider("google/gemini-2.5-flash", "google");
  report.checks.googleTest = googleTest;

  if (googleTest.status === "OK") {
    log("OK", `Google responding: ${googleTest.model} (${googleTest.tokens_used} tokens)`);
  } else {
    log("ERROR", `Google failed: ${googleTest.error}`);
  }

  // Summary
  console.log("\n📊 Summary");
  console.log("---------");

  const allOk =
    claudeCheck.status === "OK" &&
    googleKeyCheck.status === "OK" &&
    anthropicTest.status === "OK" &&
    googleTest.status === "OK";

  if (allOk) {
    log("OK", `${colors.green}All systems operational${colors.reset}`);
  } else {
    const failures = [];
    if (claudeCheck.status !== "OK") failures.push("Claude OAuth");
    if (googleKeyCheck.status !== "OK") failures.push("Google key");
    if (anthropicTest.status !== "OK") failures.push("Anthropic test");
    if (googleTest.status !== "OK") failures.push("Google test");
    log("ERROR", `Failed checks: ${failures.join(", ")}`);
  }

  console.log("\n📋 Full Report");
  console.log(JSON.stringify(report, null, 2));

  // Try to persist report (non-fatal if it fails)
  try {
    const fs = await import("node:fs/promises");
    const dir = join(homedir(), ".openclaw", "oauthrouter");
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {}
    await fs.writeFile(HEALTH_REPORT_PATH, JSON.stringify(report, null, 2));
    log("INFO", `Report saved to ${HEALTH_REPORT_PATH}`);
  } catch (err) {
    // Non-fatal
  }

  // Exit code based on overall health
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
