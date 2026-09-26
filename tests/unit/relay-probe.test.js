// #1037: relay deploy routes probe the worker before saving the pool. The
// probe's healthy signal is the relay contract itself — a bare GET answered
// with 400 and "Missing x-relay-target" in the body.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { buildRelayProbeResult, probeRelayWithRetry } from "../../src/lib/network/relayProbe.js";

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
