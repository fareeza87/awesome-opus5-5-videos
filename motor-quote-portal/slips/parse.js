// Reads an insurer's motor quotation slip (PDF) into our quote format.
// One reader handles every layout by looking for the labels insurers use
// ("Basic Premium", "NCD", "Gross Contribution", "Service Tax", ...), then
// checks the arithmetic: basic − NCD + add-ons = gross, gross + tax + stamp = total.
// If the sums don't add up, the result is flagged for staff to check.
import { pdfLines } from './text.js';

const INSURERS = [
  ['zurich', /zurich/i, 'Zurich General Takaful', 'takaful'],
  ['etiqa', /etiqa/i, 'Etiqa General Takaful', 'takaful'],
  ['allianz', /allianz/i, 'Allianz General Insurance', 'conventional'],
  ['generali', /generali/i, 'Generali Insurance Malaysia', 'conventional'],
  ['bsompo', /berjaya sompo/i, 'Berjaya Sompo Insurance', 'conventional'],
  ['po', /pacific\s*&\s*orient|pacific-orient/i, 'Pacific & Orient Insurance', 'conventional'],
  ['ikhlas', /takaful ikhlas/i, 'Takaful Ikhlas General', 'takaful'],
  ['stm', /takaful malaysia|^\s*PARTICIPANT\s*:/im, 'Takaful Malaysia', 'takaful'],
  ['liberty', /liberty general/i, 'Liberty General Insurance', 'conventional'],
  ['msig', /msig/i, 'MSIG Insurance (Malaysia)', 'conventional'],
];

// Amounts like 1,234.56 — but not percentages (25.00 %) or dates (28.11.2026).
const MONEY = /(?<![\d.,])(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d.)]|\s?%)/g;
const money = (line) => [...line.matchAll(MONEY)].map((m) => Number(m[1].replace(/,/g, '')));
const lastMoney = (line) => money(line).at(-1);
const r2 = (n) => Math.round(n * 100) / 100;
const close = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;

const L = {
  basic: /basic (takaful )?(premium|contribution)(?! \(trailer\))|caruman asas/i,
  ncd: /\bncd\b|no.?claim.?discount/i,
  loading: /^\s*\+?\s*loading/i,
  gross: /gross (premium|contribution|due)|^\s*total premium\s|^\s*annual premium/i,
  discount: /total discount|rebate/i,
  sst: /services? tax|\bsst\b/i,
  stamp: /stamp duty|duti setem/i,
  total: /total (amount )?(payable|due)|total gross due|^\s*\+?\s*gross due\b|total contribution|total payable|payable (premium|contribution)|amount due|takaful contribution payable|total premium \/ jumlah/i,
  rounded: /\(rounded\)|digenapkan/i,
  sum: /sum (insured|covered)|estimate value|vehicle sum\b|\bagreed value\s{2,}[\d,]+\.\d{2}/i,
  notAddon: /trailer|net basic|total extra coverage|additional coverage|^\s*total\s*:|loading|rebate|gst|^\s*\+ extra coverage\s/i,
};

export async function parseSlipPdf(data, { filename = '', today = new Date(), expectInsurer } = {}) {
  return parseSlipLines(await pdfLines(data), { filename, today, expectInsurer });
}

const SST_RATE = Number(globalThis.process?.env?.SST_RATE ?? 0.08);

