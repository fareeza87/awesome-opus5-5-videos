// Generali agent portal (omni.generali.com.my → e-Business → Quick Quotation).
// Worked out on the live portal, 9 Nov 2026. Agency rules:
//   - the customer is found by ID (Search By = Individual/Business + the ID
//     number), never by name
//   - annual e-hailing = the "Annual e-Hailing extension" (BEHA, fixed RM1,950)
// The price is read from Generali's own Calculate Premium figures and checked:
// basic − NCD + extras = gross; gross + tax + stamp = total.
// Login: GENERALI_PORTAL_USER / _PASS, or Settings.

const TPFT_LAST_YEAR = Number(process.env.TPFT_LAST_YEAR || 2012); // agency rule
const money = (s) => Number(String(s || '').replace(/[^\d.-]/g, '')) || 0;
const sleep = (page, ms) => page.waitForTimeout(ms);
const step = (...a) => { if (process.env.RPA_DEBUG === '1') console.log('[generali]', new Date().toISOString().slice(11, 19), ...a); };

// Generali's form lives in pop_quickquote_add_1 (customer & car) and
// pop_quickquote_add_2 (sum, NCD, extras, premium).
const part = (page, n) => page.frames().find((f) => new RegExp(`pop_quickquote_add_${n}`).test(f.url()));

// The form reloads after several fields: wait until it answers again.
async function settle(page, n = 1) {
  await sleep(page, 2500);
  await page.waitForLoadState('load').catch(() => {});
  for (let k = 0; k < 6; k++) {
    const f = part(page, n) || page.mainFrame();
    try { await f.evaluate(() => document.forms.length); return f; } catch { await sleep(page, 1500); }
  }
  return part(page, n) || page.mainFrame();
}

const field = (f, name) => f.locator(`[name='${name}']:visible, #${name}:visible`).first();
async function type(page, f, name, value) {
  await field(f, name).fill(String(value));
  await field(f, name).press('Tab').catch(() => {});
  await sleep(page, 1500);
}

// dd-mm-yyyy
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
const dobFromIc = (ic) => {
  const d = String(ic).replace(/\D/g, '');
  if (d.length !== 12) return null;
  const yy = Number(d.slice(0, 2));
  return `${d.slice(4, 6)}-${d.slice(2, 4)}-${yy > new Date().getFullYear() % 100 ? 1900 + yy : 2000 + yy}`;
};

// Extra cover codes on Generali's list.
const EXTRA = { ehailing: 'BEHA', windscreen: 'B089', specialPerils: 'B057', srcc: 'B025', llop: 'B072', llan: 'B100', cart: '112' };

