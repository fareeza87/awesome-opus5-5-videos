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
  try { await locator.click({ timeout: 4000 }); } catch { await locator.evaluate((b) => b.click()); }
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
function dismissDialogs(page) {
  return ev(page, () => {
    const modals = [...document.querySelectorAll('.cdk-overlay-pane, nx-modal-container, [role="dialog"], .modal')];
    const btn = (m, ...labels) => [...m.querySelectorAll('button, a, [role="button"]')].find((b) => labels.includes((b.textContent || '').trim().toUpperCase()));
    for (const m of modals) {
      const t = (m.innerText || '').toLowerCase();
      if (t.includes('concurrent login') || t.includes('another machine') || t.includes('other session will be ended')) { btn(m, 'YES')?.click(); return 'concurrent'; }
      if (t.includes('existing quotation')) { btn(m, 'NO')?.click(); return 'existing'; }
      if (t.includes('enq001') || t.includes('confirmation already taken') || t.includes('confirmation already been taken')) return 'renewed';
      if (/lapsed|betterment|notice|warning|e-invoice|consent not updated/.test(t)) { const b = btn(m, 'NEXT', 'OK', 'CLOSE', 'CONTINUE', 'PROCEED'); if (b) { b.click(); return 'notice'; } }
    }
    return null;
  }).catch(() => null);
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
    for (let i = 0; i < 5; i++) { if ((await dismissDialogs(page)) === 'concurrent') { await sleep(page, 1000); break; } await sleep(page, 400); }
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
        await sleep(page, 800);
        moved = await onPage2();
      } else { if (i % 4 === 3) await answerDeclaration(); await sleep(page, 500); }
    }
    if (!moved) throw new Error(`Allianz page 1: NEXT stayed disabled (${(await bodyText(page)).slice(-120).trim()})`);

    step('page 2');
    // Page 2: customer.
    const mobPrefix = '60' + mobile.slice(0, 2);
    await pickDropdown(page, 'mobileNoCode', mobPrefix);
    await typeInto(page.locator('input[formcontrolname="mobileNo"]'), mobile.slice(2));
    await typeInto(page.locator('input[formcontrolname="email"]'), email);
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

    // Coverage and add-ons.
    const notes = [];
    let coverType = cover.coverType;
    if (coverType === 'comprehensive' && Number(vehicle.year) && Number(vehicle.year) < TPFT_BEFORE_YEAR) {
      coverType = 'tpft';
      notes.push(`Car made before ${TPFT_BEFORE_YEAR}: quoted Third Party, Fire & Theft`);
    }
    await clickText(page, coverType === 'tpft' ? 'THIRD PARTY FIRE' : 'COMPREHENSIVE', { exact: false });
    await sleep(page, 400);
    await tickNx(page, 'WAIVER OF COMPULSORY EXCESS', !!cover.addons?.waiverExcess);
    if (cover.addons?.windscreen) {
      await tickNx(page, 'WINDSCREEN', true);
      const ws = page.locator('input[formcontrolname*="windscreen" i], input[placeholder*="windscreen" i]').first();
      if (await ws.count()) await typeInto(ws, Math.round(cover.windscreenSI || 1000));
    }
    if (cover.addons?.specialPerils) await tickNx(page, 'SPECIAL PERILS', true);
    if (cover.addons?.ehailing) {
      await clickText(page, 'ADD MORE', { exact: false });
      await sleep(page, 600);
      await ev(page, () => {
        const row = [...document.querySelectorAll('tbody tr, .nx-table__row')].find((r) => (r.innerText || '').toUpperCase().includes('PRIVATE HIRE'));
        const cb = row && row.querySelector('nx-checkbox, input[type="checkbox"]');
        if (cb) cb.click();
      });
      await clickText(page, 'PROCEED');
      await sleep(page, 600);
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

    // Generate e-Quotation and download the official PDF.
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
    return {
      ...figures,
      status: 'quoted',
      coverType,
      notes: [...notes, ...slip.checks.map((c) => `Check slip: ${c}`), ...slip.notes, ...auditAddons(cover, slip)],
      slipFile: file,
      benefits: ['Official Allianz e-Quotation saved'],
    };
  },
};
