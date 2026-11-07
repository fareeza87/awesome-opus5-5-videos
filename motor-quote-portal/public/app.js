import { ADDONS, COVER_TYPES, ageFromNric } from './engine/tariff.js';
import { rateQuote } from './engine/rate.js';
import { compareStream, rank } from './engine/compare.js';
import { demoLookup } from './engine/lookup.js';
import { PROVIDERS } from './engine/providers-config.js';
import { VEHICLES, estimateValue } from './data/vehicles.js';
import { quotationHtml } from './quotation.js';

// Shown on the printed quotation. Change to your agency's details.
const AGENCY = {
  name: 'Your Agency Sdn Bhd',
  line: 'Authorised agent for panel insurers & takaful operators',
  contact: 'Tel 03-0000 0000 · hello@youragency.my',
  agent: 'Your insurance advisor',
  color: '#0b5cad',
};

const $ = (s, el = document) => el.querySelector(s);
const form = $('#quote-form');
const rm = (n) => 'RM ' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rm0 = (n) => 'RM ' + Number(n).toLocaleString('en-MY', { maximumFractionDigits: 0 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let current = null;       // finished comparison shown on screen
let serverOnline = true;  // false = static demo, priced in the browser

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
  form.sumInsured.value = estimateValue(v, Number(form.year.value));
});

const DEFAULT_ON = ['windscreen', 'specialPerils', 'srcc', 'llop'];
for (const [key, a] of Object.entries(ADDONS)) {
  $('#addons').insertAdjacentHTML('beforeend',
    `<label class="chip"><input type="checkbox" name="addon" value="${key}" ${DEFAULT_ON.includes(key) ? 'checked' : ''}><span>${esc(a.label)}</span></label>`);
}

// The e-hailing period picker only matters when e-hailing is ticked.
const ehBox = form.querySelector('input[name=addon][value=ehailing]');
const showEh = () => { $('#ehWrap').hidden = !ehBox.checked; };
ehBox.addEventListener('change', showEh);
form.addEventListener('reset', () => setTimeout(showEh));

const ID_LABELS = { nric: ['NRIC no.', '900101-14-5678'], passport: ['Passport no.', 'A12345678'], company: ['Company reg. no.', '202301012345'] };
form.idType.addEventListener('change', () => {
  const [label, ph] = ID_LABELS[form.idType.value];
  $('#idLabel').textContent = label;
  form.nric.placeholder = ph;
});
form.coverType.addEventListener('change', () => {
  const tp = form.coverType.value === 'tp';
  form.sumInsured.disabled = tp;
  form.valueBasis.disabled = tp;
});

// Details filled by a lookup belong to that plate + IC. Clear them when either changes.
const AUTO_FIELDS = ['make', 'model', 'year', 'cc', 'seats', 'sumInsured', 'ncd'];
for (const n of ['regNo', 'nric']) {
  form[n].addEventListener('input', () => {
    for (const f of AUTO_FIELDS) if (form[f].dataset.auto) { form[f].value = ''; delete form[f].dataset.auto; }
    $('#vehHint').textContent = '· auto from ISM lookup';
  });
}
for (const f of AUTO_FIELDS) form[f].addEventListener('input', () => delete form[f].dataset.auto);
form.addEventListener('reset', () => { for (const f of AUTO_FIELDS) delete form[f].dataset.auto; $('#vehHint').textContent = '· auto from ISM lookup'; });

$('#demo').addEventListener('click', () => {
  form.reset();
  form.name.value = 'Ahmad bin Ismail';
  form.nric.value = '880312-10-5531';
  form.phone.value = '012-345 6789';
  form.postcode.value = '47301';
  form.regNo.value = 'VBK 2281';
  form.windscreenSI.value = 1500;
});

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#tab-quote').classList.toggle('hidden', t.dataset.tab !== 'quote');
  $('#tab-history').classList.toggle('hidden', t.dataset.tab !== 'history');
  $('#tab-slips').classList.toggle('hidden', t.dataset.tab !== 'slips');
  if (t.dataset.tab === 'history') loadHistory();
}));

