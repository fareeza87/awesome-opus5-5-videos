// Motor quote comparison portal — zero-dependency Node server.
//   GET  /api/providers      list of panel insurers
//   POST /api/quotes         compare all insurers for one customer, saves it
//   GET  /api/quotes         recent saved comparisons
//   GET  /api/quotes/:id     one saved comparison
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { compareAll } from './public/engine/compare.js';
import { PROVIDERS, quoteOne } from './providers/index.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DB = path.join(ROOT, 'data', 'quotes.json');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

async function loadDb() {
  if (!existsSync(DB)) return [];
  return JSON.parse(await readFile(DB, 'utf8'));
}
async function saveDb(rows) {
  await mkdir(path.dirname(DB), { recursive: true });
  await writeFile(DB, JSON.stringify(rows.slice(0, 1000), null, 1));
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100_000) throw new Error('Request too large');
  }
  return JSON.parse(data || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/providers') {
      return send(res, 200, PROVIDERS.map(({ id, name, kind, mode }) => ({ id, name, kind, mode })));
    }
    if (url.pathname === '/api/quotes' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await compareAll(body, PROVIDERS, quoteOne);
      if (!result.ok) return send(res, 400, result);
      result.id = randomUUID().slice(0, 8).toUpperCase();
      result.staff = req.headers['x-staff'] || null;
      const rows = await loadDb();
      rows.unshift(result);
      await saveDb(rows);
      return send(res, 200, result);
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

server.listen(PORT, () => console.log(`Motor quote portal on http://localhost:${PORT}`));
