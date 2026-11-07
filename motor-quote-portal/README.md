# Motor Quote Compare

An internal portal for a motor insurance / takaful agency in Malaysia. Staff enter the customer's **IC, plate number and postcode**. An RPA bot looks the car up once, and then every panel insurer portal is quoted on the **same sum insured** at the same time. Prices appear as each insurer answers, ready to print or send on WhatsApp.

Today staff open each insurer's portal and re-type the same details, about 15 minutes per quotation. This portal replaces that with one short form.

## How it works

```
Staff: IC + plate + postcode + cover/add-ons
        │
        ▼
1. Lookup (once) ── RPA bot runs the ISM enquiry on one insurer portal
        │            → make, model, year, cc, NCD, recommended sum insured
        ▼
2. Quote (in parallel) ── one bot per insurer portal, all at once,
        │                 all using that same sum insured
        ▼
3. Results stream to the screen as each insurer answers (cheapest first),
   saved to history, then printed or sent on WhatsApp
```

This is the same pattern GoInsuran (Tan Chong) uses on its public quote page. The customer gives only ID type, IC, plate, postcode, name, email and mobile. Vehicle details, NCD and sum insured are looked up behind the scenes, and every insurer is quoted on that one sum insured.

**Same sum insured.** Each insurer only accepts a sum insured inside its own range, usually about ±10% of its valuation. If the shared amount falls outside that range, the bot quotes the nearest amount the insurer allows. The offer is then flagged on screen, on WhatsApp and on the printout, so staff and customers can see which offers used a different amount.

**Speed.** Each bot keeps its insurer portal logged in between quotes. Logging in is the slowest step, so after the first quote of the day an insurer usually answers in 2–3 seconds.

## Run it

Needs Node 18 or newer.

```bash
cd motor-quote-portal
npm install          # installs Playwright (used by the RPA bots)
npm start            # http://localhost:3000 — demo insurers only
npm run demo:rpa     # adds a live RPA bot against the practice portal
npm test             # engine, lookup flow and RPA bot tests
```

`npm run demo:rpa` starts a **practice insurer portal** in three styles: `/mock-portal/basic`, `/mock-portal/otp` (sends a 6-digit OTP after the password, like Zurich; the code is printed in the server log), and `/mock-portal/etiqa` (forces a password change at every login, then shows a splash notice, like Etiqa). Each behaves like a real agent portal: login, ISM enquiry, sum insured range, calculate. A real bot logs in and quotes on it, so you can see the full RPA flow without touching a real insurer. Set `RPA_HEADED=1` to watch the browser.

If you open `public/index.html` without the server, it runs in **demo mode**: quotes are priced in the browser and history stays in that browser.

## Reading quotation slips

`slips/parse.js` reads the quotation slip PDF that each insurer portal produces: basic premium, NCD, add-ons, gross, service tax, stamp duty, total, sum insured, excess, quote number, validity and "referred" status. It checks every slip adds up (basic − NCD + add-ons = gross; gross + tax + stamp duty = total) and flags any that don't.

It is tested against real slips from **Allianz, Generali, Berjaya Sompo, Takaful Malaysia, Takaful Ikhlas, P&O and MSIG** (also Etiqa and Zurich). The test data keeps only the price lines, with customer details removed. MSIG's PDF uses a font whose text comes out scrambled, so its digits are decoded and its figures are read by position, then checked by the sums.

It is used in two places:

1. **Upload slips tab**: staff drop in the slip PDFs they already download from the portals and get the comparison, quotation PDF and WhatsApp message straight away. No bots needed. Slips for different cars, or at different sums insured, are flagged.
2. **RPA bots**: each bot fills the portal form, downloads the slip and hands it to the same reader (see `providers/rpa/bots/_template.js`). The bot only drives the portal; reading and checking prices is shared and already tested.

## Connecting insurers

Each panel insurer is one entry in `public/engine/providers-config.js`. Its `mode` decides how it is quoted:

