// Small sample of popular Malaysian cars for quick autofill.
// Market values are rough examples only. In production, pull these from
// the ISM / insurer vehicle valuation (ABI) lookup.
export const VEHICLES = [
  { make: 'Perodua', model: 'Axia 1.0', cc: 998, seats: 5, values: { 2024: 36000, 2021: 28000, 2018: 21000 } },
  { make: 'Perodua', model: 'Bezza 1.3', cc: 1329, seats: 5, values: { 2024: 44000, 2021: 35000, 2018: 27000 } },
  { make: 'Perodua', model: 'Myvi 1.5', cc: 1496, seats: 5, values: { 2024: 55000, 2021: 44000, 2018: 34000 } },
  { make: 'Perodua', model: 'Ativa 1.0T', cc: 998, seats: 5, values: { 2024: 66000, 2022: 56000 } },
  { make: 'Perodua', model: 'Alza 1.5', cc: 1496, seats: 7, values: { 2024: 70000, 2023: 63000 } },
  { make: 'Proton', model: 'Saga 1.3', cc: 1332, seats: 5, values: { 2024: 37000, 2021: 29000, 2018: 22000 } },
  { make: 'Proton', model: 'Persona 1.6', cc: 1597, seats: 5, values: { 2024: 50000, 2021: 40000 } },
  { make: 'Proton', model: 'X50 1.5T', cc: 1477, seats: 5, values: { 2024: 105000, 2022: 85000 } },
  { make: 'Proton', model: 'X70 1.5T', cc: 1477, seats: 5, values: { 2024: 120000, 2021: 90000 } },
  { make: 'Proton', model: 'S70 1.5T', cc: 1477, seats: 5, values: { 2024: 85000 } },
  { make: 'Honda', model: 'City 1.5', cc: 1498, seats: 5, values: { 2024: 88000, 2021: 70000, 2018: 52000 } },
  { make: 'Honda', model: 'Civic 1.5T', cc: 1498, seats: 5, values: { 2024: 140000, 2021: 110000 } },
  { make: 'Honda', model: 'HR-V 1.5', cc: 1498, seats: 5, values: { 2024: 125000, 2021: 95000 } },
  { make: 'Toyota', model: 'Vios 1.5', cc: 1496, seats: 5, values: { 2024: 92000, 2021: 72000, 2018: 55000 } },
  { make: 'Toyota', model: 'Corolla Cross 1.8', cc: 1798, seats: 5, values: { 2024: 135000, 2022: 115000 } },
  { make: 'Toyota', model: 'Hilux 2.4', cc: 2393, seats: 5, values: { 2024: 115000, 2021: 90000 } },
  { make: 'Nissan', model: 'Almera 1.0T', cc: 999, seats: 5, values: { 2024: 82000, 2021: 65000 } },
  { make: 'Mazda', model: 'CX-5 2.0', cc: 1998, seats: 5, values: { 2024: 145000, 2021: 115000 } },
  { make: 'BYD', model: 'Atto 3 (EV)', cc: 1400, seats: 5, values: { 2024: 140000, 2023: 125000 } },
];

export function estimateValue(v, year) {
  const years = Object.keys(v.values).map(Number).sort((a, b) => b - a);
  const nearest = years.reduce((a, b) => (Math.abs(b - year) < Math.abs(a - year) ? b : a));
  // ~8% a year depreciation from the nearest known point.
  const value = v.values[nearest] * Math.pow(0.92, nearest - year);
  return Math.round(value / 500) * 500;
}