// expectInsurer: the insurer a bot was quoting. A slip from any other insurer
// (e.g. an old file picked up by mistake) is rejected, not read.
export function parseSlipLines(lines, { filename = '', today = new Date(), expectInsurer } = {}) {
  const text = lines.join('\n');
  const found = INSURERS.find(([, re]) => re.test(text))
    || INSURERS.find(([id]) => new RegExp(`(^|[^a-z])${id}([^a-z]|$)`, 'i').test(filename))
    || (/ƽƽƽ/.test(text) ? INSURERS.find(([id]) => id === 'msig') : null);
  const [providerId, , provider, kind] = found || ['unknown', null, 'Unknown insurer', 'conventional'];
  if (expectInsurer && providerId !== expectInsurer) {
    const want = INSURERS.find(([id]) => id === expectInsurer)?.[2] || expectInsurer;
    return { status: 'error', providerId, provider, kind, reasons: [`This PDF is ${found ? `a ${provider}` : 'not a recognised'} quotation, not ${want}`] };
  }

  const q = providerId === 'msig' && !/basic/i.test(text) ? readByPosition(lines) : readByLabels(lines);
  if (!q) {
    const why = !/total|payable|amount due/i.test(text) ? 'No total payable found on this slip' : 'Could not find the premium figures on this slip';
    return { status: 'error', providerId, provider, kind, reasons: [why] };
  }

  const checks = [];
  const notes = [];
  const addonTotal = r2(q.gross - q.basic + q.ncdAmount - (q.loading || 0) + (q.discount || 0));
  if (q.addonItems.length && !close(q.addonItems.reduce((s, a) => s + a.amount, 0), addonTotal)) q.addonItems = [];
  // Slips whose add-on names can't be read (MSIG): show one combined line.
  if (q.addonItems.length > 1 && q.addonItems.every((a) => a.label === 'Extra coverage')) q.addonItems = [];
  const addons = q.addonItems.length ? q.addonItems : (addonTotal > 0.005 ? [{ key: 'extra', label: 'Extra coverage', amount: addonTotal }] : []);
  if (addonTotal < -0.05) checks.push('Basic − NCD is more than gross: check the figures');
  if (addonTotal > 0.005 && !q.addonItems.length) notes.push(`Add-ons of RM${addonTotal.toFixed(2)} are on this slip but not listed by name: check the slip`);
  const sstDue = r2((q.gross - (q.discount || 0)) * SST_RATE);
  if (!close(q.sst, sstDue) && !close(q.sst, r2(q.gross * SST_RATE))) checks.push(`Service tax RM${q.sst.toFixed(2)} is not ${SST_RATE * 100}% of gross (RM${sstDue.toFixed(2)})`);
  if (!close(q.gross - (q.discount || 0) + q.sst + q.stamp, q.total) && !close(q.gross + q.sst + q.stamp, q.total)) {
    checks.push(`Gross + tax + stamp duty = ${r2(q.gross + q.sst + q.stamp)} but slip total is ${q.total}`);
  }

  return {
    status: checks.length ? 'check' : 'quoted',
    source: 'slip',
    providerId, provider, kind,
    coverType: /third party,? fire|tpft/i.test(text) ? 'tpft' : /third party only|\bact\b cover/i.test(text) ? 'tp' : 'comprehensive',
    sumInsured: q.sum,
    ncdPercent: q.ncdPercent,
    basic: q.basic,
    loading: q.loading || 0,
    ncdAmount: q.ncdAmount,
    addons,
    addonTotal: Math.max(addonTotal, 0),
    discount: q.discount || 0,
    gross: q.gross,
    sst: q.sst,
    stampDuty: q.stamp,
    total: q.total,
    excess: q.excess ?? 0,
    insurerRef: quoteNo(text),
    validUntil: validUntil(text, today),
    referred: /\bREFERRED\b/.test(text),
    vehicle: vehicleInfo(lines),
    checks,
    notes,
    reasons: checks,
  };
}

