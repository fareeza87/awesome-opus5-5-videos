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

// `npm run demo:rpa` adds a bot-driven insurer using the practice portal,
// and makes it the source of the IC + plate lookup.
const RPA_DEMO = process.env.RPA_DEMO === '1' ? [{
  id: 'mock-rpa',
  name: 'Mock Insurer (live RPA)',
  kind: 'conventional',
  mode: 'rpa',
  lookupSource: true,
  rpa: { bot: 'mock-portal', defaultUrl: `http://localhost:${PORT}/mock-portal`, defaultUser: 'agent01', defaultPass: 'demo123' },
}] : [];

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
