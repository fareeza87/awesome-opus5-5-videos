import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let hasPlaywright = true;
try { createRequire(import.meta.url)('playwright'); } catch { hasPlaywright = false; }

const owner = { name: 'Ali bin Abu', idType: 'nric', nric: '880312-10-5531', postcode: '47301', address: 'No 12, Jalan SS2/24, Petaling Jaya', phone: '012-345 6789', email: 'ali@example.com', pdpaConsent: true,
  claims3y: '0', drivingExp: '12', violations: 'none', occupation: 'Engineer', race: 'Malay', religion: 'Islam' };
const quote = async (port, body, id = 'mock-po') => {
  const r = await (await fetch(`http://localhost:${port}/api/quotes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  assert.ok(r.ok, JSON.stringify(r).slice(0, 600));
  return r.results.find((x) => x.providerId === id);
};

test('P&O and Allianz bots on their practice portals', { skip: !hasPlaywright && 'Playwright not installed', timeout: 600000 }, async (t) => {
  const port = 3700 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), RPA_DEMO: '1', OTP_TIMEOUT_MS: '500', VAULT_DIR: mkdtempSync(path.join(tmpdir(), 'vault-')), QUOTES_FILE: path.join(mkdtempSync(path.join(tmpdir(), 'quotes-')), 'quotes.json'), SETTINGS_FILE: path.join(mkdtempSync(path.join(tmpdir(), 'settings-')), 'settings.json') },
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
    await t.test('e-hailing is declined; a missing address uses the town from the postcode', async () => {
      const eh = await quote(port, { owner, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: { ehailing: true } } });
      assert.match(eh.reasons[0], /e-hailing/);
      const na = await quote(port, { owner: { ...owner, address: '' }, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: {} } });
      assert.equal(na.status, 'quoted', JSON.stringify(na.reasons));
    });
    await t.test('Allianz: full quote with e-hailing, windscreen and flood from the e-Quotation PDF', async () => {
      const x = await quote(port, { owner, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', windscreenSI: 1500, addons: { windscreen: true, specialPerils: true, ehailing: true } } }, 'mock-allianz');
      assert.equal(x.status, 'quoted', JSON.stringify(x.reasons));
      assert.match(x.insurerRef, /^QKJ\d+/);
      assert.equal(x.addons.length, 4); // + waiver of compulsory excess (agency all-drivers rule)
      assert.ok(x.addons.some((a) => /waiver/i.test(a.label)));
      assert.ok(x.addons.some((a) => /private hire/i.test(a.label)));
      assert.deepEqual(x.notes, ['Allianz has no All Drivers cover: Waiver of Compulsory Excess (if not named driver) added instead']);
      assert.ok(Math.abs(x.gross + x.sst + x.stampDuty - x.total) < 0.06);
    });
    await t.test('Allianz: already renewed elsewhere (ENQ001) and missing consent', async () => {
      const r = await quote(port, { owner, vehicle: { regNo: 'EAA 1234' }, cover: { coverType: 'comprehensive', ncd: 25, sumInsured: 50000, addons: {} } }, 'mock-allianz');
      assert.match(r.reasons[0], /already renewed/i);
      const c = await quote(port, { owner: { ...owner, pdpaConsent: false }, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: {} } }, 'mock-allianz');
      assert.match(c.reasons[0], /privacy notice/);
    });
    await t.test('Takaful Ikhlas: price from Ikhlas slip, add-ons, range retry, NCD 001, blank answers use agency defaults', async () => {
      const x = await quote(port, { owner, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', windscreenSI: 1500, addons: { windscreen: true, specialPerils: true } } }, 'mock-ikhlas');
      assert.equal(x.status, 'quoted', JSON.stringify(x.reasons));
      assert.deepEqual(x.addons.map((a) => a.label), ['Windscreen', 'Special Perils', 'All Drivers'] /* All Drivers: agency rule */);
      assert.ok(!x.notes.some((n) => /requested but is not/.test(n)));
      assert.match(x.insurerRef, /^TQ\d+/);
      const r = await quote(port, { owner, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', sumInsured: 500000, addons: {} } }, 'mock-ikhlas');
      assert.equal(r.status, 'quoted');
      assert.match(r.siNote, /Takaful Ikhlas accepts/);
      const e = await quote(port, { owner, vehicle: { regNo: 'EAA 1234' }, cover: { coverType: 'comprehensive', ncd: 25, sumInsured: 50000, addons: {} } }, 'mock-ikhlas');
      assert.match(e.reasons[0], /NCD 001/);
      const m = await quote(port, { owner: { ...owner, race: '', claims3y: '' }, vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: {} } }, 'mock-ikhlas');
      assert.equal(m.status, 'quoted', JSON.stringify(m.reasons)); // blank race and claims: agency defaults (Others, 0)
    });
  } finally {
    const exited = new Promise((r) => srv.on('exit', r));
    srv.kill('SIGTERM');
    await exited;
  }
});
