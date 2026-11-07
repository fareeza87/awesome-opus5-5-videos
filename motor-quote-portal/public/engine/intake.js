// Reads a customer's WhatsApp message (or a filled-in template) into the
// quote form. Ported from the agency's parse_customer_message. Anything not
// in the message is left empty for staff to fill: nothing is made up.
export function parseCustomerMessage(raw) {
  const text = String(raw || '').trim();
  const out = { owner: {}, vehicle: {}, cover: { addons: {} }, found: [] };
  const set = (obj, key, val, label) => { if (val !== undefined && val !== '') { obj[key] = val; out.found.push(label); } };

  // Plate: a labelled one, else anything that looks like a Malaysian plate.
  const plate = /(?:car\s*plate(?:\s*number)?|plate\s*no\.?|no\.?\s*plat|plate)[:\s]*([A-Za-z]{1,3}\s*\d{1,4}\s*[A-Za-z]?)\b/i.exec(text)?.[1]
    || /\b([A-Z]{1,3}\s?\d{1,4}\s?[A-Z]?)\b/.exec(text.replace(/\b(?:RM|NO|IC|ID)\b/gi, ''))?.[1];
  if (plate) set(out.vehicle, 'regNo', plate.replace(/\s+/g, '').toUpperCase().replace(/^([A-Z]+)(\d+)([A-Z]?)$/, '$1 $2$3'), 'plate');

  // ID: passport, company registration, or NRIC.
  const passport = /(?:passport|pasport)(?:\s*no\.?)?[:\s]*([A-Z]\d{7,9})\b/i.exec(text);
  const brnNew = /\b(20\d{10})\b/.exec(text);
  const brnOld = /\b(\d{5,7}-[A-Z]|[A-Z]{2}\d{5,7}-[A-Z])\b/.exec(text);
  const nric = /(?:nric|ic\s*no\.?|no\.?\s*ic|id\s*no\.?|\bic\b)[:\s]*(\d{6}-?\d{2}-?\d{4})/i.exec(text) || /\b(\d{6}-\d{2}-\d{4})\b/.exec(text);
  if (passport) {
    set(out.owner, 'idType', 'passport', 'ID type');
    set(out.owner, 'nric', passport[1].toUpperCase(), 'passport no.');
  } else if (brnNew || brnOld || (/\b(sdn\.?\s*bhd|bhd|enterprise|trading|plt)\b/i.test(text) && !nric)) {
    set(out.owner, 'idType', 'company', 'ID type');
    set(out.owner, 'nric', brnNew?.[1] || brnOld?.[1], 'company reg. no.');
    if (brnNew && brnOld) out.owner.oldBrn = brnOld[1];
  } else if (nric) {
    set(out.owner, 'idType', 'nric', 'ID type');
    const d = nric[1].replace(/\D/g, '');
    set(out.owner, 'nric', `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`, 'NRIC');
  }

  const name = /(?:full\s*name|nama(?:\s*penuh)?|name|proposer)[:\s]+([A-Za-z@'./\s]{3,60}?)\s*(?:\n|$|email|contact|nric|passport|ssm|ic\b)/i.exec(text)?.[1];
  if (name && !/email/i.test(name)) set(out.owner, 'name', name.trim().toUpperCase(), 'name');

  const email = /([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/.exec(text)?.[1];
  if (email) set(out.owner, 'email', email, 'email');

  const phone = /(?:contact|mobile|phone|tel|no\.?\s*(?:hp|tel|telefon))(?:\s*(?:number|no\.?))?[:\s]*(\+?6?0?1[\d\s-]{7,12})/i.exec(text)?.[1] || /\b(01[0-46-9][\d-]{7,9})\b/.exec(text)?.[1];
  if (phone) set(out.owner, 'phone', phone.replace(/[^\d+]/g, '').replace(/^\+?6(?=01)/, ''), 'mobile');

  // Address: its line, plus the next line only when that is clearly the rest
  // of the address (first line has no postcode yet, next line does).
  let address;
  const am = /(?:full\s*address|address|alamat)[:\s]*([^\n]+)(?:\n([^\n]+))?/i.exec(text);
  if (am) {
    address = am[1].trim();
    if (am[2] && !/\b\d{5}\b/.test(address) && /\b\d{5}\b/.test(am[2]) && !/[a-z ]{2,20}:/i.test(am[2])) address += ', ' + am[2].trim();
  }
  if (address) set(out.owner, 'address', address.replace(/\s*\n\s*/g, ', ').trim(), 'address');
  const postcode = /\b(\d{5})\b/.exec(address || '')?.[1] || /(?:postcode|poskod)[:\s]*(\d{5})/i.exec(text)?.[1];
  if (postcode) set(out.owner, 'postcode', postcode, 'postcode');

  // E-hailing: "e-hailing: no" or "daily" means no annual cover.
  if (/e[\s-]?hailing|private\s*hire|grab\b/i.test(text)) {
    const no = /e[\s-]?hailing\s*[:\-]?\s*(no|tidak|x)\b/i.test(text);
    if (!no && !/daily|harian/i.test(text)) { out.cover.addons.ehailing = true; out.cover.ehailingPeriod = 'annual'; out.found.push('e-hailing'); }
  }
  if (/wind\s*screen|cermin/i.test(text) && !/wind\s*screen\s*[:\-]?\s*(no|tidak)\b/i.test(text)) {
    out.cover.addons.windscreen = true; out.found.push('windscreen');
    const ws = /wind\s*screen[^\n\d]*(?:rm)?\s*([1-9][\d,]{2,5})/i.exec(text)?.[1];
    if (ws) out.cover.windscreenSI = Number(ws.replace(/,/g, ''));
  }
  if (/special\s*perils?|flood|banjir/i.test(text) && !/(special\s*perils?|flood|banjir)\s*[:\-]?\s*(no|tidak)\b/i.test(text)) { out.cover.addons.specialPerils = true; out.found.push('special perils'); }

  const model = /(?:car\s*model|model\s*kereta|model)(?:\s*(?:&|and|dan)\s*(?:year|tahun))?[:\s]*([^\r\n]+)/i.exec(text)?.[1];
  const year = /\b((?:19|20)\d{2})\b/.exec(model || '')?.[1] || /(?:year|tahun)(?:\s*(?:make|dibuat|of\s*manufacture))?[:\s]*((?:19|20)\d{2})/i.exec(text)?.[1];
  if (year) set(out.vehicle, 'year', Number(year), 'year');
  if (model) set(out.vehicle, 'model', model.replace(year || '', '').replace(/[,()-]+\s*$/, '').trim(), 'model');

  const si = /(?:sum\s*(?:insured|covered)|market\s*value|nilai)[:\s]*(?:rm)?\s*([\d,]{4,})/i.exec(text)?.[1];
  if (si) set(out.cover, 'sumInsured', Number(si.replace(/,/g, '')), 'sum insured');
  if (/\btpft\b|third\s*party\s*fire/i.test(text)) set(out.cover, 'coverType', 'tpft', 'cover type');

  return out;
}
