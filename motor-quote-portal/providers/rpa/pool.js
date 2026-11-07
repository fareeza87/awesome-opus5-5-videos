// Keeps one logged-in browser tab per insurer portal and runs bot jobs on it
// one at a time. Logging in is the slowest step, so reusing the session is
// what makes quotes come back in seconds instead of minutes.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'rpa-errors');
let browserPromise;
const slots = new Map();

function browser() {
  if (!browserPromise) {
    let pw;
    try { pw = require('playwright'); } catch { throw new Error('Playwright is not installed on the server (npm install playwright)'); }
    browserPromise = pw.chromium.launch({ headless: process.env.RPA_HEADED !== '1' });
  }
  return browserPromise;
}

export function credentialsFor(provider) {
  const prefix = provider.id.toUpperCase().replace(/-/g, '_');
  const c = {
    url: process.env[`${prefix}_PORTAL_URL`] || provider.rpa?.defaultUrl,
    user: process.env[`${prefix}_PORTAL_USER`] || provider.rpa?.defaultUser,
    pass: process.env[`${prefix}_PORTAL_PASS`] || provider.rpa?.defaultPass,
  };
  if (!c.url || !c.user || !c.pass) throw new Error(`Portal login not set (${prefix}_PORTAL_URL / _USER / _PASS)`);
  return c;
}

export function runBot(provider, bot, task) {
  let slot = slots.get(provider.id);
  if (!slot) { slot = { queue: Promise.resolve() }; slots.set(provider.id, slot); }

  const job = slot.queue.then(async () => {
    const creds = credentialsFor(provider);
    if (!slot.page || slot.page.isClosed()) {
      slot.context = await (await browser()).newContext();
      slot.page = await slot.context.newPage();
      slot.page.setDefaultTimeout(Number(process.env.RPA_STEP_TIMEOUT_MS || 20000));
      slot.loggedIn = false;
    }
    const { page } = slot;
    try {
      if (!slot.loggedIn) { await bot.login(page, creds); slot.loggedIn = true; }
      try {
        return await task(page, creds);
      } catch (e) {
        // Session expired mid-way: log in again and retry once.
        if (await bot.isLoginPage(page).catch(() => false)) {
          await bot.login(page, creds);
          return await task(page, creds);
        }
        throw e;
      }
    } catch (e) {
      slot.loggedIn = false;
      await mkdir(SHOTS, { recursive: true });
      const file = path.join(SHOTS, `${provider.id}-${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: true }).catch(() => {});
      throw new Error(`${e.message.split('\n')[0]} (screenshot: data/rpa-errors/${path.basename(file)})`);
    }
  });
  slot.queue = job.catch(() => {});
  return job;
}

export async function closeAll() {
  for (const s of slots.values()) await s.context?.close().catch(() => {});
  slots.clear();
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close(); }
}
