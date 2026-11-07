// Template for a real insurer portal bot. Copy to <insurer-id>.js, fill in the
// selectors (record them with: npx playwright codegen <portal-url>), and
// register it in providers/rpa/index.js.
//
// The bot only drives the portal. The price comes from the quotation slip
// PDF the portal produces, read by slips/parse.js (already tested against
// Allianz, Generali, Berjaya Sompo, Takaful Malaysia, Takaful Ikhlas, P&O and
// MSIG slips), so every insurer's numbers are read and checked the same way.
import { readFile } from 'node:fs/promises';
import { parseSlipPdf } from '../../../slips/parse.js';

export default {
  async login(page, ctx) {
    await page.goto(ctx.url);
    await page.fill('TODO user field', ctx.user);
    await page.fill('TODO password field', ctx.pass);
    await page.click('TODO login button');
    await page.waitForLoadState();
    if (await page.locator('TODO error message').count()) throw new Error('Portal rejected the password');
  },

  async isLoginPage(page) {
    return (await page.locator('TODO password field').count()) > 0;
  },

  // Optional: light activity so the portal doesn't log us out.
  async keepAlive(page, { url }) {
    await page.goto(url);
  },

  // IC + plate → vehicle, NCD, recommended sum insured (only for the insurer
  // marked lookupSource).
  async lookup(page, req) {
    // TODO: open new quotation, fill IC / plate / postcode, run the enquiry,
    // then read make, model, year, cc, ncd, sumInsured, siMin, siMax.
    throw new Error('Lookup not written for this insurer yet');
  },

  async quote(page, req) {
    const { owner, vehicle, cover } = req;
    // TODO: open new quotation and fill the form.
    // await page.fill('…', owner.nric); await page.fill('…', vehicle.regNo); …
    // Sum insured: use cover.sumInsured (the same for every insurer). If the
    // portal only allows a range, use the nearest allowed value and set siNote.
    // Add-ons: tick the portal's boxes for cover.addons.windscreen, specialPerils, …

    // Download the quotation slip and read it.
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('TODO print / download quotation button')]);
    const slip = await parseSlipPdf(await readFile(await download.path()), { filename: download.suggestedFilename() });
    if (slip.status === 'error') throw new Error(slip.reasons.join('; '));
    // 'check' = the slip's numbers don't add up: still show it, flagged.
    return { ...slip, status: 'quoted', notes: slip.checks.map((c) => `Check slip: ${c}`) };
  },
};
