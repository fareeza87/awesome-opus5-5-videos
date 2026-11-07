import { ADDONS, COVER_TYPES, ageFromNric } from './engine/tariff.js';
import { rateQuote } from './engine/rate.js';
import { compareAll } from './engine/compare.js';
import { PROVIDERS } from './engine/providers-config.js';
import { VEHICLES, estimateValue } from './data/vehicles.js';

// Shown on the printed quotation. Change to your agency's details.
const AGENCY = {
  name: 'Your Agency Sdn Bhd',
  line: 'Authorised agent for panel insurers & takaful operators',
  contact: 'Tel 03-0000 0000 · hello@youragency.my',
};

const $ = (s, el = document) => el.querySelector(s);
const form = $('#quote-form');
const rm = (n) => 'RM ' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let current = null;   // last comparison
let serverOnline = true;

// ---------- Setup ----------
const pick = $('#pick');
VEHICLES.forEach((v, i) => pick.append(new Option(`${v.make} ${v.model} (${v.cc}cc)`, i)));
pick.addEventListener('change', () => {
  const v = VEHICLES[pick.value];
  if (!v) return;
  form.make.value = v.make;
  form.model.value = v.model;
  form.cc.value = v.cc;
  form.seats.value = v.seats;
  if (!form.year.value) form.year.value = new Date().getFullYear() - 3;
  suggestValue();
});
form.year.addEventListener('change', suggestValue);
function suggestValue() {
  const v = VEHICLES[pick.value];
  if (v && form.year.value) form.sumInsured.value = estimateValue(v, Number(form.year.value));
}

const addonBox = $('#addons');
const DEFAULT_ON = ['windscreen', 'specialPerils', 'srcc', 'llop'];
for (const [key, a] of Object.entries(ADDONS)) {
  addonBox.insertAdjacentHTML('beforeend',
    `<label class="chip"><input type="checkbox" name="addon" value="${key}" ${DEFAULT_ON.includes(key) ? 'checked' : ''}><span>${esc(a.label)}</span></label>`);
}

form.coverType.addEventListener('change', () => {
  const tp = form.coverType.value === 'tp';
  form.sumInsured.disabled = tp;
  form.valueBasis.disabled = tp;
});

$('#demo').addEventListener('click', () => {
  form.name.value = 'Ahmad bin Ismail';
  form.nric.value = '880312-10-5531';
  form.phone.value = '012-345 6789';
  form.postcode.value = '47301';
  form.regNo.value = 'VBK 2281';
  pick.value = 2; pick.dispatchEvent(new Event('change'));
  form.year.value = 2021; suggestValue();
  form.windscreenSI.value = 1500;
  form.ncd.value = '38.33';
});

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#tab-quote').classList.toggle('hidden', t.dataset.tab !== 'quote');
  $('#tab-history').classList.toggle('hidden', t.dataset.tab !== 'history');
  if (t.dataset.tab === 'history') loadHistory();
}));

// ---------- Quote ----------
function readForm() {
  const f = form;
  const addons = {};
  f.querySelectorAll('input[name=addon]').forEach((c) => { addons[c.value] = c.checked; });
  return {
    owner: { name: f.name.value.trim(), nric: f.nric.value.trim(), phone: f.phone.value.trim(), postcode: f.postcode.value.trim() },
    vehicle: {
      regNo: f.regNo.value.trim().toUpperCase().replace(/\s+/g, ' '),
      make: f.make.value.trim(), model: f.model.value.trim(),
      year: Number(f.year.value), cc: Number(f.cc.value), seats: Number(f.seats.value || 5),
    },
    cover: {
      coverType: f.coverType.value,
      sumInsured: Number(f.sumInsured.value || 0),
      valueBasis: f.valueBasis.value,
      ncd: Number(f.ncd.value),
      windscreenSI: Number(f.windscreenSI.value || 0),
      namedDrivers: Number(f.namedDrivers.value || 0),
      addons,
    },
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const req = readForm();
  const btn = $('#go');
  btn.disabled = true; btn.textContent = 'Asking insurers…';
  $('#errors').textContent = '';
  $('#results').innerHTML = `<div class="card loading">${PROVIDERS.map((p) => `<div class="row-skel">${esc(p.name)} <span>waiting…</span></div>`).join('')}</div>`;
  try {
    const result = await runCompare(req);
    if (!result.ok) {
      $('#errors').textContent = result.errors.join(' · ');
      $('#results').innerHTML = '';
      return;
    }
    current = result;
    renderResults(result);
    if (matchMedia('(max-width: 900px)').matches) $('#results').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    $('#errors').textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Compare all insurers';
  }
});

