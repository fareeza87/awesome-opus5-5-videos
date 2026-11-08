// Allianz agent portal (sat.allianz.com.my, "Alpha SAT").
// Ported from the agency's working Selenium script: same pages, same
// nx-* components and formcontrolname fields, same pop-up handling.
//   login (+ concurrent-login YES, secret question) → Policy Management →
//   Cover Note → vehicle & ID (wait for JPJ/ISM) → customer (mobile, email,
//   address, postcode) → coverage & add-ons → GET NO CLAIM DISCOUNT →
//   summary → GENERATE E-QUOTATION → e-Quotation PDF (read by the slip reader).
// Login details come from ALLIANZ_PORTAL_URL / _USER / _PASS / _SECRET, never from code.
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSlipPdf } from '../../../slips/parse.js';
import { auditAddons } from '../../../slips/audit.js';

const SLIPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'slips');
const TPFT_BEFORE_YEAR = Number(process.env.TPFT_BEFORE_YEAR || 2012);
const sleep = (page, ms) => page.waitForTimeout(ms);
// Allianz's pages keep navigating while they load: if a read lands mid-way,
// wait a moment and read again.
// Allianz sometimes covers its buttons with an invisible layer: try a normal
// click briefly, then press the button directly.
// RPA_DEBUG=1 prints each step, for fixing a bot on a live portal.
const step = (...a) => { if (process.env.RPA_DEBUG === '1') console.log('[allianz]', new Date().toISOString().slice(11, 19), ...a); };

async function press(locator) {
  // If the page moved on after the click, the button is gone: that is fine.
  try { await locator.click({ timeout: 4000 }); } catch { await locator.evaluate((b) => b.click(), null, { timeout: 3000 }).catch(() => {}); }
}

async function ev(page, fn, arg) {
  for (let i = 0; ; i++) {
    try { return await page.evaluate(fn, arg); } catch (e) {
      if (i >= 8 || !/context was destroyed|navigation|Target closed/i.test(e.message)) throw e;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(700);
    }
  }
}
const bodyText = (page) => ev(page, () => document.body.innerText || '');

// Same pop-up handling as the original script.
function dismissDialogs(page, code = '') {
  return ev(page, (code) => {
    const modals = [...document.querySelectorAll('.cdk-overlay-pane, nx-modal-container, [role="dialog"], .modal')];
    const btn = (m, ...labels) => [...m.querySelectorAll('button, a, [role="button"]')].find((b) => labels.includes((b.textContent || '').trim().toUpperCase()));
    for (const m of modals) {
      const t = (m.innerText || '').toLowerCase();
      if (t.includes('concurrent login') || t.includes('another machine') || t.includes('other session will be ended')) {
        // Allianz may ask for a code here: type it in, then confirm.
        const box = m.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio])');
        if (box) {
          if (!code) return 'concurrent-code-needed';
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(box, code);
          ['input', 'change', 'blur'].forEach((e) => box.dispatchEvent(new Event(e, { bubbles: true })));
        }
        btn(m, 'YES', 'OK', 'SUBMIT', 'CONFIRM', 'PROCEED', 'CONTINUE')?.click();
        return 'concurrent';
      }
      if (t.includes('existing quotation')) { btn(m, 'NO')?.click(); return 'existing'; }
      // Agency email used when the customer gave none (agency rule): confirm it.
      if (t.includes("agent's email") || t.includes('agent\u2019s email')) { btn(m, 'YES')?.click(); return 'agent-email'; }
      if (t.includes('enq001') || t.includes('confirmation already taken') || t.includes('confirmation already been taken')) return 'renewed';
      if (/lapsed|betterment|notice|warning|e-invoice|consent not updated/.test(t)) { const b = btn(m, 'NEXT', 'OK', 'CLOSE', 'CONTINUE', 'PROCEED'); if (b) { b.click(); return 'notice'; } }
    }
    return null;
  }, code).catch(() => null);
}

