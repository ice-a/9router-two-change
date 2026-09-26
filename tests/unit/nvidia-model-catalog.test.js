// #3398: NVIDIA's NIM catalog rotates fast — the registry now pulls the live
// /v1/models list (modelsFetcher) instead of silently going stale, and the
// filter keeps chat-capable models only.
import { describe, expect, it } from "vitest";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import nvidia from "../../open-sse/providers/registry/nvidia.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const LIVE_SAMPLE = [
  { id: "moonshotai/kimi-k3", object: "model" },
  { id: "z-ai/glm-5.3", object: "model" },
  { id: "nvidia/nemotron-3.5-lightning-30b-a3b", object: "model" },
  { id: "nvidia/nemotron-4-340b-reward", object: "model" },          // reward → drop
  { id: "nvidia/llama-3.2-nv-embedqa-1b-v1", object: "model" },      // embed → drop
  { id: "nvidia/nemotron-parse-2.0", object: "model" },              // parse → drop
  { id: "nvidia/riva-translate-4b-instruct", object: "model" },      // riva → drop
];

describe("nvidia suggested-models filter (#3398)", () => {
  it("keeps chat models and drops non-chat NIM services", () => {
    const out = FILTERS["nvidia"](LIVE_SAMPLE);
    const ids = out.map((m) => m.id);
    expect(ids).toContain("moonshotai/kimi-k3");
    expect(ids).toContain("z-ai/glm-5.3");
    expect(ids).not.toContain("nvidia/nemotron-4-340b-reward");
    expect(ids).not.toContain("nvidia/llama-3.2-nv-embedqa-1b-v1");
    expect(ids).not.toContain("nvidia/nemotron-parse-2.0");
  });

  it("registry wires the live fetcher with passthrough and a refreshed curated list", () => {
    expect(nvidia.modelsFetcher).toEqual({ url: "https://integrate.api.nvidia.com/v1/models", type: "nvidia" });
    expect(nvidia.passthroughModels).toBe(true);
    const ids = nvidia.models.map((m) => m.id);
    expect(ids).toContain("moonshotai/kimi-k3");
    expect(ids).toContain("z-ai/glm-5.3");
    // Models retired from NIM must not resurface as defaults
    expect(ids).not.toContain("minimaxai/minimax-m3");
    expect(ids).not.toContain("deepseek-ai/deepseek-v4-pro");
  });

  it("capabilities force openai effort format for glm/deepseek on NIM and kimi map for kimi-k3", () => {
    expect(getCapabilitiesForModel("nvidia", "z-ai/glm-5.3").thinkingFormat).toBe("openai");
    expect(getCapabilitiesForModel("nvidia", "deepseek-ai/deepseek-v4.1-flash").thinkingFormat).toBe("openai");
    const kimi = getCapabilitiesForModel("nvidia", "moonshotai/kimi-k3");
    expect(kimi.thinkingFormat).toBe("kimi");
    expect(kimi.reasoning).toBe(true);
  });
});