async function runCompare(req) {
  if (serverOnline) {
    try {
      const r = await fetch('api/quotes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
      if (r.status === 400) return r.json();
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) return r.json();
      throw new Error('no server');
    } catch { serverOnline = false; }
  }
  // No server (e.g. static demo): price locally with the demo profiles and keep history in this browser.
  const result = await compareAll(req, PROVIDERS, async (p) => rateQuote(req, p));
  if (result.ok) {
    result.id = Math.random().toString(36).slice(2, 10).toUpperCase();
    const rows = localHistory();
    rows.unshift(result);
    try { localStorage.setItem('mq-history', JSON.stringify(rows.slice(0, 100))); } catch {}
  }
  return result;
}

function renderResults(r) {
  const { owner, vehicle, cover } = r.request;
  const quoted = r.results.filter((x) => x.status === 'quoted');
  const age = ageFromNric(owner.nric);
  const spread = quoted.length > 1 ? quoted[quoted.length - 1].total - quoted[0].total : 0;

  $('#results').innerHTML = `
    <div class="card summary">
      <div>
        <div class="muted">Ref ${esc(r.id)} · ${new Date(r.createdAt).toLocaleString('en-MY')}</div>
        <h2>${esc(vehicle.regNo)} · ${esc(vehicle.make)} ${esc(vehicle.model)} ${vehicle.year}</h2>
        <div class="muted">${esc(owner.name)}${age !== null ? ` · age ${age}` : ''} · ${COVER_TYPES[cover.coverType]}${cover.coverType !== 'tp' ? ` · SI ${rm(cover.sumInsured)}` : ''} · NCD ${cover.ncd}%</div>
      </div>
      <div class="stats">
        <div><b>${quoted.length}/${r.results.length}</b><span>quotes</span></div>
        <div><b>${(r.ms / 1000).toFixed(1)}s</b><span>total time</span></div>
        ${spread ? `<div><b>${rm(spread)}</b><span>price spread</span></div>` : ''}
      </div>
    </div>
    ${serverOnline ? '' : '<p class="note no-print">Demo mode: priced in this browser with sample insurer profiles. Run the server to use real connectors and shared history.</p>'}
    <div class="offers">${r.results.map(offerCard).join('')}</div>
    <div class="card share no-print">
      <span class="muted">Tick the offers to show the customer, then:</span>
      <button class="primary" id="print">Print / save PDF</button>
      <a id="wa" class="btn" target="_blank" rel="noopener">WhatsApp</a>
      <button id="copy">Copy text</button>
    </div>`;

  $('#print').onclick = () => { buildPrint(); window.print(); };
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(shareText()); flash('#copy', 'Copied'); } catch { flash('#copy', 'Copy blocked'); }
  };
  // Link is rebuilt on click so it carries the offers ticked at that moment.
  $('#wa').onclick = () => {
    const phone = owner.phone.replace(/\D/g, '').replace(/^0/, '60');
    $('#wa').href = `https://wa.me/${phone}?text=${encodeURIComponent(shareText())}`;
  };
}

