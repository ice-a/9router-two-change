import { resolveDns } from "../shared/dnsResolver.js";
import { HEALTH_CHECK } from "./config.js";

export async function probeUrlAlive(url) {
  if (!url) return false;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (!await resolveDns(hostname, HEALTH_CHECK.dnsTimeoutMs)) return false;

  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(url, cancelToken = { cancelled: false }) {
  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    if (await probeUrlAlive(url)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_CHECK.intervalMs));
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}

// #3412: the relay mapping (abc-tunnel.us) can lag minutes behind tunnel
// registration while the direct *.trycloudflare.com URL is already serving —
// failing the whole enable on a relay-only 60s timeout declared dead tunnels
// that were fine. Either URL answering healthy is enough to succeed.
export async function waitForTunnelHealth(publicUrl, directUrl, cancelToken = { cancelled: false }) {
  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    const [publicOk, directOk] = await Promise.all([
      probeUrlAlive(publicUrl),
      probeUrlAlive(directUrl),
    ]);
    if (publicOk) return { via: "public" };
    if (directOk) return { via: "direct" };
    await new Promise((r) => setTimeout(r, HEALTH_CHECK.intervalMs));
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}
