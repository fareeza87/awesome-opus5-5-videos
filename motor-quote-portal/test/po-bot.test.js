import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let hasPlaywright = true;
try { createRequire(import.meta.url)('playwright'); } catch { hasPlaywright = false; }

const owner = { name: 'Ali bin Abu', idType: 'nric', nric: '880312-10-5531', postcode: '47301', address: 'No 12, Jalan SS2/24, Petaling Jaya' };
const quote = async (port, body) => {
  const r = await (await fetch(`http://localhost:${port}/api/quotes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  assert.ok(r.ok, JSON.stringify(r.errors));
  return r.results.find((x) => x.providerId === 'mock-po');
};

test('P&O bot on the practice P&O portal', { skip: !hasPlaywright && 'Playwright not installed', timeout: 120000 }, async (t) => {
  const port = 3700 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), RPA_DEMO: '1', OTP_TIMEOUT_MS: '500', VAULT_DIR: mkdtempSync(path.join(tmpdir(), 'vault-')) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let log = '';
  await new Promise((res) => srv.stdout.on('data', (d) => { log += d; if (log.includes('portal on')) res(); }));
  try {
    await t.test('quotes, reads the official slip, keeps the panel name', async () => {
      const x = await quote(port, { owner, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', windscreenSI: 1500, addons: { windscreen: true, specialPerils: true } } });
      assert.equal(x.status, 'quoted', JSON.stringify(x.reasons));
      assert.equal(x.provider, 'Practice P&O (P&O bot)');
      assert.match(x.insurerRef, /^QUO\d+/);
      assert.equal(x.addons.length, 2);
      assert.ok(Math.abs(x.gross + x.sst + x.stampDuty - x.total) < 0.06);
      assert.match(x.slipFile, /^VBK2281_PO_/);
    });
    await t.test('sum insured outside P&O range is kept inside it and flagged', async () => {
      const x = await quote(port, { owner, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', sumInsured: 500000, addons: {} } });
      assert.equal(x.status, 'quoted');
      assert.ok(x.sumInsured < 500000);
      assert.match(x.siNote, /P&O accepts/);
    });
    await t.test('refer risk comes back as referred, with the reason', async () => {
      const x = await quote(port, { owner, vehicle: { regNo: 'RAA 1234' }, cover: { coverType: 'comprehensive', ncd: '', addons: {} } });
      assert.equal(x.status, 'declined');
      assert.ok(x.referred);
      assert.match(x.reasons[0], /R012 Gap for 61 days/);
    });
    await t.test('e-hailing and missing address are declined without touching the portal', async () => {
      const eh = await quote(port, { owner, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: { ehailing: true } } });
      assert.match(eh.reasons[0], /e-hailing/);
      const na = await quote(port, { owner: { ...owner, address: '' }, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: {} } });
      assert.match(na.reasons[0], /address/);
    });
  } finally {
    const exited = new Promise((r) => srv.on('exit', r));
    srv.kill('SIGTERM');
    await exited;
  }
});
