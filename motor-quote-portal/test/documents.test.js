import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchGrantOrPolicy, readDocument, closeOcr } from '../slips/grant.js';
import { parseSlipLines } from '../slips/parse.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/slips.json', import.meta.url)));

test('car grant text: plate, owner, IC, model, cc, year', () => {
  const r = matchGrantOrPolicy([
    'JABATAN PENGANGKUTAN JALAN MALAYSIA', 'SIJIL PEMILIKAN KENDERAAN',
    'No. Pendaftaran : WXY 1234', 'Nama Pemilik Berdaftar : SITI AISYAH BINTI OMAR', 'No. Kad Pengenalan : 920415-14-6688',
    'Alamat : NO 8 JALAN MAWAR 3/2', 'TAMAN MAWAR, 43000 KAJANG', 'Buatan : PERODUA', 'Nama Model : MYVI 1.5 AV',
    'Keupayaan Enjin : 1496 cc', 'Tahun Dibuat : 2020', 'No. Casis : PM2M602S002115320',
  ]);
  assert.equal(r.docType, 'grant');
  assert.deepEqual(r.fields.vehicle, { regNo: 'WXY 1234', year: 2020, model: 'PERODUA MYVI 1.5 AV', cc: 1496, chassisNo: 'PM2M602S002115320' });
  assert.deepEqual([r.fields.owner.idType, r.fields.owner.nric, r.fields.owner.name, r.fields.owner.postcode], ['nric', '920415-14-6688', 'SITI AISYAH BINTI OMAR', '43000']);
});

test('old policy: insurer\'s own registration number is not taken as the customer ID', () => {
  const r = matchGrantOrPolicy(['TAKAFUL IKHLAS GENERAL BERHAD', '201701019705 (1233870-A)', 'IC / Business Passport / Other', '000101-01-0101 (new)', 'Sum Covered  40,000.00']);
  assert.equal(r.fields.owner.idType, 'nric');
  assert.equal(r.fields.owner.nric, '000101-01-0101');
  assert.equal(r.fields.cover.sumInsured, 40000);
});

test('old policy (Generali sample): plate not mistaken for sum insured', () => {
  const r = matchGrantOrPolicy(fixtures.generali.lines);
  assert.equal(r.fields.cover.sumInsured, 24400);
});

test('photo of a car grant is read with offline OCR', { timeout: 60000 }, async () => {
  const r = await readDocument(readFileSync(new URL('./fixtures/geran-sample.jpg', import.meta.url)), { filename: 'geran.jpg' });
  await closeOcr();
  assert.equal(r.via, 'ocr');
  assert.equal(r.fields.vehicle.regNo, 'WXY 1234');
  assert.equal(r.fields.owner.nric, '920415-14-6688');
  assert.equal(r.fields.vehicle.model, 'PERODUA MYVI 1.5 AV');
  assert.equal(r.fields.vehicle.cc, 1496);
  assert.match(r.checks[0], /check the plate, IC/);
});