// ---------- Quote ----------
function readForm() {
  const f = form;
  const num = (el) => (el.value === '' ? undefined : Number(el.value));
  const addons = {};
  f.querySelectorAll('input[name=addon]').forEach((c) => { addons[c.value] = c.checked; });
  return {
    owner: { idType: f.idType.value, nric: f.nric.value.trim(), name: f.name.value.trim(), phone: f.phone.value.trim(), postcode: f.postcode.value.trim() },
    vehicle: {
      regNo: f.regNo.value.trim().toUpperCase().replace(/\s+/g, ' '),
      make: f.make.value.trim() || undefined, model: f.model.value.trim() || undefined,
      year: num(f.year), cc: num(f.cc), seats: num(f.seats),
    },
    cover: {
      coverType: f.coverType.value,
      sumInsured: num(f.sumInsured),
      valueBasis: f.valueBasis.value,
      ncd: f.ncd.value === '' ? '' : Number(f.ncd.value),
      windscreenSI: num(f.windscreenSI) || 0,
      namedDrivers: num(f.namedDrivers) || 0,
      ehailingPeriod: f.ehailingPeriod.value,
      addons,
    },
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#go');
  btn.disabled = true; btn.textContent = 'Getting quotes…';
  $('#errors').textContent = '';
  const live = startLive(readForm());
  try {
    const result = await streamQuotes(live.request, live.onEvent);
    if (result?.ok) {
      current = result;
      renderFinal(result);
    }
  } catch (err) {
    $('#errors').textContent = err.message;
  } finally {
    live.stop();
    btn.disabled = false; btn.textContent = 'Get quotes';
  }
});

// Reads the server's stream (one JSON event per line). Falls back to pricing
// in the browser when there is no server, e.g. the static demo page.
async function streamQuotes(req, onEvent) {
  if (serverOnline) {
    let res;
    try {
      res = await fetch('api/quotes/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('ndjson')) throw new Error();
    } catch { serverOnline = false; }
    if (serverOnline) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', final = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const ev = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
          if (ev.type === 'done') final = ev.result; else onEvent(ev);
        }
      }
      return final;
    }
  }
  // Static demo: same flow, simulated delays so it feels like live bots.
  const result = await compareStream(req, PROVIDERS, async (p, r) => { await sleep(600 + Math.random() * 2200); return rateQuote(r, p); }, {
    lookup: async (r) => { await sleep(900); const f = demoLookup(r); if (!f) throw new Error('Plate number not recognised'); return { source: 'Demo lookup', ...f }; },
    onEvent,
  });
  if (result.ok) {
    result.id = Math.random().toString(36).slice(2, 10).toUpperCase();
    const rows = localHistory();
    rows.unshift(result);
    try { localStorage.setItem('mq-history', JSON.stringify(rows.slice(0, 100))); } catch {}
  }
  return result;
}

