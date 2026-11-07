// A fake insurer agent portal, used only to develop and test the RPA bots.
// It behaves like a typical Malaysian insurer portal: log in, enter IC +
// plate + postcode, run the vehicle/NCD enquiry, choose cover, calculate.
// Served at /mock-portal/<style>/* by server.js, in three styles:
//   basic   – user ID + password
//   otp     – also sends a 6-digit OTP after the password (like Zurich)
//   etiqa   – forces a password change at every login, then shows a
//             splash notice that blocks the page until closed (like Etiqa)
import { randomUUID } from 'node:crypto';
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS } from '../public/engine/providers-config.js';
import { demoLookup } from '../public/engine/lookup.js';
import { handlePoPortal } from './po.js';

const sessions = new Map();          // sid → { tenant, step: 'otp' | 'change' | 'ok' }
const USER = 'agent01';
const TENANTS = {
  basic: { password: 'demo123' },
  otp: { password: 'demo123', otp: true, lastOtp: null },
  etiqa: { password: 'Demo@12345678', forceChange: true, splash: true, history: [] },
};
export const mockTenants = TENANTS;  // tests read the last OTP from here
const profile = { ...PROVIDERS[1], id: 'mock', name: 'Mock Insurer', baseFactor: 0.97 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px sans-serif;max-width:640px;margin:30px auto}label{display:block;margin:6px 0}input,select{margin-left:6px}.out td{padding:2px 10px}</style></head><body><h1>Mock Insurer Agent Portal</h1>${body}</body></html>`;

function session(req, tenant) {
  const sid = /mp_sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  const s = sid && sessions.get(sid);
  return s && s.tenant === tenant ? { sid, ...s } : null;
}

function strongEnough(p) {
  return p.length >= 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
}

export async function handleMockPortal(req, res, url, readForm) {
  if (url.pathname === '/mock-portal/po' || url.pathname.startsWith('/mock-portal/po/')) return handlePoPortal(req, res, url, readForm);
  const [, tenantName = 'basic', ...rest] = url.pathname.replace('/mock-portal', '').split('/');
  const T = TENANTS[tenantName];
  if (!T) { res.writeHead(404); return res.end(); }
  const base = `/mock-portal/${tenantName}`;
  const p = '/' + rest.join('/');
  const html = (s, body) => { res.writeHead(s, { 'content-type': 'text/html' }); res.end(body); };
  const json = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const go = (to, cookie) => { res.writeHead(302, { location: base + to, ...(cookie ? { 'set-cookie': cookie } : {}) }); res.end(); };
  const sess = session(req, tenantName);
  const setStep = (step) => sessions.set(sess.sid, { tenant: tenantName, step });

  if (p === '/' || p === '/login') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      if (f.username === USER && f.password === T.password) {
        const sid = randomUUID();
        let step = 'ok';
        if (T.otp) {
          step = 'otp';
          T.lastOtp = String(100000 + Math.floor(Math.random() * 900000));
          console.log(`[mock-portal ${tenantName}] OTP sent to registered phone: ${T.lastOtp}`);
        } else if (T.forceChange) step = 'change';
        sessions.set(sid, { tenant: tenantName, step });
        return go(step === 'otp' ? '/otp' : step === 'change' ? '/change-password' : '/quote', `mp_sid=${sid}; Path=${base}; HttpOnly`);
      }
      return html(401, page('Login', '<p id="loginError">Invalid user ID or password</p><a href="login">Back</a>'));
    }
    return html(200, page('Login', `<form method="post" action="${base}/login">
      <label>User ID<input id="username" name="username"></label>
      <label>Password<input id="password" name="password" type="password"></label>
      <button type="submit" id="btnLogin">Log in</button></form>`));
  }

  if (p === '/otp' && sess?.step === 'otp') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      if (f.otp === T.lastOtp) { T.lastOtp = null; setStep('ok'); return go('/quote'); }
      return html(401, page('OTP', '<p id="otpError">Invalid OTP</p><a href="otp">Try again</a>'));
    }
    return html(200, page('Verify', `<p>We sent a 6-digit code to your registered mobile number.</p>
      <form method="post" action="${base}/otp"><label>OTP<input id="otp" name="otp" inputmode="numeric" maxlength="6"></label>
      <button type="submit" id="btnVerify">Verify</button></form>`));
  }

  if (p === '/change-password' && sess?.step === 'change') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      let err = null;
      if (f.oldPassword !== T.password) err = 'Current password is incorrect';
      else if (f.newPassword !== f.confirmPassword) err = 'Passwords do not match';
      else if (!strongEnough(f.newPassword)) err = 'Password must be at least 12 characters with upper, lower, digit and symbol';
      else if ([T.password, ...T.history].includes(f.newPassword)) err = 'Cannot reuse a recent password';
      if (err) return html(400, page('Change password', `<p id="pwError">${err}</p><a href="change-password">Back</a>`));
      T.history = [T.password, ...T.history].slice(0, 5);
      T.password = f.newPassword;
      setStep('ok');
      return go('/quote');
    }
    return html(200, page('Change password', `<p>Your password has expired. Please set a new password.</p>
      <form method="post" action="${base}/change-password">
      <label>Current password<input id="oldPassword" name="oldPassword" type="password"></label>
      <label>New password<input id="newPassword" name="newPassword" type="password"></label>
      <label>Confirm new password<input id="confirmPassword" name="confirmPassword" type="password"></label>
      <button type="submit" id="btnChangePassword">Change password</button></form>`));
  }

  if (sess?.step !== 'ok') {
    if (p.startsWith('/api/')) { res.writeHead(401); return res.end(); }
    return go('/login');
  }

  if (p === '/home') return html(200, page('Home', '<p id="home">Welcome back</p>'));

  if (p === '/quote') {
    const splash = T.splash ? `<div id="splash" style="position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center">
        <div style="background:#fff;padding:24px;max-width:420px"><h3>Important notice</h3><p>System maintenance on Sunday 2am–6am.</p>
        <button id="btnCloseSplash" onclick="document.getElementById('splash').remove()">Close</button></div></div>` : '';
    return html(200, page('New Motor Quotation', `${splash}
      <h2>New Motor Quotation</h2>
      <label>ID No.<input id="idNo"></label>
      <label>Vehicle Reg No.<input id="vehRegNo"></label>
      <label>Postcode<input id="postcode"></label>
      <button id="btnEnquire">Enquire (ISM)</button> <span id="enqStatus"></span>
      <fieldset id="vehBox" disabled>
        <p>Vehicle: <b id="vehDesc"></b> · <span id="vehCc"></span>cc · <span id="vehYear"></span></p>
        <p>NCD: <b id="ncd"></b>% · Recommended SI: RM <b id="recSI"></b> (allowed <span id="siMin"></span>–<span id="siMax"></span>)</p>
        <label>Cover<select id="coverType"><option value="comprehensive">Comprehensive</option><option value="tpft">TPFT</option><option value="tp">Third Party</option></select></label>
        <label>Sum Insured<input id="sumInsured" type="number"></label>
        <label><input type="checkbox" id="extWindscreen"> Windscreen (RM <input id="windscreenSI" type="number" value="0" style="width:80px">)</label>
        <label><input type="checkbox" id="extSpecialPerils"> Special perils</label>
        <label><input type="checkbox" id="extSrcc"> SRCC</label>
        <label><input type="checkbox" id="extLlop"> LLOP</label>
        <button id="btnCalculate" type="button">Calculate</button> <span id="calcStatus"></span>
      </fieldset>
      <table class="out" id="result" hidden>
        <tr><td>Basic</td><td id="basicPremium"></td></tr><tr><td>NCD</td><td id="ncdAmount"></td></tr>
        <tr><td>Extensions</td><td id="extTotal"></td></tr><tr><td>Gross</td><td id="grossPremium"></td></tr>
        <tr><td>SST</td><td id="sst"></td></tr><tr><td>Stamp duty</td><td id="stampDuty"></td></tr>
        <tr><td><b>Total payable</b></td><td id="totalPayable"></td></tr><tr><td>Quotation no.</td><td id="quoteNo"></td></tr>
      </table>
      <script>
        const $ = (id) => document.getElementById(id);
        let enq;
        $('btnEnquire').onclick = async () => {
          $('enqStatus').textContent = 'Checking ISM…';
          const r = await fetch('api/enquire', { method: 'POST', body: JSON.stringify({ idNo: $('idNo').value, vehRegNo: $('vehRegNo').value, postcode: $('postcode').value }) });
          enq = await r.json();
          if (enq.error) { $('enqStatus').textContent = enq.error; return; }
          $('enqStatus').textContent = 'OK';
          $('vehDesc').textContent = enq.make + ' ' + enq.model; $('vehCc').textContent = enq.cc; $('vehYear').textContent = enq.year;
          $('ncd').textContent = enq.ncd; $('recSI').textContent = enq.sumInsured; $('siMin').textContent = enq.siMin; $('siMax').textContent = enq.siMax;
          $('sumInsured').value = enq.sumInsured; $('vehBox').disabled = false;
        };
        $('btnCalculate').onclick = async () => {
          $('calcStatus').textContent = 'Calculating…';
          const body = { enq, coverType: $('coverType').value, sumInsured: +$('sumInsured').value, windscreenSI: +$('windscreenSI').value,
            ext: { windscreen: $('extWindscreen').checked, specialPerils: $('extSpecialPerils').checked, srcc: $('extSrcc').checked, llop: $('extLlop').checked } };
          const q = await (await fetch('api/calc', { method: 'POST', body: JSON.stringify(body) })).json();
          if (q.error) { $('calcStatus').textContent = q.error; return; }
          $('calcStatus').textContent = '';
          for (const k of ['basicPremium','ncdAmount','extTotal','grossPremium','sst','stampDuty','totalPayable','quoteNo']) $(k).textContent = q[k];
          $('result').hidden = false;
        };
      </script>`));
  }

  if (p === '/api/enquire') {
    const f = JSON.parse(await readBody(req));
    await wait(600 + Math.random() * 600);
    const v = demoLookup({ owner: { nric: f.idNo }, vehicle: { regNo: f.vehRegNo } });
    if (!v) return json({ error: 'No record found at ISM' });
    return json({ ...v, siMin: Math.round(v.sumInsured * 0.9), siMax: Math.round(v.sumInsured * 1.1), postcode: f.postcode });
  }

  if (p === '/api/calc') {
    const f = JSON.parse(await readBody(req));
    await wait(800 + Math.random() * 800);
    if (f.coverType !== 'tp' && (f.sumInsured < f.enq.siMin || f.sumInsured > f.enq.siMax)) {
      return json({ error: `Sum insured must be between ${f.enq.siMin} and ${f.enq.siMax}` });
    }
    const q = rateQuote({
      owner: { nric: '', postcode: f.enq.postcode },
      vehicle: { regNo: 'X', cc: f.enq.cc, year: f.enq.year, seats: 5 },
      cover: { coverType: f.coverType, sumInsured: f.sumInsured, ncd: f.enq.ncd, windscreenSI: f.windscreenSI, addons: f.ext, valueBasis: 'market' },
    }, profile);
    if (q.status !== 'quoted') return json({ error: q.reasons.join('; ') });
    const fmt = (n) => n.toFixed(2);
    return json({ basicPremium: fmt(q.basic), ncdAmount: fmt(q.ncdAmount), extTotal: fmt(q.addonTotal), grossPremium: fmt(q.gross),
      sst: fmt(q.sst), stampDuty: fmt(q.stampDuty), totalPayable: fmt(q.total), quoteNo: 'MQ' + Date.now().toString().slice(-8) });
  }

  res.writeHead(404); res.end();
}

async function readBody(req) {
  let d = '';
  for await (const c of req) d += c;
  return d;
}
