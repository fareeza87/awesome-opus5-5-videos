// Ask every insurer at once. Results are reported one by one as each
// insurer answers, so staff see the first prices within seconds.
//   quoteOne(provider, req)  connector: demo, RPA bot, webhook or API
//   lookup(req)              optional IC + plate lookup when details are missing
//   onEvent(event)           { type: 'lookup' | 'start' | 'quote' | 'done' | 'error', ... }
import { validateBasics, validateRequest } from './rate.js';
import { applyLookup } from './lookup.js';

export function needsLookup(req) {
  return !req.vehicle?.cc || !req.vehicle?.year || (req.cover?.coverType !== 'tp' && !req.cover?.sumInsured)
    || req.cover?.ncd === '' || req.cover?.ncd === undefined || req.cover?.ncd === null;
}

export async function compareStream(req, providers, quoteOne, { lookup, onEvent = () => {}, timeoutMs = 60000 } = {}) {
  const started = Date.now();
  const basic = validateBasics(req);
  if (basic.length) { onEvent({ type: 'error', errors: basic }); return { ok: false, errors: basic }; }

  if (needsLookup(req)) {
    if (!lookup) return fail(['Vehicle details are missing']);
    try {
      const found = await lookup(req);
      req = applyLookup(req, found);
      onEvent({ type: 'lookup', found, request: req, ms: Date.now() - started });
    } catch (e) {
      return fail([`Vehicle lookup failed: ${e.message}. Fill in the vehicle details by hand.`]);
    }
  }
  const errors = validateRequest(req);
  if (errors.length) return fail(errors);

  onEvent({ type: 'start', providers: providers.map(({ id, name, kind, mode }) => ({ id, name, kind, mode })) });
  const results = await Promise.all(providers.map(async (p) => {
    const t0 = Date.now();
    let r;
    try {
      const quote = await withTimeout(quoteOne(p, req), timeoutMs);
      r = { providerId: p.id, provider: p.name, kind: p.kind, mode: p.mode, ms: Date.now() - t0, ...quote };
      if (r.status === 'quoted' && r.sumInsured === undefined) r.sumInsured = req.cover.sumInsured;
    } catch (e) {
      r = { providerId: p.id, provider: p.name, kind: p.kind, mode: p.mode, ms: Date.now() - t0, status: 'error', reasons: [e.message] };
    }
    onEvent({ type: 'quote', result: r });
    return r;
  }));

  const result = { ok: true, ms: Date.now() - started, createdAt: new Date().toISOString(), request: req, results: rank(results) };
  return result;

  function fail(errs) { onEvent({ type: 'error', errors: errs }); return { ok: false, errors: errs }; }
}

export function rank(results) {
  const quoted = results.filter((r) => r.status === 'quoted').sort((a, b) => a.total - b.total);
  quoted.forEach((r, i) => { r.cheapest = i === 0; });
  return [...quoted, ...results.filter((r) => r.status !== 'quoted')];
}

// Kept for callers that want the whole answer at once.
export const compareAll = (req, providers, quoteOne, opts = {}) => compareStream(req, providers, quoteOne, opts);

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`No response after ${ms / 1000}s`)), ms); }),
  ]).finally(() => clearTimeout(t));
}
