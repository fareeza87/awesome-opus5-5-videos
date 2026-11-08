// Settings staff can change in the portal (Settings page), kept in data/settings.json.
// Logins go to the encrypted vault, never to this file.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'settings.json');

export function readSettings() {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}; } catch { return {}; }
}
export function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 1));
  return next;
}
