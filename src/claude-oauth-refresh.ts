/**
 * Claude Max OAuth token auto-refresh.
 *
 * Reads the access token from ~/.claude/.credentials.json (maintained by Claude Code)
 * and refreshes it using the stored refresh token when it expires.
 *
 * This allows oauthrouter to use Claude Max OAuth tokens without manual config updates.
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/** Buffer before expiry to trigger refresh (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

let cachedToken: string | null = null;
let cachedExpiresAt = 0;

/**
 * Get a valid Claude Max OAuth access token.
 *
 * Reads from ~/.claude/.credentials.json, refreshes if expired, and caches in memory.
 * Returns null if no credentials are available.
 */
export async function getClaudeOAuthToken(): Promise<string | null> {
  // Return cached token if still valid.
  if (cachedToken && Date.now() < cachedExpiresAt - REFRESH_BUFFER_MS) {
    return cachedToken;
  }

  let creds: ClaudeCredentials;
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf8");
    creds = JSON.parse(raw) as ClaudeCredentials;
  } catch {
    return null;
  }

  const oauth = creds.claudeAiOauth;
  if (!oauth?.accessToken || !oauth?.refreshToken) return null;

  // Token still valid — use it directly.
  if (Date.now() < oauth.expiresAt - REFRESH_BUFFER_MS) {
    cachedToken = oauth.accessToken;
    cachedExpiresAt = oauth.expiresAt;
    return cachedToken;
  }

  // Token expired or about to expire — refresh it.
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: oauth.refreshToken,
      }),
    });

    if (!response.ok) {
      console.error(
        `[claude-oauth] refresh failed: ${response.status} ${await response.text().catch(() => "")}`,
      );
      // If refresh fails but token hasn't hard-expired, use the old one.
      if (oauth.accessToken) {
        cachedToken = oauth.accessToken;
        cachedExpiresAt = oauth.expiresAt;
        return cachedToken;
      }
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const newExpiresAt = Date.now() + data.expires_in * 1000 - REFRESH_BUFFER_MS;

    // Update in-memory cache.
    cachedToken = data.access_token;
    cachedExpiresAt = newExpiresAt;

    // Persist back to credentials file so Claude Code stays in sync.
    try {
      const freshRaw = await readFile(CREDENTIALS_PATH, "utf8");
      const freshCreds = JSON.parse(freshRaw) as ClaudeCredentials;
      if (freshCreds.claudeAiOauth) {
        freshCreds.claudeAiOauth.accessToken = data.access_token;
        freshCreds.claudeAiOauth.refreshToken = data.refresh_token;
        freshCreds.claudeAiOauth.expiresAt = newExpiresAt;
        await writeFile(CREDENTIALS_PATH, JSON.stringify(freshCreds, null, 2) + "\n");
      }
    } catch {
      // Non-fatal: credentials file write failed, but in-memory token is valid.
    }

    console.log(`[claude-oauth] token refreshed, expires in ${Math.round(data.expires_in / 60)}m`);
    return cachedToken;
  } catch (err) {
    console.error(`[claude-oauth] refresh error: ${err instanceof Error ? err.message : err}`);
    // Fall back to existing token if available.
    if (oauth.accessToken) {
      cachedToken = oauth.accessToken;
      cachedExpiresAt = oauth.expiresAt;
      return cachedToken;
    }
    return null;
  }
}

/**
 * Check if a config authHeader value indicates Claude OAuth auto-refresh should be used.
 * Convention: use the literal string "claude-oauth-auto" as the authHeader value.
 */
export function isClaudeOAuthAutoRefresh(authHeader: unknown): boolean {
  return authHeader === "claude-oauth-auto";
}
