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

`npm run demo:rpa` starts a **practice insurer portal** at `/mock-portal` (user `agent01`, password `demo123`). It behaves like a real agent portal: login, ISM enquiry, sum insured range, calculate. A real bot logs in and quotes on it, so you can see the full RPA flow without touching a real insurer. Set `RPA_HEADED=1` to watch the browser.

If you open `public/index.html` without the server, it runs in **demo mode**: quotes are priced in the browser and history stays in that browser.

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

### Things to check per insurer

- **Permission:** confirm your agency agreement allows automated access to the portal, and use a dedicated agent login for the bot.
- **OTP / captcha at login:** the bot can't type an OTP. Ask the insurer for an OTP-exempt login on a whitelisted IP, or use their API.
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