| mode | How | Use for |
|---|---|---|
| `rpa` | Built-in Playwright bot logs in to the insurer's agent portal and fills in the quotation form. | Insurers with only a web portal (most of them). |
| `webhook` | Calls a bot you already run in your own RPA tool (UiPath, Power Automate, Automation Anywhere) through its HTTP trigger. | If your RPA team already has bots for some portals. |
| `api` | Calls the insurer's agency API. | Insurers that give you API access. |
| `demo` | Sample pricing only. Never send these prices to customers. | Trying the portal. |

Mark **one** insurer `lookupSource: true`. Its portal does the IC + plate enquiry. Pick the fastest, most reliable portal.

### Adding an RPA bot for a real insurer portal

1. Copy `providers/rpa/bots/mock-portal.js` to, for example, `providers/rpa/bots/insurer-a.js`.
2. Open the insurer portal, go through one quotation by hand, and copy each field's selector into the bot. Use the browser's Inspect, or run `npx playwright codegen <portal-url>` to record the steps. A bot has four steps:
   - `login(page, creds)`
   - `isLoginPage(page)`: used to detect an expired session and log in again
   - `lookup(page, req)`: IC + plate → vehicle, NCD, recommended sum insured and its allowed range
   - `quote(page, req)`: sum insured, cover, add-ons, then read the premium breakdown
3. Register the bot in `providers/rpa/index.js` and set the insurer in `providers-config.js`:
   ```js
   { id: 'insurer-a', name: 'Insurer A', kind: 'conventional', mode: 'rpa', rpa: { bot: 'insurer-a' }, ... }
   ```
4. Put the login details in environment variables on the server, never in code:
   ```
   INSURER_A_PORTAL_URL=https://agent.insurer-a.com.my
   INSURER_A_PORTAL_USER=...
   INSURER_A_PORTAL_PASS=...
   ```

When a bot fails, the insurer's card shows the reason, and a screenshot of the portal at that moment is saved in `data/rpa-errors/` so the selector can be fixed. The other insurers still return their prices.

### Pacific & Orient (first live bot)

`providers/rpa/bots/po.js` is ported from the agency's working Python script and uses the same portal field names (`txtCurrRegNo`, `btnINFO`, `opPCCoInd`, `txtSumin`, `M2`, `M4`/`N4`, …). It searches every frame like the original, dismisses the DriveGuard pop-up, clicks "Main Menu" on the Message of the Day, and keeps the sum insured inside P&O's allowed range. It reports refer-risk cases with their R-codes. The price is read from the official slip in the "Print & Save Quotation" pop-up, which is also saved in `data/slips/`.

Differences from the Python script, on purpose:

