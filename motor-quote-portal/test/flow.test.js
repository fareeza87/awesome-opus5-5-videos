import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareStream } from '../public/engine/compare.js';
import { demoLookup } from '../public/engine/lookup.js';
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS } from '../public/engine/providers-config.js';

const minimal = {
  owner: { idType: 'nric', nric: '880312-10-5531', postcode: '47301' },
  vehicle: { regNo: 'VBK 2281' },
  cover: { coverType: 'comprehensive', valueBasis: 'market', ncd: '', addons: { llop: true } },
};

test('IC + plate only: looks up once, quotes everyone on the same sum insured', async () => {
  const events = [];
  let lookups = 0;
  const r = await compareStream(structuredClone(minimal), PROVIDERS, async (p, req) => rateQuote(req, p), {
    lookup: async (req) => { lookups++; return demoLookup(req); },
    onEvent: (e) => events.push(e.type),
  });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(lookups, 1);
  assert.deepEqual(events.slice(0, 2), ['lookup', 'start']);
  assert.equal(events.filter((t) => t === 'quote').length, PROVIDERS.length);
  const si = r.request.cover.sumInsured;
  assert.ok(si > 1000);
  for (const q of r.results.filter((x) => x.status === 'quoted')) assert.equal(q.sumInsured, si);
});

test('bad IC is rejected before any bot runs', async () => {
  let called = false;
  const r = await compareStream({ ...minimal, owner: { ...minimal.owner, nric: '123' } }, PROVIDERS, async () => { called = true; }, { lookup: async () => { called = true; } });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

let hasPlaywright = true;
try { createRequire(import.meta.url)('playwright'); } catch { hasPlaywright = false; }

test('RPA bot logs in to the practice portal, looks up and quotes', { skip: !hasPlaywright && 'Playwright not installed', timeout: 60000 }, async () => {
  const port = 3900 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), RPA_DEMO: '1', OTP_TIMEOUT_MS: '1500', VAULT_DIR: mkdtempSync(path.join(tmpdir(), 'vault-')) }, stdio: 'pipe' });
  try {
    await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('portal on') && res()));
    const res = await fetch(`http://localhost:${port}/api/quotes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(minimal) });
    const r = await res.json();
    assert.ok(r.ok, JSON.stringify(r));
    const bot = r.results.find((x) => x.mode === 'rpa');
    assert.equal(bot.status, 'quoted', JSON.stringify(bot.reasons));
    assert.ok(bot.total > 100);
    assert.match(bot.insurerRef, /^MQ\d+/);
    assert.equal(bot.sumInsured, r.request.cover.sumInsured);
  } finally {
    const exited = new Promise((res) => srv.on('exit', res));
    srv.kill('SIGTERM');
    await exited;
    srv.stdout.destroy();
  }
});
