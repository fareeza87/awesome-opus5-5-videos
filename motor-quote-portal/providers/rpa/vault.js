// Encrypted store for portal passwords that the bots change themselves
// (e.g. Etiqa forces a new password). Saved in data/vault.json, encrypted
// with AES-256-GCM using VAULT_KEY from the environment.
//
// A new password is saved as "pending" BEFORE the bot submits it to the
// portal, and made current once the portal accepts it. If anything breaks
// in between, the next login tries both, so the agency is never locked out.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const dir = () => process.env.VAULT_DIR || DEFAULT_DIR;
const FILE = () => path.join(dir(), 'vault.json');
const KEY_FILE = () => path.join(dir(), '.vault-key');

function key() {
  let secret = process.env.VAULT_KEY;
  if (!secret) {
    // No key configured: create one next to the vault (fine for a single office
    // server; set VAULT_KEY in production so a copied vault file is useless).
    mkdirSync(dir(), { recursive: true });
    if (!existsSync(KEY_FILE())) { writeFileSync(KEY_FILE(), randomBytes(32).toString('hex')); chmodSync(KEY_FILE(), 0o600); }
    secret = readFileSync(KEY_FILE(), 'utf8').trim();
  }
  return createHash('sha256').update(secret).digest();
}

function load() {
  return existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), 'utf8')) : {};
}
function save(all) {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(FILE(), JSON.stringify(all, null, 1));
  chmodSync(FILE(), 0o600);
}
function enc(text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function dec(box) {
  if (!box) return null;
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
}

export function getPasswords(id) {
  const e = load()[id];
  return e ? { current: dec(e.current), pending: dec(e.pending), changedAt: e.changedAt } : null;
}

export function setPassword(id, password) {
  const all = load();
  all[id] = { ...all[id], current: enc(password), pending: null, changedAt: new Date().toISOString() };
  save(all);
}

export function setPending(id, password) {
  const all = load();
  all[id] = { ...all[id], pending: enc(password) };
  save(all);
}

export function commitPending(id) {
  const all = load();
  if (!all[id]?.pending) return;
  all[id] = { current: all[id].pending, pending: null, changedAt: new Date().toISOString() };
  save(all);
}

export function list() {
  return Object.entries(load()).map(([id, e]) => ({ id, changedAt: e.changedAt, hasPending: !!e.pending }));
}

// 14 characters with upper, lower, digit and symbol; no look-alike characters.
export function newPassword(length = 14) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*!?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
