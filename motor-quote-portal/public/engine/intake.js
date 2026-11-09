// Reads a customer's WhatsApp message (or a filled-in template) into the
// quote form. Ported from the agency's parse_customer_message. Anything not
// in the message is left empty for staff to fill: nothing is made up.
export function parseCustomerMessage(raw) {
  // WhatsApp bold/italic marks (*Postcode:* 40170) would hide the labels.
  const text = String(raw || '').replace(/[*_~]/g, '').trim();
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out = { owner: {}, vehicle: {}, cover: { addons: {} }, found: [] };
  const set = (obj, key, val, label) => { if (val !== undefined && val !== '') { obj[key] = val; out.found.push(label); } };

  // Plate: a labelled one, else anything that looks like a Malaysian plate.
  const plate = /(?:car\s*plate(?:\s*number)?|plate\s*no\.?|no\.?\s*plat|plate)[:\s]*([A-Za-z]{1,3}\s*\d{1,4}\s*[A-Za-z]?)\b/i.exec(text)?.[1]
    || /\b([A-Z]{1,3}\s?\d{1,4}\s?[A-Z]?)\b/.exec(text.replace(/\b(?:RM|NO|IC|ID)\b/gi, ''))?.[1];
  if (plate) set(out.vehicle, 'regNo', plate.replace(/\s+/g, '').toUpperCase().replace(/^([A-Z]+)(\d+)([A-Z]?)$/, '$1 $2$3'), 'plate');

  // ID: passport, company registration, or NRIC.
  const passport = /(?:passport|pasport)(?:\s*no\.?)?[:\s]*([A-Z]\d{7,9})\b/i.exec(text);
  // New SSM number: 20YY + 2-digit entity code (01–06) + 6 digits.
  const brnNew = /\b(20\d{2}0[1-6]\d{6})\b/.exec(text);
  const brnOld = /\b(\d{5,7}-[A-Z]|[A-Z]{2}\d{5,7}-[A-Z])\b/.exec(text);
  // A bare 12-digit number is an NRIC only if it starts with a real date (YYMMDD).
  const realDate = (d) => { const m = +d.slice(2, 4), day = +d.slice(4, 6); return m >= 1 && m <= 12 && day >= 1 && day <= 31; };
  const bare = [...text.matchAll(/(?<![\d-])(\d{12})(?![\d-])/g)].map((m) => m[1]).find((d) => realDate(d) && !(brnNew && d === brnNew[1] && /ssm|company|syarikat|sdn|bhd/i.test(text)));
  const nric = /(?:nric|ic\s*no\.?|no\.?\s*ic|id\s*no\.?|\bic\b)[:\s]*(\d{6}-?\d{2}-?\d{4})/i.exec(text) || /\b(\d{6}-\d{2}-\d{4})\b/.exec(text) || (bare ? [bare, bare] : null);
  if (passport) {
    set(out.owner, 'idType', 'passport', 'ID type');
    set(out.owner, 'nric', passport[1].toUpperCase(), 'passport no.');
  } else if ((brnNew || brnOld) && (/ssm|company|syarikat|sdn\.?\s*bhd|\bbhd\b|enterprise|trading|plt/i.test(text) || !nric) || (/\b(sdn\.?\s*bhd|bhd|enterprise|trading|plt)\b/i.test(text) && !nric)) {
    set(out.owner, 'idType', 'company', 'ID type');
    set(out.owner, 'nric', brnNew?.[1] || brnOld?.[1], 'company reg. no.');
    if (brnNew && brnOld) out.owner.oldBrn = brnOld[1];
  } else if (nric) {
    set(out.owner, 'idType', 'nric', 'ID type');
    const d = nric[1].replace(/\D/g, '');
    set(out.owner, 'nric', `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`, 'NRIC');
  }

  let name = /(?:full\s*name|nama(?:\s*penuh)?|(?<!company\s)name|proposer)[:\s]+([A-Za-z@'./\s]{3,60}?)\s*(?:\n|$|email|contact|nric|passport|ssm|ic\b)/i.exec(text)?.[1];
  // Company template: "Company Name & SSM No.: 202101014964 Artami Consultant Sdn Bhd".
  const company = /company\s*name[^:\n]*:\s*([^\n]+)/i.exec(text)?.[1]?.replace(/\b\d{5,12}(-[A-Z])?\b/g, '').replace(/\s{2,}/g, ' ').trim();
  if (company) name = company;
  // Unlabelled: a line that is just a person's name (2–7 words, letters only, not an address or a yes/no answer).
  if (!name) name = lines.find((l) => /^[A-Za-z@'.\/ ]{5,60}$/.test(l) && l.trim().split(/\s+/).length >= 2 && l.trim().split(/\s+/).length <= 7
    && !/\b(jalan|jln|lorong|lrg|taman|tmn|kampung|kg|lot|blok|block|no|yes|ya|tak|tidak|insurance|insurans|annual|tahunan|daily|e-?hailing|add\s*on|private|car|kereta|hi|hello|salam|team|quotation)\b/i.test(l));
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
  // Unlabelled address: lines that look like one ("no 5 lorong …", "taman …", "60000 kuala lumpur").
  if (!address) {
    const addrLines = lines.filter((l) => /^(no\.?\s*\d|lot\s|\d+[a-z]?,)|\b(jalan|jln|lorong|lrg|taman|tmn|kampung|kg\.?|blok|block|persiaran|lebuh|apartment|kondo|condo|pangsapuri)\b/i.test(l) || /^\d{5}\s+[a-z]/i.test(l));
    if (addrLines.length) address = addrLines.join(', ');
  }
  if (address) set(out.owner, 'address', address.replace(/\s*\n\s*/g, ', ').trim(), 'address');
  const postcode = /\b(\d{5})\b/.exec(address || '')?.[1] || /(?:postcode|poskod)[:\s]*(\d{5})/i.exec(text)?.[1]
    || lines.find((l) => /^\d{5}$/.test(l)); // a postcode on its own line
  if (postcode) set(out.owner, 'postcode', postcode, 'postcode');

  // Template lines left blank ("Windscreen Cover :" with nothing after) are not a request.
  const blank = (re) => new RegExp(`(?:${re.source})[^:\\n]*:[ \\t]*(?:\\n|$)`, 'i').test(text);
  // E-hailing: "e-hailing: no" or "daily" means no annual cover.
  if (/e[\s-]?hailing|private\s*hire|grab\b/i.test(text) && !blank(/e[\s-]?hailing/)) {
    const no = /e[\s-]?hailing\s*[:\-]?\s*(no|tidak|x)\b/i.test(text);
    if (!no) {
      out.cover.addons.ehailing = true;
      out.cover.ehailingPeriod = /daily|harian|per\s*day/i.test(text) ? 'daily' : 'annual';
      out.found.push(`e-hailing (${out.cover.ehailingPeriod})`);
    }
  }
  if (/wind\s*screen|cermin/i.test(text) && !/wind\s*screen\s*[:\-]?\s*(no|tidak)\b/i.test(text) && !blank(/wind\s*screen/)) {
    out.cover.addons.windscreen = true; out.found.push('windscreen');
    const ws = /wind\s*screen[^\n\d]*(?:rm)?\s*([1-9][\d,]{2,5})/i.exec(text)?.[1];
    if (ws) out.cover.windscreenSI = Number(ws.replace(/,/g, ''));
  }
  if (/special\s*perils?|flood|banjir/i.test(text) && !/(special\s*perils?|flood|banjir)\s*[:\-]?\s*(no|tidak)\b/i.test(text) && !blank(/special\s*perils?|flood|banjir/)) { out.cover.addons.specialPerils = true; out.found.push('special perils'); }

  const model = /(?:car\s*model|model\s*kereta|model)(?:\s*(?:&|and|dan)\s*(?:year|tahun))?[:\s]*([^\r\n]+)/i.exec(text)?.[1];
  const year = /\b((?:19|20)\d{2})\b/.exec(model || '')?.[1] || /(?:year|tahun)(?:\s*(?:make|dibuat|of\s*manufacture))?[:\s]*((?:19|20)\d{2})/i.exec(text)?.[1];
  if (year) set(out.vehicle, 'year', Number(year), 'year');
  if (model) set(out.vehicle, 'model', model.replace(year || '', '').replace(/[,()-]+\s*$/, '').trim(), 'model');

  const si = /(?:sum\s*(?:insured|covered)|market\s*value|nilai)[:\s]*(?:rm)?\s*([\d,]{4,})/i.exec(text)?.[1];
  if (si) set(out.cover, 'sumInsured', Number(si.replace(/,/g, '')), 'sum insured');
  if (/\btpft\b|third\s*party\s*fire/i.test(text)) set(out.cover, 'coverType', 'tpft', 'cover type');

  return out;
}
