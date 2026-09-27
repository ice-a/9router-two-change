// #3398: /v1/models now serves NVIDIA NIM's live catalog (chat models only,
// TTL-cached, proxy/relay-aware) instead of the static registry list that
// silently went stale as NIM rotated its catalog.
import { describe, expect, it } from "vitest";
import { resolveNvidiaModels, __resetNvidiaCatalogCacheForTests } from "../../open-sse/services/nvidiaModels.js";

const LIVE_BODY = {
  data: [
    { id: "moonshotai/kimi-k3" },
    { id: "z-ai/glm-5.3" },
    { id: "nvidia/nemotron-3.5-lightning-30b-a3b" },
    { id: "nvidia/nemotron-4-340b-reward" },
    { id: "nvidia/nemotron-parse-2.0" },
    { id: "nvidia/riva-translate-4b-instruct" },
    { id: "snowflake/arctic-embed-l" },
  ],
};

function fetchOk(body, status = 200) {
  let calls = 0;
  const fn = async () => {
    calls++;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = () => calls;
  return fn;
}

describe("resolveNvidiaModels (#3398)", () => {
  it("returns the live catalog filtered to chat models, sorted", async () => {
    __resetNvidiaCatalogCacheForTests();
    const fetchFn = fetchOk(LIVE_BODY);
    const result = await resolveNvidiaModels({ apiKey: "nvapi-x" }, { fetchFn });

    const ids = result.models.map((m) => m.id);
    expect(ids).toEqual([
      "moonshotai/kimi-k3",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "z-ai/glm-5.3",
    ]);
    expect(fetchFn.calls()).toBe(1);
  });

  it("caches within the TTL window", async () => {
    __resetNvidiaCatalogCacheForTests();
    const fetchFn = fetchOk(LIVE_BODY);
    await resolveNvidiaModels({}, { fetchFn });
    await resolveNvidiaModels({}, { fetchFn });
    expect(fetchFn.calls()).toBe(1);
    __resetNvidiaCatalogCacheForTests();
  });

  it("returns an empty list with a warning on upstream failure", async () => {
    __resetNvidiaCatalogCacheForTests();
    const result = await resolveNvidiaModels({}, { fetchFn: fetchOk({}, 503) });
    expect(result.models).toEqual([]);
    expect(result.warning).toContain("503");
  });

  it("sends the API key when provided (catalog may be gated later)", async () => {
    __resetNvidiaCatalogCacheForTests();
    let seenAuth = null;
    const fetchFn = async (url, init) => {
      seenAuth = init?.headers?.Authorization || null;
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "openai/gpt-oss-20b" }] }) };
    };
    await resolveNvidiaModels({ apiKey: "nvapi-test" }, { fetchFn });
    expect(seenAuth).toBe("Bearer nvapi-test");
  });
});
