// Practice copy of the Pacific & Orient agent portal (login2agent.pacific-orient.com),
// built from the field names in the agency's existing P&O script, so the P&O
// bot can be tested without touching the real portal. Served at /mock-portal/po/.
//
// Like the real portal: content sits inside a frame; after login a Message of
// the Day shows a "Main Menu" button; Motor Quotation → Add; screen 1 takes the
// plate (GET INFO) and company / e-hailing radios; screen 2 the insured, sum
// insured (with an allowed range) and extensions; screen 3 the summary with a
// "Print & Save Quotation" button that opens the slip in a pop-up window.
import { randomUUID } from 'node:crypto';
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS } from '../public/engine/providers-config.js';
import { demoLookup } from '../public/engine/lookup.js';

const USER = 'agent01';
const PASS = 'demo123';
const sessions = new Map();
const profile = { ...PROVIDERS[1], id: 'po-mock', baseFactor: 1.04, ehailing: false };
const STATES = ['JOHOR', 'KEDAH', 'KELANTAN', 'LABUAN', 'MELAKA', 'N.SEMBILAN', 'PAHANG', 'PENANG', 'PERAK', 'PERLIS', 'PUTRAJAYA', 'SABAH', 'SARAWAK', 'SELANGOR', 'TRENGGANU', 'W.PERSEKUTUAN'];
const fmt = (n) => Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const page = (body, title = 'P&O Agent') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:11px Arial;margin:16px}td{padding:3px 8px;white-space:nowrap}table{border-collapse:collapse}</style></head><body>${body}</body></html>`;

export async function handlePoPortal(req, res, url, readForm) {
  const base = '/mock-portal/po';
  const p = url.pathname.slice(base.length) || '/';
  const html = (body, status = 200) => { res.writeHead(status, { 'content-type': 'text/html' }); res.end(body); };
  const sid = /po_sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  const s = sid && sessions.get(sid);

  // Outer page holds the frame, as the real portal does.
  if (p === '/') return html(page(`<iframe name="main" src="${base}/login" style="width:100%;height:900px;border:0"></iframe>`, 'Pacific & Orient'));

  if (p === '/login') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      if (f.txtUserName === USER && f.txtPassword === PASS) {
        const id = randomUUID();
        sessions.set(id, {});
        res.writeHead(302, { 'set-cookie': `po_sid=${id}; Path=${base}`, location: `${base}/motd` });
        return res.end();
      }
      return html(page('<p>Invalid Agent ID or Password</p>'), 401);
    }
    return html(page(`<form method="post" action="${base}/login"><table>
      <tr><td>Agent ID</td><td><input name="txtUserName"></td></tr>
      <tr><td>Password</td><td><input name="txtPassword" type="password"></td></tr>
      <tr><td></td><td><input type="submit" name="login" value="Login"></td></tr></table></form>`));
  }

  if (!s) { res.writeHead(302, { location: `${base}/login` }); return res.end(); }

  if (p === '/motd') {
    return html(page(`<h3>Message of the Day</h3><p>Agent portal maintenance on Sunday 1am–5am.</p>
      <input type="button" value="Main Menu" onclick="location.href='${base}/menu'">`));
  }
  if (p === '/menu') {
    return html(page(`<table border="1"><tr><td>Motor Cover Note</td><td><a href="#">Add</a></td></tr>
      <tr><td>Motor Quotation</td><td><a href="${base}/NewMotorQuo">Add</a></td></tr>
      <tr><td>Motor Quotation Enquiry</td><td><a href="#">Search</a></td></tr></table>`));
  }

  // Screen 1: plate, GET INFO, company / e-hailing.
  if (p === '/NewMotorQuo') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      if (!s.vehicle) return html(page('<p>Please click GET INFO first.</p>'), 400);
      if (!f.opPCCoInd || !f.opEHailing) return html(page('<p>Please answer all questions.</p>'), 400);
      s.companyCar = f.opPCCoInd === 'Y';
      s.ehailing = f.opEHailing === 'Y';
      res.writeHead(302, { location: `${base}/screen2` });
      return res.end();
    }
    return html(page(`<form method="post" action="${base}/NewMotorQuo"><table>
      <tr><td>* Current Vehicle Number :</td><td><input name="txtCurrRegNo"> <input type="button" name="btnINFO" value="GET INFO" onclick="getInfo()"></td></tr>
      <tr><td colspan="2" id="vehInfo"></td></tr>
      <tr><td>Is this Private car a Company vehicle?</td><td><input type="radio" name="opPCCoInd" value="Y">Yes <input type="radio" name="opPCCoInd" value="N">No</td></tr>
      <tr><td>This car is used for E-hailing service?</td><td><input type="radio" name="opEHailing" value="Y">Yes <input type="radio" name="opEHailing" value="N">No</td></tr>
      <tr><td></td><td><input type="submit" name="btnSubmit" value="Submit"></td></tr></table></form>
      <script>
        async function getInfo() {
          const r = await fetch('${base}/info?plate=' + encodeURIComponent(document.querySelector('[name=txtCurrRegNo]').value));
          document.getElementById('vehInfo').innerHTML = await r.text();
        }
      </script>`));
  }
  if (p === '/info') {
    const plate = url.searchParams.get('plate') || '';
    const v = demoLookup({ owner: { nric: '' }, vehicle: { regNo: plate } });
    if (!v) return html('<b>No record found at JPJ/ISM</b>');
    s.plate = plate.toUpperCase();
    s.vehicle = { ...v, siMin: Math.round(v.sumInsured * 0.9 / 100) * 100, siMax: Math.round(v.sumInsured * 1.3 / 100) * 100 };
    return html(`${v.make} ${v.model} · ${v.cc}CC · ${v.year} · NCD ${v.ncd}%`);
  }

  // Screen 2: insured and risk details.
  if (p === '/screen2') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      const v = s.vehicle;
      const si = Number(f.txtSumin);
      if (f.cbxCovType !== '3' && si < v.siMin) return html(page(`<p>Minimum Sum Insured allowed is ${fmt(v.siMin)}</p><input type="button" value="Back" onclick="history.back()">`));
      if (f.cbxCovType !== '3' && si > v.siMax) return html(page(`<p>Maximum Sum Insured allowed is ${fmt(v.siMax)}</p><input type="button" value="Back" onclick="history.back()">`));
      if (!f.txtInsName || !(f.txtNewIC || f.txtPassport || f.txtBusRegNo) || !/^\d{5}$/.test(f.txtPostCode || '') || !f.txtMailAdd1 || !f.txtMailTown) {
        return html(page('<p>Please complete all mandatory fields (*).</p><input type="button" value="Back" onclick="history.back()">'), 400);
      }
      s.form = f;
      res.writeHead(302, { location: `${base}/screen3` });
      return res.end();
    }
    const v = s.vehicle;
    return html(page(`<form method="post" action="${base}/screen2"><table>
      <tr><td>* Insured :</td><td><input name="txtInsName"></td></tr>
      <tr><td>ID Type :</td><td><select name="cbxIDType"><option value="N">New IC</option><option value="P">Passport</option><option value="B">Business Reg</option></select></td></tr>
      <tr><td>* New IC No / Old IC No / Passport :</td><td><input name="txtNewIC"> <input name="txtPassport" placeholder="Passport"> <input type="hidden" name="HidtxtNewIC"></td></tr>
      <tr><td>Business Reg No :</td><td><input name="txtBusRegNo"> Old: <input name="txtOldBusRegNo"></td></tr>
      <tr><td>* Postcode :</td><td><input name="txtPostCode"></td></tr>
      <tr><td>Gender :</td><td><select name="cbxInsGender"><option></option><option>MALE</option><option>FEMALE</option></select></td></tr>
      <tr><td>Age :</td><td><input name="txtInsAge" readonly></td></tr>
      <tr><td>* Address :</td><td><input name="txtMailAdd1"></td></tr>
      <tr><td>* Town :</td><td><input name="txtMailTown"></td></tr>
      <tr><td>* State :</td><td><select name="txtMailState">${STATES.map((x) => `<option>${x}</option>`).join('')}</select></td></tr>
      <tr><td>Coverage :</td><td><select name="cbxCovType"><option value="1">Comprehensive</option><option value="2">Third Party Fire &amp; Theft</option><option value="3">Third Party</option></select></td></tr>
      <tr><td>* Sum Insured :</td><td><input name="txtSumin" value="${v.siMin}"> (RM${fmt(v.siMin)} - RM${fmt(v.siMax)})</td></tr>
      <tr><td>CC Value :</td><td>${v.cc}</td></tr>
      <tr><td>Extensions :</td><td>
        <input type="checkbox" name="M2"> Flood, Typhoon, Hurricane, Volcanic, Earthquake<br>
        <input type="checkbox" name="M4"> Windscreen Or Windows, sum insured <input name="N4" size="8"></td></tr>
      <tr><td></td><td><input type="submit" name="btnSubmit" value="Submit"></td></tr></table></form>
      <script>
        document.querySelector('[name=txtNewIC]').addEventListener('change', (e) => {
          const d = e.target.value.replace(/\\D/g, '');
          if (d.length === 12) { const yy = +d.slice(0, 2); document.querySelector('[name=txtInsAge]').value = new Date().getFullYear() - (yy > 30 ? 1900 + yy : 2000 + yy); }
          document.querySelector('[name=HidtxtNewIC]').value = e.target.value;
        });
      </script>`));
  }

  // Screen 3: summary.
  if (p === '/screen3') {
    const q = priced(s);
    if (s.plate.startsWith('R')) {
      return html(page(`<h3>REFER RISK</h3><p>Refer Case Details:</p><p>R012 Gap for 61 days in cover</p><p>R080 Department referral</p>`));
    }
    return html(page(`<h3>Motor Quotation Summary</h3><table border="1">
      <tr><td>Sum Insured</td><td>RM ${fmt(q.sumInsured)}</td></tr>
      <tr><td>Basic Premium</td><td>RM ${fmt(q.basic)}</td></tr>
      <tr><td>NCD %</td><td>${s.vehicle.ncd}</td></tr>
      <tr><td>Gross Premium</td><td>RM ${fmt(q.gross)}</td></tr>
      <tr><td>SST Amount</td><td>RM ${fmt(q.sst)}</td></tr>
      <tr><td>Total Payable</td><td>RM ${fmt(q.total)}</td></tr></table>
      <input type="button" value="Print &amp; Save Quotation" onclick="window.open('${base}/print', 'quo')">`));
  }

  // The slip, laid out like the real P&O print page.
  if (p === '/print') {
    const q = priced(s);
    const f = s.form;
    const ext = q.addons.map((a) => `<tr><td>${a.key === 'specialPerils' ? `FLOOD,TYPHOON, HURRICANE, VOL~</td><td></td></tr><tr><td></td><td>${fmt(q.sumInsured)}` : 'WINDSCREEN OR WINDOWS</td><td>' + fmt(f.N4 || 0)}</td><td>${fmt(a.amount)}</td></tr>`).join('');
    const valid = new Date(Date.now() + 14 * 864e5);
    return html(page(`<h3>PACIFIC &amp; ORIENT INSURANCE CO. BERHAD (12557-W)</h3>
      <p>MOTOR QUOTATION (PRACTICE PORTAL)</p>
      <table>
      <tr><td>${f.txtInsName}</td><td>Quotation No / No Sebut Harga</td><td>QUO${Date.now().toString().slice(-11)}</td></tr>
      <tr><td>Vehicle No</td><td>${s.plate}</td><td>Sum Insured / Jumlah Diinsuranskan</td><td>${fmt(q.sumInsured)}</td></tr>
      <tr><td>Year of Manufacture / Tahun Diperbuat</td><td>${s.vehicle.year}</td></tr>
      <tr><td>Motor Premium / Premium Motor</td></tr>
      <tr><td>Basic Premium / Premium Asas</td><td></td><td>${fmt(q.basic)}</td></tr>
      <tr><td>Loading / Premium Tambahan (%)</td><td></td><td>0.00</td></tr>
      <tr><td>NCD / DTT (${fmt(s.vehicle.ncd)}%)</td><td></td><td>${fmt(q.ncdAmount)}</td></tr>
      ${ext}
      <tr><td>Gross Premium / Premium Kasar</td><td></td><td>${fmt(q.gross)}</td></tr>
      <tr><td>Rebate / Rebat (%)</td></tr>
      <tr><td>Service Tax / Cukai Perkhidmatan</td><td></td><td>${fmt(q.sst)}</td></tr>
      <tr><td>Stamp Duty / Duti Setem</td><td></td><td>${fmt(q.stampDuty)}</td></tr>
      <tr><td>Total Premium / Jumlah Premium</td><td></td><td>${fmt(q.total)}</td></tr>
      <tr><td>Payable Premium (Rounded) / Premium Yang Perlu Dibayar (Digenapkan)</td><td></td><td>${fmt(Math.round(q.total * 20) / 20)}</td></tr>
      </table>
      <p>1. This quotation is valid for fourteen (14) calendar days from the date of issue. Valid until ${valid.toLocaleDateString('en-GB').replace(/\//g, '-')}.</p>`, 'MT.QUOTATION'));
  }

  res.writeHead(404); res.end();
}

function priced(s) {
  const f = s.form;
  const coverType = { 1: 'comprehensive', 2: 'tpft', 3: 'tp' }[f.cbxCovType] || 'comprehensive';
  const q = rateQuote({
    owner: { idType: 'nric', nric: f.txtNewIC || '', postcode: f.txtPostCode },
    vehicle: { regNo: s.plate, cc: s.vehicle.cc, year: s.vehicle.year, seats: 5 },
    cover: { coverType, sumInsured: Number(f.txtSumin), ncd: s.vehicle.ncd, valueBasis: 'market', windscreenSI: Number(f.N4 || 0),
      addons: { specialPerils: f.M2 === 'on', windscreen: f.M4 === 'on' } },
  }, profile);
  return { ...q, sumInsured: Number(f.txtSumin) };
}
