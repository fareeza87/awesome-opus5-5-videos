// Takaful Ikhlas agent portal (w7.financial-link.com.my, loginTAK.jsp).
// Form filling ported from the agency's script (same field names), with two
// differences on purpose:
//   - the price comes from Ikhlas's own quotation slip after "Get A Quote",
//     read by the slip reader; the bot never works out a price itself
//   - underwriting answers (claims, offences, driving experience, race,
//     religion, occupation) come from the form; missing ones stop the quote
// Login: IKHLAS_PORTAL_URL / _USER / _PASS (or the old TAKAFUL_USERNAME / _PASSWORD).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSlipPdf } from '../../../slips/parse.js';
import { auditAddons } from '../../../slips/audit.js';
import { splitAddress } from './my-address.js';

const SLIPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'slips');
const TPFT_BEFORE_YEAR = Number(process.env.TPFT_BEFORE_YEAR || 2012);

async function formFrame(page, selector, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const f of page.frames()) if (await f.locator(selector).count().catch(() => 0)) return f;
    await page.waitForTimeout(300);
  }
  return null;
}
// Pick the <option> whose text matches; returns the text chosen or null.
async function pickOption(frame, name, test) {
  const sel = frame.locator(`select[name='${name}']`).first();
  if (!(await sel.count())) return null;
  const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent.trim() })));
  const hit = opts.find((o) => o.v && test(o.t.toUpperCase(), o.v));
  if (!hit) return null;
  await sel.selectOption(hit.v);
  return hit.t;
}
const fill = async (frame, name, value) => {
  const el = frame.locator(`input[name='${name}']`).first();
  if (await el.count() && value !== undefined && value !== null) { await el.fill(String(value)); await el.dispatchEvent('change'); }
};

