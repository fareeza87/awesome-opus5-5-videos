// Reads a car grant (VOC / geran) or an old policy / cover note into the quote
// form. Ported from the agency's match_grant_or_policy. Text PDFs are read
// directly; photos go through OCR on this computer (tesseract.js, offline), so
// customer documents never leave the office.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pdfLines } from './text.js';

const require = createRequire(import.meta.url);
let workerPromise;

async function ocr(image) {
  if (!workerPromise) {
    const { createWorker } = await import('tesseract.js');
    const langPath = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
    workerPromise = createWorker('eng', 1, { langPath: path.join(langPath, '4.0.0_best_int'), cacheMethod: 'none', gzip: true })
      .catch(() => createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true }));
  }
  const worker = await workerPromise;
  const { data } = await worker.recognize(image);
  return data.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export async function closeOcr() {
  if (workerPromise) { const w = await workerPromise.catch(() => null); workerPromise = null; await w?.terminate(); }
}

// bytes: the uploaded file. Returns { docType, fields, found, lines }.
export async function readDocument(bytes, { filename = '' } = {}) {
  const isPdf = bytes.subarray(0, 4).toString() === '%PDF';
  let lines = [];
  let via = 'text';
  if (isPdf) {
    lines = (await pdfLines(bytes)).map((l) => l.trim()).filter(Boolean);
    if (lines.join('').replace(/\s/g, '').length < 40) return { error: 'This PDF is a scanned image. Take a photo of the document instead.' };
  } else if (/^\xff\xd8|^\x89PNG|^RIFF|^GIF8/.test(bytes.subarray(0, 4).toString('latin1')) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(filename)) {
    lines = await ocr(bytes);
    via = 'ocr';
  } else {
    return { error: 'Send a photo (JPG/PNG) or a PDF' };
  }
  const r = matchGrantOrPolicy(lines);
  // OCR mixes up look-alike characters (S/5, 1/I, 0/O): flag what came from a photo.
  if (via === 'ocr') r.checks.push('Read from a photo: check the plate, IC and numbers against the document before quoting');
  return { via, ...r };
}

const PLATE = /^[A-Z]{1,3}\s?\d{1,4}\s?[A-Z]{0,2}$/;
const cleanPlate = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]+)(\d+)([A-Z]*)$/, (m, a, b, c) => `${a} ${b}${c}`);

