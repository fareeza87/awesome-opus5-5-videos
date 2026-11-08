// Motor quote comparison portal — Node server (no required dependencies;
// Playwright is needed only for insurers connected by RPA).
//   GET  /api/providers          panel insurers
//   POST /api/quotes/stream      look up vehicle, quote all insurers; one JSON line per event
//   POST /api/quotes             same, single JSON reply
//   GET  /api/quotes?q=          saved comparisons
//   GET  /api/quotes/:id         one saved comparison
//   /mock-portal/*               practice insurer portal for testing RPA bots
import './load-env.js'; // must be first: settings are read by the modules below
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { compareStream } from './public/engine/compare.js';
import { PROVIDERS, currentProviders, quoteOne, lookupVehicle } from './providers/index.js';
import { PANEL } from './public/engine/providers-config.js';
import { readSettings, writeSettings } from './settings.js';
import * as vault from './providers/rpa/vault.js';
import { handleMockPortal } from './mock-portal/index.js';
import { closeAll, renderPdf } from './providers/rpa/pool.js';
import { quotationHtml } from './public/quotation.js';
import { authOn, isSignedIn, checkPassword, signInCookie, loginPage } from './auth.js';
import { networkInterfaces } from 'node:os';
import { otpEvents, listOtp, submitOtp, inboundSms } from './providers/rpa/otp.js';
import { parseSlipPdf } from './slips/parse.js';
import { comparisonFromSlips } from './slips/compare.js';
import { readDocument, closeOcr } from './slips/grant.js';
import { fiuuPayLink, fiuuConfigured } from './payments/fiuu.js';
import { atomePayLink, atomeConfigured } from './payments/atome.js';

