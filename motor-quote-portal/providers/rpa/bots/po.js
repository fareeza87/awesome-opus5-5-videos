// Pacific & Orient agent portal (login2agent.pacific-orient.com).
// Ported from the agency's working Python script: same field names and steps.
//   login → Message of the Day "Main Menu" → Motor Quotation "Add"
//   screen 1: plate + GET INFO, company car / e-hailing radios
//   screen 2: insured, ID, postcode, address, cover, sum insured, extensions
//   screen 3: summary → "Print & Save Quotation" pop-up → read the slip
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSlipPdf } from '../../../slips/parse.js';
import { splitAddress } from './my-address.js';
import { auditAddons } from '../../../slips/audit.js';

const SLIPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'slips');
const TPFT_BEFORE_YEAR = Number(process.env.PO_TPFT_BEFORE_YEAR || 2012); // agency rule: older cars get TPFT
const money = (s) => Number(String(s).replace(/[^\d.]/g, ''));

// The portal uses frames: look in every frame for the first match.
async function find(page, selector) {
  for (const f of page.frames()) {
    const loc = f.locator(selector);
    if (await loc.count().catch(() => 0)) return loc.first();
  }
  return null;
}
async function waitFind(page, selector, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const loc = await find(page, selector);
    if (loc) return loc;
    await page.waitForTimeout(300);
  }
  return null;
}
async function allText(page) {
  const out = [];
  for (const f of page.frames()) out.push(await f.locator('body').innerText().catch(() => ''));
  return out.join('\n');
}
async function fillIf(page, selector, value) {
  const el = await find(page, selector);
  if (el && value !== undefined && value !== null) { await el.fill(String(value)); await el.dispatchEvent('change'); }
  return !!el;
}
async function selectIf(page, selector, option) {
  const el = await find(page, selector);
  if (el) await el.selectOption(option).catch(() => {});
}

