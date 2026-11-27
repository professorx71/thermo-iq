# For Next Upgrade — ThermoIQ recommendations

Written 2026-11-27, after release v6.3.0.

**How to start an update:** tell Claude the item numbers, e.g. *"do U3, U9 and U14"*. Tick `[x]` when an item is done.
Items marked **(you)** are settings or commands you can do yourself without a release.

## A. Finish what is already started
- [x] **U1 — Turn on the domain `thermoiq.octaveworks.com`.** Run `cloud/add_domain.sh` on the server. DNS is ready, but the site is still reached by IP address.
- [x] **U2 — Make the Settings login cookie HTTPS-only.** Do this after U1, so the sign-in cookie is never sent over plain HTTP.
- [ ] **U3 — Report sender `reports@octaveworks.com`** (you). Run `windows\SET_SENDER_EMAIL.bat --report --email reports@octaveworks.com --host mail.octaveworks.com`, then click *Email Report Now*.
- [x] **U4 — Update the GitHub address** (you). Run `git remote set-url origin git@github.com:professorx71/thermo-iq.git`. The repository has moved.

## B. Alarm reliability (food-safety risk)
- [ ] **U5 — Review the alarm schedules** (you). Some loggers had Thursday OFF, and schedules ending at 05:59 leave a one-minute gap each day. Consider 24 h ON for coolers.
- [ ] **U6 — Check Tortilla L3 Cooler** (you). It had been in alarm for about 33 days. Fix the cooler, or correct its limit or mode.
- [ ] **U7 — Add text-message recipients** (you). There are none yet, so email is the only alert.
- [ ] **U8 — "No data" alarm.** Email when a logger sends no readings for 30+ minutes, or when the LI-COR connection fails.
- [ ] **U9 — Outside "is the server alive" check.** An uptime monitor emails if the whole site goes down, because then no alarm can be sent at all.
- [ ] **U10 — Alarm escalation.** If an alarm is not acknowledged within, for example, 30 minutes, also email or text a supervisor list.

## C. Logins and security
- [ ] **U11 — Stay signed in across updates.** Sessions and the wrong-password lockout currently reset on every deploy or restart.
- [ ] **U12 — Require a login to acknowledge alarms.** This becomes a new right in *Rights for each role*, so the Audit log shows who really acknowledged.
- [ ] **U13 — Back up user logins safely.** `users.json` and `role_rights.json` are not in the backup ZIP. Add an encrypted copy.
- [ ] **U14 — Remove the old Operator tool** (`SET_OPERATOR_PASSWORD.bat`) and the `OPERATOR_*` lines in `.env`. They no longer control sign-in.
- [ ] **U15 — Admin "forgot password" note in Settings.** It shows the one server command to reset the Admin login.

## D. Reports and records
- [ ] **U16 — Calibration-due reminder email**, 14 days before each logger's next calibration date.
- [ ] **U17 — Summary at the top of the daily report email**: loggers out of limit, minutes out of limit, open deviations.
- [ ] **U18 — Weekly and monthly Excel report** (one sheet per logger) for QA and audits.
- [ ] **U19 — Excel download with a date range on the Events page**, using the same filters you see on screen.
- [ ] **U20 — Audit trail Excel download** for the selected day or period. Today the CSV download always contains everything.
- [ ] **U21 — Daily min, max and average chart per logger in the Excel report**, as a chart inside each worksheet.

## E. Dashboard and look
- [x] **U22 — Use the new dashboard header on every page.** "PBF Rise Baking Burnaby" centred, same title style.
- [x] **U23 — New dashboard footer text:** "Cooler & Freezer Continuous Monitoring & Reporting".
- [x] **U24 — Phone check and fixes** for every page, especially Settings → Accounts and the Trends logger buttons.
- [x] **U25 — Trends: compare loggers.** Tick two or more loggers and see them on one chart.
- [x] **U26 — Trends: custom date range.** Pick any start and end date, not only 1 hour, 24 hours or 7 days.
- [x] **U27 — Dashboard "big screen" mode** for a wall TV: large tiles, no menus, auto-refresh.

## F. Housekeeping
- [ ] **U28 — Keep the automated tests in the project** (`tests/`) and run them before each release.
- [ ] **U29 — Install `docker buildx` on the server.** This removes the deploy warning and speeds up builds.
- [ ] **U30 — Move records from JSON files to SQLite.** Do it before history grows past about a year, because the files slow down as they grow.

---
**Suggested next release (v6.4):** U1, U2, U8, U9, U11, U16, U22, U23 — plus U3–U7 done by you.
