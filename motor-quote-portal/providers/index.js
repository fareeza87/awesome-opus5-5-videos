// Connectors: how the server gets a quote from each insurer.
//   demo    – priced locally from providers-config.js (sample only)
//   rpa     – built-in Playwright bot logs in to the insurer's agent portal
//   webhook – calls a bot in your own RPA tool (UiPath, Power Automate…)
//   api     – insurer's agency API, if they offer one
import { rateQuote } from '../public/engine/rate.js';
import { demoLookup } from '../public/engine/lookup.js';
import { PROVIDERS as CONFIGURED } from '../public/engine/providers-config.js';
import { quoteViaApi } from './api-connector.js';
import { quoteViaWebhook } from './webhook-connector.js';
import { quoteViaRpa, lookupViaRpa } from './rpa/index.js';

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
] : [];

export const PROVIDERS = [...RPA_DEMO, ...CONFIGURED.filter((p) => p.enabled !== false)];

export async function quoteOne(provider, req) {
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
  const src = PROVIDERS.find((p) => p.lookupSource);
  if (src?.mode === 'rpa') return { source: src.name, ...(await lookupViaRpa(src, req)) };
  if (src?.mode === 'webhook') return { source: src.name, ...(await quoteViaWebhook(src, req, 'lookup')) };
  const found = demoLookup(req);
  if (!found) throw new Error('Plate number not recognised');
  return { source: 'Demo lookup', ...found };
}
