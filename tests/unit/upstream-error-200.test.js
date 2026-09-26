// #2727: NVIDIA NIM answers HTTP 200 with `choices: null` (and an error
// payload) when its worker pool is exhausted. The non-streaming handler must
// surface that as a real HTTP error instead of a "successful" empty
// completion that breaks every client.
import { describe, expect, it } from "vitest";
import { detectUpstreamErrorPayload } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

describe("detectUpstreamErrorPayload (#2727)", () => {
  it("maps a 200 ResourceExhausted payload (choices null) to 429", () => {
    const body = {
      object: "chat.completion",
      choices: null,
      error: { message: "Input is oversaturated", code: "ResourceExhausted" },
    };
    expect(detectUpstreamErrorPayload(body)).toMatchObject({ status: 429 });
  });

  it("maps a generic 200 error payload to 502", () => {
    const body = { object: "chat.completion", choices: null, error: { message: "Internal worker failure" } };
    expect(detectUpstreamErrorPayload(body)).toMatchObject({ status: 502 });
  });

  it("honours numeric error codes in the 4xx/5xx range", () => {
    const body = { object: "chat.completion", choices: null, error: { code: 503, message: "overloaded" } };
    expect(detectUpstreamErrorPayload(body)).toMatchObject({ status: 503 });
  });

  it("handles string error payloads", () => {
    expect(detectUpstreamErrorPayload({ choices: null, error: "rate limit exceeded" })).toMatchObject({ status: 429 });
  });

  it("treats choices:null without any error object as a 502, not success", () => {
    expect(detectUpstreamErrorPayload({ object: "chat.completion", choices: null })).toMatchObject({ status: 502 });
  });

  it("passes normal completions through untouched", () => {
    const ok = { object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] };
    expect(detectUpstreamErrorPayload(ok)).toBeNull();
  });

  it("ignores non-OpenAI shapes (claude/gemini bodies have no choices field)", () => {
    expect(detectUpstreamErrorPayload({ type: "message", content: [] })).toBeNull();
    expect(detectUpstreamErrorPayload({ candidates: [] })).toBeNull();
    expect(detectUpstreamErrorPayload(null)).toBeNull();
  });
});