function offerCard(o, i) {
  if (o.status !== 'quoted') {
    return `<article class="offer card off">
      <header><h3>${esc(o.provider)}</h3><span class="tag ${o.kind}">${o.kind === 'takaful' ? 'Takaful' : 'Insurance'}</span></header>
      <p class="muted">${o.status === 'declined' ? 'Declined' : 'Could not get a quote'}: ${esc(o.reasons.join('; '))}</p>
    </article>`;
  }
  return `<article class="offer card ${o.cheapest ? 'best' : ''}">
    <header>
      <label class="pickme no-print"><input type="checkbox" class="sel" value="${esc(o.providerId)}" ${i < 3 ? 'checked' : ''}></label>
      <h3>${esc(o.provider)}</h3>
      <span class="tag ${o.kind}">${o.kind === 'takaful' ? 'Takaful' : 'Insurance'}</span>
      ${o.cheapest ? '<span class="tag best">Lowest</span>' : ''}
    </header>
    <div class="price">${rm(o.total)}<small>total payable</small></div>
    <dl>
      <dt>Basic premium</dt><dd>${rm(o.basic)}</dd>
      <dt>NCD ${o.ncdPercent ?? ''}%</dt><dd>− ${rm(o.ncdAmount)}</dd>
      <dt>Add-ons</dt><dd>${rm(o.addonTotal)}</dd>
      <dt>Gross</dt><dd>${rm(o.gross)}</dd>
      <dt>SST 8%</dt><dd>${rm(o.sst)}</dd>
      <dt>Stamp duty</dt><dd>${rm(o.stampDuty)}</dd>
      <dt>Excess</dt><dd>${o.excess ? rm(o.excess) : 'Nil'}</dd>
      <dt class="staff">Commission</dt><dd class="staff">${rm(o.commission)}</dd>
    </dl>
    <details class="no-print"><summary>Breakdown</summary>
      <ul>
        <li>Tariff base ${rm(o.tariff ?? o.basic)}</li>
        ${(o.factors || []).map((f) => `<li>${esc(f.label)} × ${f.factor}</li>`).join('')}
        ${o.addons.map((a) => `<li>${esc(a.label)}: ${rm(a.amount)}</li>`).join('')}
      </ul>
    </details>
    ${o.benefits?.length ? `<ul class="benefits">${o.benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
  </article>`;
}

function selected() {
  const ids = [...document.querySelectorAll('.sel:checked')].map((c) => c.value);
  return current.results.filter((o) => o.status === 'quoted' && ids.includes(o.providerId));
}

function shareText() {
  const { owner, vehicle, cover } = current.request;
  const lines = [
    `Salam ${owner.name.split(' ')[0]}, here is your motor ${cover.coverType === 'tp' ? 'cover' : 'insurance'} comparison:`,
    `${vehicle.regNo} · ${vehicle.make} ${vehicle.model} ${vehicle.year}`,
    `${COVER_TYPES[cover.coverType]}${cover.coverType !== 'tp' ? ` · Sum insured ${rm(cover.sumInsured)}` : ''} · NCD ${cover.ncd}%`,
    '',
    ...selected().map((o, i) => `${i + 1}. ${o.provider}: *${rm(o.total)}*${o.excess ? ` (excess ${rm(o.excess)})` : ''}`),
    '',
    `Prices include SST and stamp duty. Valid 14 days. Ref ${current.id}.`,
    `Reply with the number to proceed.`,
  ];
  return lines.join('\n');
}

function buildPrint() {
  const { owner, vehicle, cover } = current.request;
  const offers = selected();
  const addonNames = Object.entries(cover.addons).filter(([, v]) => v).map(([k]) => ADDONS[k]?.label).filter(Boolean);
  const row = (label, fn) => `<tr><th>${label}</th>${offers.map((o) => `<td>${fn(o)}</td>`).join('')}</tr>`;
  $('#print-sheet').innerHTML = `
    <div class="ps-head"><div><h1>${esc(AGENCY.name)}</h1><p>${esc(AGENCY.line)}</p><p>${esc(AGENCY.contact)}</p></div>
      <div class="ps-ref"><b>MOTOR QUOTATION</b><br>Ref ${esc(current.id)}<br>${new Date(current.createdAt).toLocaleDateString('en-MY')}</div></div>
    <table class="ps-info">
      <tr><th>Customer</th><td>${esc(owner.name)}</td><th>Vehicle</th><td>${esc(vehicle.regNo)} · ${esc(vehicle.make)} ${esc(vehicle.model)} ${vehicle.year} · ${vehicle.cc}cc</td></tr>
      <tr><th>Cover</th><td>${COVER_TYPES[cover.coverType]}</td><th>Sum insured</th><td>${cover.coverType === 'tp' ? '—' : rm(cover.sumInsured) + ` (${cover.valueBasis} value)`}</td></tr>
      <tr><th>NCD</th><td>${cover.ncd}%</td><th>Add-ons</th><td>${esc(addonNames.join(', ') || 'None')}</td></tr>
    </table>
    <table class="ps-compare">
      <tr><th></th>${offers.map((o) => `<th>${esc(o.provider)}<br><small>${o.kind === 'takaful' ? 'Takaful' : 'Insurance'}</small></th>`).join('')}</tr>
      ${row('Basic premium', (o) => rm(o.basic))}
      ${row('Less NCD', (o) => '− ' + rm(o.ncdAmount))}
      ${row('Add-ons', (o) => rm(o.addonTotal))}
      ${row('Gross premium', (o) => rm(o.gross))}
      ${row('SST 8%', (o) => rm(o.sst))}
      ${row('Stamp duty', (o) => rm(o.stampDuty))}
      ${row('<b>Total payable</b>', (o) => `<b>${rm(o.total)}</b>`)}
      ${row('Excess', (o) => (o.excess ? rm(o.excess) : 'Nil'))}
      ${row('Highlights', (o) => (o.benefits || []).map(esc).join('<br>'))}
    </table>
    <p class="ps-foot">This quotation is valid for 14 days and is subject to the insurer's / takaful operator's underwriting acceptance, verification of NCD with ISM, and the policy terms. Premiums include 8% SST and RM10 stamp duty.</p>`;
}

function flash(sel, text) {
  const b = $(sel); const old = b.textContent; b.textContent = text; setTimeout(() => { b.textContent = old; }, 1200);
}

// ---------- History ----------
function localHistory() {
  try { return JSON.parse(localStorage.getItem('mq-history') || '[]'); } catch { return []; }
}

let searchTimer;
$('#history-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadHistory, 250); });

async function loadHistory() {
  const q = $('#history-search').value.trim();
  let rows;
  if (serverOnline) {
    try {
      const r = await fetch('api/quotes?q=' + encodeURIComponent(q));
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error();
      rows = await r.json();
    } catch { serverOnline = false; }
  }
  if (!serverOnline) {
    rows = localHistory()
      .filter((x) => !q || JSON.stringify(x.request).toLowerCase().includes(q.toLowerCase()))
      .map((x) => {
        const best = x.results.find((o) => o.cheapest);
        return { id: x.id, createdAt: x.createdAt, customer: x.request.owner.name, regNo: x.request.vehicle.regNo,
          vehicle: `${x.request.vehicle.make} ${x.request.vehicle.model}`, cheapest: best && { provider: best.provider, total: best.total } };
      });
  }
  $('#history-list').innerHTML = rows.length ? `<table class="history">
    <tr><th>Date</th><th>Customer</th><th>Vehicle</th><th>Lowest</th><th></th></tr>
    ${rows.map((x) => `<tr><td>${new Date(x.createdAt).toLocaleDateString('en-MY')}</td><td>${esc(x.customer)}</td>
      <td>${esc(x.regNo)}<br><small>${esc(x.vehicle)}</small></td>
      <td>${x.cheapest ? `${rm(x.cheapest.total)}<br><small>${esc(x.cheapest.provider)}</small>` : '—'}</td>
      <td><button data-open="${esc(x.id)}">Open</button> <button data-requote="${esc(x.id)}" class="ghost">Re-quote</button></td></tr>`).join('')}
  </table>` : '<p class="muted">No saved comparisons yet.</p>';
}

$('#history-list').addEventListener('click', async (e) => {
  const id = e.target.dataset.open || e.target.dataset.requote;
  if (!id) return;
  const full = serverOnline ? await (await fetch('api/quotes/' + id)).json() : localHistory().find((x) => x.id === id);
  if (!full) return;
  if (e.target.dataset.requote) fillForm(full.request);
  else { current = full; renderResults(full); }
  document.querySelector('.tab[data-tab=quote]').click();
});

function fillForm({ owner, vehicle, cover }) {
  const set = (n, v) => { if (form[n]) form[n].value = v ?? ''; };
  Object.entries(owner).forEach(([k, v]) => set(k, v));
  Object.entries(vehicle).forEach(([k, v]) => set(k, v));
  ['coverType', 'sumInsured', 'valueBasis', 'ncd', 'windscreenSI', 'namedDrivers'].forEach((k) => set(k, cover[k]));
  form.querySelectorAll('input[name=addon]').forEach((c) => { c.checked = !!cover.addons[c.value]; });
}