// Live view while bots are working.
function startLive(request) {
  const t0 = Date.now();
  const state = { request, lookup: null, providers: [], results: new Map(), otpFor: new Map() };
  $('#results').innerHTML = `<div class="card summary live" id="live-head"></div><div id="live-otp"></div><div class="offers" id="live-offers"></div>`;
  const tick = setInterval(drawHead, 200);

  function drawHead() {
    if (!$('#live-head')) return;
    const done = state.results.size, total = state.providers.length;
    const { vehicle, cover } = state.request;
    const f = state.lookup;
    $('#live-head').innerHTML = `
      <div>
        <h2>${esc(vehicle.regNo)}${vehicle.make ? ` · ${esc(vehicle.make)} ${esc(vehicle.model)} ${vehicle.year ?? ''}` : ''}</h2>
        <div class="muted">${!total ? (f ? 'Vehicle found' : 'Looking up vehicle &amp; NCD…') : `Quoting ${total} insurers on the same sum insured`}</div>
        ${f ? `<div class="found">Found by ${esc(f.source)} · ${esc(f.make)} ${esc(f.model)}, ${f.year}, ${f.cc}cc · NCD ${f.ncd}% · Sum insured ${rm0(cover.sumInsured)}</div>` : ''}
      </div>
      <div class="stats">
        ${total ? `<div><b>${done}/${total}</b><span>answered</span></div>` : ''}
        <div><b>${((Date.now() - t0) / 1000).toFixed(1)}s</b><span>elapsed</span></div>
      </div>`;
  }
  function drawOffers() {
    if (!$('#live-offers')) return;
    const answered = rank([...state.results.values()]);
    const waiting = state.providers.filter((p) => !state.results.has(p.id));
    $('#live-offers').innerHTML = answered.map((o, i) => offerCard(o, i, false)).join('')
      + waiting.map((p) => `<article class="offer card pending"><header><h3>${esc(p.name)}</h3>${kindTag(p.kind)}</header>
          <p class="muted">${state.otpFor.has(p.id) ? 'Waiting for OTP ↑' : p.mode === 'rpa' || p.mode === 'webhook' ? 'Bot filling insurer portal…' : 'Waiting for insurer…'}</p><div class="bar"></div></article>`).join('');
  }
  drawHead();
  return {
    request,
    stop: () => { clearInterval(tick); },
    onEvent(ev) {
      if (ev.type === 'lookup') {
        state.lookup = ev.found; state.request = ev.request; fillForm(ev.request, { onlyEmpty: true });
        $('#vehHint').textContent = `· found ${ev.found.make} ${ev.found.model}`;
      }
      if (ev.type === 'start') { state.providers = ev.providers; drawOffers(); }
      if (ev.type === 'quote') { state.results.set(ev.result.providerId, ev.result); drawOffers(); }
      if (ev.type === 'error') { $('#errors').textContent = ev.errors.join(' · '); $('#results').innerHTML = ''; clearInterval(tick); }
      if (ev.type === 'otp') { state.otpFor.set(ev.otp.providerId, ev.otp.id); showOtp(ev.otp); drawOffers(); }
      if (ev.type === 'otp-done') {
        for (const [k, v] of state.otpFor) if (v === ev.id) state.otpFor.delete(k);
        document.querySelector(`[data-otp="${CSS.escape(ev.id)}"]`)?.remove();
        drawOffers();
      }
      drawHead();
    },
  };
}

