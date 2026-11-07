// Practice copy of the Takaful Ikhlas agent portal (Financial-Link, loginTAK.jsp),
// built from the field names in the agency's Takaful Ikhlas script.
// Served at /mock-portal/ikhlas/. Login agent01 / demo123.
// The portal validates its own form and answers "Get A Quote" with a quotation
// slip laid out like the real Ikhlas slip. Plates starting with "E" get NCD 001.
import { randomUUID } from 'node:crypto';
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS } from '../public/engine/providers-config.js';
import { demoLookup } from '../public/engine/lookup.js';

const B = '/mock-portal/ikhlas';
const sessions = new Map();
const fmt = (n) => Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const profile = { ...PROVIDERS[2], id: 'ikhlas-mock', baseFactor: 0.98, ehailing: false };
const opt = (v, t = v) => `<option value="${v}">${t}</option>`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:12px Arial;margin:10px}td{padding:2px 6px;white-space:nowrap}</style></head><body>${body}</body></html>`;

export async function handleIkhlasPortal(req, res, url, readForm) {
  const p = url.pathname.slice(B.length) || '/';
  const html = (b) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(b)); };
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const sid = /ik_sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  const s = sid && sessions.get(sid);

  if (p === '/' || p === '/loginTAK.jsp') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      if (f.field1 === 'agent01' && f.field2 === 'demo123') {
        const id = randomUUID(); sessions.set(id, {});
        res.writeHead(302, { 'set-cookie': `ik_sid=${id}; Path=${B}`, location: `${B}/home` }); return res.end();
      }
      return html('<p class="err">Invalid User ID or Password</p>');
    }
    return html(`<form method="post" action="${B}/loginTAK.jsp">User ID <input name="field1"> Password <input name="field2" type="password"> <input type="submit" name="Submit" value="Submit"></form>`);
  }
  if (!s) { res.writeHead(302, { location: `${B}/loginTAK.jsp` }); return res.end(); }

  if (p === '/home') {
    return html(`<table><tr><td valign="top"><a href="${B}/newbiz" target="content">New Business</a><br><a href="#">Enquiry</a></td>
      <td><iframe name="content" src="${B}/welcome" style="width:1000px;height:1100px;border:0"></iframe></td></tr></table>`);
  }
  if (p === '/welcome') return html('<p>Welcome to Takaful Ikhlas agency portal.</p>');

  if (p === '/ism') {
    const v = demoLookup({ owner: { nric: '' }, vehicle: { regNo: url.searchParams.get('plate') || '' } });
    if (!v) return html('No record');
    const rows = [[v.model, v.cc, v.sumInsured], [v.model + ' (H)', v.cc, Math.round(v.sumInsured * 1.06 / 100) * 100]];
    return html(`<table>${rows.map(([m, cc, mv]) => `<tr name="nvic_for_select" style="cursor:pointer" onclick="window.opener.setVariant('${v.make}','${m}',${cc},${mv});window.close()"><td>${v.make}</td><td>${m}</td><td>${cc}</td><td>RM ${fmt(mv)}</td></tr>`).join('')}</table>`);
  }
  if (p === '/blacklist') {
    const v = demoLookup({ owner: { nric: '' }, vehicle: { regNo: url.searchParams.get('plate') || '' } });
    return json(v ? { ok: true, chassis: 'PM2M' + Math.abs(v.cc * 7919).toString().slice(0, 9), engine: 'K3' + v.cc, makeyear: v.year, prepolexpdate: '28/12/2026' } : { ok: false });
  }
  if (p === '/ncd') {
    const plate = url.searchParams.get('plate') || '';
    if (/^E/i.test(plate)) return json({ msg: 'NCD 001: NCD unavailable as confirmation already taken earlier', ncd: '' });
    const v = demoLookup({ owner: { nric: '' }, vehicle: { regNo: plate } });
    return json({ msg: 'NCD 000: Successful', ncd: v ? v.ncd.toFixed(2) : '0.00' });
  }

  if (p === '/newbiz') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      const need = [];
      if (!f.name) need.push('Name');
      if (!(f.new_ic1 && f.new_ic2 && f.new_ic3) && !f.bizregno && !f.newbizregnoSeq) need.push('ID No');
      if (!/^\d{5}$/.test(f.postcode || '')) need.push('Postcode');
      if (!f.address1 || !f.town) need.push('Address');
      for (const k of ['claimyr', 'violation', 'occupation']) if (!f[k]) need.push(k);
      if (!f.newbizregnoSeq && (!f.drvexp || !f.race || !f.religion)) need.push('Driver particulars');
      if (f.blcheck !== 'Y') need.push('Black List Checking');
      if (f.ncdchk !== 'Y') need.push('NCD Enquiry');
      if (!f.nvic) need.push('Proposed Sum Covered (ISM)');
      if (need.length) return html(`<script>alert('Please complete: ${need.join(', ')}');history.back();</script>`);
      s.form = f;
      res.writeHead(302, { location: `${B}/extraben` }); return res.end();
    }
    return html(`<form name="theForm1" method="post" action="${B}/newbiz">
      <h3>New Business: Motor</h3>
      <table>
      <tr><td>Email</td><td><input name="email"> <input type="checkbox" name="chkEmail" checked> Send e-mail</td></tr>
      <tr><td>Title</td><td><select name="nametitle">${opt('', '-')}${opt('MR')}${opt('MS')}</select> Name <input name="name"></td></tr>
      <tr><td>New IC</td><td><input name="new_ic1" maxlength="6">-<input name="new_ic2" maxlength="2">-<input name="new_ic3" maxlength="4"> DOB <input name="dob"> <input type="radio" name="gender" value="M">M <input type="radio" name="gender" value="F">F</td></tr>
      <tr><td>Business Reg</td><td>Old <input name="bizregno"> New <input name="newbizregnoYYYY" id="newbizregnoYYYY" size="4"><select name="newbizregnoEntity" id="newbizregnoEntity">${['', '01', '02', '03', '04', '06'].map((x) => opt(x)).join('')}</select><input name="newbizregnoSeq" id="newbizregnoSeq" size="6">
        Category <select name="bizCategory">${opt('', '-')}${opt('C', 'Registered Company')}${opt('B', 'Business')}</select></td></tr>
      <tr><td>Nationality</td><td><select name="nationality">${opt('')}${opt('MYS', 'MALAYSIA')}${opt('SGP', 'SINGAPORE')}${opt('IDN', 'INDONESIA')}</select></td></tr>
      <tr><td>Race / Religion</td><td><select name="race">${opt('')}${['MALAY', 'CHINESE', 'INDIAN', 'OTHERS'].map((x) => opt(x)).join('')}</select>
        <select name="religion">${opt('')}${['ISLAM', 'BUDDHISM', 'CHRISTIANITY', 'HINDUISM', 'OTHERS'].map((x) => opt(x)).join('')}</select></td></tr>
      <tr><td>Driving experience</td><td><input name="drvexp" size="3"></td></tr>
      <tr><td>Postcode</td><td><input name="postcode" onchange="searchPostcode()"> Town <input name="town"> Address <input name="address1"> Phone <input name="tphoneno"></td></tr>
      <tr><td>Employment</td><td><select name="emp_status">${opt('')}${['EMPLOYED', 'SELF EMPLOYED', 'RETIRED', 'UNEMPLOYED', 'STUDENT'].map((x) => opt(x)).join('')}</select>
        Occupation <select name="occupation">${opt('')}${['CLERK', 'ENGINEER', 'MANAGER', 'TEACHER', 'DRIVER', 'NURSE'].map((x, i) => opt(`${100 + i}@NULL@${x}`, x)).join('')}${opt('106@NULL@OTHERS', 'OTHERS')}</select></td></tr>
      <tr><td>Claims past 3 yrs</td><td><select name="claimyr">${opt('', '-')}${['0', '1', '2', '3'].map((x) => opt(x)).join('')}</select>
        Traffic violation <select name="violation">${opt('', '-')}${opt('N', 'NONE')}${opt('Y', 'YES')}</select></td></tr>
      <tr><td>Vehicle</td><td><select name="vehicle">${opt('PC', 'PRIVATE CAR')}${opt('MC', 'MOTORCYCLE')}</select>
        <select name="condition">${opt('R', 'REGISTERED')}${opt('U', 'UNREGISTERED')}</select>
        <select name="vehiclefrom">${opt('')}${opt('L', 'LOCALLY ASSEMBLED')}${opt('I', 'IMPORTED')}</select></td></tr>
      <tr><td>Vehicle Reg No</td><td><input name="vehregno"> Reg Card No <input name="logbookno"> <input type="button" value="Black List Checking" onclick="blackList()">
        <input type="hidden" name="blcheck"></td></tr>
      <tr><td>Chassis / Engine</td><td><input name="chassisno" readonly> <input name="engineno" readonly> Year <input name="makeyear" readonly> Prev expiry <input name="prepolexpdate" readonly></td></tr>
      <tr><td>Period</td><td><input name="effdate"> to <input name="expdate"></td></tr>
      <tr><td>Make / Model</td><td><select name="make_ID"><option></option></select> <select name="ismmodelcode"><option></option></select> CC <input name="provCapacity" readonly>
        <input type="button" name="abibutton" value="Check for Proposed Sum Covered" onclick="window.open('${B}/ism?plate=' + encodeURIComponent(document.theForm1.vehregno.value), 'ism')">
        <input type="hidden" name="nvic"></td></tr>
      <tr><td>Cover</td><td><select name="cover_type">${opt('COMPREHENSIVE')}${opt('THIRD PARTY FIRE AND THEFT')}${opt('THIRD PARTY')}</select>
        Body <select name="bodyID">${opt('')}${opt('01|SALOON', 'SALOON')}${opt('10|HATCHBACK', 'HATCHBACK')}${opt('05|MPV', 'MPV')}</select>
        Fuel <select name="vehfueltype">${opt('')}${opt('PETROL')}${opt('DIESEL')}${opt('HYBRID')}${opt('ELECTRIC')}</select>
        Driver <select name="piamdrv">${opt('01', 'NAMED DRIVER')}${opt('03', 'ALL DRIVER')}</select></td></tr>
      <tr><td>Sum Covered</td><td><input name="sum_insured"> <span id="mvRange"></span></td></tr>
      <tr><td>NCD</td><td>Prev veh <input name="ism_pre_veh_no"> <input type="button" id="ncdEnquiry" value="NCD Enquiry" onclick="ncdEnq()"> <span id="ncdResponseMessage"></span> NCD <input name="ism_provNCD" readonly><input type="hidden" name="ncdchk"></td></tr>
      </table>
      <input type="button" name="nextButton" value="Add Extra Benefit" onclick="check_empty('EXTBEN')">
      </form>
      <script>
        const f = document.theForm1;
        function searchPostcode() { const t = { '47301': 'PETALING JAYA', '43000': 'KAJANG', '50480': 'KUALA LUMPUR', '81100': 'JOHOR BAHRU', '86800': 'MERSING' }[f.postcode.value]; if (t && !f.town.value) f.town.value = t; }
        async function blackList() {
          const r = await (await fetch('${B}/blacklist?plate=' + encodeURIComponent(f.vehregno.value))).json();
          if (!r.ok) { alert('Vehicle not found at JPJ'); return; }
          f.chassisno.value = r.chassis; f.engineno.value = r.engine; f.makeyear.value = r.makeyear; f.prepolexpdate.value = r.prepolexpdate; f.blcheck.value = 'Y';
        }
        window.setVariant = (make, model, cc, mv) => {
          f.make_ID.options[0].text = make; f.ismmodelcode.options[0].text = model; f.provCapacity.value = cc; f.nvic.value = 'NV' + cc;
          f.sum_insured.value = mv; document.getElementById('mvRange').textContent = '(RM' + Math.round(mv * 0.9) + ' - RM' + Math.round(mv * 1.1) + ')';
          f.dataset.mv = mv;
        };
        async function ncdEnq() {
          const r = await (await fetch('${B}/ncd?plate=' + encodeURIComponent(f.ism_pre_veh_no.value || f.vehregno.value))).json();
          document.getElementById('ncdResponseMessage').textContent = r.msg; f.ism_provNCD.value = r.ncd; if (r.ncd !== '') f.ncdchk.value = 'Y';
        }
        function check_empty() {
          const mv = +f.dataset.mv, si = +f.sum_insured.value;
          if (f.cover_type.value !== 'THIRD PARTY' && mv && (si < mv * 0.9 || si > mv * 1.1)) { alert('Sum Covered must be between RM' + Math.round(mv * 0.9) + ' and RM' + Math.round(mv * 1.1)); return; }
          f.submit();
        }
      </script>`);
  }

  if (p === '/extraben') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      s.ext = { windscreen: f.cew_wsc !== undefined, windscreenSI: Number(f.SIWSC1 || 0), specialPerils: f.cew_ep !== undefined };
      res.writeHead(302, { location: `${B}/agentquo` }); return res.end();
    }
    return html(`<form method="post" action="${B}/extraben"><h3>Additional Coverage</h3>
      <p><input type="checkbox" name="cew_wsc" value="WSC|WINDSCREEN"> Windscreen, sum covered <input name="SIWSC1" size="6"></p>
      <p><input type="checkbox" name="cew_ep" value="EP057|SPECIAL PERILS"> Special Perils (Flood)</p>
      <input type="submit" id="genQuotation" value="Get A Quote"></form>
      <script>document.querySelectorAll('[name^=cew]').forEach((c) => c.setAttribute('name', 'cew'));
        document.forms[0].addEventListener('submit', () => { const [w, e] = document.querySelectorAll('[name=cew]'); w.name = w.checked ? 'cew_wsc' : 'x1'; e.name = e.checked ? 'cew_ep' : 'x2'; });</script>`);
  }

  if (p === '/agentquo') {
    const f = s.form;
    const ic = [f.new_ic1, f.new_ic2, f.new_ic3].filter(Boolean).join('-');
    const year = Number(f.makeyear);
    const coverType = f.cover_type === 'THIRD PARTY FIRE AND THEFT' ? 'tpft' : f.cover_type === 'THIRD PARTY' ? 'tp' : 'comprehensive';
    const q = rateQuote({
      owner: { idType: 'nric', nric: ic, postcode: f.postcode },
      vehicle: { regNo: f.vehregno, cc: Number(f.provCapacity), year, seats: 5 },
      cover: { coverType, sumInsured: Number(f.sum_insured), ncd: Number(f.ism_provNCD), valueBasis: 'market', windscreenSI: s.ext.windscreenSI,
        addons: { windscreen: s.ext.windscreen, specialPerils: s.ext.specialPerils, allDrivers: f.piamdrv === '03' } },
    }, profile);
    const ext = q.addons.map((a) => `<tr><td>${a.key === 'windscreen' ? `WINDSCREEN ( RM ${fmt(s.ext.windscreenSI)} )` : a.key === 'specialPerils' ? `SPECIAL PERILS ( RM ${fmt(f.sum_insured)} )` : 'ALL DRIVERS'}</td><td>${fmt(a.amount)}</td></tr>`).join('');
    return html(`<p>TAKAFUL IKHLAS GENERAL BERHAD (practice portal)</p><p>MOTOR QUOTATION SLIP FOR NEW BUSINESS</p>
      <table><tr><td>Name</td><td>${f.name}</td></tr>
      <tr><td>Registration No Vehicle</td><td>${f.vehregno}</td><td>Sum Covered</td><td>${fmt(f.sum_insured)}</td></tr>
      <tr><td>Year of Manufacture</td><td>${year}</td><td>Coverage</td><td>${f.cover_type}</td></tr>
      <tr><td>Quotation No</td><td>TQ${Date.now().toString().slice(-9)}</td></tr></table>
      <p>Extra-Benefits :</p><table>${ext}</table>
      <p>CONTRIBUTION DETAIL</p><table>
      <tr><td>Basic Takaful Contribution</td><td>${fmt(q.basic)}</td></tr>
      <tr><td>-NCD(${fmt(f.ism_provNCD)}%)</td><td>${fmt(q.ncdAmount)}</td></tr>
      <tr><td>Gross Due</td><td>${fmt(q.gross)}</td></tr>
      <tr><td>+Service Tax (8.00 %)</td><td>${fmt(q.sst)}</td></tr>
      <tr><td>+Stamp Duty</td><td>${fmt(q.stampDuty)}</td></tr>
      <tr><td>Takaful Contribution Payable</td><td>${fmt(q.total)}</td></tr></table>`);
  }
  res.writeHead(404); res.end();
}
