import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanSchemaForGemini } from "../../dist/index.js";

// The cleaner is not directly exported from index.js, so we import the adapter
// and test through it. For unit tests, we'll test the behavior via the normalizer.

// Since cleanSchemaForGemini may not be directly exported, let's test via dynamic import
const mod = await import("../../dist/index.js");

// Try to find the cleaner function
const { normalizeGoogleChatCompletionsRequest } = mod;

// Helper: create a minimal request with tools
function makeReq(parameters) {
  return {
    model: "google/gemini-2.5-pro",
    messages: [{ role: "user", content: "test" }],
    tools: [
      {
        type: "function",
        function: {
          name: "test_tool",
          description: "A test tool",
          parameters,
        },
      },
    ],
  };
}

// Helper: extract cleaned parameters from normalized request
function getCleanedParams(req) {
  const normalized = normalizeGoogleChatCompletionsRequest(req);
  return normalized.tools[0].function.parameters;
}

describe("normalizeGoogleChatCompletionsRequest", () => {
  it("returns request as-is when no tools present", () => {
    const req = {
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user", content: "test" }],
    };
    const result = normalizeGoogleChatCompletionsRequest(req);
    assert.deepStrictEqual(result, req);
  });

  it("strips patternProperties from tool schemas", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: {
          data: { type: "string" },
        },
        patternProperties: { "^x-": { type: "string" } },
      }),
    );
    assert.equal(params.patternProperties, undefined);
    assert.equal(params.type, "object");
  });

  it("strips additionalProperties from tool schemas", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: { name: { type: "string" } },
        additionalProperties: false,
      }),
    );
    assert.equal(params.additionalProperties, undefined);
  });

  it("strips validation constraints (minLength, maxLength, pattern, format)", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: {
          email: {
            type: "string",
            minLength: 5,
            maxLength: 100,
            pattern: "^[a-z]+@",
            format: "email",
          },
        },
      }),
    );
    const email = params.properties.email;
    assert.equal(email.type, "string");
    assert.equal(email.minLength, undefined);
    assert.equal(email.maxLength, undefined);
    assert.equal(email.pattern, undefined);
    assert.equal(email.format, undefined);
  });

  it("strips numeric constraints (minimum, maximum, multipleOf)", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: {
          age: {
            type: "number",
            minimum: 0,
            maximum: 150,
            multipleOf: 1,
          },
        },
      }),
    );
    const age = params.properties.age;
    assert.equal(age.type, "number");
    assert.equal(age.minimum, undefined);
    assert.equal(age.maximum, undefined);
    assert.equal(age.multipleOf, undefined);
  });

  it("strips array constraints (minItems, maxItems, uniqueItems)", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
          },
        },
      }),
    );
    const tags = params.properties.tags;
    assert.equal(tags.type, "array");
    assert.equal(tags.minItems, undefined);
    assert.equal(tags.maxItems, undefined);
    assert.equal(tags.uniqueItems, undefined);
    assert.deepStrictEqual(tags.items, { type: "string" });
  });

  it("strips $schema, $id, $ref, definitions, examples", () => {
    const params = getCleanedParams(
      makeReq({
        $schema: "http://json-schema.org/draft-07/schema#",
        $id: "test-schema",
        type: "object",
        properties: { name: { type: "string" } },
        examples: [{ name: "test" }],
      }),
    );
    assert.equal(params.$schema, undefined);
    assert.equal(params.$id, undefined);
    assert.equal(params.examples, undefined);
    assert.equal(params.type, "object");
  });

  it("recursively cleans nested properties", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: {
              deep: {
                type: "string",
                minLength: 5,
                pattern: "^[A-Z]",
              },
            },
            additionalProperties: false,
          },
        },
      }),
    );
    const nested = params.properties.nested;
    assert.equal(nested.additionalProperties, undefined);
    assert.equal(nested.properties.deep.minLength, undefined);
    assert.equal(nested.properties.deep.pattern, undefined);
    assert.equal(nested.properties.deep.type, "string");
  });

  it("cleans items in array schemas", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: {
          items_list: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", minLength: 1 },
              },
              additionalProperties: false,
            },
          },
        },
      }),
    );
    const itemSchema = params.properties.items_list.items;
    assert.equal(itemSchema.additionalProperties, undefined);
    assert.equal(itemSchema.properties.name.minLength, undefined);
  });

  it("coerces null properties to empty object", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: null,
      }),
    );
    assert.deepStrictEqual(params.properties, {});
    assert.equal(params.type, "object");
  });

  it("converts const to enum", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        properties: {
          status: {
            const: "active",
            type: "string",
          },
        },
      }),
    );
    assert.deepStrictEqual(params.properties.status.enum, ["active"]);
    assert.equal(params.properties.status.const, undefined);
  });

  it("does not mutate the original request", () => {
    const original = makeReq({
      type: "object",
      properties: { x: { type: "string", minLength: 1 } },
      additionalProperties: false,
    });
    const originalJson = JSON.stringify(original);
    normalizeGoogleChatCompletionsRequest(original);
    assert.equal(JSON.stringify(original), originalJson);
  });

  it("resolves $ref definitions", () => {
    const params = getCleanedParams(
      makeReq({
        type: "object",
        $defs: {
          MyType: {
            type: "string",
            description: "A custom type",
          },
        },
        properties: {
          field: { $ref: "#/$defs/MyType" },
        },
      }),
    );
    assert.equal(params.properties.field.type, "string");
    assert.equal(params.properties.field.description, "A custom type");
  });

  it("handles multiple tools in same request", () => {
    const req = {
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          type: "function",
          function: {
            name: "tool_a",
            parameters: {
              type: "object",
              properties: { x: { type: "string", minLength: 1 } },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "tool_b",
            parameters: {
              type: "object",
              properties: { y: { type: "number", minimum: 0 } },
              patternProperties: { "^z": { type: "string" } },
            },
          },
        },
      ],
    };
    const normalized = normalizeGoogleChatCompletionsRequest(req);
    const paramsA = normalized.tools[0].function.parameters;
    const paramsB = normalized.tools[1].function.parameters;

    assert.equal(paramsA.additionalProperties, undefined);
    assert.equal(paramsA.properties.x.minLength, undefined);
    assert.equal(paramsB.patternProperties, undefined);
    assert.equal(paramsB.properties.y.minimum, undefined);
  });
});
