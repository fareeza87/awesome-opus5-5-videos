// A fake insurer agent portal, used only to develop and test the RPA bots.
// It behaves like a typical Malaysian insurer portal: log in, enter IC +
// plate + postcode, run the vehicle/NCD enquiry, choose cover, calculate.
// Served at /mock-portal/* by server.js.
import { randomUUID } from 'node:crypto';
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS } from '../public/engine/providers-config.js';
import { demoLookup } from '../public/engine/lookup.js';

const sessions = new Set();
const USER = 'agent01';
const PASS = 'demo123';
const profile = { ...PROVIDERS[1], id: 'mock', name: 'Mock Insurer', baseFactor: 0.97 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px sans-serif;max-width:640px;margin:30px auto}label{display:block;margin:6px 0}input,select{margin-left:6px}.out td{padding:2px 10px}</style></head><body><h1>Mock Insurer Agent Portal</h1>${body}</body></html>`;

function loggedIn(req) {
  const sid = /mp_sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  return sid && sessions.has(sid);
}

export async function handleMockPortal(req, res, url, readForm) {
  const p = url.pathname.replace('/mock-portal', '') || '/';
  const html = (s, body) => { res.writeHead(s, { 'content-type': 'text/html' }); res.end(body); };
  const json = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  if (p === '/' || p === '/login') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      if (f.username === USER && f.password === PASS) {
        const sid = randomUUID();
        sessions.add(sid);
        res.writeHead(302, { 'set-cookie': `mp_sid=${sid}; Path=/mock-portal; HttpOnly`, location: '/mock-portal/quote' });
        return res.end();
      }
      return html(401, page('Login', '<p id="loginError">Invalid user ID or password</p><a href="login">Back</a>'));
    }
    return html(200, page('Login', `<form method="post" action="/mock-portal/login">
      <label>User ID<input id="username" name="username"></label>
      <label>Password<input id="password" name="password" type="password"></label>
      <button type="submit" id="btnLogin">Log in</button></form>`));
  }

  if (!loggedIn(req)) {
    if (p.startsWith('/api/')) { res.writeHead(401); return res.end(); }
    res.writeHead(302, { location: '/mock-portal/login' });
    return res.end();
  }

  if (p === '/quote') {
    return html(200, page('New Motor Quotation', `
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