// Most slips: label on the left, amount on the right of the same line.
function readByLabels(lines) {
  const at = (re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };
  // The first amount after the label (some slips have a second column on the
  // same line, e.g. Zurich's excess); else the next line if it wrapped.
  const amountAt = (i, re) => {
    if (i < 0) return undefined;
    const m = re ? re.exec(lines[i]) : null;
    const v = money(m ? lines[i].slice(m.index + m[0].length) : lines[i])[0];
    if (v !== undefined) return v;
    return money(lines[i + 1] || '')[0];
  };

  const iBasic = at(L.basic);
  if (iBasic < 0) return null;
  const basic = amountAt(iBasic, L.basic);
  // NCD near the basic premium (some slips list it in the header first).
  let iNcd = at(L.ncd, iBasic + 1, iBasic + 6);
  if (iNcd < 0 || money(lines[iNcd]).length === 0) iNcd = -1;
  const ncdLine = iNcd >= 0 ? lines[iNcd] : '';
  const ncdPercent = Number(/(\d{1,2}(?:\.\d+)?)\s*%/.exec(ncdLine)?.[1] ?? /\bncd\b[^%\n]*?(\d{1,2}(?:\.\d+)?)\s*%/i.exec(lines.join('\n'))?.[1] ?? 0);
  const ncdAmount = iNcd >= 0 ? amountAt(iNcd, L.ncd) : 0;

  const iGross = at(L.gross, iBasic + 1);
  if (iGross < 0) return null;
  const gross = amountAt(iGross, L.gross);
  const iLoading = at(L.loading, iBasic + 1, iGross);
  const loading = iLoading >= 0 ? amountAt(iLoading, L.loading) || 0 : 0;

  // Tax, stamp duty and total come after gross, within the same block.
  const end = Math.min(lines.length, iGross + 25);
  let sst; let stamp; let total; let discount = 0;
  const header = at(/gross premium\s+service tax\s+stamp duty/i, iGross, end);
  if (header >= 0) {
    // Allianz: a row of headers, then a row of numbers.
    const row = money(lines.slice(header + 1, header + 4).find((l) => money(l).length >= 4) || '');
    [, sst, stamp, total] = row;
  } else {
    const iD = at(L.discount, iGross + 1, end);
    if (iD >= 0) discount = lastMoney(lines[iD]) || 0;
    sst = amountAt(at(L.sst, iGross + 1, end), L.sst);
    stamp = amountAt(at(L.stamp, iGross + 1, end), L.stamp);
    const iRounded = at(L.rounded, iGross + 1, end);
    const iTotal = iRounded >= 0 ? iRounded : at(L.total, iGross + 1, end);
    total = amountAt(iTotal, iRounded >= 0 ? L.rounded : L.total);
  }
  if ([basic, gross, sst, stamp, total].some((v) => v === undefined)) return null;

  // Add-ons listed between NCD and gross.
  const addonItems = [];
  for (let i = Math.max(iNcd, iBasic) + 1; i < iGross; i++) {
    let l = lines[i];
    const v = lastMoney(l);
    if (v === undefined) continue;
    // Amount on its own line: the label is the line above (e.g. P&O flood cover).
    if (!/[a-z]{3}/i.test(l) && /[a-z]{3}/i.test(lines[i - 1] || '') && lastMoney(lines[i - 1]) === undefined) l = lines[i - 1] + '  ' + l;
    if (L.notAddon.test(l) || L.ncd.test(l) || L.basic.test(l) || !/[a-z]{3}/i.test(l)) continue;
    if (v === 0) continue;
    addonItems.push({ key: 'extra', label: tidyLabel(l), amount: v });
  }

  // Some slips (e.g. Takaful Ikhlas) list add-ons in their own section above
  // the price block: "Extra-Benefits : WINDSCREEN ( RM 1,000.00 ) 150.00".
  if (!addonItems.length) {
    const h = lines.findIndex((l) => /extra[- ]?benefits?|perlindungan tambahan/i.test(l));
    for (let i = h + 1; h >= 0 && i < Math.min(lines.length, h + 15); i++) {
      const l = lines[i];
      if (L.basic.test(l) || /contribution detail|premium detail|^\s*schedule/i.test(l)) break;
      const v = lastMoney(l);
      if (v !== undefined && v > 0 && /[a-z]{3}/i.test(l) && !L.notAddon.test(l)) addonItems.push({ key: 'extra', label: tidyLabel(l), amount: v });
    }
  }
  return { basic, ncdPercent, ncdAmount, loading, gross, discount, sst, stamp, total, addonItems, sum: sumInsured(lines), excess: excessOf(lines) };
}

// MSIG-style slips whose labels don't survive text extraction: read the
// "(RM) : amount" column in order and rely on the arithmetic.
function readByPosition(lines) {
  const rows = lines.filter((l) => /\(\s*\)\s*:\s*[\d,]+\.\d{2}/.test(l));
  const ncdRow = rows.findIndex((l) => /%/.test(l));
  if (ncdRow < 2) return null;
  const amt = (i) => lastMoney(rows[i]);
  const sum = amt(ncdRow - 2);
  const basic = amt(ncdRow - 1);
  const ncdAmount = amt(ncdRow);
  const ncdPercent = Number(/([\d.]+)\s*%/.exec(rows[ncdRow])[1]);
  const tail = rows.slice(-5); // annual premium, premium net of NCD, service tax, stamp, amount due
  const [gross, , sst, stamp, total] = tail.map((l) => lastMoney(l));
  const addonItems = rows.slice(ncdRow + 1, rows.length - 5).map((l) => ({ key: 'extra', label: 'Extra coverage', amount: lastMoney(l) }));
  return { basic, ncdPercent, ncdAmount, loading: 0, gross, discount: 0, sst, stamp, total, addonItems, sum, excess: undefined };
}

