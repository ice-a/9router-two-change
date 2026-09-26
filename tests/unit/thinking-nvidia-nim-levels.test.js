// NVIDIA NIM thinking/effort fixes (#1914 residual + #3794):
// - a Claude-style `thinking:{type:"enabled"}` (no budget → mode "auto") must not
//   reach NIM as literal reasoning_effort:"auto" — NIM 400s on non-enum values;
//   omit the field and the upstream default (thinking on for adaptive models) applies.
// - NIM's kimi-k3 only accepts reasoning_effort low|high|max; the upstream 400 in
//   #3794 names the enum verbatim. Unsupported levels snap to the nearest
//   supported one instead of failing every request.
import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("nvidia thinking levels (#1914/#3794)", () => {
  it("declares kimi-k3's NIM enum as low/high/max", () => {
    expect(getThinkingLevels("nvidia", "moonshotai/kimi-k3")).toEqual(["low", "high", "max"]);
  });

  it("omits reasoning_effort for an 'auto' thinking intent (NIM rejects literal auto)", () => {
    const body = { messages: [{ role: "user", content: "hi" }], thinking: { type: "enabled" } };
    applyThinking("openai", "minimaxai/minimax-m3", body, "nvidia");
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("snaps unsupported kimi efforts onto the supported enum (medium → high)", () => {
    const body = { messages: [] };
    applyThinking("openai", "moonshotai/kimi-k3", body, "nvidia", { mode: "level", level: "medium" });
    expect(body.reasoning_effort).toBe("high");
  });

  it("snaps xhigh → max for NIM kimi-k3", () => {
    const body = { messages: [] };
    applyThinking("openai", "moonshotai/kimi-k3", body, "nvidia", { mode: "level", level: "xhigh" });
    expect(body.reasoning_effort).toBe("max");
  });

  it("keeps supported values untouched (low/high/max pass through)", () => {
    for (const level of ["low", "high", "max"]) {
      const body = { messages: [] };
      applyThinking("openai", "moonshotai/kimi-k3", body, "nvidia", { mode: "level", level });
      expect(body.reasoning_effort).toBe(level);
    }
  });

  it("does not regress non-NVIDIA kimi models (medium stays medium)", () => {
    const body = { messages: [] };
    applyThinking("openai", "kimi-k3", body, "kilocode", { mode: "level", level: "medium" });
    expect(body.reasoning_effort).toBe("medium");
  });
});
