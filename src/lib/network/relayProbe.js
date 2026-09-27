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

// Stable, dependency-free egress target for relay round-trips. Cloudflare's
// trace endpoint answers 200 with `ip=<addr>` from every edge — httpbin.org
// (the old target) is flaky and unreachable from some networks, which made a
// healthy relay fail its pool test and get auto-deactivated (#1037 follow-up).
const RELAY_EGRESS_TARGET = "https://www.cloudflare.com";
const RELAY_EGRESS_PATH = "/cdn-cgi/trace";

/**
 * Two-stage relay pool test:
 * 1. contract probe — the bare GET must answer the 400 "Missing x-relay-target" shape;
 * 2. egress round-trip — a real forwarded GET to the trace endpoint must come
 *    back 200 with an exit IP.
 * @returns {Promise<{ok: boolean, status: number, elapsedMs: number, stage?: string, exitIp?: string, error?: string}>}
 */
export async function testRelayEgress(relayUrl, { timeoutMs = 15000, fetchFn } = {}) {
  const doFetch = fetchFn || ((url, init) => fetch(url, init));
  const startedAt = Date.now();
  const timed = async (run) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } catch (error) {
      return { fetchError: error?.name === "AbortError" ? "timed out" : (error?.message || String(error)) };
    } finally {
      clearTimeout(timer);
    }
  };

  // Stage 1: liveness + contract.
  const probe = await timed((signal) => doFetch(relayUrl, { signal }).then(async (res) => ({
    status: res.status,
    body: await res.text().catch(() => ""),
  })));
  if (probe.fetchError) {
    return { ok: false, status: 0, elapsedMs: Date.now() - startedAt, stage: "probe", error: probe.fetchError };
  }
  const contract = buildRelayProbeResult({ status: probe.status }, probe.body);
  if (!contract.healthy) {
    return {
      ok: false,
      status: probe.status,
      elapsedMs: Date.now() - startedAt,
      stage: "probe",
      error: `Relay did not answer the x-relay-target contract (status ${probe.status})`,
    };
  }

  // Stage 2: forwarded round-trip.
  const round = await timed((signal) => doFetch(relayUrl, {
    signal,
    headers: {
      "x-relay-target": RELAY_EGRESS_TARGET,
      "x-relay-path": RELAY_EGRESS_PATH,
    },
  }).then(async (res) => ({
    status: res.status,
    body: await res.text().catch(() => ""),
  })));
  if (round.fetchError) {
    return { ok: false, status: 0, elapsedMs: Date.now() - startedAt, stage: "egress", error: round.fetchError };
  }
  if (round.status !== 200 || !round.body.includes("ip=")) {
    return {
      ok: false,
      status: round.status,
      elapsedMs: Date.now() - startedAt,
      stage: "egress",
      error: `Relay forwarded request failed (status ${round.status})`,
    };
  }

  const exitIp = round.body.match(/^ip=(.+)$/m)?.[1]?.trim();
  return { ok: true, status: round.status, elapsedMs: Date.now() - startedAt, exitIp };
}
