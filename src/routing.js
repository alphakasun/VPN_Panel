/**
 * Deterministic route selection for the control plane.  Agents receive the
 * resulting hop list and are responsible for applying it to their local
 * dataplane (for example, WireGuard and nftables).
 */
export function selectRoute({ nodes, links, entryNodeId, policy = {} }) {
  const online = new Map(nodes.filter((node) => node.status === 'online').map((node) => [node.id, node]));
  const entry = online.get(entryNodeId);
  if (!entry) throw new Error('Entry node is offline or unknown');

  const blocked = new Set(policy.blockedRegions ?? []);
  const candidates = [...online.values()].filter((node) =>
    node.egress && node.id !== entryNodeId && !blocked.has(node.region),
  );
  if (!candidates.length) throw new Error('No eligible egress nodes');

  const adjacency = new Map([...online.keys()].map((id) => [id, []]));
  for (const link of links) {
    if (!adjacency.has(link.from) || !adjacency.has(link.to)) continue;
    adjacency.get(link.from).push({ id: link.to, latency: link.latencyMs });
    adjacency.get(link.to).push({ id: link.from, latency: link.latencyMs });
  }

  const distance = new Map([...online.keys()].map((id) => [id, Infinity]));
  const previous = new Map();
  distance.set(entryNodeId, 0);
  const pending = new Set(online.keys());
  while (pending.size) {
    const current = [...pending].reduce((best, id) => distance.get(id) < distance.get(best) ? id : best);
    if (distance.get(current) === Infinity) break;
    pending.delete(current);
    for (const next of adjacency.get(current)) {
      if (!pending.has(next.id)) continue;
      const score = distance.get(current) + next.latency;
      if (score < distance.get(next.id)) {
        distance.set(next.id, score);
        previous.set(next.id, current);
      }
    }
  }

  const reachable = candidates.filter((node) => Number.isFinite(distance.get(node.id)));
  if (!reachable.length) throw new Error('No egress is reachable through the mesh');
  reachable.sort((a, b) => (distance.get(a.id) + a.load * 2) - (distance.get(b.id) + b.load * 2));
  const egress = reachable[0];
  const hops = [egress.id];
  for (let at = egress.id; at !== entryNodeId; at = previous.get(at)) hops.push(previous.get(at));
  hops.reverse();

  return {
    entryNodeId,
    egressNodeId: egress.id,
    hops,
    latencyMs: distance.get(egress.id),
    score: distance.get(egress.id) + egress.load * 2,
    reason: `Lowest mesh latency with load weighting (${egress.load}% load)`,
  };
}