- If the slip can't be printed, the quote fails with a clear error. It never builds its own "official" P&O PDF, and never works out gross or tax from the total.
- If the customer address is missing, the quote is declined with a message. It never types a made-up address.
- Refer-risk shows P&O's actual reasons. The old script had a fixed "lapsed for 557 days" message.
- Age comes from the IC, filled in by the portal itself, not from a hard-coded 2026.
- E-hailing asked for: declined (P&O doesn't offer it), instead of quietly quoting without it.

To switch it on: set `PO_PORTAL_USER` and `PO_PORTAL_PASS` (the old `PACIFIC_USERNAME` / `PACIFIC_PASSWORD`), set `enabled: true` on `po` in `PANEL`, and run one quote with `RPA_HEADED=1` to watch it. Cars made before 2012 are quoted TPFT (`PO_TPFT_BEFORE_YEAR`, your existing rule). It is tested against a practice copy of the P&O portal (`/mock-portal/po/`).

P&O's portal is off from 9pm to 5am. In those hours P&O is skipped straight away with "portal is closed, try again after 5am" (`hours: { closed: ['21:00', '05:00'] }`, Malaysia time) instead of waiting for a timeout.

### Allianz

`providers/rpa/bots/allianz.js` is ported from the agency's Selenium script, with the same pages and the same `nx-*` components and `formcontrolname` fields. It handles login, the concurrent-login pop-up (answers YES, which ends any other session on that login, so give the bot its own login), the secret question, Policy Management → Cover Note, the JPJ/ISM wait, the customer page, coverage and add-ons (e-hailing via ADD MORE → Private Hire), GET NO CLAIM DISCOUNT, and the e-Quotation PDF. Prices come only from that PDF; if it doesn't download, the quote fails. ENQ001 (already renewed elsewhere) is reported as such.

Needs: `ALLIANZ_PORTAL_USER`, `ALLIANZ_PORTAL_PASS`, `ALLIANZ_PORTAL_SECRET` (the secret answer). The customer's mobile, email and address are also needed, plus the "customer agreed to the privacy notice" tick on the form, because the bot answers Allianz's privacy declaration with it. `ALLIANZ_FALLBACK_EMAIL` lets the agency's email be used when the customer has none.

Every bot's slip is also checked against what was asked for: a requested add-on missing from the insurer's quotation is flagged (from the agency's `audit_and_sync_quote`).

### Takaful Ikhlas

`providers/rpa/bots/ikhlas.js` fills the Financial-Link "New Business" form with the same field names as the agency's script. It handles Black List Checking, renewal dates from the previous expiry, the ISM "Proposed Sum Covered" pop-up, NCD Enquiry (NCD 001 = already renewed elsewhere), Add Extra Benefit (windscreen `WSC`, flood `EP057`) and Get A Quote. **The price is read from Ikhlas's own quotation slip**; the bot never works out a contribution itself. If the slip doesn't appear, the quote fails.

The underwriting questions (claims in the last 3 years, traffic offences, driving experience, race, religion, occupation) come from **Driver details** on the form. If any are missing, Ikhlas is skipped with a message saying which. Customers with claims or offences are quoted by hand, so those details are entered properly. If the sum covered is outside Ikhlas's range, the bot retries with the nearest allowed amount and flags it.

Login: `IKHLAS_PORTAL_USER`, `IKHLAS_PORTAL_PASS` (the old `TAKAFUL_USERNAME` / `TAKAFUL_PASSWORD`).

### Paste a WhatsApp message

On the quote form, **Paste WhatsApp message** reads plate, IC / passport / company number, name, phone, email, address and postcode, model and year, and add-ons (windscreen, flood, e-hailing), in English or Malay, and fills the form. It is ported from the agency's `parse_customer_message`, but leaves anything not in the message empty for staff to fill instead of filling in a default.

### Portals with OTP (e.g. Zurich)

When a portal asks for a one-time code, the bot pauses and an **OTP box appears on the quote screen** of whoever is quoting. They type the code from the agency phone and the bot carries on. The bot then keeps that portal logged in with light activity every few minutes (`RPA_KEEPALIVE_MIN`, default 8), so staff are asked for an OTP rarely, usually once a day.

To skip typing, install an SMS-forwarding app on the phone that receives the OTP and point it at:

```
POST https://<portal>/api/otp/inbound?token=<OTP_INBOUND_TOKEN>
body: the SMS text (plain text, or JSON {"text": "..."})
```

The portal picks the code out of the message and passes it to the waiting insurer (matched by the insurer's name in the SMS). Set `OTP_INBOUND_TOKEN` to a long random value. Unanswered OTP requests expire after `OTP_TIMEOUT_MS` (default 3 minutes), and that insurer shows an error while the others still quote.

### Portals that force a password change (e.g. Etiqa)

When the portal demands a new password, the bot makes a strong one (14 characters with upper, lower, digit and symbol), **saves it encrypted before submitting it**, and marks it current once the portal accepts it. If the server stops halfway, the next login tries both the old and new password, so the login can't be lost. Splash notices are closed automatically (`closeSplash` in the bot).

Passwords live in `data/vault.json`, encrypted with `VAULT_KEY`. Set `VAULT_KEY` on the server and keep a copy of it somewhere safe.

```
npm run vault -- list            which insurers have a saved password, and when it last changed
npm run vault -- show etiqa      see the current password, to log in by hand
npm run vault -- set etiqa       after resetting it through the registered email
```

### E-hailing

Each insurer declares which e-hailing periods it sells, in `providers-config.js`:

```js
ehailing: { periods: ['annual'] }                 // Allianz: annual only
ehailing: { periods: ['annual'], fixed: 1950 }    // Generali: annual only, fixed RM1,950
ehailing: { periods: ['annual', '6m', '3m', '1m'] }
ehailing: false                                   // not offered: insurer declines
```

Staff pick the period on the form. An insurer that only sells annual is quoted annual, and the card and quotation say so.

### Your panel

`PANEL` in `providers-config.js` lists your insurers (Allianz, Generali, Zurich Takaful, Etiqa Takaful, Berjaya Sompo, Takaful Malaysia, Takaful Ikhlas, P&O, MSIG, Liberty) with what we know from their quotation slips: validity days, e-hailing rules, OTP, password change, splash screen. Each is switched off until its bot is written and tested against the live portal.

### Things to check per insurer

- **Permission:** confirm your agency agreement allows automated access to the portal, and use a dedicated agent login for the bot.
- **Captcha at login:** a bot can't solve a captcha. Ask the insurer for a captcha-free agent login or whitelisted IP, or use their API.
- **Portal changes:** when an insurer redesigns its portal, that bot needs new selectors. The error screenshots show where it broke.
- **One login, one session:** each bot runs one quote at a time per insurer. For busy periods, ask the insurer for extra agent logins.

## What staff see

- A short form: ID type (NRIC, passport or company), ID number, plate, postcode, name, mobile, cover type and add-ons.
- **Vehicle, NCD & sum insured** is auto-filled by the lookup. Staff only open it to override a value.
- Live cards: "Bot filling insurer portal…" until each price lands, then the cards are re-ranked with the cheapest first.
- Each offer shows basic premium, NCD, add-ons, gross premium, 8% SST, RM10 stamp duty, excess, insurer quotation number and commission. Commission is staff-only and never printed.
- **Print** or **Download PDF** produces a one-page A4 comparison of the ticked offers on your letterhead: the lowest price and saving at the top, a price bar for each insurer, a line-by-line breakdown, each insurer's quote validity, and the NRIC masked. The layout is in `public/quotation.js`, and agency details come from the `AGENCY_*` environment variables. **WhatsApp** and **Copy text** produce a short message for the customer.
- **History**: every comparison is saved, searchable by name, IC or plate, and can be re-quoted at renewal.

## Files

```
server.js                         API, quote streaming, static files
providers/index.js                picks the connector per insurer, runs the lookup
providers/rpa/pool.js             one logged-in browser session per insurer
providers/rpa/bots/*.js           one bot per insurer portal
providers/webhook-connector.js    bots in your own RPA tool
providers/api-connector.js        insurer APIs
mock-portal/                      practice insurer portal for building and testing bots
public/                           staff screen (index.html, app.js, styles.css)
public/engine/                    rating, lookup and compare logic (browser + server)
data/                             saved quotes and bot error screenshots (git-ignored)
```

## API

```
POST /api/quotes/stream   { owner, vehicle, cover } → one JSON event per line:
                          lookup → start → quote (per insurer) → done
POST /api/quotes          same, one reply at the end
GET  /api/quotes?q=VBK    saved comparisons
GET  /api/quotes/:id      one saved comparison
GET  /api/quotes/:id/pdf  one-page comparison PDF (?ids=insurer-a,insurer-b)
GET  /api/providers       panel insurers
```

## Before going live

1. Write bots for your panel insurers, starting with the ones you quote most and the one used for lookups.
2. Add staff login, for example behind the office VPN or SSO. IC numbers are personal data under the PDPA.
3. Run it on an office server or a small cloud VM in Malaysia, with Playwright installed.
4. Move history from the JSON file to a database (SQLite or Postgres) once several staff use it.
5. Next step after that: issue the cover note from the chosen offer with the same bot.
