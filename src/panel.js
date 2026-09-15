import { randomBytes, randomUUID } from 'node:crypto';

const supportedProtocols = new Set(['vless-reality', 'hysteria2', 'amneziawg']);

export class Panel {
  constructor(store) { this.store = store; }

  async initialise() {
    const state = await this.store.read();
    if (!state) await this.store.write({ nodes: [], clients: [] });
  }

  async snapshot() {
    const state = await this.store.read();
    return { ...state, nodes: state.nodes.map(({ agentToken, ...node }) => node) };
  }

  async createNode(input) {
    assertText(input.name, 'name');
    assertText(input.host, 'host');
    assertProtocol(input.protocol);
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error('port must be between 1 and 65535');
    if (input.protocol === 'vless-reality' && (!input.realityPublicKey || !input.realityShortId)) {
      throw new Error('VLESS Reality requires realityPublicKey and realityShortId from Xray');
    }
    if (input.protocol === 'hysteria2' && !input.sni) throw new Error('Hysteria2 requires an SNI hostname');
    const node = {
      id: randomUUID(), name: input.name, host: input.host, port: input.port, protocol: input.protocol,
      status: 'pending', createdAt: new Date().toISOString(),
      agentToken: randomBytes(24).toString('base64url'),
      realityPublicKey: input.realityPublicKey, realityShortId: input.realityShortId, sni: input.sni,
      hysteriaPassword: input.protocol === 'hysteria2' ? randomBytes(18).toString('base64url') : undefined,
      awgPublicKey: input.awgPublicKey,
    };
    await this.store.update((state) => ({ ...state, nodes: [...state.nodes, node] }));
    await this.store.audit?.('node.created', node.id, { protocol: node.protocol, host: node.host });
    return node;
  }

  async markNodeReady(nodeId, agentToken) {
    const updated = await this.store.update((state) => {
      const node = state.nodes.find((item) => item.id === nodeId && item.agentToken === agentToken);
      if (!node) throw new Error('invalid node credentials');
      return { ...state, nodes: state.nodes.map((item) => item.id === nodeId ? { ...item, status: 'ready', lastSeenAt: new Date().toISOString() } : item) };
    });
    await this.store.audit?.('node.ready', nodeId);
    return updated;
  }

  async createClient(input) {
    assertText(input.name, 'name');
    const nodeId = input.nodeId;
    const result = await this.store.update((state) => {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node) throw new Error('node not found');
      const client = { id: randomUUID(), name: input.name, nodeId, uuid: randomUUID(), enabled: true, createdAt: new Date().toISOString() };
      return { ...state, clients: [...state.clients, client], result: client };
    });
    await this.store.audit?.('client.created', result.id, { nodeId });
    return result;
  }

  async clientConnection(clientId) {
    const state = await this.store.read();
    const client = state.clients.find((item) => item.id === clientId && item.enabled);
    if (!client) throw new Error('client not found or disabled');
    const node = state.nodes.find((item) => item.id === client.nodeId);
    if (!node) throw new Error('client node not found');
    return { client, node, uri: connectionUri(client, node) };
  }

  async agentConfig(nodeId, token) {
    const state = await this.store.read();
    const node = state.nodes.find((item) => item.id === nodeId && item.agentToken === token);
    if (!node) throw new Error('invalid node credentials');
    const clients = state.clients.filter((client) => client.nodeId === nodeId && client.enabled);
    return desiredConfig(node, clients);
  }
}

function connectionUri(client, node) {
  const label = encodeURIComponent(`${client.name} · ${node.name}`);
  if (node.protocol === 'vless-reality') return `vless://${client.uuid}@${node.host}:${node.port}?encryption=none&security=reality&sni=${encodeURIComponent(node.sni || node.host)}&fp=chrome&pbk=${encodeURIComponent(node.realityPublicKey)}&sid=${encodeURIComponent(node.realityShortId)}&type=tcp#${label}`;
  if (node.protocol === 'hysteria2') return `hysteria2://${encodeURIComponent(node.hysteriaPassword)}@${node.host}:${node.port}?sni=${encodeURIComponent(node.sni)}&insecure=0#${label}`;
  return `amneziawg://configure?host=${encodeURIComponent(node.host)}&port=${node.port}&public_key=${encodeURIComponent(node.awgPublicKey || '')}&client_id=${client.uuid}#${label}`;
}

function desiredConfig(node, clients) {
  const users = clients.map((client) => ({ id: client.uuid, email: client.name }));
  if (node.protocol === 'vless-reality') return { version: 1, protocol: 'vless-reality', listen: `:${node.port}`, clients: users, reality: { publicKey: node.realityPublicKey, shortId: node.realityShortId, serverName: node.sni || node.host } };
  if (node.protocol === 'hysteria2') return { version: 1, protocol: 'hysteria2', listen: `:${node.port}`, users, tls: { sni: node.sni }, auth: { password: node.hysteriaPassword } };
  return { version: 1, protocol: 'amneziawg', listenPort: node.port, clients: users, publicKey: node.awgPublicKey };
}

function assertText(value, name) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`); }
function assertProtocol(value) { if (!supportedProtocols.has(value)) throw new Error('unsupported protocol'); }
