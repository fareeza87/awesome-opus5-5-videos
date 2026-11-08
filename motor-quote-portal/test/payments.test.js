import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fiuuPayLink } from '../payments/fiuu.js';

test('Fiuu link: signed with md5(amount + merchant + order + verify key)', () => {
  process.env.FIUU_MERCHANT_ID = 'testmerchant';
  process.env.FIUU_VERIFY_KEY = 'secretkey123';
  const link = new URL(fiuuPayLink({ orderId: 'VBK2281_101500', amount: 2110.6, name: 'Ali', mobile: '012-345 6789', description: 'Car insurance VBK2281' }));
  assert.equal(link.origin + link.pathname, 'https://pay.fiuu.com/RMS/pay/testmerchant/');
  assert.equal(link.searchParams.get('amount'), '2110.60');
  assert.equal(link.searchParams.get('orderid'), 'VBK2281_101500');
  assert.equal(link.searchParams.get('bill_mobile'), '60123456789');
  assert.equal(link.searchParams.get('vcode'), createHash('md5').update('2110.60testmerchantVBK2281_101500secretkey123').digest('hex'));
  assert.throws(() => fiuuPayLink({ orderId: 'X', amount: 0 }), /more than RM0/);
  delete process.env.FIUU_VERIFY_KEY;
  assert.throws(() => fiuuPayLink({ orderId: 'X', amount: 10 }), /Fiuu not set up/);
});

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
let hasPlaywright = true;
try { createRequire(import.meta.url)('playwright'); } catch { hasPlaywright = false; }

test('Atome bot: link for this order only, right outlet, real amount', { skip: !hasPlaywright && 'Playwright not installed', timeout: 120000 }, async () => {
  const port = 3600 + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT: String(port), DEMO_INSURERS: '1', VAULT_DIR: mkdtempSync(path.join(tmpdir(), 'v-')),
    ATOME_PORTAL_URL: `http://localhost:${port}/mock-portal/atome`, ATOME_PORTAL_USER: 'agent01', ATOME_PORTAL_PASS: 'demo123' };
  const srv = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let log = '';
  await new Promise((r) => srv.stdout.on('data', (d) => { log += d; if (log.includes('portal on')) r(); }));
  const post = async (p, body) => (await fetch(`http://localhost:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const q = await post('/api/quotes', { owner: { name: 'Ali', idType: 'nric', nric: '880312-10-5531', postcode: '47301', phone: '0123456789' }, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: {} } });
    const offer = q.results.find((o) => o.status === 'quoted');
    const pay = await post('/api/payments/atome', { quoteId: q.id, providerId: offer.providerId });
    assert.match(pay.link, /^https:\/\/gateway\.atome\.my\/pay\/VBK2281_\d{6}-/);
    assert.ok(!pay.link.includes('OTHERCUSTOMER'));
    assert.equal(pay.amount, offer.total);
    const saved = await (await fetch(`http://localhost:${port}/api/quotes/${q.id}`)).json();
    assert.equal(saved.payments[0].link, pay.link);
  } finally {
    const exited = new Promise((r) => srv.on('exit', r));
    srv.kill('SIGTERM'); await exited;
  }
  // Wrong outlet name: refuse instead of picking the first outlet.
  process.env.ATOME_OUTLET = 'NoSuchOutlet';
  const srv2 = spawn(process.execPath, ['server.js'], { env: { ...env, ATOME_OUTLET: 'NoSuchOutlet' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let log2 = '';
  await new Promise((r) => srv2.stdout.on('data', (d) => { log2 += d; if (log2.includes('portal on')) r(); }));
  try {
    const q = await post('/api/quotes', { owner: { name: 'Ali', idType: 'nric', nric: '880312-10-5531', postcode: '47301' }, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: {} } });
    const r = await post('/api/payments/atome', { quoteId: q.id, providerId: q.results.find((o) => o.status === 'quoted').providerId });
    assert.match(r.error, /outlet "NoSuchOutlet" not found/);
  } finally {
    delete process.env.ATOME_OUTLET;
    const exited = new Promise((r) => srv2.on('exit', r));
    srv2.kill('SIGTERM'); await exited;
  }
});
