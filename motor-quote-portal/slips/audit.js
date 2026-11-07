// Ported from the agency's audit_and_sync_quote: the insurer's slip is the
// authority. Never change its figures; flag anything that doesn't match what
// was asked for, so staff check before sending.
const KINDS = [
  ['windscreen', /wind\s*screen|windows|w\/screen/i, 'Windscreen'],
  ['specialPerils', /special perils|flood|typhoon/i, 'Special perils'],
  ['ehailing', /private hire|e-?hailing/i, 'E-hailing'],
  ['waiverExcess', /waiver of compulsory/i, 'Waiver of compulsory excess'],
  ['allDrivers', /all drivers|authori[sz]ed driver/i, 'All drivers'],
  ['llop', /liability of passengers|l\.l\.p of/i, 'Legal liability of passengers'],
  ['llan', /liability to passengers|l\.l\.p to/i, 'Legal liability to passengers'],
];

export function auditAddons(cover, slip) {
  const notes = [];
  const labels = (slip.addons || []).map((a) => a.label);
  const combinedOnly = labels.length === 1 && labels[0] === 'Extra coverage'; // names not readable on this slip
  if (combinedOnly) return notes;
  for (const [key, re, name] of KINDS) {
    if (cover.addons?.[key] && !labels.some((l) => re.test(l))) notes.push(`${name} was requested but is not on the insurer's quotation`);
  }
  return notes;
}
