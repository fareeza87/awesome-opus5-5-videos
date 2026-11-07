# Motor Quote Compare

An internal portal for a motor insurance / takaful agency in Malaysia. Staff enter the customer and vehicle **once**. The portal then asks every panel insurer at the same time and shows the offers side by side, ready to print or send on WhatsApp.

Today staff open each insurer's portal and re-type the same details, about 15 minutes per quotation. This portal replaces that with one form and one click.

## What it does

- **One form**: customer (name, NRIC, postcode), vehicle (plate, make/model, year, cc), and cover (comprehensive / TPFT / TP, sum insured, market or agreed value, NCD, add-ons, named drivers).
- **Quick pick** of popular Malaysian models fills the cc, seats and an estimated market value.
- **Asks all insurers at once**, with a 30-second timeout each. If one insurer fails or declines, the others still show.
- **Side-by-side offers** ranked by total payable, with the lowest marked. Each offer shows basic premium, NCD, add-ons, gross premium, 8% SST, RM10 stamp duty, excess and the agency's commission (staff only).
- **Printable quotation** (save as PDF) for the offers you tick, under your agency's letterhead. Commission is never printed.
- **WhatsApp / copy text** sends a short summary straight to the customer's number.
- **History**: every comparison is saved, can be searched by name, NRIC or plate, and can be re-opened or re-quoted at renewal.
- Works on phones as well as desktops.

## Run it

Needs Node 18 or newer. There are no packages to install.

```bash
cd motor-quote-portal
npm start            # http://localhost:3000
npm test             # rating engine tests
```

If you open `public/index.html` without the server (for example as a static page), it runs in **demo mode**: quotes are priced in the browser and history is kept in that browser only.

## How insurers are connected

Each panel insurer is one entry in `public/engine/providers-config.js`. Its `mode` decides how the server gets a quote:

| mode | How it works | When to use |
|---|---|---|
| `demo` | Priced locally from the tariff base × that insurer's factors (base rate, old-car loading, young-driver loading, region, agreed value, add-on pricing, maximum vehicle age, maximum sum insured, e-hailing appetite). | Now, and for insurers whose rate guide you can mirror. |
| `api` | `providers/api-connector.js` calls the insurer's agency API. Edit `toInsurerFormat` / `fromInsurerFormat` for that insurer. | When an insurer gives you API access. |
| `portal` | `providers/portal-connector.js` logs in to the insurer's agent portal with a headless browser (Playwright) and fills in the quotation form, the same way staff do by hand. | Insurers with no API. Check your agency agreement allows automated access first. |

Credentials always come from environment variables, never from the code. For example, the insurer with id `insurer-a` uses:

```
INSURER_A_API_URL=...      INSURER_A_API_KEY=...
INSURER_A_PORTAL_URL=...   INSURER_A_PORTAL_USER=...   INSURER_A_PORTAL_PASS=...
```

**To add a real insurer:**

1. Rename an entry in `providers-config.js`, for example `{ id: 'insurer-a', name: 'Allianz', kind: 'conventional', mode: 'api', ... }`.
2. Set its environment variables.
3. For `portal` mode, run `npm install playwright` and replace the CSS selectors in `portal-connector.js` with that portal's own. Copy the file once per insurer.

## Rating basics used in demo mode

These are in `public/engine/tariff.js`.

- The base is the former PIAM private-car tariff, with Peninsular and East Malaysia (Sabah, Sarawak, Labuan by postcode) tables and 8 cc bands. Comprehensive is the first RM1,000 plus RM26 (Peninsular) or RM20.30 (East) for each further RM1,000. TPFT is 75% of comprehensive. TP has its own table.
- NCD steps: 0 / 25 / 30 / 38.33 / 45 / 55%.
- SST is 8% of the gross premium. Stamp duty is RM10.
- Add-ons:
  - windscreen: 15% of the windscreen sum insured
  - special perils: 0.5% of the sum insured
  - SRCC: 0.3% of the sum insured
  - legal liability of passengers: RM7.50
  - legal liability to passengers: per seat
  - all drivers: RM20
  - additional named drivers: RM10 each
  - e-hailing: 15% of the basic premium
  - CART: flat fee
- Driver age comes from the NRIC. An extra RM400 excess applies to drivers under 21.

**The demo insurer profiles and prices are placeholders, not real insurer rates.** Do not send them to customers until each insurer is connected through its API or portal, or has been tuned against its current rate guide.

## Files

```
server.js                     API + static files (no dependencies)
providers/                    connectors: demo, api, portal
public/index.html, app.js     staff UI
public/styles.css             UI and print layout for the quotation
public/engine/                rating engine shared by browser and server
public/data/vehicles.js       sample vehicle list for quick pick
data/quotes.json              saved comparisons (created at runtime, git-ignored)
test/engine.test.js           tests
```

## API

```
GET  /api/providers           panel insurers
POST /api/quotes              { owner, vehicle, cover } → ranked results (saved)
GET  /api/quotes?q=VBK        recent comparisons, searchable
GET  /api/quotes/:id          one saved comparison
```

## Next steps before going live

1. **Connect the panel insurers**, starting with the ones you quote most often.
2. **Add staff login.** Put the portal behind your office VPN or SSO. NRIC numbers are personal data under the PDPA.
3. **Look up vehicle data** (market value from the ISM/ABI valuation, NCD confirmation from ISM) to replace the manual sum insured and NCD.
4. **Move history to a proper database** (Postgres/SQLite) once several staff use it at the same time.
5. **Issue cover notes** from the chosen offer, using the same connectors.
