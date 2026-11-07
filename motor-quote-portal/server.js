// Motor quote comparison portal — Node server (no required dependencies;
// Playwright is needed only for insurers connected by RPA).
//   GET  /api/providers          panel insurers
//   POST /api/quotes/stream      look up vehicle, quote all insurers; one JSON line per event
//   POST /api/quotes             same, single JSON reply
//   GET  /api/quotes?q=          saved comparisons
//   GET  /api/quotes/:id         one saved comparison
//   /mock-portal/*               practice insurer portal for testing RPA bots
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { compareStream } from './public/engine/compare.js';
import { PROVIDERS, quoteOne, lookupVehicle } from './providers/index.js';
import { handleMockPortal } from './mock-portal/index.js';
import { closeAll } from './providers/rpa/pool.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DB = path.join(ROOT, 'data', 'quotes.json');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

let writing = Promise.resolve();
async function loadDb() {
  if (!existsSync(DB)) return [];
  return JSON.parse(await readFile(DB, 'utf8'));
}
function saveQuote(row) {
  writing = writing.then(async () => {
    const rows = await loadDb();
    rows.unshift(row);
    await mkdir(path.dirname(DB), { recursive: true });
    await writeFile(DB, JSON.stringify(rows.slice(0, 2000), null, 1));
  });
  return writing;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readText(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100_000) throw new Error('Request too large');
  }
  return data;
}
const readJson = async (req) => JSON.parse((await readText(req)) || '{}');
const readForm = async (req) => Object.fromEntries(new URLSearchParams(await readText(req)));

async function runQuote(body, staff, onEvent) {
  const result = await compareStream(body, PROVIDERS, quoteOne, { lookup: lookupVehicle, onEvent });
  if (result.ok) {
    result.id = randomUUID().slice(0, 8).toUpperCase();
    result.staff = staff || null;
    await saveQuote(result);
  }
  return result;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/mock-portal')) return await handleMockPortal(req, res, url, readForm);

    if (url.pathname === '/api/providers') {
      return send(res, 200, PROVIDERS.map(({ id, name, kind, mode, lookupSource }) => ({ id, name, kind, mode, lookupSource: !!lookupSource })));
    }
    if (url.pathname === '/api/quotes/stream' && req.method === 'POST') {
      const body = await readJson(req);
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
      const emit = (e) => res.write(JSON.stringify(e) + '\n');
      const result = await runQuote(body, req.headers['x-staff'], emit);
      if (result.ok) emit({ type: 'done', result });
      return res.end();
    }
    if (url.pathname === '/api/quotes' && req.method === 'POST') {
      const result = await runQuote(await readJson(req), req.headers['x-staff']);
      return send(res, result.ok ? 200 : 400, result);
    }
    if (url.pathname === '/api/quotes' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const rows = (await loadDb()).filter((r) => !q || JSON.stringify(r.request).toLowerCase().includes(q));
      return send(res, 200, rows.slice(0, 50).map(summary));
    }
    const m = url.pathname.match(/^\/api\/quotes\/([A-Z0-9-]+)$/);
    if (m) {
      const row = (await loadDb()).find((r) => r.id === m[1]);
      return row ? send(res, 200, row) : send(res, 404, { error: 'Not found' });
    }

    // Static files.
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) {
    if (res.headersSent) { res.end(JSON.stringify({ type: 'error', errors: [e.message] }) + '\n'); return; }
    send(res, 500, { error: e.message });
  }
});

function summary(r) {
  const best = r.results.find((x) => x.cheapest);
  return {
    id: r.id,
    createdAt: r.createdAt,
    customer: r.request.owner?.name,
    regNo: r.request.vehicle?.regNo,
    vehicle: `${r.request.vehicle?.make ?? ''} ${r.request.vehicle?.model ?? ''}`.trim(),
    cheapest: best ? { provider: best.provider, total: best.total } : null,
    quoted: r.results.filter((x) => x.status === 'quoted').length,
  };
}

server.listen(PORT, () => {
  console.log(`Motor quote portal on http://localhost:${PORT}`);
  console.log(`Insurers: ${PROVIDERS.map((p) => `${p.name} [${p.mode}]`).join(', ')}`);
});

// Close bot browsers on shutdown so no Chromium is left running.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close();
    await closeAll().catch(() => {});
    process.exit(0);
  });
}
