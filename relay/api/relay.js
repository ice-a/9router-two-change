// 9router free egress relay — Vercel Edge Function.
// Same relay contract as relay/cloudflare-worker.js: forwards any request to
// the upstream named by x-relay-target / x-relay-path.
//
// Deploy (free Hobby plan works): from this relay/ directory run
//   npx vercel --prod
// The bundled vercel.json rewrites every path into this function.

const HOP_HEADERS = [
  "x-relay-target",
  "x-relay-path",
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
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

export const config = { runtime: "edge" };

export default async function handler(request) {
  const target = (request.headers.get("x-relay-target") || "").replace(/\/+$/, "");
  const relayPath = request.headers.get("x-relay-path") || "/";

  if (!target) {
    return jsonResponse({ error: "Missing x-relay-target header" }, 400);
  }
  if (!/^https?:\/\//.test(target)) {
    return jsonResponse({ error: `Invalid x-relay-target: ${target}` }, 400);
  }
  if (!targetAllowed(target, process.env)) {
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
}
