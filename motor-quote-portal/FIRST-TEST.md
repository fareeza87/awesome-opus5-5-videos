# First test on the real portals (office PC)

About 20 minutes. Do it during office hours: P&O's portal is closed 9pm–5am.

## 1. Install (once)

1. Install **Node.js 20 LTS** from nodejs.org (Windows installer, all defaults).
2. On GitHub, open the repository, switch to the branch `claude/friendly-allen-e0l0fp`, then **Code → Download ZIP**. Unzip it.
3. Open the `motor-quote-portal` folder, click the address bar, type `cmd`, press Enter. In that window:

```
npm install
npx playwright install chromium
```

## 2. Settings

1. Copy `.env.example` to a new file named `.env` in the same folder.
2. Open `.env` in Notepad and fill in:
   - `INSURERS=po` (start with one insurer; add `allianz` and `ikhlas` once P&O works)
   - the login for that insurer (e.g. `PO_PORTAL_USER`, `PO_PORTAL_PASS`)
   - `VAULT_KEY=` any long random text
   - keep `RPA_HEADED=1` so you can watch the bot
   - `PORTAL_PASSWORD=` a password for staff
3. `.env` holds passwords: don't email it, WhatsApp it or put it on GitHub.

## 3. Run

```
npm start
```

Open http://localhost:3000 in Chrome on that PC. On staff phones (same Wi-Fi), open the address the window shows after "Staff on the office Wi-Fi", e.g. `http://192.168.1.20:3000`. If phones can't open it, allow Node.js through Windows Firewall (Windows asks the first time; tick "Private networks").

Use a real renewal you were going to quote anyway:

1. Tap **📷 Car grant / old policy** and snap the geran, or paste the customer's WhatsApp message, or type IC, plate, postcode, name, mobile and **address** (P&O needs it).
2. For Allianz: tick "Customer agreed to the privacy notice" and add the email.
3. For Takaful Ikhlas: fill in **Driver details** (claims, offences, driving experience, race, religion, occupation).
4. Click **Get quotes** and watch the bot's browser window.

## Phones outside the office (ngrok)

Stop the old bot server first (it uses port 5000). With `PORT=5000` in `.env`, your usual command opens the new portal instead:

```
.\ngrok.exe http 127.0.0.1:5000 --url childcare-routine-enviable.ngrok-free.dev --log stdout
```

Staff open https://childcare-routine-enviable.ngrok-free.dev on any phone, tap "Visit Site" on ngrok's notice, then sign in with `PORTAL_PASSWORD`. Set a strong password: this address is open to the whole internet.

## 4. Check

- Compare the price on the screen with the insurer's slip saved in `data\slips\`. They must match.
- If a bot stops, the card shows the reason and a screenshot is saved in `data\rpa-errors\`. Send me the message and the screenshot (blank out the customer's IC first).
- Note how long each insurer took: the card shows the seconds.

## Turning on more insurers

Add them to `.env`, e.g. `INSURERS=po,allianz,ikhlas`, then stop the server (Ctrl+C) and run `npm start` again.