export default {
  async login(page, ctx) {
    if (!page.__genDialogs) {
      page.__genDialogs = [];
      page.on('dialog', (d) => { page.__genDialogs.push(d.message()); d.accept().catch(() => {}); });
    }
    await page.goto(ctx.url, { waitUntil: 'domcontentloaded' });
    const user = page.locator("input[name='loginId']");
    if (!(await user.count())) return; // already in
    // The page must finish loading first, or LOGIN submits a plain form.
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(page, 3000);
    await user.fill(ctx.user);
    await page.locator("input[name='password']").fill(ctx.pass);
    await page.locator('button', { hasText: /^\s*LOGIN\s*$/ }).first().click();
    await page.waitForURL((u) => !/login/i.test(u.pathname), { timeout: 30000 }).catch(() => {});
    if (/login/i.test(new URL(page.url()).pathname)) {
      const t = await page.locator('body').innerText().catch(() => '');
      throw new Error(/invalid|incorrect|wrong/i.test(t) ? 'Generali rejected the user ID or password' : 'Generali login did not finish');
    }
  },

  async isLoginPage(page) {
    return /login/i.test(page.url()) && (await page.locator("input[name='loginId']").count()) > 0;
  },

  async lookup() {
    throw new Error('Use another insurer for the IC + plate lookup');
  },

  async quote(page, req, ctx) {
    const { owner, vehicle, cover } = req;
    const notes = [];
    page.__genDialogs = [];
    if (cover.addons?.ehailing && cover.ehailingPeriod === 'daily') return { status: 'declined', reasons: ['Generali: daily e-hailing not offered (annual only)'] };
    const company = owner.idType === 'company';
    if (owner.idType === 'passport') return { status: 'declined', reasons: ['Generali bot handles NRIC and company only for now'] };
    const id = String(owner.nric || '').replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
    const icDigits = id.replace(/\D/g, '');
    const plate = vehicle.regNo.replace(/\s+/g, '').toUpperCase();
    // Make/model is chosen from Generali's own list by keyword: it needs the model.
    const wantModel = String(vehicle.model || '').trim();
    if (!wantModel) return { status: 'declined', reasons: ['Generali needs the car model (e.g. "Bezza 1.3 AV"): fill it on the form or snap the grant'] };

    // e-Business → Quick Quotation → Create
    await page.goto(new URL('/', ctx.url).href, { waitUntil: 'domcontentloaded' });
    if (await this.isLoginPage(page)) await this.login(page, ctx);
    await page.getByText('e-Business', { exact: true }).first().click();
    await page.waitForURL(/clientProfile/, { timeout: 60000 });
    await sleep(page, 2500);
    await page.getByText('Quick Quotation', { exact: true }).first().click();
    await page.waitForURL(/QuickQuote/i, { timeout: 30000 }).catch(() => {});
    await sleep(page, 2500);
    await page.locator('#addbtn').first().click();
    await sleep(page, 5000);
    let f = await settle(page);

    // 1. Customer by ID (agency rule: never search by name).
    await f.selectOption("select[name='SPE_CONTACT_TYPE']", { label: company ? 'Business' : 'Individual' });
    await sleep(page, 800);
    await type(page, f, 'VALUE_TEXT', company ? id : icDigits);
    f = await settle(page);
    // 2. Postcode (fills town and state).
    await type(page, f, 'POSTCODE', owner.postcode);
    f = await settle(page);
    // 3. Plate, cover start date, then Generali's ISM car lookup (VIX).
    await type(page, f, 'VEHNO', plate);
    f = await settle(page);
    // Cover starts tomorrow, or the day after the current policy ends (found on the premium page).
    const start = req.__genStart || (cover.startDate ? new Date(`${cover.startDate}T12:00:00Z`) : null) || new Date(Date.now() + 8 * 3600e3 + 864e5);
    const setStart = () => f.evaluate((v) => { const e = document.getElementById('EFFDATE'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, dmy(start));
    await setStart();
    await sleep(page, 2500);
    await f.evaluate(() => fnGetVIX()); // a click on the button would clear the date
    for (let i = 0; i < 30 && !(await field(f, 'CAP').inputValue().catch(() => '')); i++) await sleep(page, 1000);
    step('after vix', JSON.stringify(await f.evaluate(() => [...document.querySelectorAll('input')].filter((e) => /\d{2}[-/]\d{2}[-/]\d{4}/.test(e.value) || /EXP|POL|NCD/i.test(e.name)).map((e) => `${e.name}=${e.value}`)).catch(() => [])));
    const cc = Number(await field(f, 'CAP').inputValue().catch(() => '')) || Number(vehicle.cc) || 0;
    const year = Number(await field(f, 'YEARMAKE').inputValue().catch(() => '')) || Number(vehicle.year) || 0;
    if (!cc) {
      const said = page.__genDialogs.at(-1);
      return { status: 'declined', reasons: [`Generali: car not found at ISM${said ? ` (${said})` : ''}`] };
    }

    // Cover type (agency rule: 2012 or older → TPFT).
    let coverType = cover.coverType;
    if (coverType === 'comprehensive' && year && year <= TPFT_LAST_YEAR) { coverType = 'tpft'; notes.push(`Car made in ${year} (${TPFT_LAST_YEAR} or older): quoted Third Party, Fire & Theft`); }
    await f.selectOption("select[name='SUBCLS']", { label: { comprehensive: 'Comprehensive', tpft: 'Third Party Fire & Theft', tp: 'Third Party' }[coverType] }).catch(() => {});
    await sleep(page, 1500);

    // 4. Make/model from Generali's list: keyword = the model name, then the
    // row with the same engine size band (1,329cc → "1300") and variant words.
    const words = wantModel.toUpperCase().replace(/[^A-Z0-9. ]/g, ' ').split(/\s+/).filter(Boolean);
    const keyword = words.find((w) => /^[A-Z]{3,}$/.test(w) && !['PERODUA', 'PROTON', 'TOYOTA', 'HONDA', 'NISSAN', 'MAZDA', 'AUTO', 'MANUAL'].includes(w)) || words[0];
    await f.evaluate(() => { fnSearchModel(); if (window.jQuery) jQuery('#exampleNiftyFlipHorizontal').modal('show'); });
    await sleep(page, 3500);
    const mm = page.frames().find((x) => /search_makemodel/.test(x.url()));
    if (!mm) throw new Error('Generali: make/model search did not open');
    const box = mm.locator('input[type=text]:visible').first();
    await box.fill(keyword);
    await box.press('Enter');
    await sleep(page, 4000);
    const rows = await mm.locator('tr[ondblclick]').evaluateAll((trs) => trs.map((tr, i) => ({ i, text: tr.innerText.replace(/\s+/g, ' ').trim() })));
    if (!rows.length) return { status: 'declined', reasons: [`Generali has no model matching "${keyword}"`] };
    const band = cc ? String(Math.round(cc / 100) * 100) : '';
    const auto = !/manual|\bMT\b/i.test(wantModel);
    // Variant words count too, even one letter ("X"); the keyword itself does not.
    const score = (t) => (band && t.includes(band) ? 5 : 0) + words.filter((w) => w !== keyword && !/^\d/.test(w) && new RegExp(`(^|\\s)${w.replace('.', '\\.')}(\\s|\\)|$)`, 'i').test(t)).length * 3
      + (auto ? (/auto|\bAT\b/i.test(t) ? 1 : 0) : (/manual|\bMT\b/i.test(t) ? 1 : 0));
    let best = rows[0];
    for (const r of rows) if (score(r.text) > score(best.text)) best = r;
    const ties = rows.filter((r) => r !== best && score(r.text) === score(best.text)).map((r) => r.text.replace(/^\S+\s+/, ''));
    await mm.locator('tr[ondblclick]').nth(best.i).locator('a').first().click();
    await sleep(page, 4000);
    f = await settle(page);
    const modelName = await field(f, 'MODEL').inputValue().catch(() => '');
    notes.push(`Model picked on Generali: ${modelName || best.text}${ties.length ? `. Also possible: ${ties.slice(0, 3).join('; ')}` : ''}`);

    // 5. Variant (NVIC): the ISM entry for that model; same variant word wins.
    step('model', modelName);
    const nvics = await f.evaluate(() => [...(document.getElementsByName('NVIC')[0]?.options || [])].filter((o) => o.value).map((o) => ({ v: o.value, t: o.text.trim() })));
    if (!nvics.length) return { status: 'declined', reasons: ['Generali: no ISM variant (NVIC) for this model'] };
    const variantWord = (modelName.toUpperCase().match(/\b(AV|X|G|GX|GXTRA|E|S|V|H|PREMIUM|EXECUTIVE|STANDARD|FLAGSHIP)\b/) || [])[1];
    const nvic = nvics.find((n) => variantWord && n.t.split(',').map((x) => x.trim().toUpperCase()).includes(variantWord)) || nvics[0];
    if (nvics.length > 1 && !(variantWord && nvic.t.toUpperCase().includes(variantWord))) notes.push(`Generali variant not matched: used ${nvic.t}`);
    await f.selectOption("select[name='NVIC']", nvic.v);
    await sleep(page, 3000);
    f = await settle(page);

    // 6. Declarations, then the customer's fields once more (later steps clear
    // them) and Next. Generali wants the ID in the Search column at this point.
    for (const n of ['DECLARATION_1', 'DECLARATION_2', 'DECLARATION_3']) {
      const c = f.locator(`input[name='${n}']:visible`).first();
      if ((await c.count()) && !(await c.isChecked())) await c.check().catch(() => {});
    }
    await setStart();
    await sleep(page, 2000);
    const name = (owner.name || process.env.DEFAULT_CUSTOMER_NAME || 'CUSTOMER').toUpperCase().slice(0, 60);
    await f.evaluate(({ idv, ic, name, dob }) => {
      const q = (n) => document.querySelector(`form[name=mainform] [name=${n}]`);
      document.getElementById('VALUE_TEXT').value = idv;
      if (ic && q('NEW_IC_NO')) q('NEW_IC_NO').value = ic;
      if (q('NAME') && !q('NAME').value) q('NAME').value = name;
      if (dob && q('DOB') && !q('DOB').value) q('DOB').value = dob;
    }, { idv: company ? id : icDigits, ic: company ? '' : icDigits, name, dob: company ? null : dobFromIc(icDigits) });
    page.__genDialogs = [];
    step('next');
    const next = f.locator('#next:visible, a:has-text("Next"):visible').first();
    await next.click({ timeout: 8000 }).catch(() => next.evaluate((e) => e.click()));
    await sleep(page, 6000);
    const blocking = page.__genDialogs.filter((m) => !/Check NCD FROM/i.test(m));
    if (blocking.length) return { status: 'declined', reasons: [`Generali: ${blocking.join(' | ')}`] };

    // 7. NCD (ISM enquiry), extras, Calculate Premium.
    step('part 2', page.__genDialogs);
    const p2 = part(page, 2);
    if (!p2) throw new Error('Generali: premium page did not open');
    const ncdBtn = p2.locator("input[name='CHECK_NCDFROM']");
    // Generali's NCD answer comes a few seconds later, and an early press is
    // ignored: press again until the NCD fields fill (a real 0% shows an effective date).
    await sleep(page, 3000);
    step('before ncd', JSON.stringify(await p2.evaluate(() => ['POLEFF_DATE', 'POLEXP_DATE', 'NCDEFFDATE', 'NCDPCT', 'NCDFROM'].map((n) => `${n}=${document.getElementsByName(n)[0]?.value}`)).catch(() => [])));
    for (let tries = 0; tries < 4; tries++) {
      // A second enquiry for the same car can come back empty: clear the NCD section first.
      if (tries >= 2) {
        const clear = p2.locator("input[value='Clear NCD'], button:has-text('Clear NCD'), a:has-text('Clear NCD')").first();
        await clear.click({ timeout: 5000 }).catch(() => clear.evaluate((e) => e.click()).catch(() => {}));
        await sleep(page, 4000);
      }
      await ncdBtn.click({ timeout: 8000 }).catch(() => ncdBtn.evaluate((e) => e.click()).catch(() => {}));
      let got = false;
      for (let i = 0; i < 12 && !got; i++) {
        await sleep(page, 1000);
        got = (await p2.locator("select[name='NCDPCT']").inputValue().catch(() => '0')) !== '0' || !!(await p2.locator("input[name='NCDFROM']").inputValue().catch(() => ''));
      }
      if (got) break;
    }
    // Starting before the current policy ends keeps last year's NCD: start again the day after it ends.
    const prevExp = await p2.locator("input[name='POLEXP_DATE']").inputValue().catch(() => '');
    const pm = /(\d{2})-(\d{2})-(\d{4})/.exec(prevExp);
    if (pm && !req.__genStart && !cover.startDate) {
      const next = new Date(Date.UTC(+pm[3], +pm[2] - 1, +pm[1] + 1, 12));
      const days = (next - start) / 864e5;
      if (days >= 1 && days <= 90) {
        step('restart at', dmy(next), 'policy ends', prevExp);
        const again = await this.quote(page, { ...req, __genStart: next }, ctx);
        again.notes = [`Cover starts ${dmy(next)}, the day after the current policy ends`, ...(again.notes || [])];
        return again;
      }
    }
    step('extra codes', JSON.stringify(await p2.evaluate(() => [...(document.getElementsByName('EXTRACODE')[0]?.options || [])].map((o) => `${o.value}:${o.text.trim()}`)).catch(() => [])).slice(0, 3000));
    step('ncd', await p2.locator("select[name='NCDPCT']").inputValue().catch(() => '?'), JSON.stringify(page.__genDialogs), 'btn visible', await ncdBtn.isVisible().catch(() => 'x'), 'p2 url', p2.url().slice(-40));
    const want = Object.entries(EXTRA).filter(([k]) => (k === 'ehailing' ? cover.addons?.ehailing && cover.ehailingPeriod !== 'daily' : cover.addons?.[k]));
    for (const [k, code] of want) {
      await p2.selectOption("select[name='EXTRACODE']", code).catch(() => {});
      await sleep(page, 1500);
      if (k === 'windscreen') await p2.locator("input[name='EXTRASUM']").fill(String(Math.round(cover.windscreenSI || Number(process.env.DEFAULT_WINDSCREEN_SI) || 1000))).catch(() => {});
      await p2.locator('#ADD_EXTRA, button[name=ADD_EXTRA]').first().click().catch(() => {});
      await sleep(page, 2500);
    }
    // All Drivers on Generali is the "Multi Drive Bravo" package (it has no waiver add-on).
    if (cover.addons?.allDrivers || cover.addons?.waiverExcess) {
      const radios = await p2.evaluate(() => [...document.querySelectorAll('input[type=radio]')].map((e) => `${e.name}=${e.value}${e.checked ? '*' : ''}${e.disabled ? '(off)' : ''}`)).catch(() => []);
      step('packages', JSON.stringify(radios));
      const bravo = p2.locator("input[type=radio][value='MULTI_DRIVE_BRAVO']").first();
      if (await bravo.count()) {
        await bravo.click({ timeout: 5000 }).catch(() => bravo.evaluate((e) => { e.checked = true; e.dispatchEvent(new Event('click', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }));
        await sleep(page, 2500);
        notes.push('All Drivers: Generali Multi Drive Bravo package');
      } else notes.push('Generali: Multi Drive Bravo (all drivers) not offered for this car; named drivers only');
    }
    if (cover.addons?.windscreen && !cover.windscreenSI) notes.push(`Windscreen sum insured RM${Number(process.env.DEFAULT_WINDSCREEN_SI || 1000).toLocaleString()} (default)`);
    step('calculate');
    const calc = p2.locator("input[name='calpremrecal_trigger']");
    await calc.click({ timeout: 8000 }).catch(() => calc.evaluate((e) => e.click()));
    for (let i = 0; i < 20; i++) { await sleep(page, 1000); if (money(await p2.locator("[name='TOTPREM_Disp']").first().inputValue().catch(() => '0')) > 0) break; }
    step('total', await p2.locator("[name='TOTPREM_Disp']").first().inputValue().catch(() => '?'), page.__genDialogs.slice(-2));

    const v = await p2.evaluate(() => {
      const val = (n) => document.getElementsByName(n)[0]?.value || '';
      const ncdSel = document.getElementsByName('NCDPCT')[0];
      // Extras table: [tick] code | description | sum insured | premium
      const extras = [...document.querySelectorAll('tr')].map((r) => [...r.children].map((c) => (c.innerText || c.querySelector('input')?.value || '').trim()))
        .filter((c) => c.length >= 5 && /^[A-Z0-9]{3,5}$/.test(c[1]) && /\d\.\d{2}$/.test(c[4]))
        .map((c) => ({ code: c[1], label: c[2], amount: c[4] }));
      return { si: val('SUMINS'), ncd: ncdSel?.value, basic: val('BASICPREM_WITH_FRAN'), ncdAmt: val('NCDAMT'), extra: val('TOTEXTRA_Disp'), gross: val('GPREM_Disp'), sst: val('STAXAMT_Disp'), stamp: val('STAMP'), total: val('TOTPREM_Disp'), extras };
    });
    const r = { sumInsured: money(v.si), ncdPercent: Number(v.ncd) || 0, basic: money(v.basic), ncdAmount: money(v.ncdAmt), addonTotal: money(v.extra), gross: money(v.gross), sst: money(v.sst), stampDuty: money(v.stamp), total: money(v.total) };
    if (!(r.total > 0)) return { status: 'declined', reasons: [`Generali did not calculate a premium${page.__genDialogs.length ? `: ${page.__genDialogs.join(' | ')}` : ''}`] };
    const checks = [];
    if (Math.abs(r.basic - r.ncdAmount + r.addonTotal - r.gross) > 0.06) checks.push(`Basic − NCD + extras (${(r.basic - r.ncdAmount + r.addonTotal).toFixed(2)}) is not gross (${r.gross.toFixed(2)})`);
    if (Math.abs(r.gross + r.sst + r.stampDuty - r.total) > 0.06) checks.push(`Gross + tax + stamp is not the total (${r.total.toFixed(2)})`);
    const keyOf = (code) => Object.entries(EXTRA).find(([, c]) => c === code)?.[0] || 'extra';
    const addons = v.extras.map((e) => ({ key: keyOf(e.code), label: e.label.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()), amount: money(e.amount) }));
    // The Multi Drive Bravo charge is in the extras total but not in the extras table.
    const bravoAmt = Math.round((r.addonTotal - addons.reduce((a, x) => a + x.amount, 0)) * 100) / 100;
    if (bravoAmt > 0.005) addons.unshift({ key: 'allDrivers', label: 'Multi Drive Bravo (All Drivers)', amount: bravoAmt });
    return {
      status: 'quoted',
      source: 'Generali premium screen',
      coverType,
      ...r,
      addons,
      vehicle: { regNo: plate, year, makeModel: modelName },
      excess: 0,
      checks,
      notes: [...notes, ...checks.map((c) => `Check: ${c}`), 'Figures from Generali Quick Quotation (no slip saved yet)'],
    };
  },
};
