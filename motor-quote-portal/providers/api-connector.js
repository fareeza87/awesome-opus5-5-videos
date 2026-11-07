// Template for an insurer that offers an agency quotation API.
// Each insurer's API differs, so map our request to theirs and their reply
// back to our quote shape (see rateQuote in public/engine/rate.js).
//
// Credentials come from environment variables, never from code:
//   <PROVIDER_ID>_API_URL, <PROVIDER_ID>_API_KEY   e.g. INSURER_A_API_URL

export async function quoteViaApi(provider, req) {
  const prefix = provider.id.toUpperCase().replace(/-/g, '_');
  const url = process.env[`${prefix}_API_URL`];
  const key = process.env[`${prefix}_API_KEY`];
  if (!url || !key) throw new Error(`API not configured (set ${prefix}_API_URL and ${prefix}_API_KEY)`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(toInsurerFormat(req)),
  });
  if (!res.ok) throw new Error(`Insurer API returned ${res.status}`);
  return fromInsurerFormat(await res.json());
}

// Adjust these two functions per insurer.
function toInsurerFormat({ owner, vehicle, cover }) {
  return {
    vehicleRegNo: vehicle.regNo,
    idNo: owner.nric,
    postcode: owner.postcode,
    coverType: cover.coverType,
    sumInsured: cover.sumInsured,
    ncdPercent: cover.ncd,
    extensions: Object.keys(cover.addons ?? {}).filter((k) => cover.addons[k]),
  };
}

function fromInsurerFormat(r) {
  return {
    status: 'quoted',
    basic: r.basicPremium,
    ncdAmount: r.ncdAmount,
    addons: (r.extensions ?? []).map((e) => ({ key: e.code, label: e.name, amount: e.premium })),
    addonTotal: r.extensionTotal,
    gross: r.grossPremium,
    sst: r.sst,
    stampDuty: r.stampDuty,
    total: r.totalPayable,
    excess: r.excess ?? 0,
    commission: r.commission ?? 0,
    benefits: r.benefits ?? [],
    insurerRef: r.quotationNo,
    validDays: r.validDays ?? 14,
  };
}
