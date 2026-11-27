# For Next Upgrade — ThermoIQ recommendations

Written 2026-11-27, after release v6.3.0. Ordered by priority.

## 1. Finish what is already started

| # | Item | Why | Effort |
|---|---|---|---|
| 1.1 | **Turn on the domain `thermoiq.octaveworks.com`.** Run `cloud/add_domain.sh` on the server (steps in `docs/guides/CLOUD_DEPLOYMENT.txt`). | DNS already points to the server, but Caddy does not serve the name yet. Today the site is reached by IP address. | 15 min |
| 1.2 | **Make the login cookie HTTPS-only** once 1.1 is done (`secure=True` on `pbf_admin_session`). | The cookie that keeps people signed in to Settings could otherwise be sent over plain HTTP. | Small |
| 1.3 | **Set up the report sender `reports@octaveworks.com`.** Run `windows\SET_SENDER_EMAIL.bat --report --email reports@octaveworks.com --host mail.octaveworks.com`, then click *Email Report Now*. | The code is live, but reports still come from `alarm@octaveworks.com`. | 5 min |
| 1.4 | **Point git at the new GitHub address:** `git remote set-url origin git@github.com:professorx71/thermo-iq.git` | GitHub warns on every release that the repository moved. The old address may stop working. | 1 min |

## 2. Alarm reliability (food-safety risk)

| # | Item | Why |
|---|---|---|
| 2.1 | **Review the alarm schedules.** | Tortilla L3 Cooler and Bagel Proofer 1 and 2 had alarms scheduled OFF on Thursday, so out-of-limit readings sent no message. Schedules ending at 05:59 also leave a one-minute gap each day. Consider 24 h ON for coolers. |
| 2.2 | **Investigate Tortilla L3 Cooler.** | It had been in alarm for about 33 days. Either the cooler has a fault or its limit or mode is wrong (for example, it should be set to NOT IN USE). |
| 2.3 | **Add text-message recipients.** | There are currently 0 text recipients, so email is the only alert. |
| 2.4 | **"No data" alarm.** Email when a logger has sent no readings for 30+ minutes, or when the LI-COR connection fails. | A dead logger or lost connection currently shows only on screen. Nobody is told. |
| 2.5 | **Outside "is the server alive" check** (for example, a free uptime monitor that emails if the site is down). | If the server itself stops, no alarm can be sent at all. |

## 3. Logins and security (follow-up to v6.3)

| # | Item | Why |
|---|---|---|
| 3.1 | **Keep people signed in across updates.** Store sessions in a file instead of memory. | Every deploy or restart signs everyone out of Settings, and resets the wrong-password lockout. |
| 3.2 | **Optional: require a login to acknowledge alarms** (a new right in *Rights for each role*). | Today anyone on the dashboard can acknowledge by typing any name, so the Audit log can't prove who did it. |
| 3.3 | **Back up user logins separately.** Encrypt `data/users.json` and `data/role_rights.json` in the backup, or keep a protected copy. | They are left out of the backup ZIP on purpose because they hold password hashes. After a restore, people must be re-added by hand. |
| 3.4 | **Remove the old Operator tool** (`SET_OPERATOR_PASSWORD.bat`, `tools/set_operator_password.py`) and the `OPERATOR_*` lines in `.env`. | Since v6.3 they no longer control who can sign in, which could confuse someone. |

## 4. Reports and records

| # | Item | Why |
|---|---|---|
| 4.1 | **Calibration-due reminder email**, 14 days before each logger's *Next Calibration Due* date. | Due dates are recorded but nobody is reminded. |
| 4.2 | **Short summary at the top of the daily report email**: loggers out of limit, minutes out of limit, open deviations. | People can see the important part without opening the attachments. |
| 4.3 | **Weekly or monthly Excel report** (same one-sheet-per-logger layout) for QA and audits. | Today it covers 24 h, 48 h or 7 days only. |
| 4.4 | **Excel download button with a date range on the Events page.** | The event log can now be filtered on screen, but downloads are fixed at 24 h and 30 days. |

## 5. Look and feel

| # | Item |
|---|---|
| 5.1 | Use the new dashboard header on every page: "PBF Rise Baking Burnaby" centred, and the same title style. |
| 5.2 | Change the dashboard footer, which still says "Environmental Monitoring Dashboard", to "Cooler & Freezer Continuous Monitoring & Reporting". |
| 5.3 | Check every page on a phone, especially Settings → Accounts and the Trends logger buttons. |

## 6. Housekeeping

| # | Item | Why |
|---|---|---|
| 6.1 | **Keep the automated tests in the project** (`tests/`), and run them before each release. | The tests used for v6.3 (logins, rights, lockout, filters) live only in a temporary folder. |
| 6.2 | **Install `docker buildx` on the server.** | Removes the warning shown during each deploy and speeds up builds. |
| 6.3 | **Plan to move records from JSON files to a small database (SQLite)** once history grows past about a year. | Event and audit files are read in full on every page load and will slow down over time. |

---
**Suggested next release (v6.4):** 1.1–1.4, 2.4, 3.1, 4.1, 5.1 and 5.2. Items 2.1–2.3 are settings changes you can make today without a release.
