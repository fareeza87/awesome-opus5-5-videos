// Vehicle + NCD lookup from IC and plate number.
// In production this comes from one insurer portal's ISM enquiry (done by the
// RPA bot). The demo version below invents a stable answer for each plate.
import { VEHICLES, estimateValue } from '../data/vehicles.js';
import { NCD_STEPS } from './tariff.js';

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function demoLookup(req) {
  const plate = String(req.vehicle?.regNo || '').toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{1,3}\d{1,4}[A-Z]?$/.test(plate)) return null;
  const h = hash(plate + '|' + String(req.owner?.nric || '').replace(/\D/g, ''));
  const v = VEHICLES[h % VEHICLES.length];
  const newest = Math.max(...Object.keys(v.values).map(Number));
  const year = newest - ((h >> 8) % 7);
  const age = new Date().getFullYear() - year;
  const ncd = NCD_STEPS[Math.min(Math.max(age - 1, 0), 5)];
  return { make: v.make, model: v.model, cc: v.cc, seats: v.seats, year, ncd, sumInsured: estimateValue(v, year) };
}

// Fill in whatever the staff did not type, from a lookup result.
export function applyLookup(req, found) {
  const vehicle = { ...req.vehicle };
  for (const k of ['make', 'model', 'cc', 'seats', 'year']) if (!vehicle[k]) vehicle[k] = found[k];
  const cover = { ...req.cover };
  if (!cover.sumInsured) cover.sumInsured = found.sumInsured;
  if (cover.ncd === undefined || cover.ncd === null || cover.ncd === '') cover.ncd = found.ncd;
  return { ...req, vehicle, cover };
}