export function matchGrantOrPolicy(lines) {
  const text = lines.join('\n');
  const up = text.toUpperCase();
  const isGrant = /SIJIL PEMILIKAN KENDERAAN|GERAN|\bVOC\b|JABATAN PENGANGKUTAN JALAN|PENDAFTARAN KENDERAAN|BAHAN BAKAR|KELAS KEGUNAAN/.test(up);
  const fields = { owner: {}, vehicle: {}, cover: {} };
  const found = [];

  // Value after a label on the same line, else on the next lines.
  const after = (labelRe, valueRe, look = 3) => {
    for (let i = 0; i < lines.length; i++) {
      const m = labelRe.exec(lines[i]);
      if (!m) continue;
      const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:.\-/]+/, '');
      const same = valueRe.exec(rest);
      if (same) return same[1] ?? same[0];
      for (let k = i + 1; k <= Math.min(i + look, lines.length - 1); k++) {
        const v = valueRe.exec(lines[k]);
        if (v) return v[1] ?? v[0];
      }
    }
    return null;
  };
  const set = (obj, key, val, label) => { if (val !== null && val !== undefined && val !== '') { obj[key] = val; found.push(label); } };

  // Plate.
  // (not "SST Registration No.", which is the insurer's tax number)
  let plate = after(/(?<!sst\s)(?:no\.?\s*pendaftaran(?!\s*(perniagaan|syarikat))|vehicle\s*(registration|reg\.?)\s*no|vehicle\s*no\.?|registration\s*no\.?(\s*vehicle)?|car\s*plate|plate\s*no)/i, /\b([A-Z]{1,3}\s?\d{1,4}\s?[A-Z]{0,2})\b(?![-\d])/i);
  if (!plate) plate = lines.map((l) => l.trim()).find((l) => PLATE.test(l.toUpperCase()));
  if (!plate) plate = /^\s*([A-Z]{1,3}\d{1,4}[A-Z]?)\s{2,}(?:year|tahun)/im.exec(text)?.[1];
  if (plate) set(fields.vehicle, 'regNo', cleanPlate(plate), 'plate');

  // Year, model, cc, chassis, engine.
  const year = after(/tahun\s*dibuat|tahun\s*diperbuat|year\s*of\s*(manufacture|make)/i, /\b((?:19|20)\d{2})\b/);
  if (year) set(fields.vehicle, 'year', Number(year), 'year');
  const make = after(/^\s*buatan\b(?!\s*&|\s*\/)/i, /^([A-Z][A-Z0-9 .\-()]{2,30})$/i, 0)
    || /^\s*buatan\b[^A-Za-z]*([A-Z][A-Z-]{2,20})\s*$/im.exec(text)?.[1];
  let model = after(/nama\s*model|buatan\s*\/\s*(nama\s*)?model|make\s*(&|and)\s*model(\s*of\s*vehicle)?|vehicle\s*model/i, /^([A-Z][A-Z0-9 .\-()/]{2,40}?)(?:\s{2,}|\s+(?:cubic|keupayaan|tahun|year)\b|$)/i, 2);
  if (model && make && !model.toUpperCase().includes(make.toUpperCase())) model = `${make} ${model}`;
  if (!model && make) model = make;
  if (model) model = model.replace(/^(\s*(of|vehicle|nama\s*model|model)\b[\s:]*)+/i, '').trim();
  if (model) set(fields.vehicle, 'model', model.toUpperCase(), 'model');
  const cc = /\b(\d{1,2},\d{3}|\d{3,4})(?:\.\d+)?\s*(?:cc|c\.c\.)/i.exec(text)?.[1]
    || after(/keupayaan\s*enjin|cubic\s*capacity/i, /\b(\d{1,2},\d{3}|\d{3,4})(?:\.\d+)?\b/, 1);
  if (cc) set(fields.vehicle, 'cc', Number(cc.replace(/,/g, '')), 'cc');
  const chassis = after(/no\.?\s*casis|chassis\s*no/i, /\b([A-Z0-9]{10,20})\b/i, 1);
  if (chassis) set(fields.vehicle, 'chassisNo', chassis.toUpperCase(), 'chassis no.');
  const engine = after(/no\.?\s*enjin|engine\s*no/i, /\b([A-Z0-9]{6,20})\b/i, 1);
  if (engine) set(fields.vehicle, 'engineNo', engine.toUpperCase(), 'engine no.');

  // Owner ID: passport, company, NRIC. Ignore the insurer's / agent's own
  // registration numbers (header lines with BERHAD, SST, PIDM, agency codes).
  const own = /berhad|insurance|takaful|assurance|pidm|sst\s*reg|registration\s*no\.?\s*\d|agen(t|cy)|intermediary|licensed|\(\d{4,7}-[A-Z]\)/i;
  const idText = lines.filter((l) => !own.test(l) || /\b(ic|business|syarikat|perniagaan|insured|participant|nama|name)\b/i.test(l)).join('\n');
  const passport = /(?:passport|pasport)[^:\n]*[:\s]*([A-Z]\d{7,9})\b/i.exec(idText)?.[1];
  const nric = /\b(\d{6}-\d{2}-\d{4})\b/.exec(idText)?.[1] || /\b(\d{12})\b/.exec(idText.replace(/\b20\d{10}\b/g, ''))?.[1];
  const brn = /\b(20\d{10})\b/.exec(idText)?.[1];
  const brnOld = /\b(\d{5,7}-[A-Z]|[A-Z]{2}\d{5,7}-[A-Z])\b/.exec(idText)?.[1];
  const companyName = /\b(SDN\.?\s*BHD|BERHAD|ENTERPRISE|TRADING|PLT|SYARIKAT)\b/i;
  if (passport) { set(fields.owner, 'idType', 'passport', 'ID type'); set(fields.owner, 'nric', passport.toUpperCase(), 'passport no.'); }
  else if (nric && !brn) {
    const d = nric.replace(/\D/g, '');
    set(fields.owner, 'idType', 'nric', 'ID type');
    set(fields.owner, 'nric', `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`, 'NRIC');
  }
  else if (brn || (brnOld && companyName.test(up))) { set(fields.owner, 'idType', 'company', 'ID type'); set(fields.owner, 'nric', brn || brnOld, 'company reg. no.'); if (brn && brnOld) fields.owner.oldBrn = brnOld; }
  else if (nric) {
    const d = nric.replace(/\D/g, '');
    set(fields.owner, 'idType', 'nric', 'ID type');
    set(fields.owner, 'nric', `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`, 'NRIC');
  }

  // Owner name.
  const name = after(/nama\s*pemilik(\s*berdaftar)?|the\s*insured|pihak\s*diinsuranskan|\bproposer\b|\bname\b|\bnama\b|participant/i,
    /^([A-Z][A-Z@'./\s-]{2,60}?)\s*$/i, 2);
  if (name && !/alamat|address|jalan|taman|schedule|quotation|tel\b/i.test(name)) set(fields.owner, 'name', name.trim().toUpperCase(), 'name');

  // Address and postcode (policies usually have them; grants show the owner's address too).
  const addrStart = lines.findIndex((l) => /^\s*(alamat|address)\b/i.test(l));
  if (addrStart >= 0) {
    const parts = [lines[addrStart].replace(/^\s*(alamat|address)\s*[:.]?\s*/i, '')];
    for (let k = addrStart + 1; k < Math.min(addrStart + 4, lines.length) && !/\b\d{5}\b/.test(parts.join(' ')); k++) {
      if (/[a-z ]{3,25}:/i.test(lines[k]) || /no\.?\s*(casis|enjin)|chassis|engine/i.test(lines[k])) break;
      parts.push(lines[k]);
    }
    const addr = parts.map((p) => p.trim()).filter(Boolean).join(', ');
    if (addr) set(fields.owner, 'address', addr.toUpperCase(), 'address');
  }
  const pc = /\b(\d{5})\b/.exec(fields.owner.address || '')?.[1];
  if (pc) set(fields.owner, 'postcode', pc, 'postcode');

  // From an old policy: sum insured and NCD (the renewal NCD may differ: shown as a hint).
  if (!isGrant) {
    // The sum insured/covered itself first; market or agreed value only if there is none.
    const amount = /(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{4,}\.\d{2})/;
    const si = after(/sum\s*(insured|covered)|jumlah\s*diinsuranskan|vehicle\s*sum/i, amount, 2) || after(/agreed\s*value|market\s*value/i, amount, 2);
    if (si && Number(si.replace(/,/g, '')) >= 1000) set(fields.cover, 'sumInsured', Number(si.replace(/,/g, '')), 'sum insured');
    const ncd = /(?:NCD|No\s*Claim\s*Discount|DTT)[^%0-9\n]*(\d{1,2}(?:\.\d{1,2})?)\s*%/i.exec(text)?.[1];
    if (ncd) fields.cover.lastNcd = Number(ncd);
  }

  const checks = [];
  return { docType: isGrant ? 'grant' : 'policy', fields, found, checks, lines: lines.length };
}
