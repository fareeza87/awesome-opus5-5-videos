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
      // null: no lookup available; each insurer portal looks the car up itself.
      if (found) {
        req = applyLookup(req, found);
        onEvent({ type: 'lookup', found, request: req, ms: Date.now() - started });
      }
    } catch (e) {
      return fail([`Vehicle lookup failed: ${e.message}. Fill in the vehicle details by hand.`]);
    }
  }
  // Demo pricing needs the full vehicle details; real portals only need the basics.
  const errors = providers.some((p) => p.mode === 'demo') ? validateRequest(req) : validateBasics(req);
  if (errors.length) return fail(errors);

  onEvent({ type: 'start', providers: providers.map(({ id, name, kind, mode }) => ({ id, name, kind, mode })) });
  const results = await Promise.all(providers.map(async (p) => {
    const t0 = Date.now();
    let r;
    try {
      // Bots on real portals are slower (Allianz takes about a minute).
      const quote = await withTimeout(quoteOne(p, req), p.mode === 'rpa' ? Math.max(timeoutMs, p.timeoutMs || 180000) : timeoutMs);
      r = { providerId: p.id, provider: p.name, kind: p.kind, mode: p.mode, ms: Date.now() - t0, ...quote };
      if (r.status === 'quoted' && r.sumInsured === undefined) r.sumInsured = req.cover.sumInsured;
    } catch (e) {
      r = { providerId: p.id, provider: p.name, kind: p.kind, mode: p.mode, ms: Date.now() - t0, status: 'error', reasons: [e.message] };
    }
    onEvent({ type: 'quote', result: r });
    return r;
  }));

  // Real portals found the car themselves: fill blanks from the cheapest slip,
  // so the comparison and quotation show what the insurers quoted on.
  const ranked = rank(results);
  const best = ranked.find((r) => r.status === 'quoted');
  if (best) {
    const v = best.vehicle || {};
    req = {
      ...req,
      vehicle: { ...req.vehicle, year: req.vehicle.year || v.year, model: req.vehicle.model || v.makeModel },
      cover: { ...req.cover, sumInsured: req.cover.sumInsured || best.sumInsured, ncd: req.cover.ncd === '' || req.cover.ncd === undefined ? best.ncdPercent : req.cover.ncd },
    };
  }
  const result = { ok: true, ms: Date.now() - started, createdAt: new Date().toISOString(), request: req, results: ranked };
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
