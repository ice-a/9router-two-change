// #3412: tunnel enable must not fail when only the relay mapping lags —
// either the relay URL or the direct *.trycloudflare.com URL answering is
// enough. (The watchdog reachability gate in initializeApp builds on the
// same probeUrlAlive primitive.)
import { describe, expect, it, vi } from "vitest";
import http from "node:http";

vi.mock("../../src/lib/tunnel/shared/dnsResolver.js", () => ({
  resolveDns: async () => true,
}));

const { probeUrlAlive, waitForTunnelHealth } = await import("../../src/lib/tunnel/cloudflare/healthCheck.js");

async function listenHealth(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${server.address().port}`;
}

const deadServer = "http://127.0.0.1:9";

describe("waitForTunnelHealth dual-URL check (#3412)", () => {
  it("probeUrlAlive passes a local /api/health endpoint", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const url = await listenHealth(server);
    try {
      expect(await probeUrlAlive(url)).toBe(true);
    } finally {
      server.close();
    }
  });

  it("succeeds via direct URL when the relay mapping is still down", async () => {
    const direct = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const directUrl = await listenHealth(direct);
    try {
      // relay = dead port; direct = healthy — must not wait out the 60s budget
      const result = await waitForTunnelHealth(deadServer, directUrl, { cancelled: false });
      expect(result).toEqual({ via: "direct" });
    } finally {
      direct.close();
    }
  }, 10000);

  it("succeeds via public URL when the direct DNS has not registered yet", async () => {
    const relay = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const publicUrl = await listenHealth(relay);
    try {
      const result = await waitForTunnelHealth(publicUrl, deadServer, { cancelled: false });
      expect(result).toEqual({ via: "public" });
    } finally {
      relay.close();
    }
  }, 10000);

  it("respects the cancel token", async () => {
    const token = { cancelled: true };
    await expect(waitForTunnelHealth(deadServer, deadServer, token)).rejects.toThrow("cancelled");
  });
});
