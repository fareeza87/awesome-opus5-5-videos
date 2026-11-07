// One-time codes for insurer portals that send an OTP at login (e.g. Zurich).
// The bot pauses and asks; the code arrives either from staff typing it on
// the quote screen, or from an SMS-forwarding app posting to /api/otp/inbound.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export const otpEvents = new EventEmitter();
const pending = new Map();
const TIMEOUT_MS = Number(process.env.OTP_TIMEOUT_MS || 180000);

export function requestOtp(provider, prompt) {
  const id = randomUUID().slice(0, 8);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`No OTP entered for ${provider.name} within ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
    const entry = { id, providerId: provider.id, provider: provider.name, prompt, createdAt: Date.now(), resolve, reject, timer };
    function finish(err, code) {
      clearTimeout(timer);
      pending.delete(id);
      otpEvents.emit('done', { id, providerId: provider.id });
      if (err) reject(err); else resolve(code);
    }
    entry.finish = finish;
    pending.set(id, entry);
    otpEvents.emit('request', publicView(entry));
  });
}

export function listOtp() {
  return [...pending.values()].map(publicView);
}

export function submitOtp(id, code) {
  const entry = pending.get(id);
  if (!entry) return false;
  const clean = String(code).replace(/\s/g, '');
  if (!/^\d{4,8}$/.test(clean)) throw new Error('OTP should be 4–8 digits');
  entry.finish(null, clean);
  return true;
}

// From an SMS-forwarding app: picks the code out of the message text and
// gives it to the waiting insurer (matched by name in the SMS, else the oldest).
export function inboundSms(text) {
  const code = /\b(\d{6})\b/.exec(text)?.[1] || /\b(\d{4,8})\b/.exec(text)?.[1];
  if (!code) return { matched: false, reason: 'No code found in message' };
  const waiting = [...pending.values()].sort((a, b) => a.createdAt - b.createdAt);
  const lower = text.toLowerCase();
  const entry = waiting.find((e) => lower.includes(e.provider.split(' ')[0].toLowerCase())) || waiting[0];
  if (!entry) return { matched: false, reason: 'No portal is waiting for an OTP' };
  entry.finish(null, code);
  return { matched: true, provider: entry.provider };
}

function publicView({ id, providerId, provider, prompt, createdAt }) {
  return { id, providerId, provider, prompt, expiresAt: createdAt + TIMEOUT_MS };
}
