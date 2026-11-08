// The agency's WhatsApp quotation message, as staff send it today:
// insurer, car, breakdown, rounded total, then the FPX and Atome links.
const money = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Malaysian rounding to the nearest 5 sen (e.g. 1,773.39 → 1,773.40).
export const roundMY = (n) => Math.round(Number(n) * 20) / 20;
export const ATOME_SURCHARGE = 0.06; // agency rule: Atome amount = rounded total + 6%, paid in 3
export const atomeAmount = (total, surcharge = ATOME_SURCHARGE) => Math.round(roundMY(total) * (1 + surcharge) * 100) / 100;

const COVER = { comprehensive: 'Comprehensive', tpft: 'Third Party, Fire & Theft', tp: 'Third Party' };
const FOOTER = {
  allianz: '_Includes 24/7 Allianz Road Rangers (1800-22-5542) & Official Quotation Slip._',
};
const SHORT = { allianz: 'Allianz', po: 'P&O', ikhlas: 'Takaful Ikhlas', etiqa: 'Etiqa', zurich: 'Zurich', generali: 'Generali' };
const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s(/-])\S/g, (c) => c.toUpperCase());

export function customerMessage(row, offer, links = {}) {
  const { owner = {}, vehicle = {}, cover = {} } = row.request || {};
  const name = SHORT[offer.providerId] || String(offer.provider).replace(/\s+(General\s+)?(Insurance|Berhad|Bhd).*$/i, '');
  const takaful = offer.kind === 'takaful';
  const word = takaful ? 'Contribution' : 'Premium';
  // Insurer model text runs long ("PERODUA BEZZA G MY16 D63D FACELIFT …"): keep make, model, variant.
  const model = (offer.vehicle?.makeModel || [vehicle.make, vehicle.model].filter(Boolean).join(' ')).split(/\s+MY\d{2}\b|\s+\d[DS]\b/)[0].trim();
  const year = offer.vehicle?.year || vehicle.year;
  const ncd = Number(offer.ncdPercent || 0);
  const net = offer.basic - (offer.ncdAmount || 0) + (offer.loading || 0);
  const total = roundMY(offer.total);
  const addons = offer.addons || [];
  const eh = addons.some((a) => a.key === 'ehailing' || /private hire|e-?hailing/i.test(a.label));
  const lines = [
    `*${name.toUpperCase()}*`,
    `*Insurer Provider:* ${name}`,
    `*Vehicle No:* ${String(vehicle.regNo || offer.vehicle?.regNo || '').replace(/\s+/g, '').toUpperCase()}`,
    model ? `*Model:* ${title(model)}${year ? ` (${year})` : ''}` : null,
    `*Coverage:* ${COVER[offer.coverType || cover.coverType] || 'Comprehensive'}${eh ? ' + E-hailing' : ''}`,
    owner.nric ? `*${owner.idType === 'company' ? 'Company No' : 'NRIC'}:* ${owner.nric}` : null,
    offer.sumInsured ? `*${cover.valueBasis === 'market' ? 'Market Value' : 'Agreed Value'}:* ${money(offer.sumInsured)}` : null,
    `*NCD:* ${ncd.toFixed(2)}%`,
    '',
    `*${word.toUpperCase()} BREAKDOWN:*`,
    `• Basic ${word}: ${money(offer.basic)}`,
    ncd ? `• Less NCD (${ncd}%): -${money(offer.ncdAmount || 0)}` : null,
    offer.loading ? `• Loading: ${money(offer.loading)}` : null,
    `• *Net Basic ${word}:* ${money(net)}`,
    addons.length ? `• Extra Cover ${word}: ${money(offer.addonTotal ?? addons.reduce((t, a) => t + a.amount, 0))}` : null,
    ...(addons.length > 1 ? addons.map((a) => `   - ${a.label}: ${money(a.amount)}`) : addons.map((a) => `   - ${a.label}`)),
    offer.discount ? `• Rebate: -${money(offer.discount)}` : null,
    `• *Gross ${word}:* ${money(offer.gross)}`,
    `• Service Tax (8%): ${money(offer.sst)}`,
    `• Stamp Duty: ${money(offer.stampDuty)}`,
    '━━━━━━━━━━━━━━━━━━━━━',
    `Total ${takaful ? 'Takaful' : 'Insurance'}: ${money(offer.total)}`,
    `*TOTAL AMOUNT (Rounded): ${money(total)}*`,
    '━━━━━━━━━━━━━━━━━━━━━',
    FOOTER[offer.providerId] || '_Includes Official Quotation Slip._',
  ];
  const pay = [];
  const both = links.fiuu && links.atome;
  if (links.fiuu) pay.push(`${both ? '1️⃣ ' : ''}*Full Payment (FPX Online Banking / ShopeePay - 0% Fee)*`, `👉 ${links.fiuu.link}`, `*Amount: ${money(links.fiuu.amount)}*`);
  if (links.atome) {
    if (pay.length) pay.push('');
    pay.push(`${both ? '2️⃣ ' : ''}*3x Monthly Installment (Atome - 0% Interest)*`, `👉 ${links.atome.link}`,
      `*Amount: ${money(Math.round((links.atome.amount / 3) * 100) / 100)} / month (3 payments)*`);
  }
  if (pay.length) {
    lines.push('', '━━━━━━━━━━━━━━━━━━━━━', `💳 *SECURE PAYMENT OPTION${pay.length > 3 ? 'S' : ''}:*`, '', ...pay,
      '━━━━━━━━━━━━━━━━━━━━━', '_Click the link above to proceed with instant secure payment & policy issuance._');
  }
  return lines.filter((l) => l !== null).join('\n');
}
