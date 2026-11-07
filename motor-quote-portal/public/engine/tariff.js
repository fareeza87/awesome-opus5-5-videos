// Malaysian private-car motor rating basics.
// Base figures follow the former PIAM motor tariff, which most insurers still
// use as the starting point before applying their own pricing factors.
// Shared by the browser and the Node server.

export const CC_BANDS = [1400, 1650, 2200, 3050, 4100, 4250, 4400, Infinity];

// Comprehensive: premium for the first RM1,000 sum insured, by cc band.
const COMP_BASE = {
  peninsular: [273.8, 305.5, 339.1, 372.6, 404.3, 436.0, 469.6, 501.3],
  east: [196.2, 220.0, 243.9, 266.5, 290.4, 314.2, 338.2, 361.9],
};
// Comprehensive: premium for every RM1,000 above the first RM1,000.
const COMP_PER_1000 = { peninsular: 26.0, east: 20.3 };

// Third party only, by cc band.
const TP_BASE = {
  peninsular: [120.6, 135.0, 151.2, 167.4, 181.8, 196.2, 212.4, 226.8],
  east: [67.2, 75.6, 85.2, 93.6, 101.7, 110.1, 118.2, 126.6],
};

export const NCD_STEPS = [0, 25, 30, 38.33, 45, 55];
export const SST_RATE = 0.08;
export const STAMP_DUTY = 10;

export const COVER_TYPES = {
  comprehensive: 'Comprehensive',
  tpft: 'Third Party, Fire & Theft',
  tp: 'Third Party Only',
};

// Optional extensions. `rate` is a share of the base it applies to.
export const ADDONS = {
  windscreen: { label: 'Windscreen', basis: 'windscreenSI', rate: 0.15, needs: 'windscreenSI' },
  specialPerils: { label: 'Special perils (flood, landslide)', basis: 'sumInsured', rate: 0.005 },
  srcc: { label: 'Strike, riot & civil commotion', basis: 'sumInsured', rate: 0.003 },
  llop: { label: 'Legal liability of passengers', flat: 7.5 },
  llan: { label: 'Legal liability to passengers', perSeat: 2.0 },
  allDrivers: { label: 'All drivers', flat: 20 },
  ehailing: { label: 'E-hailing usage', basis: 'basic', rate: 0.15 },
  cart: { label: 'Car replacement (CART, 7 days)', flat: 70 },
};

export function ccBandIndex(cc) {
  return CC_BANDS.findIndex((max) => cc <= max);
}

export function region(postcode) {
  // Sabah 88xxx–91xxx, Sarawak 93xxx–98xxx, Labuan 87xxx.
  const p = Number(String(postcode).slice(0, 2));
  return p >= 87 && p <= 98 ? 'east' : 'peninsular';
}

export function tariffBasic({ coverType, cc, sumInsured, postcode }) {
  const r = region(postcode);
  const i = ccBandIndex(cc);
  if (coverType === 'tp') return TP_BASE[r][i];
  const comp = COMP_BASE[r][i] + (Math.max(sumInsured - 1000, 0) / 1000) * COMP_PER_1000[r];
  return coverType === 'tpft' ? comp * 0.75 : comp;
}

export function ageFromNric(nric, today = new Date()) {
  const digits = String(nric).replace(/\D/g, '');
  if (digits.length < 6) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const century = yy > today.getFullYear() % 100 ? 1900 : 2000;
  const dob = new Date(century + yy, mm - 1, dd);
  if (Number.isNaN(dob.getTime()) || mm < 1 || mm > 12) return null;
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

export const round2 = (n) => Math.round(n * 100) / 100;