// Coverage page: Make / Model is picked in a search pop-up. Use last year's
// model shown on the page ("Previous Year Selected Make / Model : PERODUA AXIA -
// 1000 SE (CVT)"), or the make/model from the form, and take the closest row.
async function pickMakeModel(page, vehicle) {
  const box = page.locator('input[formcontrolname="makeModel"]');
  await box.waitFor({ state: 'attached', timeout: 6000 }).catch(() => {});
  // The car's details (year, cc, last year's model) load a moment after the page.
  const yearBox = page.locator('input[formcontrolname="vehicleMakeYear"]');
  for (let i = 0; i < 40 && (await yearBox.count()); i++) {
    const year = await yearBox.inputValue().catch(() => 'x');
    if (year || /Previous Year Selected Make/i.test(await bodyText(page).catch(() => ''))) break;
    await sleep(page, 500);
  }
  if (!(await box.count())) return null;
  // Allianz may remember a model from an earlier draft: keep it only if it fits the car.
  const current = (await box.inputValue()).trim().toUpperCase();
  if (current) {
    const ccOk = !vehicle.cc || current.includes(`${vehicle.cc} CC`);
    const yearOk = !vehicle.year || current.includes(`MY${String(vehicle.year).slice(2)}`) || !/\bMY\d{2}\b/.test(current);
    if (ccOk && yearOk) return null;
  }
  const prev = /Previous Year Selected Make \/ Model\s*:\s*([^\n]+)/i.exec(await bodyText(page))?.[1]?.trim() || '';
  const [prevModel = '', prevVariant = ''] = prev.split(/\s+-\s+/);
  const wanted = (prevModel || `${vehicle.make || ''} ${vehicle.model || ''}`).trim().toUpperCase();
  if (!wanted) throw new Error('Allianz needs the make/model: fill it in on the form');
  const keyword = wanted.split(/\s+/).slice(1).join(' ') || wanted;
  const field = box.locator('xpath=ancestor::nx-formfield[1]');
  await press(field.locator('nx-icon, button').last());
  const search = page.locator('.cdk-overlay-pane input[formcontrolname="searchBy"]');
  await search.waitFor({ timeout: 10000 });
  await search.fill(keyword);
  await press(page.locator('.cdk-overlay-pane button', { hasText: /search/i }).first());
  const rows = page.locator('.cdk-overlay-pane tr.nx-table-row--selectable');
  await rows.first().waitFor({ timeout: 15000 });
  // The list shows 5 per page: show 50 so every variant is there.
  const perPage = page.locator('.cdk-overlay-pane nx-dropdown[formcontrolname="perPage"]').first();
  if (await perPage.count()) {
    await press(perPage);
    await press(page.locator('nx-dropdown-item', { hasText: /^\s*50\s*$/ }).first());
    await sleep(page, 1200);
  }
  const list = await rows.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim())));
  step('make/model rows', list.length, JSON.stringify(list.map((r) => `${r[1]} | ${r[4]}`)).slice(0, 1500));
  step('picker footer', (await page.locator('.cdk-overlay-pane').last().innerText().catch(() => '')).split('\n').slice(-6).join(' / '));
  const words = (t) => new Set(t.toUpperCase().replace(/[()]/g, ' ').split(/\s+/).filter((w) => w.length > 1));
  const want = words(prevVariant);
  const score = ([mm, variant, , , cc]) => (mm.toUpperCase() === wanted ? 10 : 0)
    + [...words(variant)].filter((w) => want.has(w)).length * 3
    + (vehicle.cc && Number(String(cc).replace(/,/g, '')) === Number(vehicle.cc) ? 2 : 0)
    + (vehicle.year && variant.includes(`MY${String(vehicle.year).slice(2)}`) ? 1 : 0);
  // With the engine size known, only rows of that size will do.
  const ccOf = (r) => Number(String(r[4] || '').replace(/,/g, ''));
  const fits = list.map((r, i) => i).filter((i) => !vehicle.cc || ccOf(list[i]) === Number(vehicle.cc));
  if (!fits.length) {
    await press(page.locator('.cdk-overlay-pane button', { hasText: /cancel/i }).first());
    throw new Error(`Allianz has no ${wanted} of ${vehicle.cc}cc in its list: check the make/model`);
  }
  let best = fits[0];
  fits.forEach((i) => { if (score(list[i]) > score(list[best])) best = i; });
  await press(rows.nth(best));
  await sleep(page, 800);
  const ok = page.locator('.cdk-overlay-pane button', { hasText: /^\s*(OK|SELECT|CONFIRM|PROCEED)\s*$/i }).first();
  if (await ok.count()) await press(ok);
  await sleep(page, 800);
  const [mm, variant, range] = list[best];
  const others = fits.filter((i) => i !== best && score(list[i]) === score(list[best])).map((i) => list[i][1].split(' ')[0]);
  return `Make/model picked on Allianz: ${mm} ${variant} (SI range RM${range})${others.length ? `. Also possible: ${others.join(', ')} variant; check the car's variant` : ''}`;
}

