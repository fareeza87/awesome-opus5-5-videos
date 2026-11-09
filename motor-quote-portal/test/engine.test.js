import test from 'node:test';
import assert from 'node:assert/strict';
import { tariffBasic, ageFromNric, region } from '../public/engine/tariff.js';
import { rateQuote, validateRequest } from '../public/engine/rate.js';
import { compareAll } from '../public/engine/compare.js';
import { PROVIDERS, quoteOne } from '../providers/index.js';

const today = new Date('2026-11-07');
const req = {
  owner: { name: 'Test', nric: '880312-10-5531', postcode: '47301' },
  vehicle: { regNo: 'VBK 2281', make: 'Perodua', model: 'Myvi', year: 2021, cc: 1496, seats: 5 },
  cover: { coverType: 'comprehensive', sumInsured: 40000, valueBasis: 'market', ncd: 55, windscreenSI: 1000, addons: { windscreen: true, llop: true } },
};

test('tariff base for 1,496cc Peninsular comprehensive, RM40k', () => {
  // 305.50 + 39 × 26.00
  assert.equal(tariffBasic({ coverType: 'comprehensive', cc: 1496, sumInsured: 40000, postcode: '47301' }), 1319.5);
});

test('TPFT is 75% of comprehensive, TP uses its own table', () => {
  assert.equal(tariffBasic({ coverType: 'tpft', cc: 1496, sumInsured: 40000, postcode: '47301' }), 1319.5 * 0.75);
  assert.equal(tariffBasic({ coverType: 'tp', cc: 1496, sumInsured: 0, postcode: '47301' }), 135);
});

test('East Malaysia postcodes', () => {
  assert.equal(region('88000'), 'east');
  assert.equal(region('93050'), 'east');
  assert.equal(region('50450'), 'peninsular');
});

test('age from NRIC', () => {
  assert.equal(ageFromNric('880312-10-5531', today), 38);
  assert.equal(ageFromNric('050101-14-1111', today), 21);
});

test('quote totals add up', () => {
  const q = rateQuote(req, { ...PROVIDERS[1], baseFactor: 1, newCarDiscount: 1 }, today);
  assert.equal(q.status, 'quoted');
  assert.equal(q.basic, 1319.5);
  assert.equal(q.ncdAmount, 725.73);
  assert.equal(q.addonTotal, 150 + 7.5);
  assert.equal(q.gross, Math.round((1319.5 - 725.73 + 157.5) * 100) / 100);
  assert.equal(q.total, Math.round((q.gross + q.sst + 10) * 100) / 100);
});

test('insurer declines old car for comprehensive', () => {
  const old = { ...req, vehicle: { ...req.vehicle, year: 2008 } };
  assert.equal(rateQuote(old, PROVIDERS.find((p) => p.id === 'insurer-d'), today).status, 'declined');
});

test('validation catches missing fields', () => {
  assert.ok(validateRequest({ owner: {}, vehicle: {}, cover: {} }).length >= 4);
  assert.deepEqual(validateRequest(req), []);
});

test('compare ranks cheapest first and survives a failing connector', async () => {
  const providers = [...PROVIDERS, { id: 'broken', name: 'Broken', kind: 'conventional', mode: 'api' }];
  const r = await compareAll(req, providers, quoteOne);
  assert.ok(r.ok);
  const quoted = r.results.filter((x) => x.status === 'quoted');
  assert.ok(quoted.length >= 4);
  for (let i = 1; i < quoted.length; i++) assert.ok(quoted[i - 1].total <= quoted[i].total);
  assert.ok(quoted[0].cheapest);
  assert.equal(r.results.find((x) => x.providerId === 'broken').status, 'error');
});
