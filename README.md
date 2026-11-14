<div align="center">

<img src="wwwroot/icons/icon.svg" width="96" height="96" alt="OfficeBuffet logo">

# OfficeBuffet · بوفه

**A self-hosted office pantry app: staff order breakfast and drinks from their phones, every item is recorded, and everyone's tab stays transparent.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f8f46.svg)](LICENSE)
![.NET 10](https://img.shields.io/badge/.NET-10-512bd4.svg)
![PWA](https://img.shields.io/badge/PWA-installable-2f8f46.svg)
![UI: Persian / RTL](https://img.shields.io/badge/UI-Persian%20%C2%B7%20RTL-555.svg)


<p align="center">
  <a href="https://www.coffeebede.com/mohammadkhadem" target="_blank" rel="noopener noreferrer">
    <img
      src="https://raw.githubusercontent.com/Mohamadkhadem/mohammadkhadem.github.io/main/Mohammad%20Khadem_files/buy-me-a-coffee.svg"
      alt="Buy me a coffee - Support my open-source projects"
      width="100%"
    />
  </a>
</p>


**English** · [فارسی](README.fa.md)

</div>

---

OfficeBuffet replaces the paper notebook in a company pantry (Persian: *buffet* / *ābdārkhāne*). The person
running the pantry records what each colleague takes. Colleagues send requests ("one coffee, room 203") from
their desks, and everyone can see their own consumption and balance at any time. At the end of the month,
accounts are settled up to a date with a full, tamper-evident history.

It is built for offices in Iran: the interface is Persian and right-to-left, dates are in the Solar Hijri
(Jalali) calendar, amounts are in Toman, and colleagues sign in with their Iranian national ID (*kod-e melli*),
which is checked against its check digit. It runs entirely on your own server inside the office network.

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [HTTPS, installing on phones, and notifications](#https-installing-on-phones-and-notifications)
- [Data and backups](#data-and-backups)
- [How the bookkeeping works](#how-the-bookkeeping-works)
- [Security notes](#security-notes)
- [Development](#development)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Features

### For colleagues

- **Sign in with the national ID only:** no password to remember. Stay signed in on that device.
- **Price list:** every active item with today's price. Free items are clearly marked.
- **Requests from the desk:** pick items and add a note. The pantry manager's phone rings.
- **"Nudge" button 👋:** if a request is taking long, ring the manager again. The limit is two nudges, at least
  two minutes apart. After that the app suggests walking over.
- **Answers as notifications:** "☕ Your request was seen and will be ready in a few minutes", or
  "✋ Rejected, with the reason".
- **Payment receipts:** send a photo of the bank receipt with the amount from the «ثبت فیش» tab and follow its
  status; the manager approves it and the payment is recorded.
- **Own account only:** each person sees their own orders, payments, settlements and balance, and nobody
  else's.

### For the pantry manager

- **Fast order entry** on phone or desktop: pick a person, tap items, done.
- **Back-dated entry:** orders written on paper while the app was unavailable can be entered later for the
  day they happened, up to 60 days back. The real entry time is kept next to them.
- **Request inbox** with *Pending* and *Handled* tabs. Accepting turns a request into orders at current prices.
  Rejecting asks for a reason that the colleague will see.
- **Alerts:** push notifications on the manager's phone even when the app is closed, plus a distinctive chime
  and vibration while it is open.
- **Payments and settlements:** record payments and see every balance. Settle a person's account *up to a
  date*, for example the end of the month.
- **Reports** for today, yesterday, this week, this month, last month or all time, per person or for everyone.
- **Excel / CSV import** of items and people with column mapping and a preview. Nothing is duplicated
  (Arabic ي/ك and Persian ی/ک are treated as the same letter) and existing prices are updated. Invalid or
  duplicate national IDs are listed for fixing, and leading zeros dropped by Excel are restored.
- **Menu categories with hours and staff groups:** define your own menu sections (breakfast, drinks, …), give a
  section opening hours (colleagues can only request from it in that window; the server enforces it) and/or
  limit it to one staff group. Staff groups are defined on the people page; each person is in one group or none.
- **Debt per card:** each menu category can be tied to a bank card, so a balance is shown split by card
  (for example total 10,000 = card A 4,000 + card B 6,000); categories without a card count as "other". A payment
  can be recorded to a card; a payment without a card pays off card debts in order.
- **Edit and undo requests:** the manager can change a pending request (fewer/more of an item, remove or add
  items) before accepting it, and can undo an accepted or rejected request: the orders it created are voided
  (kept in history) and it goes back to pending.
- **Receipt review:** receipts colleagues send arrive in the «بررسی فیش‌ها» tab with the photo; approve to record
  the payment or reject with a reason. Duplicates are refused or flagged.
- **Settlement drive:** "Start settlement" on the payments page, up to a chosen date, notifies only the people
  who owe for purchases up to that day; until "End settlement" they cannot send any request (free items
  included). Orders after that day block nobody. The server enforces it.
- **Bank cards:** define the cards colleagues pay into, each with a title (for example "Breakfast card"). They
  appear under each colleague's balance, and tapping a number copies it.
- Multiple manager accounts, password change, and light and dark themes.

### Built to be trusted

- **Nothing is ever deleted.** Mistakes are *voided* with a reason, and who voided what and when stays in the
  history.
- **Prices are frozen at order time:** a later price change never rewrites old bills.
- **Your server, your data:** a single SQLite file, with no external services required. The only exception is
  push notifications, which go through the browser vendors' push services.
- **Lightweight:** a framework-free installable PWA, with the Vazirmatn font bundled so it renders correctly
  offline.

## Tech stack

| Layer | Technology |
|---|---|
| Server | ASP.NET Core 10 Minimal API |
| Data | Entity Framework Core 10 + SQLite, schema managed by EF migrations (applied automatically at startup) |
| Auth | Cookie authentication (persistent, sliding), PBKDF2 password hashing, rate-limited login |
| Front end | Vanilla HTML/CSS/JavaScript PWA with a service worker and web app manifest, no build step |
| Notifications | Standard Web Push (RFC 8291 encryption, RFC 8292 VAPID), implemented without third-party packages |
| Import | Built-in `.xlsx` and CSV reader (UTF-8 or Windows-1256) |
| Hosting | Windows service, IIS, or any platform that runs .NET 10 |

## Quick start

**Just want to run it?** Download `OfficeBuffet-<version>-win-x64.zip` from the
[latest release](https://github.com/Mohamadkhadem/OfficeBuffet/releases/latest), unzip it and run
`OfficeBuffet.exe`. No .NET installation is needed. See [Deployment](#deployment) to run it as a service.

**From source**, with the [.NET 10 SDK](https://dotnet.microsoft.com/download):

```bash
git clone https://github.com/Mohamadkhadem/OfficeBuffet.git
cd OfficeBuffet
dotnet run
```

Open <http://localhost:5080>. On first run:

1. Choose **ورود مسئول بوفه** (manager sign-in) and create the first manager account. This form only appears
   while no account exists, so do it right after installing.
2. Add items and prices under **کالاها**, and people with their national IDs under **افراد**. You can also
   import both from Excel.
3. Colleagues open the same address from their phones and sign in with their national ID.

The app listens on all network interfaces, so phones on the office network can reach it at
`http://<server-ip>:5080`. You may need to allow port 5080 in the firewall.

## Configuration

Settings can come from `appsettings.json`, environment variables, or command-line arguments
(`--Key=value`).

| Key | Default | Purpose |
|---|---|---|
| `Urls` | `http://0.0.0.0:5080` | Addresses to listen on, for example `http://0.0.0.0:80;https://0.0.0.0:443` |
| `DbPath` | `App_Data/officebuffet.db` | SQLite database file. Login keys and the push key are stored in the same folder. |
| `Push:Subject` | `mailto:officebuffet@example.com` | Contact URI sent to push services (VAPID `sub`). Set it to a real address. |
| `Kestrel:Certificates:Default:Path` / `:Password` | – | HTTPS certificate when Kestrel serves HTTPS directly |

If a `certs/kestrel.json` file exists next to the app (for example one created by
`tools/new-certificate.ps1`), it is loaded automatically.

## Deployment

Release builds are self-contained, so the server does not need .NET installed (except when hosting on IIS):

```bash
dotnet publish -c Release -r win-x64 --self-contained -o publish/OfficeBuffet
```

Copy the folder to the server, then choose one of:

- **Windows service (recommended):** run `install-service.ps1` as Administrator. It starts with Windows,
  restarts on failure, and opens the firewall port.
- **IIS:** install the ASP.NET Core 10 Hosting Bundle, point a site at the folder (`web.config` is included),
  and set the app pool to *No Managed Code*.
- **Manual:** just run `OfficeBuffet.exe`.

The step-by-step guide, including updating, moving existing data, and backups, is in
[`deploy/DEPLOY.md`](deploy/DEPLOY.md) (Persian). The `App_Data` and `certs` folders are never included in a
build, so deploying an update cannot overwrite the server's data or keys.

## HTTPS, installing on phones, and notifications

Everything works over plain `http`. Browsers only allow two features on `https` (or `localhost`):
installing the app to the home screen as a standalone app, and push notifications.

On an office network without a public domain, you can either:

- put the app behind IIS or a reverse proxy with a certificate your devices already trust, or
- run `tools/new-certificate.ps1`. It creates a small private CA and a server certificate for the server's IP
  addresses, then deletes the CA's private key right after signing. Install `certs/officebuffet-ca.cer` once on
  each phone. On iPhone, also enable it under *Settings → General → About → Certificate Trust Settings*.

Push notifications have a few more requirements:

- The server needs outbound internet access to the browser push services: `fcm.googleapis.com`,
  `*.push.apple.com` and `*.push.services.mozilla.com`.
- iPhone needs iOS 16.4 or later, and the app must be opened from its Home Screen icon.
- Each person turns notifications on once per device: the manager for new requests and nudges, colleagues for
  answers to their requests.

Without push, an open app still announces new requests and answers with a sound and an on-screen message.

## Data and backups

Everything lives in the data folder (`App_Data` by default):

| File | Contents | If lost |
|---|---|---|
| `officebuffet.db` | All business data | Restore from backup |
| `receipts/` | Receipt photos colleagues upload with a payment (files, not in the database) | Payments stay; their photos can't be viewed |
| `keys/` | Keys that encrypt login cookies | Everyone has to sign in again |
| `vapid.json` | Web Push key pair | Notifications must be turned on again on each device |

To back up, copy the folder while the app is stopped. Installs from before the project was renamed keep using
their existing `officebite.db` automatically.

## How the bookkeeping works

- **Balance** = consumption − payments since the person's latest settlement. A positive balance means they
  owe money.
- **Settle up to a date:** closes all of a person's orders and payments up to the end of that Jalali date,
  regardless of how much was paid. The amount cleared is stored for the record, and consumption reports are not
  affected.
- **Void, never delete:** orders, payments and settlements are voided with a reason. Items or people with
  history can be deactivated but not deleted.
- **Requests** only affect anyone's account once the manager accepts them. A colleague can have at most three
  pending requests and can cancel a request until it is handled.

## Security notes

OfficeBuffet is designed for a **trusted office network**, not the open internet.

- Colleagues sign in with their national ID alone, without a password. Anyone who knows a colleague's national
  ID can sign in as that colleague: view their records, send requests or report receipts in their name (both
  still need the manager's approval). Every sign-in is recorded with time, IP and device in the security log
  (Settings), and 10 wrong national IDs lock that device out for 30 minutes. Deactivating a person or changing
  their national ID revokes their access immediately.
- Manager passwords: at least 8 characters, PBKDF2-SHA256 with 600,000 iterations (older hashes are upgraded at the
  next sign-in). 5 wrong passwords lock the account for 15 minutes. Changing the password signs out every other
  device of that account.
- Cookies are `HttpOnly`, `SameSite=Strict` (and `Secure` over HTTPS). Every data route requires sign-in; only
  sign-in and first-run setup are public. Every state-changing call must come from the app's own page (an
  `X-Buffet` header plus an Origin check), so another site or app on the same host can't act for a signed-in user.
- Strict Content-Security-Policy (no inline scripts), no framing, `nosniff`, `Referrer-Policy: no-referrer`, and
  HSTS when `Security:RequireHttps` is on.
- Receipts: only well-formed JPEG/PNG/WebP up to 3 MB, stored under random names outside `wwwroot`, served with
  `Content-Security-Policy: sandbox`. The same photo is never accepted twice; same-amount receipts of one person
  within a week are flagged for the manager. Approving is atomic: a double click records one payment.
- The security log (sign-ins, bank cards, manager accounts, prices, national IDs) is append-only: database
  triggers refuse UPDATE and DELETE.
- Push notifications are only sent to real browser push services (Google, Mozilla, Apple, Microsoft).
- Uploaded spreadsheets are parsed defensively: size limits, no DTD processing, and zip-bomb checks.
- On Windows the cookie keys in `App_Data/keys` are encrypted with the machine's DPAPI, so a copy of `App_Data`
  (e.g. a backup) can't be used to forge a sign-in.
- Never commit `App_Data/` or `certs/`. Both are in `.gitignore`.

If you find a vulnerability, please report it privately to the maintainers instead of opening a public issue.

## Development

```bash
dotnet run                     # http://localhost:5080
dotnet build -c Release        # compile check
```

There is no front-end build step. Edit the files in `wwwroot/` and reload. When you change cached front-end
files, bump the `CACHE` version in `wwwroot/sw.js` so installed apps pick up the change.

To change the database schema, edit `Data/Models.cs` and add a migration. It is applied automatically on the
next start, and existing data is kept.

```bash
dotnet tool restore
dotnet tool run dotnet-ef migrations add <Name> -o Data/Migrations
```

In Visual Studio, the `https` launch profile serves `https://localhost:7080` and `http://localhost:5080`.

**Releasing:** bump `<Version>` in `OfficeBuffet.csproj`, which is shown in the app under Settings → About.
Add an entry to [CHANGELOG.md](CHANGELOG.md), tag the commit as `vX.Y.Z`, and attach the self-contained zip to a
GitHub release.

## Project structure

```
Program.cs                    Startup: database, cookie auth, rate limiting, Web Push, routes
Data/
  Models.cs                   Entities: Person, Item, Order, Payment, Settlement, PantryRequest, …
  AppDb.cs                    EF Core context and model configuration
  Migrations/                 EF Core migrations (applied at startup)
Endpoints/
  AuthEndpoints.cs            Sign-in for managers and colleagues, first-run setup, password change
  AdminEndpoints.cs           Items, people, orders, payments, settlements, manager accounts
  RequestEndpoints.cs         Colleague requests, nudges, accept/reject, push subscriptions
  ReportEndpoints.cs          Summaries, entries, price list
  ImportEndpoints.cs          Excel/CSV import with preview
Services/
  WebPush.cs                  Web Push sender (RFC 8291 / RFC 8292)
  Spreadsheet.cs              .xlsx / CSV reader
  NationalCode.cs             Iranian national ID normalization and check digit
  Passwords.cs                PBKDF2 password hashing
wwwroot/                      The PWA: index.html, js/app.js, css/app.css, sw.js, manifest, icons, font
deploy/                       Deployment guide and Windows service scripts (copied into release builds)
tools/new-certificate.ps1     Creates a private CA and server certificate for HTTPS on the office network
```

## Contributing

Issues and pull requests are welcome.

- Keep the scope: a simple, self-hosted tool for an office pantry.
- Keep the front end dependency-free and the UI in Persian and right-to-left.
- Database changes go through EF migrations, and existing data must survive upgrades.
- Before opening a pull request, run `dotnet build -c Release` and try the affected screens on a phone-sized
  window.

## License

[MIT](LICENSE). Bundled third-party components (the Vazirmatn font, which uses the SIL OFL 1.1 license, and
the jalaali-js algorithm, which uses the MIT license) are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
