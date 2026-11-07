// Keeps one logged-in browser tab per insurer portal and runs bot jobs on it
// one at a time. Logging in is the slowest step, so reusing the session is
// what makes quotes come back in seconds instead of minutes.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestOtp } from './otp.js';
import * as vault from './vault.js';

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

// Login details. A password the bot changed itself (kept in the vault) wins
// over the one in the environment.
export function credentialsFor(provider) {
  const prefix = provider.id.toUpperCase().replace(/-/g, '_');
  const saved = vault.getPasswords(provider.id);
  const c = {
    url: process.env[`${prefix}_PORTAL_URL`] || provider.rpa?.defaultUrl,
    user: process.env[`${prefix}_PORTAL_USER`] || provider.rpa?.defaultUser,
    pass: saved?.current || process.env[`${prefix}_PORTAL_PASS`] || provider.rpa?.defaultPass,
    pendingPass: saved?.pending || null,
  };
  if (!c.url || !c.user || !c.pass) throw new Error(`Portal login not set (${prefix}_PORTAL_URL / _USER / _PASS)`);
  return c;
}

// What a bot can use while logging in, besides the login details.
function loginContext(provider, creds, slot) {
  return {
    ...creds,
    // Pauses until staff (or the SMS forwarder) supply the code.
    askOtp: (prompt) => {
      slot.status = 'waiting-otp';
      return requestOtp(provider, prompt || `Enter the OTP ${provider.name} sent to the registered phone`).finally(() => { slot.status = null; });
    },
    // Portal demands a new password: make one, save it (pending) before
    // submitting, then mark it current once `apply` succeeds.
    changePassword: async (apply) => {
      const next = vault.newPassword();
      vault.setPending(provider.id, next);
      await apply(creds.pass, next);
      vault.commitPending(provider.id);
      creds.pass = next;
      creds.pendingPass = null;
    },
  };
}

async function login(provider, bot, page, creds, slot) {
  try {
    await bot.login(page, loginContext(provider, creds, slot));
  } catch (e) {
    // A password change may have gone through just before a crash: try the new one.
    if (!creds.pendingPass) throw e;
    await bot.login(page, loginContext(provider, { ...creds, pass: creds.pendingPass, pendingPass: null }, slot));
    vault.commitPending(provider.id);
  }
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
      if (!slot.loggedIn) { await login(provider, bot, page, creds, slot); slot.loggedIn = true; }
      try {
        return await task(page, creds);
      } catch (e) {
        // Session expired mid-way: log in again and retry once.
        if (await bot.isLoginPage(page).catch(() => false)) {
          await login(provider, bot, page, creds, slot);
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
  keepAlive(provider, bot, slot);
  return job;
}

// Portals with OTP log out after a while. A light click every few minutes
// keeps the session alive so staff are asked for an OTP rarely.
function keepAlive(provider, bot, slot) {
  if (slot.keepAlive || !bot.keepAlive) return;
  const every = Number(process.env.RPA_KEEPALIVE_MIN || 8) * 60000;
  slot.keepAlive = setInterval(() => {
    if (!slot.loggedIn) return;
    slot.queue = slot.queue.then(() => bot.keepAlive(slot.page, credentialsFor(provider))).catch(() => { slot.loggedIn = false; });
  }, every);
  slot.keepAlive.unref();
}

export async function renderPdf(html) {
  const page = await (await browser()).newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}

export async function closeAll() {
  for (const s of slots.values()) { clearInterval(s.keepAlive); await s.context?.close().catch(() => {}); }
  slots.clear();
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close(); }
}
