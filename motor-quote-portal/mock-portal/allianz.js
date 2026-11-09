// Practice copy of the Allianz agent portal (sat.allianz.com.my), built from
// the selectors in the agency's Selenium script, for testing the Allianz bot.
// Served at /mock-portal/allianz/. Login agent01 / demo123, secret answer "blue".
// Pages share state through sessionStorage, like the real single-page app.
// Plates starting with "E" answer "ENQ001: NCD confirmation already taken".
import { rateQuote } from '../public/engine/rate.js';
import { PROVIDERS } from '../public/engine/providers-config.js';
import { demoLookup } from '../public/engine/lookup.js';
import { renderPdf } from '../providers/rpa/pool.js';

const B = '/mock-portal/allianz';
const fmt = (n) => Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const profile = { ...PROVIDERS[1], id: 'allianz-mock', baseFactor: 1.02, addonFixed: { allDrivers: 50 }, ehailing: { periods: ['annual'] } };

// Tiny stand-ins for the portal's nx-* components.
const KIT = `
<style>
  body{font:14px Arial;margin:20px} nx-dropdown,nx-checkbox,nx-radio{display:inline-block;border:1px solid #999;padding:4px 8px;margin:3px;cursor:pointer;min-width:60px}
  .cdk-overlay-pane{position:fixed;top:80px;left:80px;background:#fff;border:2px solid #333;padding:12px;z-index:10}
  .cdk-overlay-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.2);z-index:9}
  nx-dropdown-item{display:block;padding:4px;cursor:pointer} nx-error{color:red;display:block}
  .is-checked{background:#cde}
</style>
<script>
  const S = { get: (k) => JSON.parse(sessionStorage.getItem(k) || 'null'), set: (k, v) => sessionStorage.setItem(k, JSON.stringify(v)) };
  function overlay(html) {
    const bd = document.createElement('div'); bd.className = 'cdk-overlay-backdrop';
    const p = document.createElement('div'); p.className = 'cdk-overlay-pane'; p.innerHTML = html;
    bd.onclick = () => { bd.remove(); p.remove(); };
    document.body.append(bd, p); return p;
  }
  function closeOverlays() { document.querySelectorAll('.cdk-overlay-pane,.cdk-overlay-backdrop').forEach((e) => e.remove()); }
  // nx-dropdown: click opens an overlay of nx-dropdown-item; optional filter box.
  function dropdown(el, items, filter) {
    el.addEventListener('click', () => {
      const p = overlay((filter ? '<input class="nx-dropdown__filter-input">' : '') + '<div class="items"></div>');
      const draw = (q) => { p.querySelector('.items').innerHTML = items.filter((i) => !q || i.includes(q)).map((i) => '<nx-dropdown-item>' + i + '</nx-dropdown-item>').join(''); };
      draw('');
      const f = p.querySelector('input'); if (f) f.addEventListener('input', () => draw(f.value));
      p.addEventListener('click', (e) => { if (e.target.tagName === 'NX-DROPDOWN-ITEM') { el.querySelector('.nx-dropdown__container').textContent = e.target.textContent; el.dataset.value = e.target.textContent; closeOverlays(); el.dispatchEvent(new Event('picked')); } });
    });
  }
  function checkbox(el) {
    el.innerHTML = '<input type="checkbox" style="display:none"><span class="nx-checkbox__label">' + el.innerHTML + '</span>';
    el.addEventListener('click', () => { const i = el.querySelector('input'); i.checked = !i.checked; el.classList.toggle('is-checked', i.checked); el.dispatchEvent(new Event('toggled')); });
  }
  function radio(el) { el.addEventListener('click', () => { el.parentElement.querySelectorAll('nx-radio').forEach((r) => r.classList.remove('is-checked')); el.classList.add('is-checked'); el.parentElement.dataset.value = el.getAttribute('ng-reflect-value') || el.textContent.trim(); }); }
  function go(path) { location.href = '${B}' + path; }
</script>`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Allianz SAT (practice)</title>${KIT}</head><body>${body}</body></html>`;

export async function handleAllianzPortal(req, res, url) {
  const p = url.pathname.slice(B.length) || '/';
  const html = (body) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(body)); };

  if (p === '/' || p === '/login') {
    return html(`<h2>Allianz SAT</h2><p>User ID <input type="text"></p><p>Password <input type="password"></p><button>LOG IN</button>
      <script>
        document.querySelector('button').onclick = () => {
          const [u, pw] = document.querySelectorAll('input');
          if (u.value !== 'agent01' || pw.value !== 'demo123') { document.body.insertAdjacentHTML('beforeend', '<nx-error>Invalid user ID or password</nx-error>'); return; }
          if (!localStorage.getItem('seenConcurrent')) {
            localStorage.setItem('seenConcurrent', '1');
            const m = overlay('<div role="dialog">Concurrent login detected: you are logged in on another machine. The other session will be ended. Continue?<button>NO</button><button>YES</button></div>');
            m.querySelectorAll('button')[1].onclick = () => go('/secret-answer');
            return;
          }
          go('/secret-answer');
        };
      </script>`);
  }

  if (p === '/secret-answer') {
    return html(`<h3>Secret question</h3><p>What is your favourite colour?</p><input type="text"><button type="submit">SUBMIT</button>
      <script>document.querySelector('button').onclick = () => { if (document.querySelector('input').value === 'blue') { S.set('auth', true); go('/alpha-sat/home'); } else document.body.insertAdjacentHTML('beforeend', '<nx-error>Wrong answer</nx-error>'); };</script>`);
  }

  if (p === '/ism') return allianzIsm(url, res);
  if (!['/alpha-sat/home', '/cover-note', '/customer', '/coverage', '/summary'].includes(p)) {
    if (p === '/e-quotation.pdf') return sendPdf(res, url);
    res.writeHead(404); return res.end();
  }
  const guard = `<script>if (!S.get('auth')) go('/login');</script>`;

  if (p === '/alpha-sat/home') {
    return html(`${guard}<h2>Welcome</h2><span id="pm">Policy Management</span><div id="sub" style="display:none"><a href="#" id="cn">Cover Note</a></div>
      <script>pm.onclick = () => { sub.style.display = 'block'; }; cn.onclick = (e) => { e.preventDefault(); go('/cover-note'); };</script>`);
  }

  if (p === '/cover-note') {
    return html(`${guard}<h3>Cover Note: Vehicle</h3>
      <nx-checkbox id="decl">I confirm the customer has read the Privacy Notice</nx-checkbox><br>
      e-Document <nx-radio-group formcontrolname="edocConsentInd"><nx-radio ng-reflect-value="true">YES</nx-radio><nx-radio ng-reflect-value="false">NO</nx-radio></nx-radio-group><br>
      e-Invoice <nx-radio-group formcontrolname="einvoiceConsentInd"><nx-radio ng-reflect-value="true">YES</nx-radio><nx-radio ng-reflect-value="false">NO</nx-radio></nx-radio-group><br>
      e-Marketing <nx-radio-group formcontrolname="emarketingConsentInd"><nx-radio ng-reflect-value="true">YES</nx-radio><nx-radio ng-reflect-value="false">NO</nx-radio></nx-radio-group>
      <p>Vehicle No <input type="text" id="veh"></p>
      <p>ID Type <nx-dropdown formcontrolname="idType"><span class="nx-dropdown__container">NRIC</span></nx-dropdown> ID No <input type="text" id="idno"></p>
      <div id="ism"></div><button id="next" disabled>NEXT</button>
      <script>
        document.querySelectorAll('nx-checkbox').forEach(checkbox); document.querySelectorAll('nx-radio').forEach(radio);
        dropdown(document.querySelector('nx-dropdown'), ['NRIC', 'PASSPORT', 'NEW BUSINESS REGISTRATION NO.', 'BUSINESS REGISTRATION NO.']);
        let timer;
        const check = () => {
          clearTimeout(timer); next.disabled = true;
          if (veh.value.length < 3 || idno.value.length < 6) return;
          ism.textContent = 'Checking JPJ/ISM…';
          timer = setTimeout(async () => {
            if (/^E/i.test(veh.value)) { overlay('<div role="dialog">ENQ001: NCD confirmation already taken by another insurer.<button>OK</button></div>'); ism.textContent = ''; return; }
            const v = await (await fetch('${B}/ism?plate=' + encodeURIComponent(veh.value))).json();
            if (!v) { ism.textContent = 'Vehicle not found'; return; }
            S.set('veh', { ...v, plate: veh.value.toUpperCase(), idType: document.querySelector('nx-dropdown').dataset.value || 'NRIC', idNo: idno.value });
            ism.textContent = 'PRIVATE CARS · ' + v.make + ' ' + v.model + ' · ' + v.year;
            next.disabled = !(document.querySelector('#decl input').checked && ['edocConsentInd','einvoiceConsentInd','emarketingConsentInd'].every((g) => document.querySelector('[formcontrolname=' + g + ']').dataset.value));
          }, 1200);
        };
        veh.addEventListener('change', check); idno.addEventListener('change', check);
        document.addEventListener('click', () => { if (S.get('veh') && ism.textContent.startsWith('PRIVATE')) next.disabled = !(document.querySelector('#decl input').checked && ['edocConsentInd','einvoiceConsentInd','emarketingConsentInd'].every((g) => document.querySelector('[formcontrolname=' + g + ']').dataset.value)); });
        next.onclick = () => go('/customer');
      </script>`);
  }

  if (p === '/customer') {
    return html(`${guard}<h3>CUSTOMER INFORMATION</h3>
      <p>Mobile No <nx-dropdown formcontrolname="mobileNoCode"><span class="nx-dropdown__container">Code</span></nx-dropdown> <input formcontrolname="mobileNo"></p>
      <p>Email <input formcontrolname="email"></p>
      <p>Address <input formcontrolname="address1"></p>
      <p>Postcode <nx-dropdown formcontrolname="postCode"><span class="nx-dropdown__container">Postcode</span></nx-dropdown></p>
      <p>Address type <span><nx-radio ng-reflect-value="R">Residential</nx-radio><nx-radio ng-reflect-value="N">Non-Residential</nx-radio></span></p>
      <div id="err"></div><button id="next">NEXT</button>
      <script>
        dropdown(document.querySelector('[formcontrolname=mobileNoCode]'), ['6010','6011','6012','6013','6014','6016','6017','6018','6019']);
        dropdown(document.querySelector('[formcontrolname=postCode]'), ['43000 KAJANG','47301 PETALING JAYA','47300 PETALING JAYA','50450 KUALA LUMPUR','81100 JOHOR BAHRU','86800 MERSING'], true);
        document.querySelectorAll('nx-radio').forEach(radio);
        next.onclick = () => {
          const v = (s) => document.querySelector(s);
          const errs = [];
          if (!/^60\\d\\d$/.test(v('[formcontrolname=mobileNoCode]').dataset.value || '')) errs.push('Mobile code is required');
          if (!/^\\d{7,8}$/.test(v('[formcontrolname=mobileNo]').value)) errs.push('Mobile number is invalid');
          if (!/@/.test(v('[formcontrolname=email]').value)) errs.push('Email is invalid');
          if (!v('[formcontrolname=address1]').value) errs.push('Address is required');
          if (!v('[formcontrolname=postCode]').dataset.value) errs.push('Postcode is required');
          if (errs.length) { err.innerHTML = errs.map((e) => '<nx-error>' + e + '</nx-error>').join(''); return; }
          S.set('cust', { postcode: v('[formcontrolname=postCode]').dataset.value.slice(0, 5) });
          go('/coverage');
        };
      </script>`);
  }

  if (p === '/coverage') {
    return html(`${guard}<h3>Coverage</h3>
      <button class="cov">COMPREHENSIVE</button><button class="cov">THIRD PARTY FIRE AND THEFT</button>
      <p><nx-checkbox>Waiver of Compulsory Excess</nx-checkbox> <nx-checkbox>Windscreen</nx-checkbox> sum <input formcontrolname="windscreenSumInsured"> <nx-checkbox>Special Perils</nx-checkbox></p>
      <a href="#" id="more">ADD MORE</a>
      <p id="ncd"></p><button id="getncd">GET NO CLAIM DISCOUNT</button> <button id="next" disabled>NEXT</button>
      <script>
        document.querySelectorAll('nx-checkbox').forEach(checkbox);
        const c = { cover: 'comprehensive', ehailing: false };
        document.querySelectorAll('.cov').forEach((b) => b.onclick = () => { c.cover = b.textContent.includes('THIRD') ? 'tpft' : 'comprehensive'; });
        more.onclick = (e) => {
          e.preventDefault();
          const m = overlay('<table><tbody><tr><td><nx-checkbox></nx-checkbox></td><td>PRIVATE HIRE CAR ENDORSEMENT (E-HAILING)</td></tr><tr><td><nx-checkbox></nx-checkbox></td><td>ALL DRIVERS</td></tr></tbody></table><button>PROCEED</button>');
          m.querySelectorAll('nx-checkbox').forEach(checkbox);
          m.querySelector('button').onclick = () => { c.ehailing = m.querySelector('tr nx-checkbox input').checked; closeOverlays(); };
        };
        getncd.onclick = () => { ncd.textContent = 'No Claim Discount: ' + S.get('veh').ncd + '%'; next.disabled = false; };
        next.onclick = () => {
          const box = (t) => [...document.querySelectorAll('nx-checkbox')].find((x) => x.textContent.includes(t)).querySelector('input').checked;
          S.set('cov', { ...c, waiver: box('Waiver'), windscreen: box('Windscreen'), windscreenSI: +document.querySelector('[formcontrolname=windscreenSumInsured]').value || 0, specialPerils: box('Special Perils') });
          go('/summary');
        };
      </script>`);
  }

  // Summary → Generate e-Quotation → e-Quotation PDF download.
  return html(`${guard}<h3>Summary</h3><div id="sum"></div><button id="gen">GENERATE E-QUOTATION</button><div id="out"></div>
    <script>
      const q = new URLSearchParams({ ...S.get('veh'), ...S.get('cust'), ...S.get('cov') });
      sum.textContent = 'Vehicle Sum Insured RM ' + S.get('veh').sumInsured.toLocaleString();
      gen.onclick = () => {
        const no = 'QKJ' + String(Date.now()).slice(-11);
        q.set('quoteNo', no);
        out.innerHTML = '<p>Quotation No: ' + no + '</p><a id="dl" href="${B}/e-quotation.pdf?' + q + '" download>e-Quotation PDF</a>';
      };
    </script>`);
}

export function allianzIsm(url, res) {
  const v = demoLookup({ owner: { nric: '' }, vehicle: { regNo: url.searchParams.get('plate') || '' } });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(v));
}

// The e-Quotation, laid out like Allianz's real one (see the slip reader tests).
async function sendPdf(res, url) {
  const q = Object.fromEntries(url.searchParams);
  const r = rateQuote({
    owner: { idType: 'nric', nric: q.idNo || '', postcode: q.postcode },
    vehicle: { regNo: q.plate, cc: +q.cc, year: +q.year, seats: 5 },
    cover: { coverType: q.cover, sumInsured: +q.sumInsured, ncd: +q.ncd, valueBasis: 'agreed', windscreenSI: +q.windscreenSI, ehailingPeriod: 'annual',
      addons: { windscreen: q.windscreen === 'true', specialPerils: q.specialPerils === 'true', waiverExcess: q.waiver === 'true', ehailing: q.ehailing === 'true' } },
  }, profile);
  const label = { windscreen: `COVER FOR WINDSCREENS, WINDOWS AND SUNROOF  SUM INSURED (RM) : ${fmt(q.windscreenSI)}`, specialPerils: `INCLUSION OF SPECIAL PERILS  SUM INSURED (RM) : ${fmt(q.sumInsured)}`, waiverExcess: 'WAIVER OF COMPULSORY EXCESS', ehailing: 'PRIVATE HIRE CAR ENDORSEMENT (E-HAILING)' };
  const body = `<!doctype html><html><body style="font:11px Arial;margin:30px">
    <p>Allianz General Insurance Company (Malaysia) Berhad (practice portal)</p>
    <p>Dear Policyholder, here's your Motor Insurance quotation &nbsp;&nbsp; Your Quote No.: ${q.quoteNo}</p>
    <p>No Claim Discount ${fmt(q.ncd)}% &nbsp;&nbsp; Sum Insured RM ${fmt(q.sumInsured)}</p>
    <table style="white-space:nowrap">
    <tr><td>BASIC PREMIUM</td><td>${fmt(r.basic)}</td></tr>
    <tr><td>NO CLAIM DISCOUNT ${fmt(q.ncd)}%</td><td>${fmt(r.ncdAmount)}</td></tr>
    <tr><td>NET BASIC PREMIUM</td><td>${fmt(r.basic - r.ncdAmount)}</td></tr>
    <tr><td>EXTRA COVERAGE</td></tr>
    ${r.addons.map((a) => `<tr><td>${label[a.key] || a.label}</td><td>${fmt(a.amount)}</td></tr>`).join('')}
    <tr><td>TOTAL EXTRA COVERAGE PREMIUM</td><td>${fmt(r.addonTotal)}</td></tr>
    <tr><td>GROSS PREMIUM</td><td>${fmt(r.gross)}</td></tr>
    </table><br>
    <table style="white-space:nowrap"><tr><td>Gross Premium</td><td>Service Tax</td><td>Stamp Duty</td><td>Total Amount Payable</td></tr>
    <tr><td>${fmt(r.gross)}</td><td>${fmt(r.sst)}</td><td>${fmt(r.stampDuty)}</td><td>${fmt(r.total)}</td></tr></table>
    </body></html>`;
  const pdf = await renderPdf(body);
  res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${q.plate}_${q.quoteNo}.pdf"` });
  res.end(pdf);
}