function sumInsured(lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!L.sum.test(l) || /recommended sum insured range|trailer/i.test(l)) continue;
    // Amount on the same line, or on the next line when the label wrapped.
    const v = money(l).find((n) => n >= 1000) ?? money(lines[i + 1] || '').find((n) => n >= 1000);
    if (v) return v;
  }
  return undefined;
}

function excessOf(lines) {
  for (const l of lines) {
    const m = /excess(?! damage)/i.exec(l);
    if (!m || /compulsory|voluntary|waiver|wajib|sukarela/i.test(l)) continue;
    const v = money(l.slice(m.index))[0];
    if (v !== undefined) return v;
  }
  return undefined;
}

function quoteNo(text) {
  const m = /(?:your quote no\.?|quotation no\.?(?: \/ no\.? sebut harga)?|quotation number|proposal number)\s*[:.]?\s*([A-Z0-9-]*\d[A-Z0-9-]{5,})/i.exec(text)
    // Label wrapped: a quote number like QUO26100303032 on the next line.
    || /quotation no[^\n]*\n[^\n]*?\b([A-Z]{2,4}\d{8,})\b/i.exec(text);
  return m?.[1];
}

function validUntil(text, today) {
  const d = /valid(?:ity)?(?: period)?\s*(?:until|sehingga|sah sehingga|\/)[^0-9\n]{0,30}(\d{2})[-/.](\d{2})[-/.](\d{4})/i.exec(text)
    || /valid until (\d{2})[-/.](\d{2})[-/.](\d{4})/i.exec(text);
  if (d) return `${d[3]}-${d[2]}-${d[1]}`;
  const days = /valid(?:ity)?[^.\n]{0,40}?\(?(\d{1,3})\)?\s*(?:calendar\s*)?days/i.exec(text);
  if (days) {
    const issued = /(?:issued date|quotation date|date of issue)\s*:?\s*(\d{2})[-/.](\d{2})[-/.](\d{4})/i.exec(text);
    const from = issued ? new Date(`${issued[3]}-${issued[2]}-${issued[1]}`) : today;
    return new Date(from.getTime() + Number(days[1]) * 864e5).toISOString().slice(0, 10);
  }
  return undefined;
}

function vehicleInfo(lines) {
  const text = lines.join('\n');
  const regNo = /(?:vehicle no\.?|registration no\.?(?: vehicle)?|vehicle registration no\.?)\s*[:]?\s*([A-Z]{1,3}\s?\d{1,4}\s?[A-Z]?)\b/i.exec(text)?.[1];
  const year = /year of manufactur\w*\s*[:/]?[^0-9\n]{0,30}(19\d{2}|20\d{2})/i.exec(text)?.[1];
  const make = /make (?:&|and) (?:model|type)[^:\n]*?\s{2,}([A-Z][^\n]{2,40}?)(?:\s{2,}|$)/i.exec(text)?.[1];
  // A label that wrapped can pull in the next column's label instead of the model.
  const makeModel = make && !/capacity|tonnage|^cubic/i.test(make) ? make.trim() : undefined;
  return { regNo: regNo?.replace(/\s+/g, ' ').trim(), year: year && Number(year), makeModel };
}

function tidyLabel(line) {
  return line.replace(/\s+sum insured\b.*$/i, '').replace(/\(\s*RM\s*[\d,.]*\)/gi, '').replace(MONEY, '').replace(/\bRM\b/g, '').replace(/\(\s*\)|[:+~]/g, ' ').replace(/\s{2,}.*$/, '').replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).slice(0, 50) || 'Extra coverage';
}
