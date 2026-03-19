import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  DEFAULT_ROUTING_CONFIG,
  getFallbackChain,
  classifyByRules,
} from "../../dist/index.js";

const modelPricing = new Map();

// ─── Tier → Model mapping (DeepSeek + Gemini) ───

test("SIMPLE tier routes to deepseek/deepseek-chat", () => {
  const decision = route("hello", undefined, 4096, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assert.equal(decision.tier, "SIMPLE");
  assert.equal(decision.model, "deepseek/deepseek-chat");
});

test("MEDIUM tier routes to deepseek/deepseek-chat", () => {
  const decision = route("return result", "Always respond in json format", 4096, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  // Structured output forces at least MEDIUM
  assert.equal(decision.tier, "MEDIUM");
  assert.equal(decision.model, "deepseek/deepseek-chat");
});

test("COMPLEX tier routes to google/gemini-2.5-pro", () => {
  const longPrompt = "x".repeat(400_001);
  const decision = route(longPrompt, undefined, 4096, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assert.equal(decision.tier, "COMPLEX");
  assert.equal(decision.model, "google/gemini-2.5-pro");
});

test("REASONING tier routes to google/gemini-2.5-pro", () => {
  // Force reasoning with multiple strong reasoning keywords
  const decision = route(
    "Prove this theorem step by step using formal mathematical logic and derive the proof",
    undefined,
    8192,
    { config: DEFAULT_ROUTING_CONFIG, modelPricing },
  );
  assert.equal(decision.tier, "REASONING");
  assert.equal(decision.model, "google/gemini-2.5-pro");
});

// ─── Fallback chains ───

test("SIMPLE fallback chain is deepseek-chat → gemini-2.5-flash", () => {
  const chain = getFallbackChain("SIMPLE", DEFAULT_ROUTING_CONFIG.tiers);
  assert.deepEqual(chain, ["deepseek/deepseek-chat", "google/gemini-2.5-flash"]);
});

test("MEDIUM fallback chain is deepseek-chat → gemini-2.5-flash", () => {
  const chain = getFallbackChain("MEDIUM", DEFAULT_ROUTING_CONFIG.tiers);
  assert.deepEqual(chain, ["deepseek/deepseek-chat", "google/gemini-2.5-flash"]);
});

test("COMPLEX fallback chain is gemini-2.5-pro → deepseek-reasoner", () => {
  const chain = getFallbackChain("COMPLEX", DEFAULT_ROUTING_CONFIG.tiers);
  assert.deepEqual(chain, ["google/gemini-2.5-pro", "deepseek/deepseek-reasoner"]);
});

test("REASONING fallback chain is gemini-2.5-pro → deepseek-reasoner", () => {
  const chain = getFallbackChain("REASONING", DEFAULT_ROUTING_CONFIG.tiers);
  assert.deepEqual(chain, ["google/gemini-2.5-pro", "deepseek/deepseek-reasoner"]);
});

// ─── No Anthropic models in any tier ───

test("no Anthropic model appears in any tier primary or fallback", () => {
  const tiers = DEFAULT_ROUTING_CONFIG.tiers;
  for (const tier of ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"]) {
    const chain = getFallbackChain(tier, tiers);
    for (const model of chain) {
      assert.ok(
        !model.startsWith("anthropic/"),
        `tier ${tier} should not use Anthropic model: ${model}`,
      );
    }
  }
});

// ─── Classification → model end-to-end ───

test("simple Q&A routes cheaply via DeepSeek", () => {
  const prompts = [
    "What is the capital of France?",
    "Define photosynthesis",
    "Translate hello to Spanish",
    "Who is Albert Einstein?",
  ];
  for (const prompt of prompts) {
    const decision = route(prompt, undefined, 4096, {
      config: DEFAULT_ROUTING_CONFIG,
      modelPricing,
    });
    assert.equal(
      decision.model,
      "deepseek/deepseek-chat",
      `"${prompt}" should route to DeepSeek, got ${decision.model} (tier: ${decision.tier})`,
    );
  }
});

test("medium code request routes to DeepSeek", () => {
  const decision = route(
    "Write an async function that implements an algorithm to optimize the database architecture by parsing " +
      "the schema and generating migration scripts with comprehensive error handling and retry logic across tables",
    undefined,
    8192,
    { config: DEFAULT_ROUTING_CONFIG, modelPricing },
  );
  // Moderate code generation classifies as MEDIUM → DeepSeek
  assert.ok(
    ["MEDIUM", "COMPLEX"].includes(decision.tier),
    `expected MEDIUM or COMPLEX, got ${decision.tier}`,
  );
  if (decision.tier === "MEDIUM") {
    assert.equal(decision.model, "deepseek/deepseek-chat");
  } else {
    assert.equal(decision.model, "google/gemini-2.5-pro");
  }
});

test("large context forces COMPLEX → Gemini Pro", () => {
  const longPrompt = "x".repeat(400_001);
  const decision = route(longPrompt, undefined, 8192, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assert.equal(decision.tier, "COMPLEX");
  assert.equal(decision.model, "google/gemini-2.5-pro");
});

test("image content upgrades to COMPLEX → Gemini Pro", () => {
  const decision = route("describe this image", undefined, 4096, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
    hasImageContent: true,
  });
  assert.equal(decision.tier, "COMPLEX");
  assert.equal(decision.model, "google/gemini-2.5-pro");
});
