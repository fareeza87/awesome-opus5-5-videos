import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS, PANEL } from '../public/engine/providers-config.js';
import { inboundSms, requestOtp } from '../providers/rpa/otp.js';
import * as vault from '../providers/rpa/vault.js';

const req = (cover = {}) => ({
  owner: { idType: 'nric', nric: '880312-10-5531', postcode: '47301' },
  vehicle: { regNo: 'VBK 2281', make: 'Perodua', model: 'Myvi', year: 2021, cc: 1496, seats: 5 },
  cover: { coverType: 'comprehensive', sumInsured: 40000, ncd: 55, addons: { ehailing: true }, ehailingPeriod: '3m', ...cover },
});
const demo = PROVIDERS[0];
const panel = (id) => ({ ...demo, ...PANEL.find((p) => p.id === id) });

test('Generali: e-hailing annual only, fixed RM1,950', () => {
  const q = rateQuote(req(), panel('generali'));
  const eh = q.addons.find((a) => a.key === 'ehailing');
  assert.equal(eh.amount, 1950);
  assert.match(eh.label, /annual/);
  assert.match(q.notes.join(), /Only annual e-hailing/);
});

test('Allianz: asked 3 months, quoted annual and flagged; others quote 3 months', () => {
  const allianz = rateQuote(req(), panel('allianz'));
  const other = rateQuote(req(), demo);
  assert.match(allianz.addons.find((a) => a.key === 'ehailing').label, /annual/);
  assert.equal(allianz.notes.length, 1);
  assert.match(other.addons.find((a) => a.key === 'ehailing').label, /3 months/);
  assert.equal(other.notes.length, 0);
});

test('insurer without e-hailing declines', () => {
  assert.equal(rateQuote(req(), PROVIDERS.find((p) => p.id === 'takaful-c')).status, 'declined');
});

test('SMS forwarder: code goes to the insurer named in the message', async () => {
  const z = requestOtp({ id: 'zurich', name: 'Zurich General Takaful' }, 'x');
  const a = requestOtp({ id: 'other', name: 'Allianz' }, 'x');
  assert.deepEqual(inboundSms('Zurich: your one-time PIN is 482913. Do not share.'), { matched: true, provider: 'Zurich General Takaful' });
  assert.equal(await z, '482913');
  inboundSms('Code 111222');
  assert.equal(await a, '111222');
});

test('vault: encrypted at rest, pending password survives until confirmed', () => {
  process.env.VAULT_DIR = mkdtempSync(path.join(tmpdir(), 'vault-'));
  vault.setPassword('etiqa', 'Old@Password123');
  vault.setPending('etiqa', 'New@Password456');
  assert.deepEqual([vault.getPasswords('etiqa').current, vault.getPasswords('etiqa').pending], ['Old@Password123', 'New@Password456']);
  vault.commitPending('etiqa');
  assert.equal(vault.getPasswords('etiqa').current, 'New@Password456');
  const p = vault.newPassword();
  assert.ok(p.length >= 14 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p));
  delete process.env.VAULT_DIR;
});

let hasPlaywright = true;
try { createRequire(import.meta.url)('playwright'); } catch { hasPlaywright = false; }

test('live bots: OTP login (staff types code) and forced password change + splash', { skip: !hasPlaywright && 'Playwright not installed', timeout: 90000 }, async () => {
  const port = 3800 + Math.floor(Math.random() * 90);
  const vaultDir = mkdtempSync(path.join(tmpdir(), 'vault-'));
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), RPA_DEMO: '1', VAULT_DIR: vaultDir }, stdio: ['ignore', 'pipe', 'inherit'] });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  try {
    await new Promise((res) => srv.stdout.on('data', () => log.includes('portal on') && res()));
    const res = await fetch(`http://localhost:${port}/api/quotes/stream`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...req({ addons: {} }), vehicle: { regNo: 'VBK 2281' }, cover: { coverType: 'comprehensive', ncd: '', addons: {} } }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', done = null, otpAsked = 0;
    while (!done) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ev = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (ev.type === 'otp') {
          otpAsked++;
          // Staff read the SMS (here: the practice portal's log) and type it in.
          await new Promise((r) => setTimeout(r, 100));
          const code = /OTP sent to registered phone: (\d{6})/.exec(log)[1];
          const ok = await fetch(`http://localhost:${port}/api/otp/${ev.otp.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
          assert.equal(ok.status, 200);
        }
        if (ev.type === 'done') done = ev.result;
        if (ev.type === 'error') assert.fail(ev.errors.join());
      }
    }
    assert.equal(otpAsked, 1);
    const by = (id) => done.results.find((r) => r.providerId === id);
    for (const id of ['mock-rpa', 'mock-otp', 'mock-etiqa']) assert.equal(by(id).status, 'quoted', `${id}: ${by(id).reasons}`);

    process.env.VAULT_DIR = vaultDir;
    const saved = vault.getPasswords('mock-etiqa');
    delete process.env.VAULT_DIR;
    assert.ok(saved.current && saved.current !== 'Demo@12345678', 'new Etiqa password saved');
    assert.equal(saved.pending, null);
  } finally {
    const exited = new Promise((r) => srv.on('exit', r));
    srv.kill('SIGTERM');
    await exited;
  }
});
