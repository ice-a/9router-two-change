// relay/cloudflare-worker.js + relay/api/relay.js must keep honoring the
// x-relay-target / x-relay-path contract that open-sse/utils/proxyFetch.js
// speaks: rewrite the request onto the target origin, strip the relay headers
// (and other edge-injected hop headers) so the upstream never sees them,
// stream the body through, and pass the upstream status/headers back.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import cfWorker from "../../relay/cloudflare-worker.js";
import vercelRelay from "../../relay/api/relay.js";

let server;
let upstreamUrl;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "x-upstream": "yes" });
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        sawRelayHeaders: {
          target: req.headers["x-relay-target"],
          path: req.headers["x-relay-path"],
          cfIp: req.headers["cf-connecting-ip"],
          xff: req.headers["x-forwarded-for"],
        },
        auth: req.headers["authorization"] || null,
        body: body || null,
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstreamUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
});

describe("cloudflare relay worker", () => {
  it("forwards path, auth and body; strips relay/edge headers", async () => {
    const res = await cfWorker.fetch(
      new Request("https://relay.example.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "x-relay-target": upstreamUrl,
          "x-relay-path": "/v1/chat/completions",
          "authorization": "Bearer nvapi-test",
          "cf-connecting-ip": "203.0.113.9",
        },
        body: '{"model":"x"}',
      }),
      {}
    );
    const upstream = await res.json();

    expect(res.status).toBe(200);
    expect(upstream.url).toBe("/v1/chat/completions");
    expect(upstream.auth).toBe("Bearer nvapi-test");
    expect(upstream.body).toBe('{"model":"x"}');
    expect(upstream.sawRelayHeaders.target).toBeUndefined();
    expect(upstream.sawRelayHeaders.path).toBeUndefined();
    expect(upstream.sawRelayHeaders.cfIp).toBeUndefined();
    expect(res.headers.get("x-upstream")).toBe("yes");
  });

  it("rejects requests without x-relay-target", async () => {
    const res = await cfWorker.fetch(new Request("https://relay.example.com/"), {});
    expect(res.status).toBe(400);
  });

  it("honours the ALLOWED_TARGETS allowlist", async () => {
    const restricted = { ALLOWED_TARGETS: "https://integrate.api.nvidia.com" };

    const blocked = await cfWorker.fetch(
      new Request("https://relay.example.com/v1/models", {
        headers: { "x-relay-target": upstreamUrl, "x-relay-path": "/v1/models" },
      }),
      restricted
    );
    expect(blocked.status).toBe(403);

    const allowed = await cfWorker.fetch(
      new Request("https://relay.example.com/v1/models", {
        headers: { "x-relay-target": upstreamUrl, "x-relay-path": "/v1/models" },
      }),
      { ALLOWED_TARGETS: upstreamUrl }
    );
    expect(allowed.status).toBe(200);
  });
});

describe("vercel edge relay", () => {
  it("forwards with the same contract", async () => {
    const res = await vercelRelay(
      new Request("https://relay.vercel.app/v1/models", {
        headers: {
          "x-relay-target": upstreamUrl,
          "x-relay-path": "/v1/models",
          "x-forwarded-for": "203.0.113.9",
        },
      })
    );
    const upstream = await res.json();

    expect(res.status).toBe(200);
    expect(upstream.url).toBe("/v1/models");
    expect(upstream.sawRelayHeaders.path).toBeUndefined();
    expect(upstream.sawRelayHeaders.xff).toBeUndefined();
  });
});
