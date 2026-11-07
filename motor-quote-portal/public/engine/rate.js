// Turns one quote request into a priced quotation for one insurer profile.
import {
  ADDONS, NCD_STEPS, SST_RATE, STAMP_DUTY, ageFromNric, region, round2, tariffBasic,
} from './tariff.js';

// The minimum needed to look a vehicle up: who owns it, which plate, where.
export function validateBasics(req) {
  const errors = [];
  const idType = req.owner?.idType || 'nric';
  const id = String(req.owner?.nric || '').replace(/\D/g, '');
  if (idType === 'nric' && id.length !== 12) errors.push('NRIC must have 12 digits');
  if (idType !== 'nric' && !String(req.owner?.nric || '').trim()) errors.push(idType === 'company' ? 'Company registration no. is required' : 'Passport no. is required');
  if (!req.vehicle?.regNo) errors.push('Vehicle registration number is required');
  if (!/^\d{5}$/.test(String(req.owner?.postcode ?? ''))) errors.push('Postcode must be 5 digits');
  return errors;
}

export function validateRequest(req) {
  const errors = validateBasics(req);
  const year = new Date().getFullYear();
  if (!(req.vehicle?.cc > 0)) errors.push('Engine capacity (cc) is required');
  if (!(req.vehicle?.year >= 1980 && req.vehicle.year <= year + 1)) errors.push('Year of manufacture looks wrong');
  if (req.cover?.coverType !== 'tp' && !(req.cover?.sumInsured >= 1000)) errors.push('Sum insured must be at least RM1,000');
  if (!NCD_STEPS.includes(Number(req.cover?.ncd))) errors.push('NCD must be one of ' + NCD_STEPS.join(', '));
  return errors;
}

// profile: per-insurer pricing appetite (see providers-config.js).
export function rateQuote(req, profile, today = new Date()) {
  const { owner, vehicle, cover } = req;
  const coverType = cover.coverType;
  const sumInsured = coverType === 'tp' ? 0 : Number(cover.sumInsured);
  const vehicleAge = today.getFullYear() - Number(vehicle.year);
  const driverAge = (owner.idType || 'nric') === 'nric' ? ageFromNric(owner.nric, today) : null;
  const reg = region(owner.postcode);

  // Underwriting rules that make an insurer decline.
  const declines = [];
  if (vehicleAge > profile.maxVehicleAge && coverType === 'comprehensive') declines.push(`Comprehensive not offered for cars older than ${profile.maxVehicleAge} years`);
  if (sumInsured > profile.maxSumInsured) declines.push(`Sum insured above RM${profile.maxSumInsured.toLocaleString()} needs referral`);
  if (cover.addons?.ehailing && !profile.ehailing) declines.push('E-hailing extension not offered');
  if (declines.length) return { status: 'declined', reasons: declines };

  const tariff = tariffBasic({ coverType, cc: Number(vehicle.cc), sumInsured, postcode: owner.postcode });

  // Insurer-specific pricing factors on top of the tariff base.
  const factors = [];
  const apply = (label, f) => { if (f !== 1) factors.push({ label, factor: f }); return f; };
  let basic = tariff * apply('Insurer base rate', profile.baseFactor);
  basic *= apply('Region', profile.regionFactor[reg] ?? 1);
  if (vehicleAge >= 10) basic *= apply('Vehicle 10+ years', profile.oldCarLoading);
  else if (vehicleAge <= 2) basic *= apply('New vehicle', profile.newCarDiscount);
  if (driverAge !== null && driverAge < 25) basic *= apply('Young driver (<25)', profile.youngDriverLoading);
  if (cover.valueBasis === 'agreed' && coverType !== 'tp') basic *= apply('Agreed value', profile.agreedValueLoading);
  basic = round2(basic);

  const ncd = Number(cover.ncd);
  const ncdAmount = round2(basic * ncd / 100);
  const afterNcd = basic - ncdAmount;

  // Add-ons.
  const addons = [];
  for (const [key, on] of Object.entries(cover.addons ?? {})) {
    if (!on || !ADDONS[key]) continue;
    const def = ADDONS[key];
    if (coverType === 'tp' && def.basis && key !== 'ehailing') continue;
    let amt = 0;
    if (def.flat) amt = def.flat;
    else if (def.perSeat) amt = def.perSeat * Math.max(Number(vehicle.seats || 5) - 1, 0);
    else if (def.basis === 'windscreenSI') amt = Number(cover.windscreenSI || 0) * def.rate;
    else if (def.basis === 'sumInsured') amt = sumInsured * def.rate;
    else if (def.basis === 'basic') amt = basic * def.rate;
    amt *= profile.addonFactor[key] ?? 1;
    addons.push({ key, label: def.label, amount: round2(amt) });
  }
  const namedDrivers = Math.max(Number(cover.namedDrivers || 0), 0);
  if (namedDrivers && !cover.addons?.allDrivers) {
    addons.push({ key: 'namedDrivers', label: `Additional named drivers × ${namedDrivers}`, amount: round2(namedDrivers * 10) });
  }
  const addonTotal = round2(addons.reduce((s, a) => s + a.amount, 0));

  const gross = round2(Math.max(afterNcd + addonTotal, profile.minPremium));
  const sst = round2(gross * SST_RATE);
  const total = round2(gross + sst + STAMP_DUTY);
  const excess = coverType === 'tp' ? 0
    : (driverAge !== null && driverAge < 21 ? profile.excess + 400 : profile.excess);

  return {
    status: 'quoted',
    coverType,
    sumInsured,
    tariff: round2(tariff),
    factors,
    basic,
    ncdPercent: ncd,
    ncdAmount,
    addons,
    addonTotal,
    gross,
    sst,
    stampDuty: STAMP_DUTY,
    total,
    excess,
    commission: round2(gross * profile.commissionRate),
    benefits: profile.benefits,
    validDays: 14,
  };
}
