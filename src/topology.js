import { selectRoute } from './routing.js';

export const topology = {
  nodes: [
    { id: 'hel-1', name: 'Helsinki Edge', region: 'FI', status: 'online', egress: true, load: 32, clients: 184, endpoint: '185.42.10.8:51820' },
    { id: 'fra-1', name: 'Frankfurt Core', region: 'DE', status: 'online', egress: true, load: 47, clients: 236, endpoint: '91.198.21.4:51820' },
    { id: 'waw-1', name: 'Warsaw Relay', region: 'PL', status: 'online', egress: false, load: 21, clients: 79, endpoint: '89.64.18.11:51820' },
    { id: 'ams-1', name: 'Amsterdam Exit', region: 'NL', status: 'online', egress: true, load: 54, clients: 302, endpoint: '145.40.2.19:51820' },
    { id: 'ist-1', name: 'Istanbul Edge', region: 'TR', status: 'degraded', egress: true, load: 88, clients: 121, endpoint: '46.20.7.9:51820' },
  ],
  links: [
    { from: 'hel-1', to: 'fra-1', latencyMs: 29 },
    { from: 'hel-1', to: 'waw-1', latencyMs: 24 },
    { from: 'waw-1', to: 'fra-1', latencyMs: 19 },
    { from: 'fra-1', to: 'ams-1', latencyMs: 11 },
    { from: 'waw-1', to: 'ist-1', latencyMs: 42 },
    { from: 'fra-1', to: 'ist-1', latencyMs: 48 },
  ],
};

export function dashboard() {
  const active = topology.nodes.filter((node) => node.status === 'online');
  const routes = active.map((node) => selectRoute({ nodes: topology.nodes, links: topology.links, entryNodeId: node.id }));
  return { ...topology, routes, generatedAt: new Date().toISOString() };
}
