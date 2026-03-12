import test from "node:test";
import assert from "node:assert/strict";

import {
  toGoogleModelId,
  buildGoogleGenerateContentRequest,
  googleGenerateContentResponseToOpenAIChatCompletion,
} from "../../dist/index.js";

// ── Model ID normalization ──────────────────────────────────────────

test("toGoogleModelId strips google/ prefix", () => {
  assert.equal(toGoogleModelId("google/gemini-2.5-flash"), "gemini-2.5-flash");
  assert.equal(toGoogleModelId("google/gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(toGoogleModelId("google/gemini-3-pro-preview"), "gemini-3-pro-preview");
});

test("toGoogleModelId passes through bare model names", () => {
  assert.equal(toGoogleModelId("gemini-2.5-flash"), "gemini-2.5-flash");
});

// ── Basic text request translation ──────────────────────────────────

test("basic text request translation", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: "Hello" }],
    temperature: 0.7,
    max_tokens: 1024,
  };

  const result = buildGoogleGenerateContentRequest(req);

  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0].role, "user");
  assert.deepEqual(result.contents[0].parts, [{ text: "Hello" }]);
  assert.equal(result.generationConfig?.temperature, 0.7);
  assert.equal(result.generationConfig?.maxOutputTokens, 1024);
  assert.equal(result.systemInstruction, undefined);
});

// ── System message handling ─────────────────────────────────────────

test("system messages are extracted to systemInstruction", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hi" },
    ],
  };

  const result = buildGoogleGenerateContentRequest(req);

  assert.ok(result.systemInstruction);
  assert.deepEqual(result.systemInstruction.parts, [{ text: "You are a helpful assistant." }]);
  // System messages should not appear in contents
  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0].role, "user");
});

test("multiple system messages are joined", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: "First instruction." },
      { role: "system", content: "Second instruction." },
      { role: "user", content: "Hi" },
    ],
  };

  const result = buildGoogleGenerateContentRequest(req);

  assert.ok(result.systemInstruction);
  assert.equal(result.systemInstruction.parts[0].text, "First instruction.\n\nSecond instruction.");
});

// ── Role mapping ────────────────────────────────────────────────────

test("assistant role maps to model", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ],
  };

  const result = buildGoogleGenerateContentRequest(req);

  assert.equal(result.contents.length, 3);
  assert.equal(result.contents[0].role, "user");
  assert.equal(result.contents[1].role, "model");
  assert.equal(result.contents[2].role, "user");
});

// ── Tool/function calling translation ───────────────────────────────

test("tools are converted to functionDeclarations", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: "What's the weather?" }],
    tools: [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a location",
          parameters: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
      },
    ],
    tool_choice: "auto",
  };

  const result = buildGoogleGenerateContentRequest(req);

  assert.ok(result.tools);
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].functionDeclarations.length, 1);
  assert.equal(result.tools[0].functionDeclarations[0].name, "get_weather");
  assert.equal(result.tools[0].functionDeclarations[0].description, "Get weather for a location");
  assert.ok(result.toolConfig);
  assert.equal(result.toolConfig.functionCallingConfig?.mode, "AUTO");
});

test("tool_choice required maps to ANY mode", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: "Hi" }],
    tools: [
      {
        type: "function",
        function: { name: "my_tool", parameters: { type: "object" } },
      },
    ],
    tool_choice: "required",
  };

  const result = buildGoogleGenerateContentRequest(req);
  assert.equal(result.toolConfig?.functionCallingConfig?.mode, "ANY");
});

test("tool_choice none results in NONE toolConfig and no tools", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: "Hi" }],
    tools: [
      {
        type: "function",
        function: { name: "my_tool", parameters: { type: "object" } },
      },
    ],
    tool_choice: "none",
  };

  const result = buildGoogleGenerateContentRequest(req);
  assert.equal(result.tools, undefined);
  assert.equal(result.toolConfig?.functionCallingConfig?.mode, "NONE");
});

test("tool_choice with specific function maps to ANY with allowedFunctionNames", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: "Hi" }],
    tools: [
      {
        type: "function",
        function: { name: "my_tool", parameters: { type: "object" } },
      },
    ],
    tool_choice: { type: "function", function: { name: "my_tool" } },
  };

  const result = buildGoogleGenerateContentRequest(req);
  assert.equal(result.toolConfig?.functionCallingConfig?.mode, "ANY");
  assert.deepEqual(result.toolConfig?.functionCallingConfig?.allowedFunctionNames, ["my_tool"]);
});

// ── Assistant tool_calls → functionCall parts ───────────────────────

