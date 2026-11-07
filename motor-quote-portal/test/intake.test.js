import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomerMessage } from '../public/engine/intake.js';
import { portalClosed } from '../providers/index.js';
import { auditAddons } from '../slips/audit.js';

test('WhatsApp template fills the form, nothing invented', () => {
  const r = parseCustomerMessage(`Car Plate: WXY 1234\nName: AHMAD BIN ISMAIL\nNRIC: 880312-10-5531\nContact: 012-345 6789\nEmail: ahmad@example.com\nAddress: No 12, Jalan Mawar 3, 43000 Kajang, Selangor\nCar model: Perodua Myvi 1.5 2019\nWindscreen RM1500\nE-hailing: No`);
  assert.equal(r.vehicle.regNo, 'WXY 1234');
  assert.equal(r.owner.nric, '880312-10-5531');
  assert.equal(r.owner.postcode, '43000');
  assert.equal(r.vehicle.year, 2019);
  assert.equal(r.cover.windscreenSI, 1500);
  assert.equal(r.cover.addons.ehailing, undefined);
  const casual = parseCustomerMessage('Salam, nak renew VBK 2281 ic 900101-14-5678 tambah banjir. Grab annual');
  assert.equal(casual.vehicle.regNo, 'VBK 2281');
  assert.ok(casual.cover.addons.specialPerils && casual.cover.addons.ehailing);
  assert.equal(casual.owner.postcode, undefined);
  const two = parseCustomerMessage('Alamat: No 12, Jalan SS2/24\n47301 Petaling Jaya\nTambah windscreen RM1500');
  assert.equal(two.owner.address, 'No 12, Jalan SS2/24, 47301 Petaling Jaya');
  const one = parseCustomerMessage('Alamat: No 12, Jalan SS2/24, 47301 Petaling Jaya\nTambah windscreen RM1500 dan banjir');
  assert.equal(one.owner.address, 'No 12, Jalan SS2/24, 47301 Petaling Jaya');
  assert.equal(parseCustomerMessage('Company SYARIKAT CONTOH SDN BHD 202301099999 JQA1234').owner.idType, 'company');
});

test('P&O portal closed 9pm to 5am Malaysia time', () => {
  const po = { name: 'P&O', hours: { closed: ['21:00', '05:00'] } };
  assert.ok(portalClosed(po, new Date('2026-11-07T15:30:00Z')));   // 11:30pm
  assert.equal(portalClosed(po, new Date('2026-11-07T21:00:00Z')), null); // 5:00am
  assert.ok(portalClosed(po, new Date('2026-11-08T13:00:00Z')));   // 9:00pm
  assert.equal(portalClosed(po, new Date('2026-11-08T03:00:00Z')), null); // 11am
});

test('flags a requested add-on missing from the insurer slip', () => {
  const notes = auditAddons({ addons: { windscreen: true, specialPerils: true } }, { addons: [{ label: 'Windscreen Or Windows', amount: 450 }] });
  assert.deepEqual(notes, ["Special perils was requested but is not on the insurer's quotation"]);
});
