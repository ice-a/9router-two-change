// Default relay pool (#1282-adjacent "route everything through the free relay"):
// exactly one pool may be flagged isDefault; connections without their own
// proxyPoolId fall back to it in resolveConnectionProxyConfig. Deactivating a
// pool drops its default flag — an inactive default would dead-route every
// unassigned connection.
// Far-future model locks (#4250): marking a connection active must not clear
// manually injected long-lived modelLock_* entries.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let connectionProxy;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-default-pool-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  connectionProxy = await import("@/lib/network/connectionProxy.js");
  await db.initDb();
});

afterAll(() => {
  // Windows: the sqlite adapter may still hold the temp file — never fail the
  // run over cleanup.
  try {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("default proxy pool", () => {
  it("createProxyPool keeps isDefault exclusive", async () => {
    const a = await db.createProxyPool({ name: "a", proxyUrl: "https://a.workers.dev", type: "cloudflare", isDefault: true });
    const b = await db.createProxyPool({ name: "b", proxyUrl: "https://b.workers.dev", type: "cloudflare", isDefault: true });

    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(true);
    expect((await db.getProxyPoolById(a.id)).isDefault).toBe(false);
    expect((await db.getProxyPoolById(b.id)).isDefault).toBe(true);
  });

  it("falls back to the default pool when a connection has no proxyPoolId", async () => {
    await db.createProxyPool({ name: "relay", proxyUrl: "https://relay.example.workers.dev", type: "cloudflare", isDefault: true });

    const resolved = await connectionProxy.resolveConnectionProxyConfig({});
    expect(resolved.vercelRelayUrl).toBe("https://relay.example.workers.dev");
    expect(resolved.strictProxy).toBe(false);
  });

  it("an explicit __none__ poolId opts out of the default pool", async () => {
    const resolved = await connectionProxy.resolveConnectionProxyConfig({ proxyPoolId: "__none__" });
    expect(resolved.vercelRelayUrl).toBeUndefined();
    expect(resolved.connectionProxyEnabled).toBe(false);
  });

  it("an explicit pool wins over the default pool", async () => {
    const other = await db.createProxyPool({ name: "other", proxyUrl: "http://10.0.0.1:7890", type: "http", isDefault: false });

    const resolved = await connectionProxy.resolveConnectionProxyConfig({ proxyPoolId: other.id });
    expect(resolved.connectionProxyEnabled).toBe(true);
    expect(resolved.connectionProxyUrl).toBe("http://10.0.0.1:7890");
  });

  it("deactivating the default pool drops its default flag", async () => {
    const pool = await db.createProxyPool({ name: "tmp", proxyUrl: "https://tmp.example.workers.dev", type: "cloudflare", isDefault: true });
    await db.updateProxyPool(pool.id, { isActive: false });

    const updated = await db.getProxyPoolById(pool.id);
    expect(updated.isActive).toBe(false);
    expect(updated.isDefault).toBe(false);

    const resolved = await connectionProxy.resolveConnectionProxyConfig({});
    expect(resolved.vercelRelayUrl).toBeUndefined();
  });
});

describe("far-future model locks survive activation (#4250)", () => {
  it("updateProviderConnection(testStatus:active) only clears expired locks", async () => {
    const conn = await db.createProviderConnection({
      provider: "nvidia",
      authType: "apikey",
      apiKey: "nvapi-test",
    });

    const farFuture = "2099-01-01T00:00:00.000Z";
    const stale = new Date(Date.now() - 60_000).toISOString();
    await db.updateProviderConnection(conn.id, {
      [`modelLock_moonshotai/kimi-k3`]: farFuture,
      [`modelLock_z-ai/glm-5.2`]: stale,
    });

    await db.updateProviderConnection(conn.id, { testStatus: "active" });

    const reloaded = await db.getProviderConnectionById(conn.id);
    expect(reloaded[`modelLock_moonshotai/kimi-k3`]).toBe(farFuture);
    expect(reloaded[`modelLock_z-ai/glm-5.2`]).toBeNull();
  });
});
