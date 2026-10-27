# Changelog

All notable changes to OfficeBuffet are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The version lives in `OfficeBuffet.csproj` (`<Version>`).

## [1.0.0] - 2026-10-28

First public release.

### For colleagues
- Sign in with the Iranian national ID (check digit validated). Sessions stay signed in on the device.
- Price list with current prices; free items marked as such.
- Send requests to the pantry with a note; up to 3 pending at a time; cancel until handled.
- "Nudge" button to ring the pantry manager again (2 nudges per request, 2 minutes apart).
- Notifications when a request is accepted ("seen, ready in a few minutes") or rejected (with the reason),
  plus an on-screen message and sound while the app is open.
- Own orders, payments, settlements and balance, by period.

### For the pantry manager
- Fast order entry for any colleague, on phone or desktop.
- Back-dated order entry (up to 60 days) for orders written on paper; the real entry time is kept.
- Request inbox with Pending / Handled tabs; accept turns a request into orders at current prices,
  reject requires a reason.
- Web Push notifications for new requests and nudges, with a distinctive chime and vibration in the open app.
- Payments, balances, and "settle up to a date".
- Reports by today, yesterday, this week, this month, last month or all time.
- Excel (.xlsx) / CSV import of items and people with column mapping, preview, de-duplication, price updates
  and a list of invalid national IDs.
- Multiple manager accounts, password change, light and dark themes.

### Platform
- ASP.NET Core 10 + EF Core / SQLite, migrations applied automatically at startup.
- Installable PWA (Persian, RTL, Jalali dates), bundled Vazirmatn font, works offline for the app shell.
- Self-contained Windows build; Windows service scripts and IIS `web.config` included.
- `tools/new-certificate.ps1` to create a private CA and HTTPS certificate for the office network.

[1.0.0]: https://github.com/Mohamadkhadem/OfficeBuffet/releases/tag/v1.0.0
