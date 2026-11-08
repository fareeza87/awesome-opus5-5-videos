import test from 'node:test';
import assert from 'node:assert/strict';
import { customerMessage, roundMY, atomeAmount } from '../public/whatsapp.js';

test('rounding to 5 sen and the Atome amount (rounded total + 6%)', () => {
  assert.equal(roundMY(1773.39), 1773.4);
  assert.equal(roundMY(2455.28), 2455.3);
  assert.equal(atomeAmount(1773.39), 1879.8); // agency sample: 3 x 626.60
});

test('agency WhatsApp message: breakdown, rounded total, both payment links', () => {
  const row = { request: { owner: { nric: '990618-12-5725', idType: 'nric' }, vehicle: { regNo: 'SJN 8559' }, cover: { coverType: 'comprehensive' } } };
  const offer = { provider: 'Allianz General Insurance', providerId: 'allianz', kind: 'conventional', coverType: 'comprehensive', sumInsured: 64000, ncdPercent: 25,
    basic: 2150.36, ncdAmount: 537.59, addons: [{ key: 'waiverExcess', label: 'Waiver Of Compulsory Excess If Not Named Driver', amount: 20 }], addonTotal: 20,
    gross: 1632.77, sst: 130.62, stampDuty: 10, total: 1773.39, vehicle: { makeModel: 'PERODUA ATIVA 1.0 AV MY21 5D SUV', year: 2025 } };
  const t = customerMessage(row, offer, { fiuu: { link: 'https://f', amount: 1773.4 }, atome: { link: 'https://a', amount: 1879.8 } });
  for (const line of ['*ALLIANZ*', '*Vehicle No:* SJN8559', '*Model:* Perodua Ativa 1.0 Av (2025)', '*Agreed Value:* RM 64,000.00', '• Less NCD (25%): -RM 537.59',
    '• *Net Basic Premium:* RM 1,612.77', '• Extra Cover Premium: RM 20.00', '*TOTAL AMOUNT (Rounded): RM 1,773.40*', '👉 https://f', '*Amount: RM 626.60 / month (3 payments)*']) {
    assert.ok(t.includes(line), `missing: ${line}\n${t}`);
  }
});
