import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRoute } from '../src/routing.js';

const nodes = [
  { id: 'a', status: 'online', egress: false, load: 10 },
  { id: 'b', status: 'online', egress: true, load: 80, region: 'DE' },
  { id: 'c', status: 'online', egress: true, load: 10, region: 'NL' },
];
const links = [{ from: 'a', to: 'b', latencyMs: 10 }, { from: 'a', to: 'c', latencyMs: 20 }];

test('chooses the lowest latency-plus-load egress through the mesh', () => {
  const route = selectRoute({ nodes, links, entryNodeId: 'a' });
  assert.deepEqual(route.hops, ['a', 'c']);
  assert.equal(route.egressNodeId, 'c');
});

test('respects egress region exclusions', () => {
  const route = selectRoute({ nodes, links, entryNodeId: 'a', policy: { blockedRegions: ['NL'] } });
  assert.equal(route.egressNodeId, 'b');
});
