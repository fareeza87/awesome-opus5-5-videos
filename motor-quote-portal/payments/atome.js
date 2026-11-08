// Atome payment links, made by a bot on the Atome Merchant Center
// (portal.atome.my). Ported from the agency's script, with fixes:
// the amount is never replaced by a default, the right outlet must be found,
// and the link must come from this order (no "success" without a real link).
// Settings: ATOME_PORTAL_USER, ATOME_PORTAL_PASS, ATOME_OUTLET (default "MetaFin"),
// ATOME_LINK_DAYS (link expiry, default 7 days at 23:59:59).
import { runBot } from '../providers/rpa/pool.js';
import { getPasswords } from '../providers/rpa/vault.js';

const PROVIDER = {
  id: 'atome', name: 'Atome',
  rpa: { defaultUrl: process.env.ATOME_PORTAL_URL || 'https://portal.atome.my' },
};
const LINK = /https:\/\/(?:gateway|pay)\.atome\.my\/[^\s"'<>]+/;

export const atomeConfigured = () => !!(process.env.ATOME_PORTAL_USER && process.env.ATOME_PORTAL_PASS) || !!(getPasswords('atome')?.current && getPasswords('atome__user')?.current);

const bot = {
  async login(page, ctx) {
    await page.goto(`${ctx.url}/login`, { waitUntil: 'domcontentloaded' });
    if (!page.url().toLowerCase().includes('login')) return;
    await page.locator("input[name='username']").fill(ctx.user);
    await page.locator("input[name='password']").fill(ctx.pass);
    await page.locator("button:has-text('Log in')").click();
    await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 10000 }).catch(() => {});
    if (page.url().toLowerCase().includes('login')) {
      const body = await page.locator('body').innerText();
      throw new Error(/incorrect/i.test(body) ? 'Atome rejected the username or password' : 'Atome login did not finish');
    }
  },
  async isLoginPage(page) {
    return page.url().toLowerCase().includes('login') || (await page.locator("input[name='password']").count()) > 0;
  },
};

export async function atomePayLink({ plate, amount, orderId }) {
  if (!atomeConfigured()) throw new Error('Atome not set up: add ATOME_PORTAL_USER and ATOME_PORTAL_PASS to .env');
  const amt = Number(String(amount).replace(/[^\d.]/g, ''));
  if (!(amt > 0)) throw new Error('Amount must be more than RM0.00');
  const fixed = amt.toFixed(2);
  const outlet = process.env.ATOME_OUTLET || 'MetaFin';

  return runBot(PROVIDER, bot, async (page, ctx) => {
    await page.goto(`${ctx.url}/main/payments/payment-link`, { waitUntil: 'domcontentloaded' });
    if (await bot.isLoginPage(page)) throw new Error('Atome session expired');
    const create = page.locator("button:has-text('Create Payment Link')").first();
    await create.waitFor({ timeout: 15000 });
    await create.click();
    const modal = page.locator('.ant-modal').last();
    await modal.waitFor();

    // Outlet: must be ours, never just the first in the list.
    const sel = modal.locator('.ant-select-selector, #outletId').first();
    if (await sel.count()) {
      await sel.click();
      await page.waitForTimeout(600);
      const all = page.locator('.ant-select-item-option');
      let opt = page.locator('.ant-select-item-option', { hasText: outlet }).first();
      // An outlet account has just its own outlet: use it.
      if (!(await opt.count()) && (await all.count()) === 1) opt = all.first();
      if (!(await opt.count())) throw new Error(`Atome outlet "${outlet}" not found (set ATOME_OUTLET). Outlets: ${(await all.allInnerTexts()).join(', ')}`);
      await opt.click();
    }
    await modal.locator('#amount').fill(fixed);

    // Expiry: the box defaults to "now", which Atome refuses. Like the links
    // staff make: N days ahead (ATOME_LINK_DAYS, default 7) at 23:59:59, Malaysia time.
    const days = Number(process.env.ATOME_LINK_DAYS || 7);
    const day = new Date(Date.now() + 8 * 3600e3 + days * 864e5).toISOString().slice(0, 10);
    const exp = modal.locator('#expirationTime, .ant-picker input').first();
    if (await exp.count()) {
      await exp.click();
      const panel = page.locator('.ant-picker-dropdown:visible').last();
      await panel.waitFor({ timeout: 5000 });
      // Month may need moving forward when the date is next month.
      for (let i = 0; i < 2 && !(await panel.locator(`td[title="${day}"]`).count()); i++) await panel.locator('.ant-picker-header-next-btn').first().click();
      await panel.locator(`td[title="${day}"]`).first().click();
      const cols = panel.locator('.ant-picker-time-panel-column');
      for (const [c, v] of [[0, '23'], [1, '59'], [2, '59']]) {
        if (await cols.nth(c).count()) await cols.nth(c).locator('.ant-picker-time-panel-cell-inner', { hasText: new RegExp(`^${v}$`) }).first().click();
      }
      await panel.locator('.ant-picker-ok button').first().click();
      const set = await exp.inputValue();
      if (!set.startsWith(day)) throw new Error(`Atome expiry not set (shows ${set})`);
    }
    await modal.locator('#ecomOrderId').fill(orderId);
    await modal.locator("button:has-text('Create Link')").click();

    // The link shown for this order only.
    let link = null;
    for (let i = 0; i < 20 && !link; i++) {
      const texts = [await modal.innerText().catch(() => ''),
        ...(await modal.locator('input').evaluateAll((els) => els.map((e) => e.value)).catch(() => [])),
        ...(await modal.locator('a').evaluateAll((els) => els.map((e) => e.href)).catch(() => []))];
      link = texts.map((t) => LINK.exec(t)?.[0]).find(Boolean) || null;
      if (!link) await page.waitForTimeout(500);
    }
    if (!link) {
      const err = await modal.locator('.ant-form-item-explain-error, .ant-message-error').allInnerTexts().catch(() => []);
      throw new Error(`Atome did not show a payment link${err.length ? `: ${err.join('; ')}` : ''}`);
    }
    await page.keyboard.press('Escape').catch(() => {});
    return { provider: 'Atome', link, amount: Number(fixed), orderId };
  });
}
