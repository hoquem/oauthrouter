/**
 * Google / Gemini Adapter
 *
 * Cleans JSON Schema tool definitions for compatibility with Gemini API.
 * Uses the battle-tested schema cleaner ported from OpenClaw.
 *
 * References:
 * - https://github.com/openclaw/openclaw (clean-for-gemini.ts)
 * - https://github.com/openclaw/openclaw/issues/21172
 * - https://github.com/openclaw/openclaw/issues/20667
 */

import type { OpenAIChatCompletionsRequest } from "./anthropic.js";
import { cleanSchemaForGemini } from "./google-schema-cleaner.js";

/**
 * Clean OpenAI chat completions request for Google/Gemini compatibility.
 * Strips unsupported JSON Schema keywords from tool function parameters,
 * resolves $ref definitions, flattens literal unions, and normalizes types.
 */
export function normalizeGoogleChatCompletionsRequest(
  req: OpenAIChatCompletionsRequest,
): OpenAIChatCompletionsRequest {
  // If no tools, return as-is
  if (!Array.isArray((req as any).tools) || (req as any).tools.length === 0) {
    return req;
  }

  // Use structuredClone for safe deep copy (preserves undefined, faster than JSON round-trip)
  const cleaned = structuredClone(req);

  if (Array.isArray((cleaned as any).tools)) {
    for (const tool of (cleaned as any).tools) {
      if (
        tool &&
        typeof tool === "object" &&
        tool.type === "function" &&
        tool.function &&
        typeof tool.function === "object" &&
        tool.function.parameters &&
        typeof tool.function.parameters === "object"
      ) {
        tool.function.parameters = cleanSchemaForGemini(tool.function.parameters);
      }
    }
  }

  return cleaned;
}