// Price as shown on the Summary page ("Premium Information"). This one has the
// car's real NCD; the e-Quotation PDF is printed at 0% NCD.
// Paid extras listed on the Summary page ("Extra Cover / Premium (RM)" table).
export function summaryAddons(text) {
  const i = text.search(/Extra Cover\s+Premium \(RM\)/i);
  if (i < 0) return [];
  const out = [];
  for (const line of text.slice(i).split('\n').slice(1, 30)) {
    const m = /^\s*(.+?)\s+([\d,]+\.\d{2})\s*$/.exec(line);
    if (!m) { if (out.length && line.trim()) break; continue; }
    const label = m[1].trim();
    const key = /PRIVATE HIRE|E-?HAILING/i.test(label) ? 'ehailing' : /WINDSCREEN/i.test(label) ? 'windscreen' : /SPECIAL PERIL|FLOOD/i.test(label) ? 'specialPerils' : /WAIVER/i.test(label) ? 'waiverExcess' : 'extra';
    out.push({ key, label: label.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()), amount: Number(m[2].replace(/,/g, '')) });
  }
  return out;
}

export function summaryPremium(text) {
  const i = text.search(/Premium Summary/i);
  if (i < 0) return null;
  const t = text.slice(i, i + 1500);
  const num = (re) => { const m = re.exec(t); return m ? Number(m[1].replace(/,/g, '')) : null; };
  const r = {
    sumInsured: num(/Vehicle Sum Insured\s*:?\s*([\d,]+\.\d{2})/i),
    basic: num(/Basic Premium\s*:?\s*([\d,]+\.\d{2})/i),
    ncdPercent: num(/No Claim Discount\s*\(([\d.]+)%\)/i),
    ncdAmount: num(/No Claim Discount\s*\([\d.]+%\)\s*:?\s*([\d,]+\.\d{2})/i),
    addonTotal: num(/Total Extra Cover Premium\s*:?\s*([\d,]+\.\d{2})/i) || 0,
    gross: num(/Gross Premium\s*:?\s*([\d,]+\.\d{2})/i),
    sst: num(/Service Tax(?:\s*\([^)]*\))?\s*:?\s*([\d,]+\.\d{2})/i),
    stampDuty: num(/Stamp Duty\s*:?\s*([\d,]+\.\d{2})/i),
    total: num(/Total Amount\s*:?\s*([\d,]+\.\d{2})/i),
  };
  if ([r.basic, r.gross, r.sst, r.stampDuty, r.total].some((v) => v === null)) return null;
  // Same checks as for slips: basic - NCD + add-ons = gross; gross + tax + stamp = total.
  const ok = Math.abs(r.basic - (r.ncdAmount || 0) + r.addonTotal - r.gross) < 0.06 && Math.abs(r.gross + r.sst + r.stampDuty - r.total) < 0.06;
  return ok ? r : null;
}

async function typeInto(locator, text) {
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(String(text), { delay: 30 });
  await locator.evaluate((el) => ['input', 'change', 'blur'].forEach((e) => el.dispatchEvent(new Event(e, { bubbles: true }))));
  await locator.press('Tab').catch(() => {}); // as the original script: leave the field so the page validates it now
}

// Click an nx-dropdown, then the overlay item that matches.
async function pickDropdown(page, control, match, filterText) {
  await page.locator(`nx-dropdown[formcontrolname="${control}"]`).click();
  await sleep(page, 400);
  if (filterText) {
    const f = page.locator('.cdk-overlay-pane .nx-dropdown__filter-input, .cdk-overlay-pane input').first();
    if (await f.count()) { await f.fill(filterText); await sleep(page, 400); }
  }
  const item = page.locator('.cdk-overlay-pane nx-dropdown-item', { hasText: match }).first();
  if (await item.count()) await item.click();
  else await ev(page, () => document.querySelectorAll('.cdk-overlay-backdrop').forEach((b) => b.click()));
  return page.locator(`nx-dropdown[formcontrolname="${control}"]`).innerText();
}

