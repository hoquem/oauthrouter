import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalModelForProviderTier,
  ANTHROPIC_TO_CODEX_FALLBACK_MODEL_MAP,
  ANTHROPIC_TO_DEEPSEEK_FALLBACK_MODEL_MAP,
  ANTHROPIC_TO_GOOGLE_FALLBACK_MODEL_MAP,
  buildDefaultRateLimitFallbackChain,
} from "../../dist/index.js";

// ─── canonicalModelForProviderTier ───

test("returns Anthropic model for SIMPLE tier", () => {
  const model = canonicalModelForProviderTier("anthropic", "SIMPLE");
  assert.ok(model, "should return a model");
  assert.ok(model.includes("claude"), "should be a Claude model");
});

test("returns Codex model for MEDIUM tier", () => {
  const model = canonicalModelForProviderTier("openai-codex", "MEDIUM");
  assert.ok(model, "should return a model");
});

test("returns Google model for SIMPLE tier", () => {
  const model = canonicalModelForProviderTier("google", "SIMPLE");
  assert.ok(model, "should return a model");
  assert.ok(model.includes("gemini"), "should be a Gemini model");
});

test("returns null for unknown provider", () => {
  const model = canonicalModelForProviderTier("unknown-provider", "SIMPLE");
  assert.equal(model, null);
});

// ─── Fallback model maps ───

test("Anthropic to Codex fallback map has entries", () => {
  assert.ok(Object.keys(ANTHROPIC_TO_CODEX_FALLBACK_MODEL_MAP).length > 0);
});

test("Anthropic to DeepSeek fallback map has entries", () => {
  assert.ok(Object.keys(ANTHROPIC_TO_DEEPSEEK_FALLBACK_MODEL_MAP).length > 0);
});

test("Anthropic to Google fallback map has entries", () => {
  assert.ok(Object.keys(ANTHROPIC_TO_GOOGLE_FALLBACK_MODEL_MAP).length > 0);
});

test("Anthropic to Google fallback map maps Opus to Gemini Pro", () => {
  const target = ANTHROPIC_TO_GOOGLE_FALLBACK_MODEL_MAP["anthropic/claude-opus-4-6"];
  assert.ok(target, "should have a mapping for opus-4-6");
  assert.ok(target.includes("gemini") && target.includes("pro"), "should map to Gemini Pro");
});

test("Anthropic to Google fallback map maps Haiku to Gemini Flash", () => {
  const target = ANTHROPIC_TO_GOOGLE_FALLBACK_MODEL_MAP["anthropic/claude-haiku-4-5"];
  assert.ok(target, "should have a mapping for haiku-4-5");
  assert.ok(target.includes("gemini") && target.includes("flash"), "should map to Gemini Flash");
});

// ─── buildDefaultRateLimitFallbackChain ───

test("builds chain with DeepSeek and Google when available", () => {
  const chain = buildDefaultRateLimitFallbackChain(true, true);
  assert.ok(chain.length > 0);
  const providers = chain.map((c) => c.provider);
  assert.ok(providers.includes("openai-codex"));
  assert.ok(providers.includes("deepseek"));
  assert.ok(providers.includes("google"));
});

test("builds chain without DeepSeek", () => {
  const chain = buildDefaultRateLimitFallbackChain(false, false);
  const providers = chain.map((c) => c.provider);
  assert.ok(!providers.includes("deepseek"));
  assert.ok(!providers.includes("google"));
});

test("builds chain with Google only", () => {
  const chain = buildDefaultRateLimitFallbackChain(false, true);
  const providers = chain.map((c) => c.provider);
  assert.ok(providers.includes("google"), "should include google");
  assert.ok(providers.includes("openai-codex"), "should always include codex");
  assert.ok(!providers.includes("deepseek"), "should not include deepseek");
});

test("Google appears before Codex in fallback chain", () => {
  const chain = buildDefaultRateLimitFallbackChain(false, true);
  const googleIdx = chain.findIndex((c) => c.provider === "google");
  const codexIdx = chain.findIndex((c) => c.provider === "openai-codex");
  assert.ok(googleIdx < codexIdx, "google should be tried before codex");
});
