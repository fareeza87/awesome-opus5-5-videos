// Ask every insurer at once and rank the results. `quoteOne(provider, req)`
// is a connector: demo rating in the browser, or real API/portal calls on the server.
import { validateRequest } from './rate.js';

export async function compareAll(req, providers, quoteOne, { timeoutMs = 30000 } = {}) {
  const errors = validateRequest(req);
  if (errors.length) return { ok: false, errors };

  const started = Date.now();
  const results = await Promise.all(providers.map(async (p) => {
    const t0 = Date.now();
    try {
      const quote = await withTimeout(quoteOne(p, req), timeoutMs);
      return { providerId: p.id, provider: p.name, kind: p.kind, mode: p.mode, ms: Date.now() - t0, ...quote };
    } catch (e) {
      return { providerId: p.id, provider: p.name, kind: p.kind, mode: p.mode, ms: Date.now() - t0, status: 'error', reasons: [e.message] };
    }
  }));

  const quoted = results.filter((r) => r.status === 'quoted').sort((a, b) => a.total - b.total);
  const others = results.filter((r) => r.status !== 'quoted');
  if (quoted[0]) quoted[0].cheapest = true;
  return { ok: true, ms: Date.now() - started, createdAt: new Date().toISOString(), request: req, results: [...quoted, ...others] };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`No response after ${ms / 1000}s`)), ms)),
  ]);
}
