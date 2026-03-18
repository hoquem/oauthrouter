/**
 * Google Gemini adapter
 *
 * Google exposes an OpenAI-compatible endpoint at
 * `generativelanguage.googleapis.com/v1beta/openai`. The main job here is to
 * strip the `google/` prefix from router model IDs and normalise any fields
 * that the Gemini OpenAI-compat layer does not accept.
 */

import type { OpenAIChatCompletionsRequest } from "./anthropic.js";

export function toGoogleModelId(routerModelId: string): string {
  if (routerModelId.startsWith("google/")) return routerModelId.slice("google/".length);
  return routerModelId;
}

export function normalizeGoogleChatCompletionsRequest(
  req: OpenAIChatCompletionsRequest,
): OpenAIChatCompletionsRequest {
  const model = typeof req.model === "string" ? req.model.trim() : "";
  if (!model) return req;

  // Clone to avoid mutating the caller's object.
  const out: OpenAIChatCompletionsRequest = {
    ...req,
    model: toGoogleModelId(model),
  };

  return out;
}
