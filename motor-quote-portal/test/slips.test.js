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

// Regression cases from the agency's own parser test suite.
const lines = (t) => t.trim().split('\n');

test('A: Takaful Ikhlas add-ons listed above the price block are itemised', () => {
  const q = parseSlipLines(lines(`
TAKAFUL IKHLAS GENERAL BERHAD
MOTOR QUOTATION SLIP FOR NEW BUSINESS
Sum Covered  100,000.00
Coverage  Comprehensive
Year of Manufacture  2021
Perlindungan Tambahan :
Extra-Benefits :
WINDSCREEN ( RM 1,000.00 )  150.00
SPECIAL PERILS ( RM 100,000.00 )  200.00
CONTRIBUTION DETAIL
Basic Takaful Contribution  2,500.00
-NCD(30.00%)  750.00
Gross Due  2,100.00
+Service Tax (8.00 %)  168.00
+Stamp Duty  10.00
Takaful Contribution Payable  2,278.00`), { today });
  assert.equal(q.status, 'quoted', q.checks.join());
  assert.deepEqual(q.addons.map((a) => [a.label, a.amount]), [['Windscreen', 150], ['Special Perils', 200]]);
  assert.equal(q.gross, 2100);
  assert.deepEqual(q.notes, []);
});

test('B: add-ons in the total but not listed are flagged', () => {
  const q = parseSlipLines(lines(`
TAKAFUL IKHLAS GENERAL BERHAD
CONTRIBUTION DETAIL
Basic Takaful Contribution  2,000.00
-NCD(0.00%)  0.00
Gross Due  2,500.00
+Service Tax (8.00 %)  200.00
+Stamp Duty  10.00
Takaful Contribution Payable  2,710.00`), { today });
  assert.match(q.notes[0], /RM500\.00 are on this slip but not listed/);
});

test('C: a slip from the wrong insurer is rejected', () => {
  const q = parseSlipLines(fixtures.allianz.lines, { filename: 'x', today, expectInsurer: 'po' });
  assert.equal(q.status, 'error');
  assert.match(q.reasons[0], /Allianz.*not Pacific & Orient/);
  assert.equal(parseSlipLines(fixtures.po.lines, { filename: 'x', today, expectInsurer: 'po' }).status, 'quoted');
});

test('D: Allianz sample calculation on later pages is ignored', () => {
  const q = parseSlipLines(fixtures.allianz.lines, { filename: 'allianz', today });
  assert.notEqual(q.basic, 1525.5);
  assert.notEqual(q.total, 1927.54);
});

test('E: a slip with no total is an error, not a guess', () => {
  const q = parseSlipLines(lines(`
ALLIANZ GENERAL INSURANCE
SCHEDULE OF PREMIUM
BASIC PREMIUM  500.00
GROSS PREMIUM  500.00
SERVICE TAX  40.00
STAMP DUTY  10.00`), { today });
  assert.equal(q.status, 'error');
  assert.match(q.reasons[0], /No total payable/);
});

test('F: service tax that is not 8% of gross is flagged', () => {
  const ok = parseSlipLines(fixtures.bsompo.lines, { filename: 'bsompo', today });
  assert.equal(ok.status, 'quoted');
  const bad = parseSlipLines(fixtures.bsompo.lines.map((l) => l.replace('171.27', '128.45').replace('2,322.19', '2,279.37')), { filename: 'bsompo', today });
  assert.equal(bad.status, 'check');
  assert.match(bad.checks.join(), /not 8% of gross/);
});
