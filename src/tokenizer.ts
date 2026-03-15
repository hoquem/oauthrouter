/**
 * Accurate token counting using tiktoken.
 *
 * Replaces naive char/4 estimation with BPE tokenization.
 */

import { encoding_for_model } from "tiktoken";
import type { TiktokenModel } from "tiktoken";

// Singleton encoders to avoid re-initialization overhead
const encoderCache = new Map<string, ReturnType<typeof encoding_for_model>>();

/**
 * Get or create a cached tiktoken encoder for the given model.
 */
function getEncoder(model: string): ReturnType<typeof encoding_for_model> | null {
  if (encoderCache.has(model)) {
    return encoderCache.get(model)!;
  }

  try {
    // Map common model names to tiktoken-supported models
    let tiktokenModel: TiktokenModel;
    if (model.includes("gpt-4") || model.includes("opus") || model.includes("sonnet")) {
      tiktokenModel = "gpt-4";
    } else if (model.includes("gpt-3.5") || model.includes("haiku")) {
      tiktokenModel = "gpt-3.5-turbo";
    } else if (model.includes("gemini") || model.includes("deepseek")) {
      // Gemini/DeepSeek use similar tokenization to GPT-4
      tiktokenModel = "gpt-4";
    } else {
      // Default to gpt-4 encoding (most conservative)
      tiktokenModel = "gpt-4";
    }

    const enc = encoding_for_model(tiktokenModel);
    encoderCache.set(model, enc);
    return enc;
  } catch (err) {
    // If tiktoken fails, return null (caller will fall back to char/4)
    console.warn(`[tokenizer] Failed to create encoder for ${model}:`, err);
    return null;
  }
}

/**
 * Count tokens accurately using tiktoken BPE encoding.
 * Falls back to char/4 estimation if tiktoken fails.
 */
export function countTokens(text: string, model: string = "gpt-4"): number {
  if (!text || text.length === 0) return 0;

  const encoder = getEncoder(model);
  if (!encoder) {
    // Fallback to naive estimation
    return Math.ceil(text.length / 4);
  }

  try {
    const tokens = encoder.encode(text);
    return tokens.length;
  } catch (err) {
    console.warn(`[tokenizer] Encoding failed for model ${model}:`, err);
    return Math.ceil(text.length / 4);
  }
}

/**
 * Estimate tokens for a chat messages array (OpenAI format).
 */
export function countChatTokens(
  messages: Array<{ role: string; content: string | unknown }>,
  model: string = "gpt-4",
): number {
  if (!messages || messages.length === 0) return 0;

  let total = 0;

  // Account for message framing overhead (role tags, etc.)
  // OpenAI uses ~4 tokens per message for framing
  total += messages.length * 4;

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += countTokens(msg.content, model);
    } else if (Array.isArray(msg.content)) {
      // Multimodal content (text + images)
      for (const part of msg.content) {
        if (typeof part === "object" && part && "text" in part && typeof part.text === "string") {
          total += countTokens(part.text, model);
        }
        // Images add ~85 tokens per tile (rough estimate)
        if (typeof part === "object" && part && "image_url" in part) {
          total += 85;
        }
      }
    }
  }

  // Add 3 tokens for priming the assistant's response
  total += 3;

  return total;
}

/**
 * Cleanup cached encoders (call on shutdown).
 */
export function shutdownTokenizer(): void {
  for (const enc of encoderCache.values()) {
    try {
      enc.free();
    } catch {
      // ignore
    }
  }
  encoderCache.clear();
}