export default {
  async login(page, ctx) {
    if (!page.__ikDialogs) {
      page.__ikDialogs = [];
      page.on('dialog', (d) => { page.__ikDialogs.push(d.message()); d.accept().catch(() => {}); });
    }
    await page.goto(ctx.url, { waitUntil: 'domcontentloaded' });
    await page.locator("input[name='field1']").first().fill(ctx.user);
    await page.locator("input[name='field2']").first().fill(ctx.pass);
    await page.locator("input[name='Submit']").first().click();
    await page.waitForLoadState('domcontentloaded');
    if (/invalid user id or password/i.test(await page.locator('body').innerText())) throw new Error('Takaful Ikhlas rejected the user ID or password');
  },

  async isLoginPage(page) {
    return (await page.locator("input[name='field2']").count()) > 0;
  },

  async lookup() {
    throw new Error('Use another insurer for the IC + plate lookup');
  },

  async quote(page, req, ctx) {
    const { owner, vehicle, cover } = req;
    const company = owner.idType === 'company';
    const id = String(owner.nric || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const addr = splitAddress(owner.address, owner.postcode);

    // Answers the portal asks for. They go to the insurer, so they must come from the customer.
    const missing = [];
    if (!addr.line) missing.push('address');
    if (owner.claims3y === '' || owner.claims3y === undefined) missing.push('claims in last 3 years');
    if (!owner.violations) missing.push('traffic offences');
    if (!owner.occupation) missing.push('occupation');
    if (!company) {
      if (owner.drivingExp === '' || owner.drivingExp === undefined) missing.push('driving experience');
      if (!owner.race) missing.push('race');
      if (!owner.religion) missing.push('religion');
    }
    if (missing.length) return { status: 'declined', reasons: [`Takaful Ikhlas needs: ${missing.join(', ')} (Driver details on the form)`] };
    if (Number(owner.claims3y) > 0 || owner.violations === 'yes') return { status: 'declined', reasons: ['Customer has claims or offences: quote Takaful Ikhlas by hand so the details are entered correctly'] };
    if (cover.addons?.ehailing) return { status: 'declined', reasons: ['Takaful Ikhlas e-hailing not set up in the bot'] };

    // New Business.
    page.__ikDialogs = [];
    const menu = await formFrame(page, 'text=New Business', 8000);
    if (!menu) { await this.login(page, ctx); }
    await (await formFrame(page, 'text=New Business')).locator('text=New Business').first().click();
    const f = await formFrame(page, "input[name='vehregno']");
    if (!f) throw new Error('Takaful Ikhlas: New Business form did not open');
    const notes = [];

    // Insured particulars.
    const email = owner.email || process.env.AGENCY_EMAIL || '';
    if (email) await fill(f, 'email', email);
    else await f.evaluate(() => { const c = document.theForm1?.chkEmail; if (c) c.checked = false; });
    await fill(f, 'name', (owner.name || '').toUpperCase());
    if (company) {
      if (/^20\d{10}$/.test(id)) {
        await fill(f, 'newbizregnoYYYY', id.slice(0, 4));
        await f.locator("select[name='newbizregnoEntity']").first().selectOption(id.slice(4, 6)).catch(() => {});
        await fill(f, 'newbizregnoSeq', id.slice(6));
        await f.evaluate(() => { if (typeof CombineNewBizRegNo === 'function') CombineNewBizRegNo(); });
      }
      const old = owner.oldBrn || (/^\d{5,7}-?[A-Z]$/.test(id) ? id : '');
      if (old) await fill(f, 'bizregno', old);
      await f.locator("select[name='bizCategory']").first().selectOption('C').catch(() => {});
      await f.evaluate(() => { if (typeof BusinessDefaultValue === 'function') BusinessDefaultValue(); });
    } else {
      const d = id.replace(/\D/g, '');
      if (owner.idType === 'nric' && d.length === 12) {
        const female = Number(d.at(-1)) % 2 === 0;
        await f.locator("select[name='nametitle']").first().selectOption(female ? 'MS' : 'MR').catch(() => {});
        await fill(f, 'new_ic1', d.slice(0, 6)); await fill(f, 'new_ic2', d.slice(6, 8)); await fill(f, 'new_ic3', d.slice(8));
        const yy = Number(d.slice(0, 2));
        await fill(f, 'dob', `${d.slice(4, 6)}/${d.slice(2, 4)}/${yy > new Date().getFullYear() % 100 ? 1900 + yy : 2000 + yy}`);
        await f.locator(`input[name='gender'][value='${female ? 'F' : 'M'}']`).first().check().catch(() => {});
        await pickOption(f, 'nationality', (t) => t === 'MALAYSIA' || t.endsWith('|MALAYSIA'));
      } else return { status: 'declined', reasons: ['Takaful Ikhlas bot handles NRIC and company only for now'] };
      if (!(await pickOption(f, 'race', (t) => t.startsWith(owner.race.toUpperCase())))) notes.push(`Race "${owner.race}" not in Ikhlas list`);
      if (!(await pickOption(f, 'religion', (t) => t.startsWith(owner.religion.toUpperCase())))) notes.push(`Religion "${owner.religion}" not in Ikhlas list`);
      await fill(f, 'drvexp', owner.drivingExp);
    }

    await fill(f, 'postcode', owner.postcode);
    await f.locator("input[name='postcode']").first().press('Tab');
    await f.evaluate(() => { if (typeof searchPostcode === 'function') searchPostcode(); if (typeof checkpostcode === 'function') checkpostcode(); });
    await page.waitForTimeout(800);
    if (!(await f.locator("input[name='town']").first().inputValue()) && addr.town) await fill(f, 'town', addr.town);
    await fill(f, 'address1', addr.line);
    if (owner.phone) await fill(f, 'tphoneno', owner.phone.replace(/\D/g, ''));

    const occ = owner.occupation.toUpperCase();
    const empl = /RETIRE/.test(occ) ? 'RETIRED' : /STUDENT/.test(occ) ? 'STUDENT' : /UNEMPLOY|HOUSE ?WIFE|SURI RUMAH/.test(occ) ? 'UNEMPLOYED' : /SELF|OWN BUSINESS|PENIAGA|BUSINESS ?OWNER/.test(occ) ? 'SELF EMPLOYED' : 'EMPLOYED';
    await pickOption(f, 'emp_status', (t) => t === empl);
    if (!(await pickOption(f, 'occupation', (t) => t === occ || t.includes(occ)))) {
      await pickOption(f, 'occupation', (t) => t === 'OTHERS');
      notes.push(`Occupation "${owner.occupation}" not in Ikhlas list: sent as Others`);
    }
    for (const n of ['claimyr', 'claimyr1', 'claimyr2', 'claimyr3']) await pickOption(f, n, (t) => t === '0');
    await pickOption(f, 'violation', (t) => t === 'NONE');

    // Vehicle.
    const plate = vehicle.regNo.replace(/\s+/g, '').toUpperCase();
    await pickOption(f, 'vehicle', (t) => t === 'PRIVATE CAR');
    await pickOption(f, 'condition', (t) => t === 'REGISTERED');
    await fill(f, 'vehregno', plate);
    if (!(await f.locator("input[name='logbookno']").first().inputValue().catch(() => 'x'))) await fill(f, 'logbookno', plate); // agency practice: card no. = plate
    await f.locator("input[value='Black List Checking']").first().click();
    await page.waitForTimeout(1500);
    if (page.__ikDialogs.some((m) => /not found|black ?list/i.test(m))) return { status: 'declined', reasons: [`Takaful Ikhlas: ${page.__ikDialogs.at(-1)}`] };
    if (!(await f.locator("select[name='vehiclefrom']").first().inputValue().catch(() => 'x'))) {
      await pickOption(f, 'vehiclefrom', (t) => t.includes('LOCALLY ASSEMBLED'));
      notes.push('Sent as locally assembled: check if the car is imported');
    }

    // Renewal starts the day after the previous policy ends.
    const prev = await f.locator("input[name='prepolexpdate']").first().inputValue().catch(() => '');
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(prev.trim());
    if (m) {
      const end = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
      if (end >= new Date(Date.now() - 864e5)) {
        const start = new Date(end.getTime() + 864e5);
        const stop = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()) - 864e5);
        const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
        await fill(f, 'effdate', dmy(start)); await fill(f, 'expdate', dmy(stop));
      }
    }

    // ISM: Proposed Sum Covered pop-up. Pick the variant matching the model, else the first.
    // Close pop-ups left over from an earlier quote: the portal reuses a named window.
    for (const other of page.context().pages()) if (other !== page) await other.close().catch(() => {});
    const ism = f.locator("input[name='abibutton'], input[value*='Check for Proposed Sum Covered' i]").first();
    const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 10000 }), ism.click()]);
    await popup.waitForLoadState('domcontentloaded');
    const rows = popup.locator("tr[name='nvic_for_select']");
    if (!(await rows.count())) { await popup.close(); return { status: 'declined', reasons: ['Takaful Ikhlas: no ISM market value for this vehicle'] }; }
    const want = String(vehicle.model || '').toUpperCase();
    const texts = await rows.allInnerTexts();
    const idx = Math.max(0, want ? texts.findIndex((t) => t.toUpperCase().includes(want)) : 0);
    // The row's click handler fills the form and closes the pop-up, so fire it from inside.
    await rows.nth(idx).evaluate((el) => el.click()).catch(() => {});
    await page.waitForTimeout(800);
    if (!popup.isClosed()) await popup.close();

    const year = Number(await f.locator("input[name='makeyear']").first().inputValue().catch(() => '')) || Number(vehicle.year);
    let coverType = cover.coverType;
    if (coverType === 'comprehensive' && year && year < TPFT_BEFORE_YEAR) { coverType = 'tpft'; notes.push(`Car made before ${TPFT_BEFORE_YEAR}: quoted Third Party, Fire & Theft`); }
    await pickOption(f, 'cover_type', (t) => t === { comprehensive: 'COMPREHENSIVE', tpft: 'THIRD PARTY FIRE AND THEFT', tp: 'THIRD PARTY' }[coverType]);

    const model = (await f.locator("select[name='ismmodelcode'] option:checked").first().innerText().catch(() => '')).toUpperCase() + ' ' + want;
    if (!(await f.locator("select[name='bodyID']").first().inputValue().catch(() => 'x'))) {
      const hatch = /MYVI|AXIA|YARIS|JAZZ|SWIFT|IRIZ|ALMERA HATCH|HATCHBACK/.test(model);
      await pickOption(f, 'bodyID', (t) => (hatch ? t.includes('HATCHBACK') : t.includes('SALOON') || t.includes('SEDAN')));
    }
    if (!(await f.locator("select[name='vehfueltype']").first().inputValue().catch(() => 'x'))) {
      const fuel = /\bEV\b|ELECTRIC|ATTO|DOLPHIN|TESLA|SEAL\b/.test(model) ? 'ELECTRIC' : /HYBRID|HEV\b/.test(model) ? 'HYBRID' : 'PETROL';
      await pickOption(f, 'vehfueltype', (t) => t.includes(fuel));
    }
    if (cover.addons?.allDrivers) await pickOption(f, 'piamdrv', (t, v) => t.includes('ALL DRIVER') || v === '03');

    // Sum covered: the shared amount if given (the portal checks its own range).
    if (coverType !== 'tp' && cover.sumInsured) await fill(f, 'sum_insured', Math.round(cover.sumInsured));

    // NCD Enquiry.
    const prevVeh = f.locator("input[name='ism_pre_veh_no']").first();
    if (await prevVeh.count() && !(await prevVeh.inputValue())) await prevVeh.fill(plate);
    await f.locator("input#ncdEnquiry, input[value='NCD Enquiry']").first().click();
    await page.waitForTimeout(1500);
    const ncdMsg = await f.locator('#ncdResponseMessage').first().innerText().catch(() => '');
    if (/\b001\b|already been taken|confirmation already taken/i.test(ncdMsg)) return { status: 'declined', alreadyRenewed: true, reasons: ['Already renewed with another insurer (NCD 001)'] };

    // Add Extra Benefit → portal validates; any alert means something is missing.
    const next = () => f.locator("input[name='nextButton'][value*='Add Extra Benefit' i], input[value='Add Extra Benefit']").last().click();
    page.__ikDialogs = [];
    await next();
    let ext = await formFrame(page, '#genQuotation', 8000);
    // Sum covered outside Ikhlas's range: use the nearest allowed amount and say so.
    let siNote = null;
    const range = /between RM\s*([\d,]+(?:\.\d+)?) and RM\s*([\d,]+(?:\.\d+)?)/i.exec(page.__ikDialogs.join(' '));
    if (!ext && range && cover.sumInsured) {
      const [lo, hi] = [range[1], range[2]].map((x) => Number(x.replace(/,/g, '')));
      const si = Math.min(Math.max(cover.sumInsured, lo), hi);
      siNote = `Takaful Ikhlas accepts RM${lo.toLocaleString()}–${hi.toLocaleString()}; quoted at RM${si.toLocaleString()} instead of RM${cover.sumInsured.toLocaleString()}`;
      await fill(f, 'sum_insured', si);
      page.__ikDialogs = [];
      await next();
      ext = await formFrame(page, '#genQuotation', 8000);
    }
    if (!ext) {
      const alertText = page.__ikDialogs.join(' | ');
      return { status: 'declined', reasons: [`Takaful Ikhlas form not accepted${alertText ? `: ${alertText}` : ''}`] };
    }

    // Additional coverage (same Financial-Link fields as Etiqa: WSC windscreen, EP057 special perils).
    const tick = async (sel, on) => { const c = ext.locator(sel).first(); if (await c.count()) { if (on) await c.check(); else await c.uncheck(); } };
    await tick("input[name='cew'][value^='WSC|']", !!cover.addons?.windscreen);
    if (cover.addons?.windscreen) await ext.locator("input[name^='SIWSC']").first().fill(String(Math.round(cover.windscreenSI || 1000))).catch(() => {});
    await tick("input[name='cew'][value^='EP057|']", !!cover.addons?.specialPerils);
    await ext.locator('#genQuotation').click();

    // Ikhlas's own slip: find it, print it to PDF, read it.
    const slipFrame = await formFrame(page, 'text=/Takaful Contribution Payable|CONTRIBUTION DETAIL/i', 20000);
    if (!slipFrame) throw new Error(`Takaful Ikhlas: no quotation slip after Get A Quote${page.__ikDialogs.length ? ` (${page.__ikDialogs.join(' | ')})` : ''}`);
    const view = await page.context().newPage();
    let pdf;
    try {
      await view.goto(slipFrame.url(), { waitUntil: 'load' });
      pdf = await view.pdf({ format: 'A4', printBackground: true });
    } finally { await view.close(); }

    const slip = await parseSlipPdf(pdf, { filename: 'ikhlas.pdf', expectInsurer: 'ikhlas' });
    if (slip.status === 'error') throw new Error(`Takaful Ikhlas slip: ${slip.reasons.join('; ')}`);
    await mkdir(SLIPS, { recursive: true });
    const file = `${plate}_IKHLAS_${slip.insurerRef || Date.now()}.pdf`;
    await writeFile(path.join(SLIPS, file), pdf);

    const { providerId, provider, kind, ...figures } = slip;
    return {
      ...figures,
      status: 'quoted',
      coverType,
      siNote,
      notes: [...notes, ...slip.checks.map((c) => `Check slip: ${c}`), ...slip.notes, ...auditAddons(cover, slip)],
      slipFile: file,
      benefits: ['Takaful Ikhlas quotation slip saved'],
    };
  },
};
