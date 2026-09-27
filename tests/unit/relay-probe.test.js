// #1037: relay deploy routes probe the worker before saving the pool. The
// probe's healthy signal is the relay contract itself — a bare GET answered
// with 400 and "Missing x-relay-target" in the body.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { buildRelayProbeResult, probeRelayWithRetry, testRelayEgress } from "../../src/lib/network/relayProbe.js";

let healthyRelay;
let brokenRelay;
let healthyUrl;
let brokenUrl;

beforeAll(async () => {
  healthyRelay = http.createServer((req, res) => {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Missing x-relay-target header" }));
  });
  brokenRelay = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>Welcome to nginx</html>");
  });
  await new Promise((r) => healthyRelay.listen(0, "127.0.0.1", r));
  await new Promise((r) => brokenRelay.listen(0, "127.0.0.1", r));
  healthyUrl = `http://127.0.0.1:${healthyRelay.address().port}`;
  brokenUrl = `http://127.0.0.1:${brokenRelay.address().port}`;
});

afterAll(() => {
  healthyRelay?.close();
  brokenRelay?.close();
});

describe("relay probe (#1037)", () => {
  it("accepts a live relay that speaks the x-relay-target contract", () => {
    const result = buildRelayProbeResult({ status: 400 }, '{"error":"Missing x-relay-target header"}');
    expect(result.healthy).toBe(true);
  });

  it("rejects a 200 page (wrong service behind the URL)", () => {
    const result = buildRelayProbeResult({ status: 200 }, "<html>Welcome to nginx</html>");
    expect(result.healthy).toBe(false);
  });

  it("rejects a 400 without the contract body", () => {
    const result = buildRelayProbeResult({ status: 400 }, "Bad Request");
    expect(result.healthy).toBe(false);
  });

  it("probeRelayWithRetry keeps polling until the deployment activates", async () => {
    const result = await probeRelayWithRetry(healthyUrl, { attempts: 3, delayMs: 10 });
    expect(result.healthy).toBe(true);
  }, 15000);

  it("probeRelayWithRetry gives up on a broken deployment", async () => {
    const result = await probeRelayWithRetry(brokenUrl, { attempts: 2, delayMs: 10 });
    expect(result.healthy).toBe(false);
    expect(result.status).toBe(200);
  }, 15000);

  it("reports connection failures as unhealthy", async () => {
    const result = await probeRelayWithRetry("http://127.0.0.1:9", { attempts: 1, delayMs: 1 });
    expect(result.healthy).toBe(false);
  }, 15000);
});

describe("testRelayEgress — two-stage pool test (#1037)", () => {
  it("passes a healthy relay and reports the exit IP", async () => {
    // Mimics a working relay: bare GET → contract 400; forwarded GET → trace body.
    const relay = http.createServer((req, res) => {
      if (!req.headers["x-relay-target"]) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Missing x-relay-target header" }));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("fl=abc\nip=203.0.113.7\nts=1\n");
    });
    await new Promise((r) => relay.listen(0, "127.0.0.1", r));
    try {
      const result = await testRelayEgress(`http://127.0.0.1:${relay.address().port}`, {
        fetchFn: (url, init) => fetch(url, init),
      });
      expect(result.ok).toBe(true);
      expect(result.exitIp).toBe("203.0.113.7");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      relay.close();
    }
  });

  it("fails at the probe stage when the URL is not a relay", async () => {
    const result = await testRelayEgress(brokenUrl, { fetchFn: (url, init) => fetch(url, init) });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("probe");
  });

  it("fails at the egress stage when forwarding breaks", async () => {
    // Contract-compliant but forwarding broken (502 on every forwarded call).
    const relay = http.createServer((req, res) => {
      if (!req.headers["x-relay-target"]) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Missing x-relay-target header" }));
        return;
      }
      res.writeHead(502);
      res.end("upstream down");
    });
    await new Promise((r) => relay.listen(0, "127.0.0.1", r));
    try {
      const result = await testRelayEgress(`http://127.0.0.1:${relay.address().port}`, {
        fetchFn: (url, init) => fetch(url, init),
      });
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("egress");
      expect(result.status).toBe(502);
    } finally {
      relay.close();
    }
  });
});
