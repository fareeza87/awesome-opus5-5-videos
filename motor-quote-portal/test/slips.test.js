import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSlipLines } from '../slips/parse.js';
import { comparisonFromSlips } from '../slips/compare.js';

// Price lines from real insurer slips, with customer details removed.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/slips.json', import.meta.url)));
const today = new Date('2026-10-15');

for (const [id, f] of Object.entries(fixtures)) {
  test(`reads ${id} slip and the sums add up`, () => {
    const q = parseSlipLines(f.lines, { filename: f.filename, today });
    assert.equal(q.providerId, id);
    for (const [k, v] of Object.entries(f.expect)) assert.deepEqual(q[k], v, `${id}.${k}`);
    assert.equal(q.status, 'quoted', (q.checks || []).join());
    assert.ok(Math.abs(q.gross + q.sst + q.stampDuty - (q.discount || 0) - q.total) < 0.06);
  });
}

test('a slip whose figures do not add up is flagged for checking', () => {
  const f = fixtures.bsompo;
  const lines = f.lines.map((l) => l.replace('2,322.19', '2,422.19'));
  const q = parseSlipLines(lines, { filename: f.filename, today });
  assert.equal(q.status, 'check');
  assert.match(q.checks[0], /2422\.19/);
});

test('slips become one comparison, cheapest first, odd sum insured flagged', () => {
  const read = Object.values(fixtures).map((f) => parseSlipLines(f.lines, { filename: f.filename, today }));
  const allianz = read.find((r) => r.providerId === 'allianz');
  const twin = { ...allianz, providerId: 'generali', provider: 'Generali', total: allianz.total - 50, sumInsured: allianz.sumInsured + 5000 };
  const c = comparisonFromSlips([allianz, { ...allianz, total: allianz.total + 10 }, twin], { name: 'Ali' });
  assert.equal(c.results[0].provider, 'Generali');
  assert.ok(c.results[0].cheapest);
  assert.match(c.results[0].siNote, /others at RM121,000/);
  assert.equal(c.request.cover.sumInsured, 121000);
  assert.deepEqual(c.warnings, []);
});

test('warns when the slips are for different cars', () => {
  const a = parseSlipLines(fixtures.allianz.lines, { filename: 'allianz', today });
  const c = comparisonFromSlips([{ ...a, vehicle: { regNo: 'WXY 1234' } }, { ...a, vehicle: { regNo: 'JQA 9' } }]);
  assert.match(c.warnings[0], /different vehicles/);
});
