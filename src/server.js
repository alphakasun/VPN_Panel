import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Panel } from './panel.js';
import { PostgresStore } from './postgres-store.js';

const htmlPath = fileURLToPath(new URL('../public/index.html', import.meta.url));
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.PANEL_API_KEY || 'change-me-before-production';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to PostgreSQL');
const store = new PostgresStore(process.env.DATABASE_URL);
await store.migrate();
const panel = new Panel(store);
await panel.initialise();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return sendFile(response);
    if (request.method === 'GET' && url.pathname === '/healthz') return json(response, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return api(request, response, url);
    return json(response, 404, { error: 'not found' });
  } catch (error) { return json(response, error.message === 'unauthorized' ? 401 : 400, { error: error.message }); }
});

async function api(request, response, url) {
  const agentMatch = url.pathname.match(/^\/api\/agent\/nodes\/([^/]+)\/config$/);
  if (request.method === 'GET' && agentMatch) {
    const config = await panel.agentConfig(agentMatch[1], bearer(request));
    return json(response, 200, config);
  }
  const readyMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/ready$/);
  if (request.method === 'POST' && readyMatch) return json(response, 200, await panel.markNodeReady(readyMatch[1], (await body(request)).agentToken));
  requireAdmin(request);
  if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, await panel.snapshot());
  if (request.method === 'POST' && url.pathname === '/api/nodes') return json(response, 201, await panel.createNode(await body(request)));
  if (request.method === 'POST' && url.pathname === '/api/clients') return json(response, 201, await panel.createClient(await body(request)));
  const connectionMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/connection$/);
  if (request.method === 'GET' && connectionMatch) return json(response, 200, await panel.clientConnection(connectionMatch[1]));
  const telegramMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/telegram$/);
  if (request.method === 'POST' && telegramMatch) return sendTelegram(response, telegramMatch[1], await body(request));
  return json(response, 404, { error: 'not found' });
}

async function sendTelegram(response, clientId, input) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  if (!input.chatId) throw new Error('chatId is required');
  const connection = await panel.clientConnection(clientId);
  const telegram = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: input.chatId, text: `Ваше подключение MeshRoute:\n\n${connection.uri}`, disable_web_page_preview: true }),
  });
  if (!telegram.ok) throw new Error(`Telegram rejected the message (${telegram.status})`);
  return json(response, 200, { delivered: true });
}

function requireAdmin(request) { if (bearer(request) !== apiKey) throw new Error('unauthorized'); }
function bearer(request) { return request.headers.authorization?.replace(/^Bearer\s+/i, '') || ''; }
async function body(request) { let raw = ''; for await (const part of request) raw += part; if (raw.length > 100_000) throw new Error('request too large'); try { return JSON.parse(raw || '{}'); } catch { throw new Error('invalid JSON'); } }
function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function sendFile(response) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(await readFile(htmlPath)); }
server.listen(port, () => console.log(`MeshRoute Panel on http://localhost:${port}; set PANEL_API_KEY before exposing it.`));
