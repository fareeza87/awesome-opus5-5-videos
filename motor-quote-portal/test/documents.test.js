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

test('new-format grant (VOC) as laid out on a real scan', () => {
  const r = matchGrantOrPolicy([
    'SIJIL  PEMILIKAN  KENDERAAN', '(VEHICLE  OWNERSHIP  CERTIFICATE)', 'JABATAN  PENGANGKUTAN  JALAN  MALAYSIA',
    'No. Pendaftaran  :  ABC1234', 'No.  ID  :  900101145678', 'Nama Pemunya Berdaftar  :  ALI BIN ABU',
    'A l amat  :  NO 1. TAMAN CONTOH', '25250 BESERAH PAHANG',
    'No.  Chasis  /  No.  Enjin  :  PM2B200S003200000  /  H47B000',
    'Buatan  /  Nama Model  : PERODUA /  AXIA  -  1000  G  (AUTO)', 'Keupayaan Enjin  :  998', 'Bahan  Bakar  :  PETROL',
    'Status  Asal  :  PEMASANGAN TEMPATAN', 'Kelas  Kegunaan  :  PERSENDIRIAN-MOTOKAR INDIVIDU', 'Jenis  Badan  /  Tahun  Dibuat  :  MOTOKAR /  2016',
  ]);
  assert.equal(r.docType, 'grant');
  assert.deepEqual(r.fields.vehicle, { regNo: 'ABC 1234', year: 2016, model: 'PERODUA AXIA 1000 G (AUTO)', cc: 998, chassisNo: 'PM2B200S003200000', engineNo: 'H47B000', origin: 'local' });
  assert.deepEqual(r.fields.owner, { idType: 'nric', nric: '900101-14-5678', name: 'ALI BIN ABU', address: 'NO 1. TAMAN CONTOH, 25250 BESERAH PAHANG', postcode: '25250' });
});
