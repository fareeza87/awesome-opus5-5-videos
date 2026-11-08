// Connectors: how the server gets a quote from each insurer.
//   demo    – priced locally from providers-config.js (sample only)
//   rpa     – built-in Playwright bot logs in to the insurer's agent portal
//   webhook – calls a bot in your own RPA tool (UiPath, Power Automate…)
//   api     – insurer's agency API, if they offer one
import { rateQuote } from '../public/engine/rate.js';
import { demoLookup } from '../public/engine/lookup.js';
import { PROVIDERS as CONFIGURED, PANEL } from '../public/engine/providers-config.js';
import { quoteViaApi } from './api-connector.js';
import { quoteViaWebhook } from './webhook-connector.js';
import { quoteViaRpa, lookupViaRpa } from './rpa/index.js';
import { readSettings } from '../settings.js';

const PORT = Number(process.env.PORT || 3000);

// `npm run demo:rpa` adds bot-driven insurers on the practice portal: a plain
// one (also used for the IC + plate lookup), a Zurich-style one with OTP, and
// an Etiqa-style one with forced password change and a splash screen.
const mock = (id, name, style, pass, extra = {}) => ({
  id, name, kind: 'conventional', mode: 'rpa', ...extra,
  rpa: { bot: 'mock-portal', defaultUrl: `http://localhost:${PORT}/mock-portal/${style}`, defaultUser: 'agent01', defaultPass: pass },
});
const RPA_DEMO = process.env.RPA_DEMO === '1' ? [
  mock('mock-rpa', 'Mock Insurer (live RPA)', 'basic', 'demo123', { lookupSource: true }),
  mock('mock-otp', 'Mock Zurich-style (OTP)', 'otp', 'demo123', { kind: 'takaful' }),
  mock('mock-etiqa', 'Mock Etiqa-style (password change)', 'etiqa', 'Demo@12345678', { kind: 'takaful' }),
  { id: 'mock-po', name: 'Practice P&O (P&O bot)', kind: 'conventional', mode: 'rpa',
    rpa: { bot: 'po', defaultUrl: `http://localhost:${PORT}/mock-portal/po/`, defaultUser: 'agent01', defaultPass: 'demo123' } },
  { id: 'mock-ikhlas', name: 'Practice Takaful Ikhlas (Ikhlas bot)', kind: 'takaful', mode: 'rpa', ehailing: false,
    rpa: { bot: 'ikhlas', defaultUrl: `http://localhost:${PORT}/mock-portal/ikhlas/loginTAK.jsp`, defaultUser: 'agent01', defaultPass: 'demo123' } },
  { id: 'mock-allianz', name: 'Practice Allianz (Allianz bot)', kind: 'conventional', mode: 'rpa', ehailing: { periods: ['annual'] },
    rpa: { bot: 'allianz', defaultUrl: `http://localhost:${PORT}/mock-portal/allianz/`, defaultUser: 'agent01', defaultPass: 'demo123', defaultSecret: 'blue' } },
].filter((p) => !process.env.PRACTICE || process.env.PRACTICE.split(',').includes(p.id)) : [];

// Real insurers: INSURERS=po,allianz,ikhlas in .env, plus any switched on in Settings.
const envWanted = String(process.env.INSURERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const unknown = envWanted.filter((id) => !PANEL.some((p) => p.id === id));
if (unknown.length) console.warn(`INSURERS: unknown insurer id(s) ${unknown.join(', ')}. Known: ${PANEL.map((p) => p.id).join(', ')}`);

// Worked out on every quote, so Settings changes apply without a restart.
export function currentProviders() {
  const wanted = new Set([...envWanted, ...(readSettings().insurers || [])]);
  const real = PANEL.filter((p) => wanted.has(p.id)).map((p) => ({ ...p, enabled: true }));
  const showDemo = process.env.DEMO_INSURERS !== undefined ? process.env.DEMO_INSURERS === '1' : !real.length;
  return [...real, ...RPA_DEMO, ...(showDemo ? CONFIGURED.filter((p) => p.enabled !== false) : [])];
}
export const PROVIDERS = currentProviders();
// Demo pricing needs full vehicle details; real portals look the car up themselves.
export const usesDemoPricing = () => currentProviders().some((p) => p.mode === 'demo');
export const USES_DEMO_PRICING = usesDemoPricing();

// Portals that shut at night, e.g. P&O is off from 9pm to 5am.
//   hours: { closed: ['21:00', '05:00'] }   (Malaysia time)
export function portalClosed(provider, now = new Date()) {
  const [from, to] = provider.hours?.closed || [];
  if (!from) return null;
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(now);
  const shut = from < to ? hm >= from && hm < to : hm >= from || hm < to;
  const fmt = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
  return shut ? `${provider.name} portal is closed from ${fmt(from)} to ${fmt(to)}. Try again after ${fmt(to)}.` : null;
}

export async function quoteOne(provider, req) {
  const closed = portalClosed(provider);
  if (closed) return { status: 'declined', closed: true, reasons: [closed] };
  switch (provider.mode) {
    case 'demo': return rateQuote(req, provider);
    case 'rpa': return quoteViaRpa(provider, req);
    case 'webhook': return quoteViaWebhook(provider, req);
    case 'api': return quoteViaApi(provider, req);
    default: throw new Error(`Unknown connector mode "${provider.mode}"`);
  }
}

// IC + plate → vehicle, NCD, recommended sum insured. Done once, on the
// insurer marked lookupSource, so every insurer is then quoted on the same
// vehicle details and the same sum insured.
export async function lookupVehicle(req) {
  const src = currentProviders().find((p) => p.lookupSource);
  if (src?.mode === 'rpa') return { source: src.name, ...(await lookupViaRpa(src, req)) };
  if (src?.mode === 'webhook') return { source: src.name, ...(await quoteViaWebhook(src, req, 'lookup')) };
  // Only demo insurers may use the made-up demo lookup.
  if (!usesDemoPricing()) return null;
  const found = demoLookup(req);
  if (!found) throw new Error('Plate number not recognised');
  return { source: 'Demo lookup', ...found };
}
