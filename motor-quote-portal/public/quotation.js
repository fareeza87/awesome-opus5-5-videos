// Customer-facing comparison quotation: one A4 page, every insurer side by side.
// Returns a complete HTML document, used for print / PDF (browser and server).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rm = (n) => 'RM ' + num(n);
const rm0 = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 });
const TZ = 'Asia/Kuala_Lumpur';
const date = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }) : '—');
const COVER = { comprehensive: 'Comprehensive', tpft: 'Third Party, Fire & Theft', tp: 'Third Party Only' };

export function quotationHtml(comparison, { agency, ids } = {}) {
  const { request, results } = comparison;
  const { owner, vehicle, cover } = request;
  const offers = results.filter((o) => o.status === 'quoted' && (!ids || ids.includes(o.providerId)))
    .sort((a, b) => a.total - b.total);
  if (!offers.length) return '<p>No offers selected.</p>';

  const best = offers[0];
  const worst = offers[offers.length - 1];
  const saving = worst.total - best.total;
  const maxTotal = worst.total;
  const color = agency?.color || '#0b5cad';
  const issued = comparison.createdAt;
  const anyTakaful = offers.some((o) => o.kind === 'takaful');
  const premiumWord = anyTakaful ? 'Premium / contribution' : 'Premium';

  // Every add-on any insurer quoted, as rows.
  const addonRows = [];
  for (const o of offers) for (const a of o.addons || []) if (!addonRows.includes(a.label)) addonRows.push(a.label);
  const addonAmt = (o, label) => (o.addons || []).find((a) => a.label === label)?.amount;

  const cols = offers.map((o) => `<col class="${o === best ? 'best' : ''}">`).join('');
  const head = offers.map((o) => `<th class="ins ${o === best ? 'best' : ''}">
      ${o === best ? '<span class="ribbon">Lowest</span>' : ''}
      <span class="iname">${esc(shortName(o.provider))}</span>
      <span class="ikind ${o.kind}">${o.kind === 'takaful' ? 'Takaful' : 'Insurance'}</span></th>`).join('');
  const row = (label, fn, cls = '') => `<tr class="${cls}"><th>${label}</th>${offers.map((o) => `<td class="${o === best ? 'best' : ''}">${fn(o)}</td>`).join('')}</tr>`;
  const minOf = (fn) => Math.min(...offers.map(fn));

  const basicMin = minOf((o) => o.basic);
  const mark = (v, min) => (Math.abs(v - min) < 0.005 && offers.length > 1 ? `<b class="low">${num(v)}</b>` : num(v));

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Motor quotation ${esc(vehicle.regNo)}</title>
<style>
  :root { --brand: ${esc(color)}; --ink: #16202b; --muted: #5f6b78; --line: #dfe4ea; --soft: #f4f6f9; --good: #0f7a4a; --good-bg: #e7f5ee; --taka: #6a4cb8; }
  @page { size: A4; margin: 12mm 11mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; color: var(--ink); background: #fff; font: 9.3pt/1.4 "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 190mm; margin: 0 auto; }
  .band { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; background: var(--brand); color: #fff; border-radius: 10px; padding: 14px 18px; }
  .band h1 { margin: 0; font-size: 15pt; letter-spacing: -.01em; }
  .band p { margin: 2px 0 0; opacity: .85; font-size: 8.5pt; }
  .band .doc { text-align: right; }
  .band .doc b { display: block; font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; opacity: .85; }
  .band .doc span { font-size: 12pt; font-weight: 700; }

  .facts { display: grid; grid-template-columns: 1fr 1.35fr; gap: 10px; margin: 12px 0; }
  .box { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .box h2 { margin: 0 0 6px; font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
  .kv dt { color: var(--muted); } .kv dd { margin: 0; font-weight: 600; }
  .veh { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
  .plate { background: #111; color: #fff; font: 700 13pt/1 "Arial Narrow", Arial, sans-serif; letter-spacing: .08em; padding: 6px 10px; border-radius: 4px; border: 2px solid #111; outline: 1px solid #fff; outline-offset: -4px; white-space: nowrap; }
  .veh strong { font-size: 11pt; display: block; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }

  .hero { display: grid; grid-template-columns: 1.1fr 1fr; gap: 14px; align-items: center; background: var(--good-bg); border: 1px solid #bfe3cf; border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; }
  .hero .lbl { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: var(--good); font-weight: 700; }
  .hero .who { font-size: 11pt; font-weight: 700; margin-top: 2px; }
  .hero .amt { font-size: 22pt; font-weight: 800; letter-spacing: -.02em; color: var(--good); font-variant-numeric: tabular-nums; }
  .hero .save { font-size: 8.5pt; color: var(--muted); }
  .bars { display: grid; gap: 4px; }
  .bar { display: grid; grid-template-columns: 86px 1fr 50px 46px; gap: 6px; align-items: center; font-size: 7.8pt; }
  .bar i { display: block; height: 9px; border-radius: 5px; background: #c6d1dc; }
  .bar.best i { background: var(--good); }
  .bar span:nth-child(n+3) { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bar .d { color: var(--muted); }
  .bar span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
  .cmp th, .cmp td { padding: 4.5px 7px; border-bottom: 1px solid var(--line); }
  .cmp tbody th { text-align: left; font-weight: 500; color: var(--muted); white-space: nowrap; }
  .cmp td { text-align: right; }
  .cmp td.best { background: #f2faf6; }
  .cmp thead th { vertical-align: bottom; text-align: right; border-bottom: 2px solid var(--ink); position: relative; padding-top: 16px; }
  .cmp thead th.ins.best { background: var(--good-bg); border-radius: 8px 8px 0 0; }
  .iname { display: block; font-weight: 700; font-size: 8.8pt; line-height: 1.2; }
  .ikind { display: inline-block; margin-top: 3px; font-size: 6.8pt; font-weight: 600; padding: 1px 6px; border-radius: 9px; background: var(--soft); color: var(--muted); }
  .ikind.takaful { background: #efeafb; color: var(--taka); }
  .ribbon { position: absolute; top: 2px; right: 7px; font-size: 6.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--good); }
  .sec th { padding-top: 9px !important; font-size: 7pt !important; letter-spacing: .12em; text-transform: uppercase; color: var(--ink) !important; font-weight: 700 !important; border-bottom-color: var(--ink) !important; }
  .sec td { border-bottom-color: var(--ink); }
  .sub th { color: var(--ink) !important; font-weight: 600 !important; }
  .sub td { font-weight: 600; }
  .total th, .total td { font-size: 11pt; font-weight: 800 !important; color: var(--ink) !important; border-bottom: 2px solid var(--ink); padding-top: 7px; padding-bottom: 7px; }
  .total td.best { color: var(--good) !important; }
  .low { color: var(--good); }
  .muted { color: var(--muted); }
  .small td { font-size: 7.6pt; color: var(--muted); }
  .yes { color: var(--good); font-weight: 700; }

  .notes { display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; margin-top: 12px; font-size: 7.6pt; color: var(--muted); }
  .notes ul { margin: 0; padding-left: 14px; }
  .sign { border-top: 1px solid var(--line); padding-top: 8px; }
  .sign b { color: var(--ink); display: block; font-size: 8.5pt; }
  .foot { margin-top: 10px; display: flex; justify-content: space-between; font-size: 7pt; color: var(--muted); border-top: 1px solid var(--line); padding-top: 6px; }
</style></head><body><div class="sheet">

  <header class="band">
    <div><h1>${esc(agency?.name || 'Your Agency')}</h1><p>${esc(agency?.line || '')}</p><p>${esc(agency?.contact || '')}</p></div>
    <div class="doc"><b>Motor insurance comparison</b><span>Ref ${esc(comparison.id || '')}</span><p>Issued ${date(issued)}</p></div>
  </header>

  <section class="facts">
    <div class="box">
      <h2>Prepared for</h2>
      <dl class="kv">
        <dt>Name</dt><dd>${esc(owner.name || '—')}</dd>
        <dt>${owner.idType === 'company' ? 'Company no.' : owner.idType === 'passport' ? 'Passport' : 'NRIC'}</dt><dd>${esc(maskId(owner.nric, owner.idType))}</dd>
        ${owner.phone ? `<dt>Mobile</dt><dd>${esc(owner.phone)}</dd>` : ''}
        <dt>Postcode</dt><dd>${esc(owner.postcode)}</dd>
      </dl>
    </div>
    <div class="box">
      <h2>Vehicle &amp; cover</h2>
      <div class="veh"><span class="plate">${esc(vehicle.regNo)}</span>
        <div><strong>${esc(vehicle.make || '')} ${esc(vehicle.model || '')}</strong><span class="muted">${vehicle.year || ''} · ${vehicle.cc || ''}cc · ${vehicle.seats || 5} seats${vehicle.use ? ' · ' + esc(vehicle.use) : ''}</span></div></div>
      <div class="two">
        <dl class="kv"><dt>Cover</dt><dd>${COVER[cover.coverType] || esc(cover.coverType)}</dd>
          <dt>Sum insured</dt><dd>${cover.coverType === 'tp' ? '—' : rm0(cover.sumInsured)}</dd></dl>
        <dl class="kv"><dt>NCD</dt><dd>${cover.ncd}%</dd>
          <dt>Period</dt><dd>${cover.effectiveDate ? `${date(cover.effectiveDate)} – ${date(cover.expiryDate)}` : '12 months'}</dd></dl>
      </div>
    </div>
  </section>

  <section class="hero">
    <div>
      <div class="lbl">Lowest total payable</div>
      <div class="who">${esc(best.provider)}</div>
      <div class="amt">${rm(best.total)}</div>
      ${offers.length > 1 ? `<div class="save">${rm(saving)} less than the highest quote, from ${offers.length} insurers compared</div>` : ''}
    </div>
    <div class="bars">
      ${offers.map((o) => `<div class="bar ${o === best ? 'best' : ''}"><span>${esc(shortName(o.provider))}</span><i style="width:${(o.total / maxTotal * 100).toFixed(1)}%"></i><span>${num(o.total)}</span><span class="d">${o === best ? '' : '+' + num(o.total - best.total)}</span></div>`).join('')}
    </div>
  </section>

  <table class="cmp">
    <colgroup><col style="width:24%">${cols}</colgroup>
    <thead><tr><th></th>${head}</tr></thead>
    <tbody>
      <tr class="sec"><th>${premiumWord}</th>${offers.map(() => '<td></td>').join('')}</tr>
      ${row('Basic', (o) => mark(o.basic, basicMin))}
      ${offers.some((o) => o.loading) ? row('+ Loading', (o) => num(o.loading)) : ''}
      ${row(`− NCD ${cover.ncd}%`, (o) => '−' + num(o.ncdAmount))}
      ${addonRows.map((l) => row('+ ' + esc(l), (o) => (addonAmt(o, l) === undefined ? '<span class="muted">—</span>' : num(addonAmt(o, l))))).join('')}
      ${row('Gross', (o) => num(o.gross), 'sub')}
      ${offers.some((o) => o.discount) ? row('− Discount', (o) => num(o.discount)) : ''}
      ${row('+ Service tax 8%', (o) => num(o.sst))}
      ${row('+ Stamp duty', (o) => num(o.stampDuty))}
      ${row('Total payable (RM)', (o) => num(o.total), 'total')}
      <tr class="sec"><th>Terms</th>${offers.map(() => '<td></td>').join('')}</tr>
      ${row('Excess', (o) => (o.excess ? num(o.excess) : 'Nil'))}
      ${row('Quote valid until', (o) => date(o.validUntil))}
      ${offers.some((o) => o.benefits?.length) ? row('Highlights', (o) => (o.benefits || []).map(esc).join('<br>'), 'small') : ''}
      ${offers.some((o) => o.insurerRef) ? row('Insurer quote no.', (o) => esc(o.insurerRef || '—'), 'small') : ''}
    </tbody>
  </table>

  <section class="notes">
    <ul>
      <li>All amounts in RM and include 8% service tax and RM10 stamp duty.</li>
      <li>Prices are quoted directly by each insurer / takaful operator on the same vehicle details and sum insured, and are subject to their underwriting acceptance and ISM NCD confirmation.</li>
      <li>Each quote is valid until the date shown under its insurer. Policy terms are in each insurer's Product Disclosure Sheet, available on request.</li>
      ${anyTakaful ? '<li>Takaful plans: the customer confirms the vehicle is not used for Shariah non-compliant business.</li>' : ''}
    </ul>
    <div class="sign"><b>${esc(agency?.agent || 'Your insurance advisor')}</b>${esc(agency?.contact || '')}<br>Reply with the insurer's name to proceed.</div>
  </section>
  <div class="foot"><span>${esc(agency?.name || '')} · Ref ${esc(comparison.id || '')}</span><span>Prices retrieved ${new Date(issued).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })}</span></div>
</div></body></html>`;
}

function shortName(name) {
  return String(name)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+(General\s+)?(Insurance\s+|Takaful\s+)?(Malaysia\s+)?(Berhad|Bhd\.?)$/i, '')
    .trim() || name;
}

// Show only the last 4 digits of an NRIC on paper.
function maskId(id, type) {
  if (!id) return '—';
  if (type && type !== 'nric') return id;
  const d = String(id).replace(/\D/g, '');
  return d.length === 12 ? `XXXXXX-XX-${d.slice(8)}` : id;
}