// A portal is waiting for a one-time code (e.g. Zurich). Staff type it here.
function showOtp(otp) {
  const box = $('#live-otp');
  if (!box || box.querySelector(`[data-otp="${CSS.escape(otp.id)}"]`)) return;
  box.insertAdjacentHTML('beforeend', `
    <form class="card otp" data-otp="${esc(otp.id)}">
      <div><b>${esc(otp.provider)} needs an OTP</b><p class="muted">${esc(otp.prompt)}</p></div>
      <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="000000" aria-label="OTP for ${esc(otp.provider)}" required>
      <button class="primary">Send code</button>
      <span class="otp-msg muted"></span>
    </form>`);
  const form = box.querySelector(`[data-otp="${CSS.escape(otp.id)}"]`);
  form.code.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('.otp-msg');
    msg.textContent = 'Sending…';
    try {
      const r = await fetch(`api/otp/${otp.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: form.code.value }) });
      const j = await r.json();
      msg.textContent = r.ok ? 'Sent. Bot is logging in…' : j.error;
    } catch { msg.textContent = 'Could not reach the server'; }
  });
}

function kindTag(kind) {
  return `<span class="tag ${kind}">${kind === 'takaful' ? 'Takaful' : 'Insurance'}</span>`;
}

function renderFinal(r) {
  const { owner, vehicle, cover } = r.request;
  const quoted = r.results.filter((x) => x.status === 'quoted');
  const age = (owner.idType || 'nric') === 'nric' ? ageFromNric(owner.nric) : null;
  const spread = quoted.length > 1 ? quoted[quoted.length - 1].total - quoted[0].total : 0;

  $('#results').innerHTML = `
    <div class="card summary">
      <div>
        <div class="muted">Ref ${esc(r.id)} · ${new Date(r.createdAt).toLocaleString('en-MY')}</div>
        <h2>${esc(vehicle.regNo)} · ${esc(vehicle.make)} ${esc(vehicle.model)} ${vehicle.year ?? ''}</h2>
        <div class="muted">${esc(owner.name || owner.nric || 'Customer')}${age !== null ? ` · age ${age}` : ''} · ${COVER_TYPES[cover.coverType]}${cover.coverType !== 'tp' ? ` · SI ${rm0(cover.sumInsured)}` : ''} · NCD ${cover.ncd}%</div>
      </div>
      <div class="stats">
        <div><b>${quoted.length}/${r.results.length}</b><span>quotes</span></div>
        <div><b>${(r.ms / 1000).toFixed(1)}s</b><span>total time</span></div>
        ${spread ? `<div><b>${rm0(spread)}</b><span>price spread</span></div>` : ''}
      </div>
    </div>
    ${(r.warnings || []).map((w) => `<p class="card warn-banner">${esc(w)}</p>`).join('')}
    ${serverOnline ? '' : '<p class="note no-print">Demo mode: sample insurer prices worked out in this browser. On the server, RPA bots fetch live prices from each insurer portal.</p>'}
    <div class="offers">${r.results.map((o, i) => offerCard(o, i, true)).join('')}</div>
    <div class="card share no-print">
      <span class="muted">Tick the offers to show the customer, then:</span>
      <button class="primary" id="print">Print</button>
      ${serverOnline ? '<a id="pdf" class="btn" target="_blank" rel="noopener">Download PDF</a>' : ''}
      <a id="wa" class="btn" target="_blank" rel="noopener">WhatsApp</a>
      <button id="copy">Copy text</button>
    </div>`;

  $('#print').onclick = printQuotation;
  if ($('#pdf')) $('#pdf').onclick = () => { $('#pdf').href = `api/quotes/${r.id}/pdf?ids=${selected().map((o) => o.providerId).join(',')}`; };
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(shareText()); flash('#copy', 'Copied'); } catch { flash('#copy', 'Copy blocked'); }
  };
  // Link is rebuilt on click so it carries the offers ticked at that moment.
  $('#wa').onclick = () => {
    const phone = (owner.phone || '').replace(/\D/g, '').replace(/^0/, '60');
    $('#wa').href = `https://wa.me/${phone}?text=${encodeURIComponent(shareText())}`;
  };
}

function offerCard(o, i, selectable) {
  if (o.status !== 'quoted') {
    return `<article class="offer card off">
      <header><h3>${esc(o.provider)}</h3>${kindTag(o.kind)}</header>
      <p class="muted">${o.status === 'declined' ? 'Declined' : 'Could not get a quote'}: ${esc(o.reasons.join('; '))}</p>
    </article>`;
  }
  return `<article class="offer card ${o.cheapest ? 'best' : ''} ${selectable ? '' : 'arrived'}">
    <header>
      ${selectable ? `<label class="pickme no-print"><input type="checkbox" class="sel" value="${esc(o.providerId)}" ${i < 3 ? 'checked' : ''}></label>` : ''}
      <h3>${esc(o.provider)}</h3>
      ${kindTag(o.kind)}
      ${o.cheapest ? '<span class="tag best">Lowest</span>' : ''}
    </header>
    <div class="price">${rm(o.total)}<small>total payable${o.mode === 'slip' ? ' · from slip' : ''}${(o.mode !== 'demo' && o.mode !== 'slip') || o.ms >= 300 ? ` · ${(o.ms / 1000).toFixed(1)}s` : ''}${o.mode === 'rpa' || o.mode === 'webhook' ? ' · live portal' : ''}</small></div>
    ${o.siNote ? `<p class="warn">${esc(o.siNote)}</p>` : ''}
    ${(o.notes || []).map((n) => `<p class="warn">${esc(n)}</p>`).join('')}
    ${o.referred ? '<p class="warn">Referred to the insurer\'s underwriter: price is subject to approval.</p>' : ''}
    <dl>
      <dt>Basic premium</dt><dd>${rm(o.basic)}</dd>
      <dt>NCD ${o.ncdPercent ?? ''}%</dt><dd>− ${rm(o.ncdAmount)}</dd>
      <dt>Add-ons</dt><dd>${rm(o.addonTotal)}</dd>
      <dt>Gross</dt><dd>${rm(o.gross)}</dd>
      <dt>SST 8%</dt><dd>${rm(o.sst)}</dd>
      <dt>Stamp duty</dt><dd>${rm(o.stampDuty)}</dd>
      <dt>Excess</dt><dd>${o.excess ? rm(o.excess) : 'Nil'}</dd>
      ${o.commission != null ? `<dt class="staff">Commission</dt><dd class="staff">${rm(o.commission)}</dd>` : ''}
      ${o.insurerRef ? `<dt>Insurer ref</dt><dd>${esc(o.insurerRef)}</dd>` : ''}
    </dl>
    ${o.factors || o.addons?.length ? `<details class="no-print"><summary>Breakdown</summary>
      <ul>
        ${o.tariff ? `<li>Tariff base ${rm(o.tariff)}</li>` : ''}
        ${(o.factors || []).map((f) => `<li>${esc(f.label)} × ${f.factor}</li>`).join('')}
        ${(o.addons || []).map((a) => `<li>${esc(a.label)}: ${rm(a.amount)}</li>`).join('')}
      </ul>
    </details>` : ''}
    ${o.benefits?.length ? `<ul class="benefits">${o.benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
  </article>`;
}

function selected() {
  const ids = [...document.querySelectorAll('.sel:checked')].map((c) => c.value);
  return current.results.filter((o) => o.status === 'quoted' && ids.includes(o.providerId));
}

function shareText() {
  const { owner, vehicle, cover } = current.request;
  const first = (owner.name || '').split(' ')[0];
  const lines = [
    `Salam${first ? ' ' + first : ''}, here is your motor insurance comparison:`,
    `${vehicle.regNo} · ${vehicle.make} ${vehicle.model} ${vehicle.year ?? ''}`,
    `${COVER_TYPES[cover.coverType]}${cover.coverType !== 'tp' ? ` · Sum insured ${rm0(cover.sumInsured)}` : ''} · NCD ${cover.ncd}%`,
    '',
    ...selected().map((o, i) => `${i + 1}. ${o.provider}: *${rm(o.total)}*${o.excess ? ` (excess ${rm(o.excess)})` : ''}${o.sumInsured !== cover.sumInsured && cover.coverType !== 'tp' ? ` (SI ${rm0(o.sumInsured)})` : ''}`),
    '',
    `Prices include SST and stamp duty. Valid 14 days. Ref ${current.id}.`,
    'Reply with the number to proceed.',
  ];
  return lines.join('\n');
}

// Prints the one-page comparison from a hidden frame so it keeps its own layout.
function printQuotation() {
  const ids = selected().map((o) => o.providerId);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  frame.srcdoc = quotationHtml(current, { agency: AGENCY, ids });
  frame.onload = () => { frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
  document.body.append(frame);
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
        return { id: x.id, createdAt: x.createdAt, customer: x.request.owner.name || x.request.owner.nric, regNo: x.request.vehicle.regNo,
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
  else { current = full; renderFinal(full); }
  document.querySelector('.tab[data-tab=quote]').click();
});

function fillForm({ owner, vehicle, cover }, { onlyEmpty = false } = {}) {
  const set = (n, v) => {
    const el = form[n];
    if (!el || (onlyEmpty && el.value !== '')) return;
    el.value = v ?? '';
    if (onlyEmpty && v !== undefined && v !== '') el.dataset.auto = '1'; else delete el.dataset.auto;
  };
  Object.entries(owner).forEach(([k, v]) => set(k, v));
  Object.entries(vehicle).forEach(([k, v]) => set(k, v));
  ['coverType', 'sumInsured', 'valueBasis', 'ncd', 'windscreenSI', 'namedDrivers', 'ehailingPeriod'].forEach((k) => set(k, cover[k]));
  if (!onlyEmpty) { form.querySelectorAll('input[name=addon]').forEach((c) => { c.checked = !!cover.addons[c.value]; }); showEh(); }
}

// ---------- Upload slips ----------
let slips = [];

async function addSlipFiles(files) {
  for (const file of files) {
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) continue;
    const row = { name: file.name, state: 'reading' };
    slips.push(row);
    drawSlips();
    try {
      const r = await fetch('api/slips', { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent(file.name) }, body: file });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(r.status === 404 ? 'Reading slips needs the portal server' : (await r.json()).error);
      Object.assign(row, { state: 'done', slip: await r.json() });
    } catch (e) {
      Object.assign(row, { state: 'done', slip: { status: 'error', provider: file.name, reasons: [e.message || 'Could not read this file'] } });
    }
    drawSlips();
  }
}

function drawSlips() {
  $('#slipList').innerHTML = slips.length ? `<table class="history slips">
    <tr><th>Slip</th><th>Insurer</th><th>Sum insured</th><th>Total payable</th><th>Check</th><th></th></tr>
    ${slips.map((r, i) => {
      const s = r.slip;
      const state = r.state === 'reading' ? '<span class="muted">Reading…</span>'
        : s.status === 'quoted' ? '<span class="ok">✓ Adds up</span>'
        : s.status === 'check' ? `<span class="warn">Check: ${esc(s.checks.join('; '))}</span>`
        : `<span class="warn">${esc(s.reasons.join('; '))}</span>`;
      return `<tr><td><small>${esc(r.name)}</small></td><td>${esc(s?.provider || '')}${s?.referred ? ' <span class="tag">Referred</span>' : ''}</td>
        <td>${s?.sumInsured ? rm0(s.sumInsured) : '—'}</td><td>${s?.total ? `<b>${rm(s.total)}</b>` : '—'}</td><td>${state}</td>
        <td><button class="ghost" data-rm="${i}" aria-label="Remove">✕</button></td></tr>`;
    }).join('')}</table>` : '';
  $('#slipGo').disabled = !slips.some((r) => r.slip && (r.slip.status === 'quoted' || r.slip.status === 'check'));
}

$('#slipFiles').addEventListener('change', (e) => { addSlipFiles([...e.target.files]); e.target.value = ''; });
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addSlipFiles([...e.dataTransfer.files]); });
$('#slipList').addEventListener('click', (e) => { if (e.target.dataset.rm) { slips.splice(Number(e.target.dataset.rm), 1); drawSlips(); } });
$('#slipClear').addEventListener('click', () => { slips = []; drawSlips(); });

$('#slipGo').addEventListener('click', async () => {
  const body = {
    slips: slips.map((r) => r.slip).filter((s) => s && s.status !== 'error'),
    customer: { name: $('#slipName').value.trim(), phone: $('#slipPhone').value.trim(), regNo: $('#slipPlate').value.trim().toUpperCase() },
  };
  const r = await fetch('api/slips/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return;
  current = await r.json();
  document.querySelector('.tab[data-tab=quote]').click();
  renderFinal(current);
  $('#results').scrollIntoView({ behavior: 'smooth' });
});
