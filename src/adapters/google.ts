/**
 * Google Generative AI (Gemini) adapter
 *
 * Translates OpenAI-style /v1/chat/completions request bodies into Google
 * Generative AI generateContent request bodies, and maps responses back
 * into OpenAI-compatible chat.completion JSON.
 *
 * Supports:
 * - Text, image (base64 + URL), tool/function calling
 * - Streaming via streamGenerateContent?alt=sse
 * - System instruction extraction
 */

import type { OpenAIChatCompletionsRequest } from "./anthropic.js";

// ── Google request types ────────────────────────────────────────────

export type GooglePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: unknown } };

export type GoogleContent = {
  role: "user" | "model";
  parts: GooglePart[];
};

export type GoogleFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type GoogleToolConfig = {
  functionCallingConfig?: {
    mode: "AUTO" | "NONE" | "ANY";
    allowedFunctionNames?: string[];
  };
};

export type GoogleGenerateContentRequest = {
  contents: GoogleContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  };
  tools?: Array<{ functionDeclarations: GoogleFunctionDeclaration[] }>;
  toolConfig?: GoogleToolConfig;
};

export type GoogleGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: GooglePart[]; role?: string };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

// ── Helpers ─────────────────────────────────────────────────────────

function coerceStringContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (!p || typeof p !== "object") continue;
      const type = (p as { type?: unknown }).type;
      if (type === "text" || type === "input_text" || type === "output_text") {
        const text = (p as { text?: unknown }).text;
        if (typeof text === "string") parts.push(text);
      }
    }
    if (parts.length > 0) return parts.join("");
  }
  return "";
}

// ── Model ID normalization ──────────────────────────────────────────

/** Strip the `google/` router prefix to get the bare model name for the API URL. */
export function toGoogleModelId(routerModelId: string): string {
  if (routerModelId.startsWith("google/")) return routerModelId.slice("google/".length);
  return routerModelId;
}

// ── Request translation (OpenAI → Google) ───────────────────────────