export default {
  async login(page, ctx) {
    if (!page.__poDialogs) {
      page.__poDialogs = true;
      page.on('dialog', (d) => (/driveguard/i.test(d.message()) ? d.dismiss() : d.accept()).catch(() => {}));
    }
    await page.goto(ctx.url, { waitUntil: 'domcontentloaded' });
    const user = await waitFind(page, "input[name='txtUserName']", 8000);
    if (user) {
      await user.fill(ctx.user);
      await (await find(page, "input[name='txtPassword']")).fill(ctx.pass);
      await (await find(page, "input[name='login']")).click();
      await page.waitForTimeout(1500);
      if (/invalid agent id or password/i.test(await allText(page))) throw new Error('P&O rejected the agent ID or password');
      // A refused login is sent to P&O's new front page instead of showing an error.
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      if (/agent\.pacific-orient\.com\/?$/i.test(page.url()) && await find(page, "input[name='uname']")) {
        throw new Error('P&O refused the login (user name or password incorrect). Check the P&O password in Settings; the bot will not retry');
      }
    }
    await this.mainMenu(page);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    if (/AllPolicyTypeOldMenu/i.test(page.url())) page.__poMenu = page.url();
  },

  async isLoginPage(page) {
    return !!(await find(page, "input[name='txtUserName']"));
  },

  // Message of the Day splash: click "Main Menu".
  async mainMenu(page) {
    const btn = await waitFind(page, "input[value*='Main Menu' i], a:has-text('Main Menu')", 6000);
    if (btn) { await btn.click(); await page.waitForTimeout(800); }
  },

  async openNewQuotation(page, ctx) {
    // Go back to the menu page if we know it; P&O's front page logs you out.
    await page.goto(page.__poMenu || ctx.url, { waitUntil: 'domcontentloaded' });
    if (await waitFind(page, "input[name='txtUserName']", page.__poMenu ? 3000 : 8000)) await this.login(page, ctx);
    else await this.mainMenu(page);
    for (let i = 0; i < 10; i++) {
      // The login page can show up late (slow load or expired session).
      if (await find(page, "input[name='txtUserName']")) await this.login(page, ctx);
      for (const f of page.frames()) {
        // The menu nests tables, so take the nearest row around the label,
        // not an outer row that also holds every other menu item.
        const row = f.locator('td', { hasText: /^\s*Motor Quotation\s*$/ }).locator('xpath=ancestor::tr[1]');
        const add = row.locator("a:has-text('Add'), input[value*='Add' i]");
        if (await add.count().catch(() => 0)) {
          await add.first().click();
          if (await waitFind(page, "input[name='txtCurrRegNo']")) return;
        }
      }
      await page.waitForTimeout(500);
    }
    throw new Error('Could not open Motor Quotation → Add');
  },

  async lookup() {
    throw new Error('Use another insurer for the IC + plate lookup');
  },

  async quote(page, req, ctx) {
    const { owner, vehicle, cover } = req;
    if (cover.addons?.ehailing) return { status: 'declined', reasons: ['P&O does not offer e-hailing cover'] };
    const addr = splitAddress(owner.address, owner.postcode);
    if (!addr.line) return { status: 'declined', reasons: ["P&O needs the customer's address (add it on the form)"] };
    if (!addr.town) return { status: 'declined', reasons: ['P&O needs the town: add it at the end of the address'] };

    const plate = vehicle.regNo.replace(/\s+/g, '').toUpperCase();
    const id = String(owner.nric || '').replace(/[^a-zA-Z0-9]/g, '');
    const isCompany = owner.idType === 'company';
    const isPassport = owner.idType === 'passport';

    await this.openNewQuotation(page, ctx);

    // Screen 1: vehicle lookup.
    await (await find(page, "input[name='txtCurrRegNo']")).fill(plate);
    const info = await find(page, "input[name='btnINFO'], input[value*='GET INFO' i]");
    if (info) await info.click(); else await (await find(page, "input[name='txtCurrRegNo']")).press('Enter');
    // GET INFO reloads the page with the car filled in from JPJ/ISM.
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(1500);
    if (/no record found/i.test(await allText(page))) return { status: 'declined', reasons: ['P&O: vehicle not found at JPJ/ISM'] };
    const coverLabel = { comprehensive: 'COMPREHENSIVE', tpft: 'THIRD PARTY, FIRE & THEFT' }[cover.coverType];
    if (coverLabel) await selectIf(page, "select[name='cbxCoverPC']", { label: coverLabel });
    await (await waitFind(page, `input[name='opPCCoInd'][value='${isCompany ? 'Y' : 'N'}']`))?.check();
    await (await find(page, "input[name='opEHailing'][value='N']"))?.check();
    const submit1 = await waitFind(page, "input[name='btnSubmit']");
    if (!submit1) throw new Error(`P&O screen 1: Submit not found. ${(await allText(page)).slice(0, 120)}`);
    await submit1.click();
    if (!(await waitFind(page, "input[name='txtInsName']"))) throw new Error(`P&O screen 1: ${(await allText(page)).slice(0, 120)}`);

    // Screen 2: insured and risk details.
    await fillIf(page, "input[name='txtInsName']", owner.name || id);
    if (isPassport) {
      await selectIf(page, "select[name='cbxIDType']", 'P');
      if (!(await fillIf(page, "input[name='txtPassport']", id))) await fillIf(page, "input[name='txtNewIC']", id);
    } else if (isCompany) {
      await selectIf(page, "select[name='cbxIDType']", 'B');
      await fillIf(page, "input[name='txtBusRegNo']", id);
      if (owner.oldBrn) await fillIf(page, "input[name='txtOldBusRegNo']", owner.oldBrn);
    } else {
      await fillIf(page, "input[name='txtNewIC']", id);
      const last = Number(id.at(-1));
      if (!Number.isNaN(last)) await selectIf(page, "select[name='cbxInsGender']", last % 2 ? 'MALE' : 'FEMALE');
    }
    await fillIf(page, "input[name='txtPostCode']", owner.postcode);
    await fillIf(page, "input[name='txtMailAdd1']", addr.line);
    await fillIf(page, "input[name='txtMailTown']", addr.town);
    if (addr.state) await selectIf(page, "select[name='txtMailState']", addr.state);

    const notes = [];
    let coverType = cover.coverType;
    const year = Number(vehicle.year);
    if (coverType === 'comprehensive' && year && year < TPFT_BEFORE_YEAR) {
      coverType = 'tpft';
      notes.push(`Car made before ${TPFT_BEFORE_YEAR}: quoted Third Party, Fire & Theft`);
    }
    await selectIf(page, "select[name='cbxCovType']", { comprehensive: '1', tpft: '2', tp: '3' }[coverType]);

    // Sum insured: P&O shows an allowed range. Use the shared sum insured,
    // kept inside the range; with none given, P&O's own suggested amount.
    const siBox = await find(page, "input[name='txtSumin']");
    let si = cover.sumInsured;
    let siNote = null;
    if (siBox && coverType !== 'tp') {
      const rowText = await siBox.evaluate((el) => (el.closest('tr') || el.parentElement).innerText);
      const m = /RM\s*([\d,]{4,}(?:\.\d{2})?)\s*(?:-|to)\s*RM\s*([\d,]{4,}(?:\.\d{2})?)/i.exec(rowText);
      if (m) {
        const [lo, hi] = [money(m[1]), money(m[2])].sort((a, b) => a - b);
        const suggested = money(await siBox.inputValue());
        if (!si) si = suggested >= lo && suggested <= hi ? suggested : lo;
        else if (si < lo || si > hi) {
          const asked = si;
          si = Math.min(Math.max(si, lo), hi);
          siNote = `P&O accepts RM${lo.toLocaleString()}–${hi.toLocaleString()}; quoted at RM${si.toLocaleString()} instead of RM${asked.toLocaleString()}`;
        }
      }
      if (!si) si = money(await siBox.inputValue());
      await siBox.fill(String(si));
    }

    // Extensions: M2 special perils (flood), M4/N4 windscreen.
    const tick = async (name, on) => { const b = await find(page, `input[name='${name}']`); if (b) await (on ? b.check() : b.uncheck()); };
    // All drivers (agency rule: on unless switched off).
    const allDrv = await find(page, "input[name='chkAllDriver']");
    if (allDrv && cover.addons?.allDrivers !== undefined) await (cover.addons.allDrivers ? allDrv.check() : allDrv.uncheck()).catch(() => {});
    await tick('M2', cover.addons?.specialPerils);
    await tick('M4', cover.addons?.windscreen);
    if (cover.addons?.windscreen) await fillIf(page, "input[name='N4']", cover.windscreenSI || 1000);

    await (await find(page, "input[name='btnSubmit']")).click();
    await page.waitForTimeout(1200);

    // P&O may answer "Minimum/Maximum Sum Insured allowed is X": go back and use X.
    const limit = /(Minimum|Maximum)\s+Sum\s+Insured\s+allowed\s+is\s+([\d,]+(?:\.\d+)?)/i.exec(await allText(page));
    if (limit) {
      const allowed = money(limit[2]);
      siNote = `P&O ${limit[1].toLowerCase()} sum insured is RM${allowed.toLocaleString()}; quoted at that amount`;
      await (await find(page, "input[value='Back']"))?.click();
      const box = await waitFind(page, "input[name='txtSumin']");
      if (!box) throw new Error('P&O sum insured limit: could not go back to screen 2');
      await box.fill(String(allowed));
      si = allowed;
      await (await find(page, "input[name='btnSubmit']")).click();
      await page.waitForTimeout(1200);
    }

    // Screen 3: referral or summary.
    const summary = await allText(page);
    if (/internal stored procedure error/i.test(summary)) throw new Error('P&O portal error (stored procedure) on screen 3');
    if (/refer risk|refer to underwriting|refer case details/i.test(summary)) {
      const reasons = [...summary.matchAll(/(R\d{3}[^\n\r]*)/g)].map((m) => m[1].trim()).filter((r) => !/^R080 Department/i.test(r));
      return { status: 'declined', referred: true, reasons: [`Referred to P&O underwriter${reasons.length ? ': ' + reasons.join('; ') : ''}`] };
    }

    // Official slip: "Print & Save Quotation" opens it in a pop-up.
    const printBtn = await waitFind(page, "input[value*='Print & Save Quotation' i], button:has-text('Print & Save Quotation'), a:has-text('Print & Save Quotation')");
    if (!printBtn) throw new Error('P&O: "Print & Save Quotation" button not found');
    const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 15000 }), printBtn.click()]);
    await popup.waitForLoadState('load');
    const pdf = await popup.pdf({ format: 'A4', printBackground: true });
    await popup.close();

    const slip = await parseSlipPdf(pdf, { filename: 'po.pdf', expectInsurer: 'po' });
    if (slip.status === 'error') throw new Error(`P&O slip: ${slip.reasons.join('; ')}`);
    await mkdir(SLIPS, { recursive: true });
    const file = `${plate}_PO_${slip.insurerRef || Date.now()}.pdf`;
    await writeFile(path.join(SLIPS, file), pdf);

    const { providerId, provider, kind, ...figures } = slip; // keep the panel's own id and name
    return {
      ...figures,
      status: 'quoted',
      coverType,
      siNote,
      notes: [...notes, ...slip.checks.map((c) => `Check slip: ${c}`), ...slip.notes, ...auditAddons(cover, slip)],
      slipFile: file,
      benefits: ['Official P&O quotation slip saved'],
    };
  },
};
