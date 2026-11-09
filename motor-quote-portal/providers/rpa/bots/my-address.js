// Malaysian postcode → state and town, for portals that ask for them.
import { createRequire } from 'node:module';
const { findPostcode } = createRequire(import.meta.url)('malaysia-postcodes');
const POSTCODE_STATE = [
  [['01', '02'], 'PERLIS'],
  [['05', '06', '07', '08', '09'], 'KEDAH'],
  [['10', '11', '12', '13', '14'], 'PENANG'],
  [['15', '16', '17', '18'], 'KELANTAN'],
  [['20', '21', '22', '23', '24'], 'TRENGGANU'],
  [['25', '26', '27', '28'], 'PAHANG'],
  [['30', '31', '32', '33', '34', '35', '36'], 'PERAK'],
  [['39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '63', '64', '65', '66', '67', '68'], 'SELANGOR'],
  [['50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '60'], 'W.PERSEKUTUAN'],
  [['62'], 'PUTRAJAYA'],
  [['70', '71', '72', '73'], 'N.SEMBILAN'],
  [['75', '76', '77', '78'], 'MELAKA'],
  [['79', '80', '81', '82', '83', '84', '85', '86'], 'JOHOR'],
  [['87'], 'LABUAN'],
  [['88', '89', '90', '91'], 'SABAH'],
  [['93', '94', '95', '96', '97', '98'], 'SARAWAK'],
];

const TOWNS = {
  83000: 'BATU PAHAT', 81000: 'KULAI', 80000: 'JOHOR BAHRU', 80100: 'JOHOR BAHRU', 80200: 'JOHOR BAHRU', 80300: 'JOHOR BAHRU',
  84000: 'MUAR', 85000: 'SEGAMAT', 86000: 'KLUANG', 86800: 'MERSING', 82000: 'PONTIAN', 42300: 'BANDAR PUNCAK ALAM', 40000: 'SHAH ALAM',
  43000: 'KAJANG', 43200: 'CHERAS', 46000: 'PETALING JAYA', 47100: 'PUCHONG', 47300: 'PETALING JAYA', 47301: 'PETALING JAYA',
  47500: 'SUBANG JAYA', 47800: 'PETALING JAYA', 50000: 'KUALA LUMPUR', 50450: 'KUALA LUMPUR',
};

// Town for a postcode, e.g. 43000 → KAJANG, 81200 → JOHOR BAHRU.
export function townFromPostcode(postcode) {
  const hit = findPostcode(String(postcode || '').trim());
  return hit?.found ? hit.city.toUpperCase() : TOWNS[String(postcode)] || null;
}

export function stateFromPostcode(postcode) {
  const p = String(postcode || '').slice(0, 2);
  return POSTCODE_STATE.find(([prefixes]) => prefixes.includes(p))?.[1] || null;
}

// Split a typed address into the line, town and state a portal wants.
// With no street given, the town is used as the first line.
export function splitAddress(address, postcode) {
  const state = stateFromPostcode(postcode);
  let town = townFromPostcode(postcode);
  const parts = String(address || '')
    .replace(new RegExp(`\\b${postcode}\\b`), '')
    .split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !state || s.toUpperCase().replace(/\s/g, '') !== state.replace(/[.\s]/g, ''));
  if (!town && parts.length > 1 && /^[A-Za-z\s]{3,30}$/.test(parts.at(-1))) town = parts.pop().toUpperCase();
  if (town) { const i = parts.findIndex((s) => s.toUpperCase() === town); if (i >= 0) parts.splice(i, 1); }
  return { line: (parts.join(', ') || town || '').slice(0, 40), town: (town || '').slice(0, 30), state };
}