export function buildGoogleGenerateContentRequest(
  req: OpenAIChatCompletionsRequest,
): GoogleGenerateContentRequest {
  const model = typeof req.model === "string" ? req.model.trim() : "";
  if (!model) throw new Error("Missing required field: model");

  const openAiMessages = Array.isArray(req.messages) ? req.messages : [];
  const systemParts: string[] = [];
  const contents: GoogleContent[] = [];

  for (const m of openAiMessages) {
    if (!m || typeof m !== "object") continue;
    const role = typeof m.role === "string" ? m.role : "";
    const text = coerceStringContent(m.content);

    // System messages → systemInstruction
    if (role === "system") {
      if (text) systemParts.push(text);
      continue;
    }

    // Tool result messages → functionResponse part
    if (role === "tool") {
      const toolCallId = typeof (m as any).tool_call_id === "string" ? (m as any).tool_call_id : "";
      // Google functionResponse expects { name, response }. We use the tool_call_id as a
      // fallback name since OpenAI tool messages carry the tool_call_id, not the function name.
      // The name field is populated from the tool_call_id; callers should include it.
      const name = typeof (m as any).name === "string" ? (m as any).name : toolCallId;
      let responseObj: unknown;
      try {
        responseObj = JSON.parse(text);
      } catch {
        responseObj = { result: text };
      }
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name, response: responseObj } }],
      });
      continue;
    }

    // Assistant messages → model role
    if (role === "assistant") {
      const parts: GooglePart[] = [];
      if (text) {
        parts.push({ text });
      }
      // Convert OpenAI tool_calls → Google functionCall parts
      const toolCalls = Array.isArray((m as any).tool_calls) ? (m as any).tool_calls : [];
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== "object") continue;
        const fn = tc.function;
        if (!fn || typeof fn !== "object") continue;
        let parsedArgs: Record<string, unknown> = {};
        if (typeof fn.arguments === "string") {
          try {
            parsedArgs = JSON.parse(fn.arguments);
          } catch {
            parsedArgs = {};
          }
        }
        parts.push({
          functionCall: {
            name: typeof fn.name === "string" ? fn.name : "",
            args: parsedArgs,
          },
        });
      }
      if (parts.length === 0) {
        parts.push({ text: "..." });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    // User messages
    if (role === "user") {
      const parts: GooglePart[] = [];
      if (Array.isArray(m.content)) {
        for (const part of m.content as any[]) {
          if (!part || typeof part !== "object") continue;
          if (
            (part.type === "text" || part.type === "input_text" || part.type === "output_text") &&
            typeof part.text === "string"
          ) {
            parts.push({ text: part.text });
          } else if (part.type === "image_url" && part.image_url) {
            const url = typeof part.image_url === "string" ? part.image_url : part.image_url.url;
            if (typeof url === "string") {
              const dataMatch = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
              if (dataMatch) {
                parts.push({ inlineData: { mimeType: dataMatch[1], data: dataMatch[2] } });
              } else {
                // Attempt to infer mime type from URL extension
                const extMatch = url.match(/\.(png|jpe?g|gif|webp|bmp)(\?|$)/i);
                const mimeType = extMatch
                  ? `image/${extMatch[1].toLowerCase().replace("jpg", "jpeg")}`
                  : "image/png";
                parts.push({ fileData: { mimeType, fileUri: url } });
              }
            }
          }
        }
      }
      // Add text content if not already added via content blocks
      const hasTextPart = parts.some((p) => "text" in p);
      if (text && !hasTextPart) {
        parts.push({ text });
      }
      if (parts.length === 0) {
        parts.push({ text: "(empty message)" });
      }
      contents.push({ role: "user", parts });
      continue;
    }

    // Unknown roles ignored.
  }

  const out: GoogleGenerateContentRequest = { contents };

  // System instruction
  const system = systemParts.join("\n\n");
  if (system) {
    out.systemInstruction = { parts: [{ text: system }] };
  }

  // Generation config
  const genConfig: NonNullable<GoogleGenerateContentRequest["generationConfig"]> = {};
  let hasGenConfig = false;

  const maxTokens =
    typeof req.max_tokens === "number" && Number.isFinite(req.max_tokens)
      ? Math.max(1, Math.floor(req.max_tokens))
      : undefined;
  if (maxTokens !== undefined) {
    genConfig.maxOutputTokens = maxTokens;
    hasGenConfig = true;
  }

  if (typeof req.temperature === "number") {
    genConfig.temperature = req.temperature;
    hasGenConfig = true;
  }

  if (typeof req.top_p === "number") {
    genConfig.topP = req.top_p;
    hasGenConfig = true;
  }

  const stopSequences: string[] | undefined =
    typeof req.stop === "string"
      ? [req.stop]
      : Array.isArray(req.stop)
        ? req.stop.filter((s): s is string => typeof s === "string")
        : undefined;
  if (stopSequences && stopSequences.length > 0) {
    genConfig.stopSequences = stopSequences;
    hasGenConfig = true;
  }

  if (hasGenConfig) {
    out.generationConfig = genConfig;
  }

  // Tools → functionDeclarations
  if (Array.isArray(req.tools) && req.tools.length > 0) {
    const toolChoice = req.tool_choice;

    if (toolChoice !== "none") {
      const declarations: GoogleFunctionDeclaration[] = req.tools
        .filter((t) => t && t.type === "function" && t.function)
        .map((t) => ({
          name: t.function.name,
          ...(t.function.description ? { description: t.function.description } : {}),
          ...(t.function.parameters ? { parameters: t.function.parameters } : {}),
        }));

      if (declarations.length > 0) {
        out.tools = [{ functionDeclarations: declarations }];
      }

      // Tool choice → toolConfig
      if (typeof toolChoice === "string") {
        if (toolChoice === "required") {
          out.toolConfig = { functionCallingConfig: { mode: "ANY" } };
        } else if (toolChoice === "auto") {
          out.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
        }
      } else if (toolChoice && typeof toolChoice === "object" && toolChoice.type === "function") {
        out.toolConfig = {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [toolChoice.function.name],
          },
        };
      }
    } else {
      // tool_choice === "none": send toolConfig with NONE mode, no tools
      out.toolConfig = { functionCallingConfig: { mode: "NONE" } };
    }
  }

  return out;
}

// ── Response translation (Google → OpenAI) ──────────────────────────

function googleFinishReasonToOpenAi(
  reason: string | undefined,
): "stop" | "length" | "content_filter" | "tool_calls" | null {
  if (!reason) return null;
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    case "TOOL_CALL":
      return "tool_calls";
    default:
      return "stop";
  }
}

export function googleGenerateContentResponseToOpenAIChatCompletion(
  rsp: GoogleGenerateContentResponse,
  opts: { requestedModel?: string } = {},
): Record<string, unknown> {
  const candidate = rsp.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  // Extract text parts
  const textParts: string[] = [];
  for (const p of parts) {
    if ("text" in p && typeof p.text === "string") {
      textParts.push(p.text);
    }
  }
  const text = textParts.join("");

  // Extract functionCall parts → OpenAI tool_calls
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];
  for (const p of parts) {
    if ("functionCall" in p) {
      const fc = p.functionCall;
      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        type: "function",
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args ?? {}),
        },
      });
    }
  }

  const promptTokens = rsp.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = rsp.usageMetadata?.candidatesTokenCount ?? 0;

  const message: Record<string, unknown> = {
    role: "assistant",
    content: text || null,
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: opts.requestedModel ?? "unknown",
    choices: [
      {
        index: 0,
        message,
        finish_reason: googleFinishReasonToOpenAi(candidate?.finishReason),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}
