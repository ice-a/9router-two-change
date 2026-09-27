// Latency-aware account selection (#3072).
// "fastest" fallback strategy: rank a provider's available connections by
// their recent latency (from requestDetails) so the snappiest account serves
// the next request. Pure ranking logic lives here; the stats query lives in
// requestDetailsRepo.getConnectionLatencyStats.

/**
 * Rank connections for the "fastest" strategy.
 * Known-latency connections come first (lowest average wins); connections
 * without samples keep their incoming (priority) order after the known ones,
 * so a brand-new account starts serving once healthier accounts are
 * excluded/locked rather than never.
 * Stable: ties keep the original order.
 * @param {Array<object>} connections - available connections (priority order)
 * @param {Map<string, {avgMs: number, samples: number}>} latencyByConnection
 * @returns {Array<object>} reordered connections (same instances)
 */
export function rankConnectionsByLatency(connections, latencyByConnection) {
  if (!Array.isArray(connections) || connections.length <= 1) return connections;
  if (!latencyByConnection || latencyByConnection.size === 0) return connections;

  const known = [];
  const unknown = [];
  connections.forEach((conn, index) => {
    const stats = latencyByConnection.get(conn.id);
    if (stats && stats.avgMs > 0) known.push({ conn, avgMs: stats.avgMs, index });
    else unknown.push({ conn, index });
  });
  if (known.length === 0) return connections;

  // Stable sort by latency; ties fall back to the incoming order.
  known.sort((a, b) => (a.avgMs - b.avgMs) || (a.index - b.index));
  unknown.sort((a, b) => a.index - b.index);
  return [...known.map((k) => k.conn), ...unknown.map((u) => u.conn)];
}
