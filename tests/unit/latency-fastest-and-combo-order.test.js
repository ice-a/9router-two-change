// #3072 "fastest" strategy + #3761 throughput + #4322 combo reorder:
// - rankConnectionsByLatency is the pure ranking used by auth.js
// - getConnectionLatencyStats / getThroughputStats aggregate requestDetails
// - reorderCombos persists an explicit combo list order
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rankConnectionsByLatency } from "../../src/sse/services/latencyStrategy.js";

describe("rankConnectionsByLatency (#3072)", () => {
  const a = { id: "a", priority: 1 };
  const b = { id: "b", priority: 2 };
  const c = { id: "c", priority: 3 };

  it("puts the lowest-latency connection first", () => {
    const stats = new Map([
      ["a", { avgMs: 900, samples: 5 }],
      ["b", { avgMs: 300, samples: 5 }],
    ]);
    expect(rankConnectionsByLatency([a, b, c], stats).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps unsampled connections after known ones in their original order", () => {
    const stats = new Map([["c", { avgMs: 900, samples: 5 }]]);
    expect(rankConnectionsByLatency([a, b, c], stats).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps priority order without stats and with a single connection", () => {
    expect(rankConnectionsByLatency([a, b], new Map()).map((x) => x.id)).toEqual(["a", "b"]);
    expect(rankConnectionsByLatency([a], new Map([["a", { avgMs: 5, samples: 1 }]]))).toEqual([a]);
  });
});

describe("requestDetails latency/throughput aggregates + combo reorder", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;
  let db;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fastest-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    await db.initDb();
    // Default observability batches 20 rows / 5s — make the buffered writer
    // flush immediately so tests can read rows right after saving.
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1, observabilityFlushIntervalMs: 50 });
  });

  afterAll(() => {
    try {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* windows file lock */ }
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  const saveDetail = async (detail) => {
    await db.saveRequestDetail(detail);
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const { details } = await db.getRequestDetails({ pageSize: 100 });
      if (details.some((d) => d.id === detail.id)) return;
    }
    throw new Error(`requestDetail ${detail.id} never flushed`);
  };

  it("aggregates per-connection latency and throughput from successful requests", async () => {
    const mk = (id, connectionId, ttft, total, completion, status = "success") => ({
      id, provider: "nvidia", model: "moonshotai/kimi-k3", connectionId,
      timestamp: new Date().toISOString(), status,
      latency: { ttft, total }, tokens: { prompt_tokens: 10, completion_tokens: completion },
    });
    await saveDetail(mk("r1", "conn-fast", 300, 2000, 100));   // 50 tok/s
    await saveDetail(mk("r2", "conn-fast", 500, 2000, 100));   // 50 tok/s
    await saveDetail(mk("r3", "conn-slow", 1200, 3000, 100));  // 33.3 tok/s
    await saveDetail(mk("r4", "conn-fast", 9999, 9999, 100, "error")); // failed → excluded
    await saveDetail(mk("r5", "conn-t", 0, 4000, 1000));       // ttft 0 → total: 250 tok/s

    const latency = await db.getConnectionLatencyStats({ provider: "nvidia" });
    expect(latency.get("conn-fast")).toEqual({ avgMs: 400, samples: 2 });
    expect(latency.get("conn-slow")).toEqual({ avgMs: 1200, samples: 1 });

    const throughput = await db.getThroughputStats({ sinceMs: 24 * 3600 * 1000 });
    expect(throughput.samples).toBe(4); // r1,r2,r3,r5 (r4 failed, excluded)
    expect(throughput.tokensPerSecond).toBeCloseTo((50 + 50 + 100 / 3 + 250) / 4, 1);
  });

  it("reorderCombos persists the explicit order and getCombos honors it", async () => {
    const c1 = await db.createCombo({ name: `combo-a-${Date.now()}`, models: ["nvidia/z-ai/glm-5.3"] });
    const c2 = await db.createCombo({ name: `combo-b-${Date.now()}`, models: ["nvidia/moonshotai/kimi-k3"] });
    const c3 = await db.createCombo({ name: `combo-c-${Date.now()}`, models: ["nvidia/openai/gpt-oss-20b"] });

    const updated = await db.reorderCombos([c3.id, c1.id, c2.id]);
    expect(updated).toEqual([c3.id, c1.id, c2.id]);

    const combos = await db.getCombos();
    const order = combos.filter((c) => [c1.id, c2.id, c3.id].includes(c.id)).map((c) => c.id);
    expect(order).toEqual([c3.id, c1.id, c2.id]);
  });
});
