// Connectors: how the server gets a quote from each insurer.
//   demo   – priced locally from providers-config.js (works today)
//   api    – insurer's agency API (fill in once the insurer gives you access)
//   portal – logs in to the insurer's agent portal with a headless browser
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS } from '../public/engine/providers-config.js';
import { quoteViaApi } from './api-connector.js';
import { quoteViaPortal } from './portal-connector.js';

export { PROVIDERS };

export async function quoteOne(provider, req) {
  switch (provider.mode) {
    case 'demo': return rateQuote(req, provider);
    case 'api': return quoteViaApi(provider, req);
    case 'portal': return quoteViaPortal(provider, req);
    default: throw new Error(`Unknown connector mode "${provider.mode}"`);
  }
}