test("assistant tool_calls are converted to functionCall parts", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "user", content: "What's the weather?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"location":"NYC"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_123",
        name: "get_weather",
        content: '{"temp": 72}',
      },
    ],
  };

  const result = buildGoogleGenerateContentRequest(req);

  assert.equal(result.contents.length, 3);

  // Assistant message with functionCall
  const assistantContent = result.contents[1];
  assert.equal(assistantContent.role, "model");
  const fcPart = assistantContent.parts.find((p) => "functionCall" in p);
  assert.ok(fcPart);
  assert.deepEqual(fcPart.functionCall, { name: "get_weather", args: { location: "NYC" } });

  // Tool result with functionResponse
  const toolContent = result.contents[2];
  assert.equal(toolContent.role, "user");
  const frPart = toolContent.parts.find((p) => "functionResponse" in p);
  assert.ok(frPart);
  assert.equal(frPart.functionResponse.name, "get_weather");
  assert.deepEqual(frPart.functionResponse.response, { temp: 72 });
});

// ── Response mapping: text ──────────────────────────────────────────

test("text response is mapped correctly", () => {
  const googleRsp = {
    candidates: [
      {
        content: { parts: [{ text: "Hello there!" }], role: "model" },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
  };

  const result = googleGenerateContentResponseToOpenAIChatCompletion(googleRsp, {
    requestedModel: "google/gemini-2.5-flash",
  });

  assert.equal(result.object, "chat.completion");
  assert.equal(result.model, "google/gemini-2.5-flash");
  assert.ok(Array.isArray(result.choices));
  assert.equal(result.choices[0].message.content, "Hello there!");
  assert.equal(result.choices[0].message.role, "assistant");
  assert.equal(result.choices[0].finish_reason, "stop");
  assert.equal(result.usage.prompt_tokens, 10);
  assert.equal(result.usage.completion_tokens, 5);
  assert.equal(result.usage.total_tokens, 15);
});

// ── Response mapping: tool calls ────────────────────────────────────

test("functionCall response is mapped to tool_calls", () => {
  const googleRsp = {
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: {
                name: "get_weather",
                args: { location: "NYC" },
              },
            },
          ],
          role: "model",
        },
        finishReason: "TOOL_CALL",
      },
    ],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
  };

  const result = googleGenerateContentResponseToOpenAIChatCompletion(googleRsp);

  assert.equal(result.choices[0].finish_reason, "tool_calls");
  assert.ok(result.choices[0].message.tool_calls);
  assert.equal(result.choices[0].message.tool_calls.length, 1);
  assert.equal(result.choices[0].message.tool_calls[0].type, "function");
  assert.equal(result.choices[0].message.tool_calls[0].function.name, "get_weather");
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"location":"NYC"}');
});

// ── Response mapping: finish reasons ────────────────────────────────

test("finish reason mapping", () => {
  const makeRsp = (finishReason) => ({
    candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason }],
  });

  const stop = googleGenerateContentResponseToOpenAIChatCompletion(makeRsp("STOP"));
  assert.equal(stop.choices[0].finish_reason, "stop");

  const length = googleGenerateContentResponseToOpenAIChatCompletion(makeRsp("MAX_TOKENS"));
  assert.equal(length.choices[0].finish_reason, "length");

  const safety = googleGenerateContentResponseToOpenAIChatCompletion(makeRsp("SAFETY"));
  assert.equal(safety.choices[0].finish_reason, "content_filter");

  const toolCall = googleGenerateContentResponseToOpenAIChatCompletion(makeRsp("TOOL_CALL"));
  assert.equal(toolCall.choices[0].finish_reason, "tool_calls");
});

// ── Image content handling ──────────────────────────────────────────

test("base64 image content is converted to inlineData", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What's in this image?" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
          },
        ],
      },
    ],
  };

  const result = buildGoogleGenerateContentRequest(req);

  assert.equal(result.contents.length, 1);
  const parts = result.contents[0].parts;
  assert.equal(parts.length, 2);

  // Text part
  assert.ok("text" in parts[0]);
  assert.equal(parts[0].text, "What's in this image?");

  // Image part (inlineData for base64)
  assert.ok("inlineData" in parts[1]);
  assert.equal(parts[1].inlineData.mimeType, "image/png");
  assert.equal(parts[1].inlineData.data, "iVBORw0KGgo=");
});

test("URL image content is converted to fileData", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this" },
          {
            type: "image_url",
            image_url: { url: "https://example.com/photo.jpg" },
          },
        ],
      },
    ],
  };

  const result = buildGoogleGenerateContentRequest(req);

  const parts = result.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.ok("fileData" in parts[1]);
  assert.equal(parts[1].fileData.fileUri, "https://example.com/photo.jpg");
  assert.equal(parts[1].fileData.mimeType, "image/jpeg");
});

// ── Generation config ───────────────────────────────────────────────

test("stop sequences, top_p are passed through", () => {
  const req = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: "Hi" }],
    top_p: 0.9,
    stop: ["END", "STOP"],
  };

  const result = buildGoogleGenerateContentRequest(req);

  assert.equal(result.generationConfig?.topP, 0.9);
  assert.deepEqual(result.generationConfig?.stopSequences, ["END", "STOP"]);
});

test("missing model throws", () => {
  assert.throws(
    () => buildGoogleGenerateContentRequest({ messages: [{ role: "user", content: "hi" }] }),
    /Missing required field: model/,
  );
});
