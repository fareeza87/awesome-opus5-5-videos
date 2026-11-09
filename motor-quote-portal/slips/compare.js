// Turns a set of read slips into one saved comparison, like a live quote.
import { rank } from '../public/engine/compare.js';

export function comparisonFromSlips(slips, customer = {}) {
  const ok = slips.filter((s) => s.status === 'quoted' || s.status === 'check');
  // The sum insured most slips agree on is the one we compare at.
  const counts = new Map();
  for (const s of ok) if (s.sumInsured) counts.set(s.sumInsured, (counts.get(s.sumInsured) || 0) + 1);
  const si = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const first = ok[0] || {};
  const v = ok.map((s) => s.vehicle || {}).reduce((a, b) => ({ regNo: a.regNo || b.regNo, year: a.year || b.year, makeModel: a.makeModel || b.makeModel }), {});
  const [make, ...model] = String(v.makeModel || '').split(' ');

  const results = slips.map((s, i) => {
    const r = { ...s, providerId: `${s.providerId}-${i}`, mode: 'slip', ms: 0, notes: [...(s.notes || [])] };
    if (r.status === 'check') { r.status = 'quoted'; r.notes = [...(r.notes || []), ...s.checks.map((c) => `Check slip: ${c}`)]; }
    if (si && s.sumInsured && s.sumInsured !== si) r.siNote = `Quoted at sum insured RM${s.sumInsured.toLocaleString()}, others at RM${si.toLocaleString()}`;
    return r;
  });

  // Slips for different cars can't be compared: say so up front.
  const warnings = [];
  const plates = new Set(ok.map((s) => s.vehicle?.regNo?.replace(/\s/g, '').toUpperCase()).filter((p) => p && p !== 'ABC1234'));
  if (plates.size > 1) warnings.push(`These slips are for different vehicles (${[...plates].join(', ')}). Check you uploaded the right files.`);

  return {
    ok: true,
    source: 'slips',
    warnings,
    ms: 0,
    createdAt: new Date().toISOString(),
    request: {
      owner: { idType: 'nric', nric: '', name: customer.name || '', phone: customer.phone || '', postcode: '' },
      vehicle: { regNo: customer.regNo || v.regNo || '—', make: make || '', model: model.join(' '), year: v.year },
      cover: { coverType: first.coverType || 'comprehensive', sumInsured: si || 0, ncd: first.ncdPercent ?? 0, addons: {} },
    },
    results: rank(results),
  };
}
