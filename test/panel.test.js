import test from 'node:test';
import assert from 'node:assert/strict';
import { Panel } from '../src/panel.js';

class MemoryStore {
  constructor() { this.value = null; }
  async read() { return this.value && structuredClone(this.value); }
  async write(value) { this.value = structuredClone(value); }
  async update(callback) { const next = await callback(await this.read()); const result = next.result; delete next.result; this.value = structuredClone(next); return result ?? next; }
}

test('generates a VLESS Reality client URI and agent desired state', async () => {
  const panel = new Panel(new MemoryStore());
  await panel.initialise();
  const node = await panel.createNode({ name: 'Frankfurt', host: 'vpn.example.com', port: 443, protocol: 'vless-reality', realityPublicKey: 'public-key', realityShortId: 'a1b2c3d4', sni: 'www.example.com' });
  const client = await panel.createClient({ name: 'Alice', nodeId: node.id });
  const connection = await panel.clientConnection(client.id);
  assert.match(connection.uri, /^vless:\/\//);
  assert.match(connection.uri, /security=reality/);
  const config = await panel.agentConfig(node.id, node.agentToken);
  assert.equal(config.protocol, 'vless-reality');
  assert.equal(config.clients[0].id, client.uuid);
});

test('requires protocol-specific node material', async () => {
  const panel = new Panel(new MemoryStore());
  await panel.initialise();
  await assert.rejects(panel.createNode({ name: 'Bad', host: '1.2.3.4', port: 443, protocol: 'vless-reality' }), /Reality/);
});
