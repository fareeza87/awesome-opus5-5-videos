// RPA bot for the practice portal in /mock-portal.
// Copy this file for each real insurer and change the selectors and steps
// to match that insurer's agent portal. Every bot exports the same 4 steps.

const money = (s) => Number(String(s).replace(/[^\d.]/g, ''));

export default {
  // ctx: url, user, pass, askOtp(prompt), changePassword(apply)
  async login(page, ctx) {
    await page.goto(`${ctx.url}/login`);
    await page.fill('#username', ctx.user);
    await page.fill('#password', ctx.pass);
    await page.click('#btnLogin');
    await page.waitForLoadState();
    if (await page.locator('#loginError').count()) throw new Error('Portal rejected the password');

    // Handle whatever the portal asks for next, in any order.
    for (let step = 0; step < 5; step++) {
      if (await page.locator('#otp').count()) {
        const code = await ctx.askOtp('Enter the 6-digit OTP sent to the agency phone');
        await page.fill('#otp', code);
        await page.click('#btnVerify');
        await page.waitForLoadState();
        if (await page.locator('#otpError').count()) throw new Error('Portal rejected the OTP');
        continue;
      }
      if (await page.locator('#newPassword').count()) {
        await ctx.changePassword(async (oldPass, newPass) => {
          await page.fill('#oldPassword', oldPass);
          await page.fill('#newPassword', newPass);
          await page.fill('#confirmPassword', newPass);
          await page.click('#btnChangePassword');
          await page.waitForLoadState();
          const err = page.locator('#pwError');
          if (await err.count()) throw new Error(`Password change refused: ${await err.textContent()}`);
        });
        continue;
      }
      break;
    }
    if (!/\/(quote|home)/.test(page.url())) throw new Error(`Login did not finish (stuck at ${page.url()})`);
  },

  // Close any notice that pops up over the page (Etiqa-style splash).
  async closeSplash(page) {
    const close = page.locator('#btnCloseSplash');
    if (await close.count()) await close.click();
  },

  // Light activity so the portal doesn't log us out (avoids repeat OTPs).
  async keepAlive(page, { url }) {
    await page.goto(`${url}/home`);
    if (await this.isLoginPage(page)) throw new Error('Session expired');
  },

  async isLoginPage(page) {
    return (await page.locator('#password').count()) > 0;
  },

  // IC + plate → vehicle, NCD and the portal's recommended sum insured.
  async lookup(page, req, { url }) {
    await page.goto(`${url}/quote`);
    await this.closeSplash(page);
    await page.fill('#idNo', req.owner.nric);
    await page.fill('#vehRegNo', req.vehicle.regNo);
    await page.fill('#postcode', req.owner.postcode);
    await page.click('#btnEnquire');
    await page.waitForFunction(() => !/Checking|^$/.test(document.querySelector('#enqStatus').textContent));
    const status = await page.textContent('#enqStatus');
    if (status !== 'OK') throw new Error(`Enquiry: ${status}`);
    const [make, ...model] = (await page.textContent('#vehDesc')).split(' ');
    return {
      make,
      model: model.join(' '),
      cc: money(await page.textContent('#vehCc')),
      year: money(await page.textContent('#vehYear')),
      ncd: money(await page.textContent('#ncd')),
      sumInsured: money(await page.textContent('#recSI')),
      siMin: money(await page.textContent('#siMin')),
      siMax: money(await page.textContent('#siMax')),
    };
  },

  async quote(page, req, creds) {
    const found = await this.lookup(page, req, creds);
    const { cover } = req;
    // Use the same sum insured for every insurer. If this insurer only accepts
    // a range, use the nearest allowed amount and say so.
    let si = cover.sumInsured;
    let siNote = null;
    if (cover.coverType !== 'tp' && (si < found.siMin || si > found.siMax)) {
      const asked = si;
      si = Math.min(Math.max(si, found.siMin), found.siMax);
      siNote = `Insurer accepts RM${found.siMin.toLocaleString()}–${found.siMax.toLocaleString()}; quoted at RM${si.toLocaleString()} instead of RM${asked.toLocaleString()}`;
    }
    await page.selectOption('#coverType', cover.coverType);
    await page.fill('#sumInsured', String(si));
    const tick = async (sel, on) => { if (on) await page.check(sel); else await page.uncheck(sel); };
    await tick('#extWindscreen', cover.addons?.windscreen);
    await page.fill('#windscreenSI', String(cover.windscreenSI || 0));
    await tick('#extSpecialPerils', cover.addons?.specialPerils);
    await tick('#extSrcc', cover.addons?.srcc);
    await tick('#extLlop', cover.addons?.llop);
    await page.click('#btnCalculate');
    await page.waitForFunction(() => !document.querySelector('#result').hidden || /must|not/i.test(document.querySelector('#calcStatus').textContent));
    const err = await page.textContent('#calcStatus');
    if (err) return { status: 'declined', reasons: [err] };

    const read = async (sel) => money(await page.textContent(sel));
    const gross = await read('#grossPremium');
    return {
      status: 'quoted',
      coverType: cover.coverType,
      sumInsured: si,
      siNote,
      ncdPercent: found.ncd,
      basic: await read('#basicPremium'),
      ncdAmount: await read('#ncdAmount'),
      addons: [],
      addonTotal: await read('#extTotal'),
      gross,
      sst: await read('#sst'),
      stampDuty: await read('#stampDuty'),
      total: await read('#totalPayable'),
      excess: 0,
      commission: Math.round(gross * 0.1 * 100) / 100,
      benefits: ['Live quote from insurer portal'],
      insurerRef: await page.textContent('#quoteNo'),
      validDays: 14,
    };
  },
};
