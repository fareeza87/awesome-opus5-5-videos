import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryPremium } from '../providers/rpa/bots/allianz.js';

// Text as Allianz's Summary page shows it (VQE9278, 8 Nov 2026).
const page = 'Premium Summary\tTotal (RM)\nVehicle Sum Insured\t37,000.00\nAnnual Premium\t1,004.06\nBasic Premium\t1,338.75\n'
  + 'No Claim Discount (25.00%)\t334.69\nTotal Extra Cover Premium\t0.00\nGross Premium\t1,004.06\nRebate (0%)\t0.00\n'
  + 'Service Tax (8%)\t80.32\nStamp Duty\t10.00\nCommission (10%)\t100.41\nTotal Amount\t1,094.38\n';

test('Allianz summary page price is read with its NCD, commission left out', () => {
  assert.deepEqual(summaryPremium(page), { sumInsured: 37000, basic: 1338.75, ncdPercent: 25, ncdAmount: 334.69, addonTotal: 0, gross: 1004.06, sst: 80.32, stampDuty: 10, total: 1094.38 });
});

test('Allianz summary that does not add up is not used', () => {
  assert.equal(summaryPremium(page.replace('1,094.38', '1,194.38')), null);
  assert.equal(summaryPremium('no premium here'), null);
});

test('Allianz summary extra cover table: e-hailing named', async () => {
  const { summaryAddons } = await import('../providers/rpa/bots/allianz.js');
  const t = 'Extra Coverage\nThese coverage(s) / service(s) are provided at no extra cost.\n24 HOUR EMERGENCY TOWING\nExtra Cover\tPremium (RM)\nPRIVATE HIRE CAR ENDORSEMENT\t1,972.54\ne-Hailing Drivers Name\n';
  assert.deepEqual(summaryAddons(t), [{ key: 'ehailing', label: 'Private Hire Car Endorsement', amount: 1972.54 }]);
});