const clickText = (page, text, { exact = true } = {}) => ev(page, ([t, ex]) => {
  const hits = [...document.querySelectorAll('a, button, span, div, [role="button"]')]
    .filter((e) => e.offsetWidth > 0 && (ex ? (e.textContent || '').trim().toUpperCase() === t : (e.textContent || '').toUpperCase().includes(t)));
  // The innermost match is the real link or button, not a box around it.
  const el = hits.find((e) => !hits.some((o) => o !== e && e.contains(o)));
  if (el) { el.click(); return true; }
  return false;
}, [text.toUpperCase(), exact]);

const tickNx = (page, label, on = true) => ev(page, ([l, want]) => {
  const cb = [...document.querySelectorAll('nx-checkbox')].find((c) => (c.innerText || '').toUpperCase().includes(l));
  if (!cb) return false;
  const inp = cb.querySelector('input');
  if (!!(inp && inp.checked) !== want) cb.click();
  return true;
}, [label.toUpperCase(), on]);

export default {
  async login(page, ctx) {
    await page.goto(new URL('login', ctx.url.endsWith('/') ? ctx.url : ctx.url + '/').href);
    await typeInto(page.locator("input[type='text'], input:not([type])").first(), ctx.user);
    await typeInto(page.locator("input[type='password']").first(), ctx.pass);
    await clickText(page, 'LOG IN', { exact: false });
    await sleep(page, 1500);
    for (let i = 0; i < 5; i++) {
      const d = await dismissDialogs(page, ctx.concurrentCode);
      if (d === 'concurrent-code-needed') throw new Error('Allianz concurrent login asks for a code: enter it in Settings');
      if (d === 'concurrent') { await sleep(page, 1000); break; }
      await sleep(page, 400);
    }
    if (/invalid user id or password/i.test(await bodyText(page))) throw new Error('Allianz rejected the user ID or password');

    if (page.url().includes('secret-answer') || /secret question/i.test(await bodyText(page))) {
      if (!ctx.secret) throw new Error('Allianz asks the secret question: set ALLIANZ_PORTAL_SECRET');
      await typeInto(page.locator("input:not([type='hidden']):not([type='submit'])").first(), ctx.secret);
      await page.locator("button[type='submit'], button:has-text('SUBMIT')").first().click();
      await sleep(page, 1500);
      if (/wrong answer|incorrect/i.test(await bodyText(page))) throw new Error('Allianz rejected the secret answer');
    }
    for (let i = 0; i < 60; i++) {
      await dismissDialogs(page);
      // Wait for the menu itself: the home address appears before the page has loaded.
      if (/policy management/i.test(await bodyText(page).catch(() => ''))) { page.__azHome = page.url(); return; }
      await sleep(page, 500);
    }
    throw new Error('Allianz home page did not load after login');
  },

  async isLoginPage(page) {
    return (await page.locator("input[type='password']").count()) > 0;
  },

  async lookup() {
    throw new Error('Use another insurer for the IC + plate lookup');
  },

  async quote(page, req, ctx) {
    const { owner, vehicle, cover } = req;
    // Checks before touching the portal.
    const mobile = String(owner.phone || '').replace(/\D/g, '').replace(/^60/, '').replace(/^0/, '');
    const email = owner.email || process.env.ALLIANZ_FALLBACK_EMAIL || '';
    if (!owner.pdpaConsent) return { status: 'declined', reasons: ['Allianz: tick "Customer agreed to the privacy notice" on the form first'] };
    if (mobile.length < 8) return { status: 'declined', reasons: ["Allianz needs the customer's mobile number"] };
    if (!/@/.test(email)) return { status: 'declined', reasons: ["Allianz needs an email (customer's, or set ALLIANZ_FALLBACK_EMAIL to the agency's)"] };
    if (!owner.address) return { status: 'declined', reasons: ["Allianz needs the customer's address"] };

    const plate = vehicle.regNo.replace(/\s+/g, '').toUpperCase();
    const id = String(owner.nric || '').replace(/[^a-zA-Z0-9]/g, '');

    // Policy Management → Cover Note.
    // After login Allianz moves to another address (alpha.allianz.com.my): go back to that home page.
    if (!/policy management/i.test(await bodyText(page))) {
      await page.goto(page.__azHome || new URL('alpha-sat/home', ctx.url.endsWith('/') ? ctx.url : ctx.url + '/').href);
      for (let i = 0; i < 30 && !/policy management/i.test(await bodyText(page).catch(() => '')); i++) await sleep(page, 500);
    }
    await clickText(page, 'Policy Management');
    await sleep(page, 600);
    await clickText(page, 'Cover Note');
    await sleep(page, 1200);

    // Page 1: privacy declaration (customer agreed, per the form) and the three consent questions answered "No".
    // The declaration renders a moment after the page: wait for it, and answer
    // it again whenever NEXT is still disabled (it is safe to repeat).
    await page.locator('nx-checkbox').first().waitFor({ timeout: 15000 }).catch(() => {});
    const answerDeclaration = () => ev(page, () => {
      document.querySelectorAll('nx-checkbox').forEach((cb) => { const i = cb.querySelector('input'); if (!i || !i.checked) (cb.querySelector('.nx-checkbox__label, label') || cb).click(); });
      ['edocConsentInd', 'einvoiceConsentInd', 'emarketingConsentInd'].forEach((g) => {
        const group = document.querySelector(`nx-radio-group[formcontrolname="${g}"], nx-radio-group[ng-reflect-name="${g}"]`);
        const no = group && (group.querySelector('nx-radio[ng-reflect-value="false"]') || [...group.querySelectorAll('nx-radio')].find((r) => r.textContent.trim().toUpperCase() === 'NO'));
        if (no) (no.querySelector('.nx-radio__label, label') || no).click();
      });
    });
    await answerDeclaration();

    step('declaration answered');
    const vehInput = page.locator("input[type='text']:visible, input:not([type]):visible").first();
    await typeInto(vehInput, plate);
    step('plate typed');
    const idType = owner.idType === 'passport' ? 'PASSPORT' : owner.idType === 'company' ? (id.length === 12 ? 'NEW BUSINESS' : 'BUSINESS') : 'NRIC';
    if (await page.locator('nx-dropdown[formcontrolname="idType"]').count()) await pickDropdown(page, 'idType', idType);
    await typeInto(page.locator("input[type='text']:visible, input:not([type]):visible").nth(1), id);

    step('id typed');
    // Wait for JPJ/ISM, then NEXT, until the customer page shows.
    const onPage2 = async () => /CUSTOMER INFORMATION|MOBILE NO/i.test(await bodyText(page));
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) {
      if ((await dismissDialogs(page)) === 'renewed') return { status: 'declined', alreadyRenewed: true, reasons: ['Allianz ENQ001: NCD confirmation was already taken. The car may be already renewed elsewhere, or another quote for it took the confirmation. Check with the customer or try later'] };
      const issue = await ev(page, () => { const b = document.body.innerText || ''; if (b.includes('Effective date cannot be later than 90 days')) return 'Effective date is more than 90 days away'; if (/ENQ001|confirmation already taken/.test(b)) return 'renewed'; return null; });
      if (issue === 'renewed') return { status: 'declined', alreadyRenewed: true, reasons: ['Allianz ENQ001: NCD confirmation was already taken. The car may be already renewed elsewhere, or another quote for it took the confirmation. Check with the customer or try later'] };
      if (issue) return { status: 'declined', reasons: [`Allianz: ${issue}`] };
      const next = page.locator('button', { hasText: /^\s*NEXT\s*$/i }).first();
      step('page 1 loop', i, 'next enabled', await next.isEnabled().catch(() => 'n/a'));
      if (await next.isEnabled().catch(() => false)) {
        await press(next);
        // Wait for the page to change; a returning customer may skip straight to Coverage.
        for (let w = 0; w < 16 && /declaration/i.test(page.url()); w++) await sleep(page, 500);
        moved = !/declaration/i.test(page.url()) || await onPage2();
      } else { if (i % 4 === 3) await answerDeclaration(); await sleep(page, 500); }
    }
    if (!moved) throw new Error(`Allianz page 1: NEXT stayed disabled (${(await bodyText(page)).slice(-120).trim()})`);

    step('page 2', page.url());
    await sleep(page, 2500);
    if (process.env.RPA_STOP_AT === 'customer') throw new Error('stopped at customer page');
    // Page 2: customer.
    let customerText = await bodyText(page);
    const allianzName = /\bName\s*:?\s*\n?\s*:?\s*([A-Z][A-Z@'./ -]{2,60})\n/.exec(customerText)?.[1]?.trim();
    // Customer already on Allianz's records: details are shown, just press NEXT.
    if (/Customer Found/i.test(customerText) && !/Type of Coverage/i.test(customerText)) {
      step('customer found');
      await press(page.locator('button', { hasText: /^\s*NEXT\s*$/i }).first());
      for (let i = 0; i < 30 && !(await page.locator('input[formcontrolname="makeModel"]').count()); i++) { await dismissDialogs(page); await sleep(page, 500); }
      customerText = await bodyText(page);
    }
    const onCustomerPage = !/Type of Coverage/i.test(customerText) && /customer/i.test(page.url());
    if (onCustomerPage) {
    const mobPrefix = '60' + mobile.slice(0, 2);
    await pickDropdown(page, 'mobileNoCode', mobPrefix);
    await typeInto(page.locator('input[formcontrolname="mobileNo"]'), mobile.slice(2));
    await typeInto(page.locator('input[formcontrolname="email"]'), email);
    // The agent-email warning appears a moment after the email box is left.
    for (let i = 0; i < 10; i++) {
      await sleep(page, 500);
      const warns = page.locator('.cdk-overlay-pane', { hasText: /agent.s email/i });
      if (await warns.count()) {
        // The warning can be stacked more than once: confirm each copy.
        for (let k = 0; k < 6 && (await warns.count()); k++) {
          step('agent email warnings', await warns.count());
          await warns.last().locator('button', { hasText: /^\s*YES\s*$/i }).first().click({ timeout: 4000 }).catch((e) => step('yes click', e.message.split('\n')[0]));
          await sleep(page, 700);
        }
        step('agency email confirmed', !(await warns.count()));
        break;
      }
    }
    await typeInto(page.locator('input[formcontrolname="address1"]'), owner.address.slice(0, 40));
    const pc = await pickDropdown(page, 'postCode', owner.postcode, owner.postcode);
    if (!pc.includes(owner.postcode)) return { status: 'declined', reasons: [`Allianz: postcode ${owner.postcode} not in their list`] };
    await ev(page, () => {
      const r = [...document.querySelectorAll('nx-radio, input[type="radio"]')].find((x) => {
        const t = (x.innerText || x.textContent || '').toUpperCase();
        return (t.includes('RESIDENTIAL') && !t.includes('NON')) || ['R', 'RESIDENTIAL'].includes(x.getAttribute('ng-reflect-value') || x.getAttribute('value'));
      });
      if (r) (r.querySelector('.nx-radio__label, label, input') || r).click();
    });
    await press(page.locator('button', { hasText: /^\s*NEXT\s*$/i }).first());
    for (let i = 0; i < 20 && !page.url().toLowerCase().includes('coverage'); i++) { await dismissDialogs(page); await sleep(page, 400); }
    if (!page.url().toLowerCase().includes('coverage')) {
      const errs = await ev(page, () => [...document.querySelectorAll('nx-error, .nx-message--error')].map((e) => e.innerText.trim()).filter(Boolean).join(' | '));
      return { status: 'declined', reasons: [`Allianz customer page: ${errs || 'could not continue'}`] };
    }
    }
    step('coverage');
    const notes = [];
    const mmNote = await pickMakeModel(page, vehicle);
    if (mmNote) notes.push(mmNote);
    step('make/model', mmNote);

    // Coverage and add-ons.
    let coverType = cover.coverType;
    if (coverType === 'comprehensive' && Number(vehicle.year) && Number(vehicle.year) < TPFT_BEFORE_YEAR) {
      coverType = 'tpft';
      notes.push(`Car made before ${TPFT_BEFORE_YEAR}: quoted Third Party, Fire & Theft`);
    }
    // "Type of Coverage" is a folded section: open it, then press the cover button.
    const covHeader = page.locator('nx-expansion-panel-header', { hasText: /Type of Coverage/i }).first();
    if ((await covHeader.getAttribute('aria-expanded').catch(() => null)) === 'false') { await press(covHeader); await sleep(page, 800); }
    const covBtn = page.locator('nx-expansion-panel button', { hasText: coverType === 'tpft' ? /Third Party,? Fire/i : /^\s*Comprehensive\s*$/i }).first();
    if (await covBtn.count()) await press(covBtn);
    else await clickText(page, coverType === 'tpft' ? 'THIRD PARTY FIRE' : 'COMPREHENSIVE', { exact: false });
    step('cover type chosen');
    if (process.env.RPA_STOP_AT === 'coverage') throw new Error('stopped at coverage');
    await sleep(page, 400);
    await tickNx(page, 'WAIVER OF COMPULSORY EXCESS', !!cover.addons?.waiverExcess);
    if (cover.addons?.windscreen) {
      await tickNx(page, 'WINDSCREEN', true);
      const ws = page.locator('input[formcontrolname*="windscreen" i], input[placeholder*="windscreen" i]').first();
      if (await ws.count()) await typeInto(ws, Math.round(cover.windscreenSI || 1000));
    }
    if (cover.addons?.specialPerils) await tickNx(page, 'SPECIAL PERILS', true);
    if (cover.addons?.ehailing) {
      // Add More → "Extra Cover" pop-up (5 per page): show 50, tick
      // PRIVATE HIRE CAR ENDORSEMENT, Proceed. Practice page: plain table.
      const live = page.getByText(/^\s*ADD MORE\s*$/i).last();
      if (await live.count()) await press(live); else await clickText(page, 'ADD MORE', { exact: false });
      const pane = page.locator('.cdk-overlay-pane', { hasText: /Extra Cover/i }).first();
      await pane.waitFor({ timeout: live && (await live.count()) ? 8000 : 1500 }).catch(() => {});
      if (await pane.count()) await pane.locator('nx-checkbox').first().waitFor({ timeout: 10000 }).catch(() => {}); // list loads after the pop-up
      const phc = pane.locator('nx-checkbox', { hasText: /PRIVATE HIRE/i }).first();
      const perPage = pane.locator('nx-dropdown[formcontrolname="perPage"]').first();
      if (!(await phc.count()) && (await perPage.count())) {
        await press(perPage);
        await press(page.locator('nx-dropdown-item', { hasText: /^\s*50\s*$/ }).first());
        for (let i = 0; i < 10 && !(await phc.count()); i++) await sleep(page, 500);
      }
      // Still not shown: go through the pages (it is usually on page 2).
      for (let pg = 2; pg <= 6 && (await pane.count()) && !(await phc.count()); pg++) {
        const link = pane.getByText(String(pg), { exact: true }).last();
        if (!(await link.count())) break;
        await press(link);
        for (let i = 0; i < 6 && !(await phc.count()); i++) await sleep(page, 500);
      }
      let ticked = false;
      if (await phc.count()) {
        if (!(await phc.locator('input').isChecked().catch(() => false))) await press(phc.locator('label').first());
        ticked = await phc.locator('input').isChecked().catch(() => false);
      } else {
        ticked = await ev(page, () => {
          const row = [...document.querySelectorAll('tbody tr, .nx-table__row')].find((r) => (r.innerText || '').toUpperCase().includes('PRIVATE HIRE'));
          const cb = row && row.querySelector('nx-checkbox, input[type="checkbox"]');
          if (cb) cb.click();
          return !!cb;
        });
      }
      step('private hire ticked', ticked);
      const proceed = pane.locator('button', { hasText: /^\s*PROCEED\s*$/i }).first();
      if (await proceed.count()) await press(proceed); else await clickText(page, 'PROCEED');
      await sleep(page, 1200);
      await dismissDialogs(page);
      if (!ticked) notes.push('E-hailing: could not tick Private Hire Car on Allianz');
      // At least one e-hailing driver: the ones given, else the policy holder.
      // The table under "e-Hailing Drivers Name" (not the Named Drivers one above it).
      const drvTable = page.getByText(/e-?Hailing Drivers? Name/i).first().locator('xpath=following::table[1]');
      if (ticked && (await drvTable.count())) {
        // Agency rule: the customer's name if known (form, else Allianz's records), otherwise CUSTOMER; ID = owner's IC.
        const defaultName = process.env.DEFAULT_CUSTOMER_NAME || 'CUSTOMER';
        const holderName = (owner.name && owner.name !== defaultName ? owner.name : allianzName) || defaultName;
        const drivers = (cover.ehailingDrivers?.length ? cover.ehailingDrivers : [{ name: holderName, id }]).filter((d) => d.name && d.id);
        const rowsD = drvTable.locator('tr').filter({ has: page.locator('input:not([disabled])') });
        step('driver table', await rowsD.count(), (await drvTable.evaluate((t) => t.outerHTML.replace(/_ng[a-z]+-[^=]*=""/g, '').replace(/<!--[^>]*-->/g, '').replace(/\s+/g, ' ')).catch((e) => e.message)).slice(0, 1500));
        for (let k = 0; k < Math.min(drivers.length, await rowsD.count()); k++) {
          const ins = rowsD.nth(k).locator('input');
          await typeInto(ins.nth(0), String(drivers[k].name).toUpperCase());
          await typeInto(ins.nth(1), String(drivers[k].id).replace(/\D/g, ''));
        }
        if (drivers.length) notes.push(`E-hailing driver: ${cover.ehailingDrivers?.length ? drivers.map((d) => d.name).join(', ') : `policy holder (${String(drivers[0].name).toUpperCase()})`}`);
        else notes.push('E-hailing: no driver name for Allianz: enter the customer name');
        step('ehailing drivers', drivers.length);
      }
    }
    await clickText(page, 'CLAIM DISCOUNT', { exact: false });
    await sleep(page, 1500);
    await dismissDialogs(page);
    for (let i = 0; i < 15 && !page.url().toLowerCase().includes('summary'); i++) {
      await dismissDialogs(page);
      const next = page.locator('button', { hasText: /^\s*NEXT\s*$/i }).first();
      if (await next.isEnabled().catch(() => false)) await press(next);
      await sleep(page, 700);
    }
    if (!page.url().toLowerCase().includes('summary')) throw new Error('Allianz: could not reach the summary page');

    // Generate e-Quotation and download the official PDF. Never "Send to JPJ".
    step('summary');
    let onScreen = null;
    for (let i = 0; i < 20 && !(onScreen = summaryPremium(await bodyText(page))); i++) await sleep(page, 500); // price loads a moment later
    if (onScreen) {
      const items = summaryAddons(await bodyText(page));
      if (items.length && Math.abs(items.reduce((t, a) => t + a.amount, 0) - onScreen.addonTotal) < 0.06) onScreen.addons = items;
    }
    step('summary premium', JSON.stringify(onScreen));
    if (process.env.RPA_STOP_AT === 'summary') throw new Error('stopped at summary');
    await clickText(page, 'GENERATE E-QUOTATION', { exact: false });
    const pdfBtn = page.locator('a, button', { hasText: /e-?quotation pdf|download e-?quotation/i }).first();
    await pdfBtn.waitFor({ timeout: 15000 });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), pdfBtn.click()]);
    const tmp = await download.path();
    const pdf = await readFile(tmp);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Allianz e-Quotation download is not a PDF');

    const slip = await parseSlipPdf(pdf, { filename: 'allianz.pdf', expectInsurer: 'allianz' });
    if (slip.status === 'error') throw new Error(`Allianz e-Quotation: ${slip.reasons.join('; ')}`);
    await mkdir(SLIPS, { recursive: true });
    const file = `${plate}_ALLIANZ_${slip.insurerRef || Date.now()}.pdf`;
    await copyFile(tmp, path.join(SLIPS, file));

    const { providerId, provider, kind, ...figures } = slip; // keep the panel's own id and name
    // Use the Summary page price when it differs (it has the NCD; the PDF is at 0%).
    if (onScreen && (Math.abs(onScreen.total - slip.total) > 0.06 || onScreen.ncdPercent !== slip.ncdPercent)) {
      Object.assign(figures, onScreen, { ncdPercent: onScreen.ncdPercent ?? 0, ncdAmount: onScreen.ncdAmount ?? 0 });
      figures.source = 'summary page';
      notes.push(`Price from Allianz summary page (NCD ${onScreen.ncdPercent ?? 0}%). The e-Quotation PDF is printed at ${slip.ncdPercent}% NCD with a table for other NCD levels`);
    }
    return {
      ...figures,
      status: 'quoted',
      coverType,
      notes: [...notes, ...(figures.source === 'summary page' ? [] : slip.checks.map((c) => `Check slip: ${c}`)), ...slip.notes, ...auditAddons(cover, slip)],
      slipFile: file,
      benefits: ['Official Allianz e-Quotation saved'],
    };
  },
};
