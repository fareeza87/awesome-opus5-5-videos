// Practice copy of the Atome Merchant Center (portal.atome.my), from the
// selectors in the agency's Atome script. Login agent01 / demo123.
import { randomUUID } from 'node:crypto';

const B = '/mock-portal/atome';
const sessions = new Set();
const page = (b) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px Arial;margin:20px}.ant-modal{position:fixed;top:60px;left:60px;background:#fff;border:2px solid #333;padding:16px;width:420px}.ant-select-dropdown{border:1px solid #999;margin-top:4px}.ant-select-item-option{padding:4px;cursor:pointer}.ant-select-selector{border:1px solid #999;padding:4px;cursor:pointer}</style></head><body>${b}</body></html>`;

export async function handleAtomePortal(req, res, url, readForm) {
  const p = url.pathname.slice(B.length) || '/';
  const html = (b, s = 200) => { res.writeHead(s, { 'content-type': 'text/html' }); res.end(page(b)); };
  const sid = /at_sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  if (p === '/login') {
    if (req.method === 'POST') {
      const f = await readForm(req);
      if (f.username === 'agent01' && f.password === 'demo123') {
        const id = randomUUID(); sessions.add(id);
        res.writeHead(302, { 'set-cookie': `at_sid=${id}; Path=${B}`, location: `${B}/main/dashboard` }); return res.end();
      }
      return html('<p>Username or password incorrect</p><a href="login">Back</a>');
    }
    return html(`<form method="post" action="${B}/login"><input name="username"> <input name="password" type="password"> <button>Log in</button></form>`);
  }
  if (!sid || !sessions.has(sid)) { res.writeHead(302, { location: `${B}/login` }); return res.end(); }
  if (p === '/main/dashboard') return html('<p>Merchant Center</p>');
  if (p === '/main/payments/payment-link') {
    return html(`<h3>Payment Link</h3><button id="create">Create Payment Link</button>
      <table><tr><td>OLDCAR1</td><td>RM 999.00</td><td>https://gateway.atome.my/pay/OLD999OTHERCUSTOMER</td></tr></table>
      <script>
        create.onclick = () => {
          const m = document.createElement('div'); m.className = 'ant-modal';
          m.innerHTML = '<p>Outlet <span class="ant-select-selector" id="outletId">Select outlet</span></p><p>Amount <input id="amount"></p><p>Order ID <input id="ecomOrderId"></p><button id="mk">Create Link</button><div id="out"></div>';
          document.body.append(m);
          m.querySelector('#outletId').onclick = () => {
            const d = document.createElement('div'); d.className = 'ant-select-dropdown';
            d.innerHTML = ['Other Outlet (KL)', 'MetaFin (PJ - Phileo Damansara II)'].map((o) => '<div class="ant-select-item-option">' + o + '</div>').join('');
            d.onclick = (e) => { m.querySelector('#outletId').textContent = e.target.textContent; d.remove(); };
            m.querySelector('#outletId').after(d);
          };
          m.querySelector('#mk').onclick = () => {
            const a = m.querySelector('#amount').value, o = m.querySelector('#ecomOrderId').value;
            if (!/MetaFin/.test(m.querySelector('#outletId').textContent) || !(+a > 0) || !o) { m.querySelector('#out').innerHTML = '<div class="ant-form-item-explain-error">Please fill in all fields</div>'; return; }
            setTimeout(() => { m.querySelector('#out').innerHTML = '<p>Payment link created</p><input value="https://gateway.atome.my/pay/' + o + '-' + Math.random().toString(36).slice(2, 10) + '">'; }, 600);
          };
        };
      </script>`);
  }
  res.writeHead(404); res.end();
}
