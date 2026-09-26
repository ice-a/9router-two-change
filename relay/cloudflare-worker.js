// 9router free egress relay — Cloudflare Worker.
//
// Forwards any request to the upstream named by the x-relay-target /
// x-relay-path headers (the same relay contract 9router's proxy pools use),
// streaming the body and response untouched. Deploy it once on Cloudflare's
// free plan, then register the workers.dev URL as a relay-type proxy pool in
// 9router (or set it as the default pool) to route provider traffic — e.g.
// NVIDIA NIM — through Cloudflare's network.
//
// Deploy:  npx wrangler deploy      (from this relay/ directory)
//
// Optional env (wrangler.toml [vars] or dashboard → Settings → Variables):
//   ALLOWED_TARGETS — comma-separated origins the relay may forward to.
//     Example: "https://integrate.api.nvidia.com". Unset = forward anywhere
//     (fine for a personal worker; an allowlist prevents strangers from
//     abusing your worker as an open proxy).

const HOP_HEADERS = [
  "x-relay-target",
  "x-relay-path",
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "cf-trace-id",
  "cdn-loop",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
];

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function targetAllowed(target, env) {
  const allowlist = (env?.ALLOWED_TARGETS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (allowlist.length === 0) return true;
  return allowlist.some((origin) => target === origin || target.startsWith(`${origin}/`));
}

export default {
  async fetch(request, env) {
    const target = (request.headers.get("x-relay-target") || "").replace(/\/+$/, "");
    const relayPath = request.headers.get("x-relay-path") || "/";

    if (!target) {
      return jsonResponse({ error: "Missing x-relay-target header" }, 400);
    }
    if (!/^https?:\/\//.test(target)) {
      return jsonResponse({ error: `Invalid x-relay-target: ${target}` }, 400);
    }
    if (!targetAllowed(target, env)) {
      return jsonResponse({ error: `Target not allowed: ${target}` }, 403);
    }

    const headers = new Headers(request.headers);
    for (const name of HOP_HEADERS) headers.delete(name);

    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }

    try {
      const upstream = await fetch(`${target}${relayPath}`, init);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch (error) {
      return jsonResponse({ error: `Relay fetch failed: ${error.message}` }, 502);
    }
  },
};
