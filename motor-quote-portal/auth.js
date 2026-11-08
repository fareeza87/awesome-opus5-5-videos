// Simple portal password, so only staff on the office Wi-Fi can open it.
// Set PORTAL_PASSWORD in .env. Sign-ins last 12 hours on that device.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET = randomBytes(32);          // new on each restart: everyone signs in again
const HOURS = 12;
const sign = (exp) => createHmac('sha256', SECRET).update(String(exp)).digest('hex');

export const authOn = () => !!process.env.PORTAL_PASSWORD;

export function isSignedIn(req) {
  if (!authOn()) return true;
  const m = /mq_auth=(\d+)\.([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  const a = Buffer.from(m[2], 'hex');
  const b = Buffer.from(sign(m[1]), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkPassword(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(process.env.PORTAL_PASSWORD || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signInCookie() {
  const exp = Date.now() + HOURS * 3600e3;
  return `mq_auth=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${HOURS * 3600}`;
}

export const loginPage = (error = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Motor Quote Compare</title>
<style>
  :root { --bg:#f4f6f8; --card:#fff; --text:#17202a; --muted:#5d6b7a; --line:#dde3ea; --brand:#0b5cad; --warn:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1419; --card:#182028; --text:#e6edf3; --muted:#95a3b3; --line:#2a3541; --brand:#4c9cf0; --warn:#ff8a80; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text); font:15px system-ui, sans-serif; padding:16px; box-sizing:border-box; }
  form { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:24px; width:100%; max-width:340px; display:grid; gap:12px; }
  h1 { font-size:18px; margin:0; } p { margin:0; color:var(--muted); font-size:13px; }
  input { font:inherit; padding:10px; border:1px solid var(--line); border-radius:7px; background:var(--bg); color:var(--text); }
  button { font:inherit; font-weight:600; padding:10px; border:0; border-radius:7px; background:var(--brand); color:#fff; }
  .err { color:var(--warn); }
</style></head><body>
<form method="post" action="/login">
  <h1>Motor Quote Compare</h1><p>Staff sign-in</p>
  ${error ? `<p class="err">${error}</p>` : ''}
  <input type="password" name="password" placeholder="Portal password" autofocus autocomplete="current-password" aria-label="Portal password">
  <button>Sign in</button>
</form></body></html>`;
