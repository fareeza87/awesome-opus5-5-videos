import test from 'node:test';
import assert from 'node:assert/strict';
import { quotationHtml } from '../public/quotation.js';
import { compareStream } from '../public/engine/compare.js';
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS } from '../public/engine/providers-config.js';

const req = {
  owner: { idType: 'nric', nric: '880312-10-5531', name: 'Ali', postcode: '47301' },
  vehicle: { regNo: 'VBK 2281', make: 'Perodua', model: 'Myvi', year: 2021, cc: 1496, seats: 5 },
  cover: { coverType: 'comprehensive', sumInsured: 40000, ncd: 55, addons: { windscreen: true }, windscreenSI: 1000 },
};

test('one-page comparison: lowest first, NRIC masked, only ticked insurers', async () => {
  const r = await compareStream(req, PROVIDERS, async (p, q) => rateQuote(q, p));
  r.id = 'T1';
  const ids = r.results.filter((o) => o.status === 'quoted').slice(1, 3).map((o) => o.providerId);
  const html = quotationHtml(r, { agency: { name: 'Test Agency' }, ids });
  assert.match(html, /Test Agency/);
  assert.match(html, /XXXXXX-XX-5531/);
  assert.doesNotMatch(html, /880312/);
  const names = r.results.filter((o) => ids.includes(o.providerId)).map((o) => o.provider.replace(/\s*\(.*\)/, ''));
  for (const n of names) assert.ok(html.includes(n), n);
  assert.equal((html.match(/class="ribbon"/g) || []).length, 1);
});
