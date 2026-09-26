// #4345: Gemini rejects contents that end on a model turn
// ("Requests ending with a model turn are not supported") and any unresponded
// functionCall. Agentic clients legally send OpenAI/Anthropic transcripts
// ending on an assistant turn — prefill text, or a tool call whose result
// never arrived. normalizeGeminiContents closes the transcript with a
// synthetic user turn instead of forwarding a guaranteed 400.
import { describe, expect, it } from "vitest";
import { normalizeGeminiContents } from "../../open-sse/translator/formats/gemini.js";

describe("normalizeGeminiContents — terminal model turns (#4345)", () => {
  it("appends a 'Continue.' user turn after a trailing assistant text turn", () => {
    const out = normalizeGeminiContents([
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "I am thinking about your request." }] },
    ]);

    expect(out).toHaveLength(3);
    expect(out.at(-1).role).toBe("user");
    expect(out.at(-1).parts).toEqual([{ text: "Continue." }]);
  });

  it("answers a trailing unresponded functionCall with a matching functionResponse", () => {
    const out = normalizeGeminiContents([
      { role: "user", parts: [{ text: "List files" }] },
      { role: "model", parts: [{ functionCall: { id: "call_1", name: "ls", args: {} } }] },
    ]);

    expect(out).toHaveLength(3);
    const turn = out.at(-1);
    expect(turn.role).toBe("user");
    expect(turn.parts).toEqual([
      { functionResponse: { id: "call_1", name: "ls", response: { result: "Continue." } } },
    ]);
  });

  it("answers every pending call when the terminal model turn has several", () => {
    const out = normalizeGeminiContents([
      { role: "user", parts: [{ text: "go" }] },
      {
        role: "model",
        parts: [
          { functionCall: { id: "call_a", name: "ls", args: {} } },
          { functionCall: { id: "call_b", name: "pwd", args: {} } },
        ],
      },
    ]);

    const parts = out.at(-1).parts;
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.functionResponse.id)).toEqual(["call_a", "call_b"]);
  });

  it("leaves transcripts already ending on a user turn untouched", () => {
    const contents = [
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi" }] },
      { role: "user", parts: [{ functionResponse: { name: "ls", response: { result: "ok" } } }] },
    ];
    expect(normalizeGeminiContents(structuredClone(contents))).toEqual(contents);
  });

  it("still guarantees a leading user turn", () => {
    const out = normalizeGeminiContents([{ role: "model", parts: [{ text: "prefill" }] }]);
    expect(out[0].role).toBe("user");
    expect(out.at(-1).role).toBe("user");
  });

  it("handles empty and malformed input safely", () => {
    expect(normalizeGeminiContents([])).toEqual([]);
    expect(normalizeGeminiContents(null)).toEqual([]);
    expect(normalizeGeminiContents([{ role: "user", parts: [] }])).toEqual([]);
  });
});