// Printed on every quotation. Change to your agency's details.
const AGENCY = {
  name: process.env.AGENCY_NAME || 'Your Agency Sdn Bhd',
  line: process.env.AGENCY_LINE || 'Authorised agent for panel insurers & takaful operators',
  contact: process.env.AGENCY_CONTACT || 'Tel 03-0000 0000 · hello@youragency.my',
  agent: process.env.AGENCY_AGENT || 'Your insurance advisor',
  color: process.env.AGENCY_COLOR || '#0b5cad',
};

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
async function readBytes(req, max = 15_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new Error('File too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const readJson = async (req) => JSON.parse((await readText(req)) || '{}');
const readForm = async (req) => Object.fromEntries(new URLSearchParams(await readText(req)));

async function runQuote(body, staff, onEvent) {
  const result = await compareStream(body, currentProviders(), quoteOne, { lookup: lookupVehicle, onEvent });
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
    // Staff sign-in. The SMS-forwarder endpoint has its own token; practice portals are for testing.
    if (url.pathname === '/login') {
      if (req.method === 'POST') {
        const f = await readForm(req);
        if (checkPassword(f.password)) { res.writeHead(302, { 'set-cookie': signInCookie(), location: '/' }); return res.end(); }
        await new Promise((r) => setTimeout(r, 800)); // slow down guessing
        res.writeHead(401, { 'content-type': 'text/html' }); return res.end(loginPage('Wrong password'));
      }
      res.writeHead(200, { 'content-type': 'text/html' }); return res.end(loginPage());
    }
    const open = url.pathname === '/api/otp/inbound' || url.pathname.startsWith('/mock-portal');
    if (!open && !isSignedIn(req)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Please sign in' });
      res.writeHead(302, { location: '/login' }); return res.end();
    }
    if (url.pathname.startsWith('/mock-portal')) return await handleMockPortal(req, res, url, readForm);

    if (url.pathname === '/api/providers') {
      return send(res, 200, currentProviders().map(({ id, name, kind, mode, lookupSource }) => ({ id, name, kind, mode, lookupSource: !!lookupSource })));
    }
    if (url.pathname === '/api/quotes/stream' && req.method === 'POST') {
      const body = await readJson(req);
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
      const emit = (e) => res.write(JSON.stringify(e) + '\n');
      // Pass OTP requests from any bot to this staff member's screen.
      const onOtp = (o) => emit({ type: 'otp', otp: o });
      const onOtpDone = (o) => emit({ type: 'otp-done', id: o.id });
      otpEvents.on('request', onOtp);
      otpEvents.on('done', onOtpDone);
      listOtp().forEach(onOtp);
      try {
        const result = await runQuote(body, req.headers['x-staff'], emit);
        if (result.ok) emit({ type: 'done', result });
      } finally {
        otpEvents.off('request', onOtp);
        otpEvents.off('done', onOtpDone);
      }
      return res.end();
    }
    // Quotation slips downloaded from insurer portals: read one PDF.
    if (url.pathname === '/api/slips' && req.method === 'POST') {
      const pdf = await readBytes(req);
      if (pdf.subarray(0, 4).toString() !== '%PDF') return send(res, 400, { error: 'Not a PDF file' });
      const filename = decodeURIComponent(req.headers['x-filename'] || '');
      try {
        return send(res, 200, await parseSlipPdf(pdf, { filename }));
      } catch (e) {
        return send(res, 200, { status: 'error', provider: filename || 'Slip', reasons: [`Could not read this PDF: ${e.message}`] });
      }
    }
    // Payment link for the offer the customer chose; saved with the quote.
    const payWith = /^\/api\/payments\/(fiuu|atome)$/.exec(url.pathname)?.[1];
    if (payWith && req.method === 'POST') {
      if (payWith === 'fiuu' && !fiuuConfigured()) return send(res, 400, { error: 'Fiuu not set up: add FIUU_MERCHANT_ID and FIUU_VERIFY_KEY to .env' });
      if (payWith === 'atome' && !atomeConfigured()) return send(res, 400, { error: 'Atome not set up: add ATOME_PORTAL_USER and ATOME_PORTAL_PASS to .env' });
      const { quoteId, providerId } = await readJson(req);
      const rows = await loadDb();
      const row = rows.find((r) => r.id === quoteId);
      const offer = row?.results.find((o) => o.providerId === providerId && o.status === 'quoted');
      if (!offer) return send(res, 404, { error: 'Quote not found' });
      const plate = String(row.request.vehicle.regNo || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const now = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()).replace(/:/g, '');
      const orderId = `${plate}_${now}`.slice(0, 32);
      const { owner } = row.request;
      try {
        const link = payWith === 'fiuu'
          ? fiuuPayLink({ orderId, amount: offer.total, name: owner.name, email: owner.email, mobile: owner.phone, description: `Car insurance ${plate} - ${offer.provider}` })
          : (await atomePayLink({ plate, amount: offer.total, orderId })).link;
        const pay = { provider: payWith === 'fiuu' ? 'Fiuu' : 'Atome', insurer: offer.provider, amount: offer.total, orderId, link, createdAt: new Date().toISOString() };
        row.payments = [pay, ...(row.payments || [])];
        writing = writing.then(() => writeFile(DB, JSON.stringify(rows.slice(0, 2000), null, 1)));
        await writing;
        return send(res, 200, pay);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    // Settings: insurer logins (encrypted) and which insurers to quote.
    if (url.pathname === '/settings') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(await readFile(path.join(PUBLIC, 'settings.html'))); }
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      const on = new Set([...(readSettings().insurers || []), ...String(process.env.INSURERS || '').split(',').map((x) => x.trim())]);
      const portals = [
        ...PANEL.map((p) => ({ id: p.id, name: p.name, kind: 'insurer', enabled: on.has(p.id), hold: p.onHold, notes: p.notes, secret: p.id === 'allianz' })),
        { id: 'atome', name: 'Atome (payment links)', kind: 'payment', userLabel: 'Atome username' },
      ].map((p) => ({ ...p, loginSet: !!vault.getPasswords(p.id)?.current && !!vault.getPasswords(`${p.id}__user`)?.current, changedAt: vault.getPasswords(p.id)?.changedAt }));
      return send(res, 200, { portals });
    }
    if (url.pathname === '/api/settings/login' && req.method === 'POST') {
      const { id, user, pass, secret } = await readJson(req);
      if (![...PANEL.map((p) => p.id), 'atome'].includes(id)) return send(res, 400, { error: 'Unknown portal' });
      if (!user || !pass) return send(res, 400, { error: 'Enter the user ID and password' });
      vault.setPassword(`${id}__user`, user);
      vault.setPassword(id, pass);
      if (secret) vault.setPassword(`${id}__secret`, secret);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings/insurers' && req.method === 'POST') {
      const { ids = [] } = await readJson(req);
      const allowed = PANEL.filter((p) => !p.onHold).map((p) => p.id);
      return send(res, 200, writeSettings({ insurers: ids.filter((x) => allowed.includes(x)) }));
    }
    if (url.pathname === '/api/config') return send(res, 200, { fiuu: fiuuConfigured(), atome: atomeConfigured() });
    // Car grant (geran) or old policy: photo or PDF → form fields.
    if (url.pathname === '/api/documents' && req.method === 'POST') {
      const bytes = await readBytes(req);
      try {
        return send(res, 200, await readDocument(bytes, { filename: decodeURIComponent(req.headers['x-filename'] || '') }));
      } catch (e) {
        return send(res, 200, { error: `Could not read this file: ${e.message}` });
      }
    }
    // Several read slips → one saved comparison.
    if (url.pathname === '/api/slips/compare' && req.method === 'POST') {
      const { slips = [], customer = {} } = await readJson(req);
      const result = comparisonFromSlips(slips, customer);
      result.id = randomUUID().slice(0, 8).toUpperCase();
      await saveQuote(result);
      return send(res, 200, result);
    }
    if (url.pathname === '/api/otp' && req.method === 'GET') return send(res, 200, listOtp());
    if (url.pathname === '/api/otp/inbound' && req.method === 'POST') {
      // For an SMS-forwarding app on the agency phone. Needs OTP_INBOUND_TOKEN.
      const token = process.env.OTP_INBOUND_TOKEN;
      if (!token || (req.headers['x-token'] || url.searchParams.get('token')) !== token) return send(res, 403, { error: 'Bad token' });
      const raw = await readText(req);
      let text = raw;
      try { const j = JSON.parse(raw); text = j.text || j.message || j.body || raw; } catch {}
      return send(res, 200, inboundSms(String(text)));
    }
    const otpMatch = url.pathname.match(/^\/api\/otp\/([\w-]+)$/);
    if (otpMatch && req.method === 'POST') {
      const { code } = await readJson(req);
      try {
        return submitOtp(otpMatch[1], code) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'This OTP request has expired' });
      } catch (e) { return send(res, 400, { error: e.message }); }
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
    const pdf = url.pathname.match(/^\/api\/quotes\/([A-Z0-9-]+)\/pdf$/);
    if (pdf) {
      const row = (await loadDb()).find((r) => r.id === pdf[1]);
      if (!row) return send(res, 404, { error: 'Not found' });
      const ids = url.searchParams.get('ids')?.split(',').filter(Boolean);
      const file = await renderPdf(quotationHtml(row, { agency: AGENCY, ids }));
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="Quotation-${row.request.vehicle.regNo.replace(/\W/g, '')}-${row.id}.pdf"` });
      return res.end(file);
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
  // Addresses staff phones and PCs on the same Wi-Fi can open.
  const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);
  if (lan.length) console.log(`Staff on the office Wi-Fi: ${lan.join('  or  ')}`);
  if (!authOn()) console.log('WARNING: no PORTAL_PASSWORD set. Anyone on the Wi-Fi can open the portal. Set it in .env.');
  console.log(`Insurers: ${currentProviders().map((p) => `${p.name} [${p.mode}]`).join(', ')}`);
});

// Close bot browsers on shutdown so no Chromium is left running.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close();
    await closeAll().catch(() => {});
    await closeOcr().catch(() => {});
    process.exit(0);
  });
}
