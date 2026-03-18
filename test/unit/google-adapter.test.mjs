import test from "node:test";
import assert from "node:assert/strict";
import { toGoogleModelId, normalizeGoogleChatCompletionsRequest } from "../../dist/index.js";

// ─── toGoogleModelId ───

test("strips google/ prefix", () => {
  assert.equal(toGoogleModelId("google/gemini-2.5-pro"), "gemini-2.5-pro");
});

test("passes through non-prefixed model", () => {
  assert.equal(toGoogleModelId("gemini-2.5-flash"), "gemini-2.5-flash");
});

// ─── normalizeGoogleChatCompletionsRequest ───

test("normalizes model ID in request", () => {
  const req = {
    model: "google/gemini-2.5-pro",
    messages: [{ role: "user", content: "hello" }],
  };
  const normalized = normalizeGoogleChatCompletionsRequest(req);
  assert.equal(normalized.model, "gemini-2.5-pro");
});

test("preserves other fields", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: "test" }],
    temperature: 0.7,
    max_tokens: 1024,
  };
  const normalized = normalizeGoogleChatCompletionsRequest(req);
  assert.equal(normalized.temperature, 0.7);
  assert.equal(normalized.max_tokens, 1024);
  assert.deepEqual(normalized.messages, req.messages);
});

test("returns request unchanged when model is empty", () => {
  const req = {
    model: "",
    messages: [{ role: "user", content: "test" }],
  };
  const normalized = normalizeGoogleChatCompletionsRequest(req);
  assert.equal(normalized.model, "");
});
