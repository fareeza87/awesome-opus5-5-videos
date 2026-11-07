// Template for an insurer with only a web agent portal (no API).
// It fills the portal form the same way staff do today, so all portals run
// in parallel and nobody re-types the same customer five times.
//
// Needs Playwright on the server:  npm install playwright
// Credentials: <PROVIDER_ID>_PORTAL_URL, _PORTAL_USER, _PORTAL_PASS
// Check each insurer's agency agreement allows automated access first.

export async function quoteViaPortal(provider, req) {
  const prefix = provider.id.toUpperCase().replace(/-/g, '_');
  const url = process.env[`${prefix}_PORTAL_URL`];
  const user = process.env[`${prefix}_PORTAL_USER`];
  const pass = process.env[`${prefix}_PORTAL_PASS`];
  if (!url || !user || !pass) throw new Error(`Portal login not configured (set ${prefix}_PORTAL_URL/_USER/_PASS)`);

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('Playwright not installed on the server (npm install playwright)'); }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url);

    // ---- Replace the selectors below with the insurer portal's own. ----
    await page.fill('#username', user);
    await page.fill('#password', pass);
    await page.click('button[type=submit]');
    await page.waitForLoadState('networkidle');

    await page.click('text=New Motor Quotation');
    await page.fill('#vehRegNo', req.vehicle.regNo);
    await page.fill('#idNo', req.owner.nric);
    await page.fill('#postcode', req.owner.postcode);
    await page.selectOption('#coverType', req.cover.coverType);
    if (req.cover.sumInsured) await page.fill('#sumInsured', String(req.cover.sumInsured));
    await page.click('#btnCalculate');
    await page.waitForSelector('#totalPayable');

    const num = async (sel) => Number((await page.textContent(sel)).replace(/[^\d.]/g, ''));
    return {
      status: 'quoted',
      basic: await num('#basicPremium'),
      ncdAmount: await num('#ncdAmount'),
      addons: [],
      addonTotal: 0,
      gross: await num('#grossPremium'),
      sst: await num('#sst'),
      stampDuty: await num('#stampDuty'),
      total: await num('#totalPayable'),
      excess: 0,
      commission: 0,
      benefits: [],
      validDays: 14,
    };
  } finally {
    await browser.close();
  }
}
