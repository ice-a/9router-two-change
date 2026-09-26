// Post-deploy health probe for relay workers (#1037).
// Every relay worker in this repo (dashboard-deployed Vercel/Cloudflare/Deno
// functions and the standalone workers under relay/) answers a bare GET with
// 400 {error:"Missing x-relay-target header"} — a cheap, unambiguous liveness
// check that the deployment is up AND speaks the relay contract, instead of
// saving a pool that later 403s (Vercel deployment protection) or 503s.

export function buildRelayProbeResult(response, bodyText) {
  const healthy = response.status === 400 && bodyText.includes("x-relay-target");
  return { healthy, status: response.status, body: bodyText.slice(0, 200) };
}

export async function probeRelay(relayUrl, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(relayUrl, { signal: controller.signal });
    const bodyText = await res.text().catch(() => "");
    return buildRelayProbeResult(res, bodyText);
  } catch (error) {
    return { healthy: false, status: 0, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

// Relay deployments often lag a few seconds behind the API saying "ready".
export async function probeRelayWithRetry(relayUrl, { attempts = 5, delayMs = 4000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await probeRelay(relayUrl);
    if (last.healthy) return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}
