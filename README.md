# PBF Rise Baking Burnaby: Temperature Monitoring Dashboard

$16.2.1 (Cloud Edition)**

A web dashboard that monitors the plant's coolers and proofers through **LI-COR HOBO loggers**. It reads live temperature and humidity from **LI-COR Cloud** and raises alarms when a reading goes past its limit. Alarms are sent by email (Gmail) and phone push (ntfy). The dashboard also shows trends, exports CSV and PDF reports, and keeps an audit trail with calibration and deviation records.

> **Important:** This dashboard supports monitoring. It is **not** a validated plant alarm system. Acknowledging an alarm here does **not** acknowledge it in LI-COR Cloud.

---

## Where do I start?

| I want to… | Go to |
|---|---|
| Run the dashboard 24/7 on the plant mini-PC | [`windows/`](windows/) → [Always-on mini-PC](#b-always-on-mini-pc-windows) |
| Try it quickly on my own PC | [`windows/start_dashboard.bat`](windows/start_dashboard.bat) → [Manual start](#a-manual-start-windows) |
| Deploy it to the cloud VPS | [`cloud/`](cloud/) → [Cloud / Docker](#c-cloud--docker-linux-vps) |
| Back up or restore the dashboard data | Audit page → [How to back up](#how-to-back-up-from-the-dashboard) |
| Reset the Admin or Operator password | [`windows/SET_ADMIN_PASSWORD.bat`](windows/SET_ADMIN_PASSWORD.bat) or [`tools/`](tools/) → [User accounts](#user-accounts-and-access) |
| Change the application code | [`app/server.py`](app/server.py) (backend), [`app/static/`](app/static/) (frontend) |
| Read step-by-step guides | [`docs/guides/`](docs/guides/) |
| See what changed in each version | [`docs/release-notes/`](docs/release-notes/) |
| Release a new version, or roll back a bad one | [`release.cmd`](release.cmd) → [Releasing and rolling back](#releasing-and-rolling-back-cloud) |
| Upgrade an install that still uses the old flat folder | [Upgrading from the flat layout](#upgrading-from-the-flat-layout-v620-and-earlier) |

---

## Table of contents
1. [Project structure](#project-structure)
2. [Tech stack](#tech-stack)
3. [Architecture](#architecture)
4. [Monitored loggers](#monitored-loggers)
5. [Configuration (.env)](#configuration-env)
6. [Installation and running](#installation-and-running)
7. [Upgrading from the flat layout](#upgrading-from-the-flat-layout-v620-and-earlier)
    - [Releasing and rolling back (cloud)](#releasing-and-rolling-back-cloud)
8. [User accounts and access](#user-accounts-and-access)
9. [Alarm logic](#alarm-logic)
10. [Notifications](#notifications)
11. [Data storage and backups](#data-storage-and-backups)
    - [How to back up from the dashboard](#how-to-back-up-from-the-dashboard)
    - [Backing up without the browser](#backing-up-without-the-browser)
    - [Restoring a backup](#restoring-a-backup)
12. [Web pages](#web-pages)
13. [API reference](#api-reference)
14. [Troubleshooting](#troubleshooting)
15. [Security notes](#security-notes)
16. [Version history](#version-history)

---

## Project structure

The files are grouped by **who uses them**. The project root holds only the shared files: configuration, dependencies and runtime data.

```
thermoiq/
│
├── README.md                    ← you are here
├── release.cmd / release.ps1    Version, package and deploy a release from Windows
├── requirements.txt             Python dependencies (shared by every deployment)
├── .env.example                 Template for mini-PC / local config
├── .env.cloud.example           Template for cloud config
├── .env                         YOUR PRIVATE CONFIG (create it; never commit)
├── .gitignore / .dockerignore
├── .gitattributes               Keeps LF line endings for .sh / Docker files (they run on Linux)
│
├── app/                         ── APPLICATION CODE (developers) ──
│   ├── server.py                FastAPI backend: API, alarms, reports, audit
│   └── static/                  Frontend (served at /static)
│       ├── index.html + dashboard.js   Live dashboard
│       ├── trends.html + trends.js     Temperature & %RH trends
│       ├── events.html + events.js     Alarm event log
│       ├── settings.html + settings.js Admin/Operator settings
│       ├── audit.html + audit.js       Calibration, deviations, audit trail
│       ├── app.js                      Older shared dashboard script
│       ├── style.css
│       └── rise-logo.png
│
├── tools/                       ── ADMIN COMMAND-LINE TOOLS ──
│   ├── set_admin_password.py    Writes ADMIN_USERNAME / ADMIN_PASSWORD_HASH to .env
│   ├── set_operator_password.py Writes OPERATOR_USERNAME / OPERATOR_PASSWORD_HASH to .env
│   └── check_auth_config.py     Checks the hashes in .env (shows no secrets)
│
├── windows/                     ── MINI-PC / WINDOWS (plant operators) ──
│   ├── INSTALL_ALWAYS_ON_MINIPC.bat   One-time 24/7 install (run as admin)
│   ├── START_ALWAYS_ON_DASHBOARD.bat  Start the 24/7 service
│   ├── STOP_ALWAYS_ON_DASHBOARD.bat   Stop the 24/7 service
│   ├── RESTART_ALWAYS_ON_DASHBOARD.bat
│   ├── DASHBOARD_STATUS.bat           Is it running? Shows LAN URLs
│   ├── OPEN_DASHBOARD.bat             Opens http://localhost:8000
│   ├── SHOW_NETWORK_INFO.bat          IP / MAC addresses for IT
│   ├── SET_ADMIN_PASSWORD.bat         Runs tools/set_admin_password.py
│   ├── SET_OPERATOR_PASSWORD.bat      Runs tools/set_operator_password.py
│   ├── enable_lan_firewall.bat        Opens TCP 8000 on private networks
│   ├── start_dashboard.bat            Manual (foreground) start
│   └── scripts/                       PowerShell called by the .bat files
│       ├── install_always_on.ps1      Creates .venv + Task Scheduler tasks
│       ├── run_dashboard_service.ps1  What the scheduled task runs (logs to logs/)
│       ├── watchdog.ps1               Restarts the service if it stops responding
│       ├── start_/stop_/restart_always_on_dashboard.ps1
│       └── RESTART_DASHBOARD.ps1      Older restart script (same job as restart_always_on_dashboard.ps1)
│
├── cloud/                       ── CLOUD VPS / DOCKER (IT) ──
│   ├── Dockerfile               Image definition (build context = project root)
│   ├── docker-compose.yml       Dashboard container, bound to 127.0.0.1:8000
│   ├── docker-compose.https.yml Adds Caddy for public HTTPS
│   ├── Caddyfile.template       Caddy config example
│   ├── deploy_cloud.sh          Build + start
│   ├── deploy_release.sh        Install a verified, versioned release with health rollback
│   └── enable_https.sh          Generates cloud/Caddyfile + starts Caddy
│
├── docs/
│   ├── guides/                  How-to guides
│   │   ├── MINIPC_SETUP.txt     Mini-PC hardware, BIOS, network, install
│   │   ├── CLOUD_DEPLOYMENT.txt OVH VPS deployment and go-live
│   │   ├── LAN_SETUP.txt        Reaching the dashboard from other PCs/phones
│   │   └── PHONE_PUSH_SETUP.txt ntfy phone notifications
│   └── release-notes/           One file per version (V3 … V6.2.0)
│
├── data/                        RUNTIME: alarm state, audit trail, backups (git-ignored)
├── logs/                        RUNTIME: mini-PC service and watchdog logs (git-ignored)
└── .venv/                       RUNTIME: Python virtual environment (git-ignored)
```

**Path rules the code relies on**
- `app/server.py` loads `.env` and stores `data/` in the **project root**, one level above `app/`.
- Static files are served from `app/static/`.
- Every `.bat` in `windows/` changes to the project root before it runs anything, so they work wherever you double-click them.
- The Docker build context is the project root; the compose files are in `cloud/`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Language | **Python 3.12** |
| Web framework | **FastAPI** (`fastapi==0.116.1`) |
| ASGI server | **Uvicorn** (`uvicorn[standard]==0.35.0`) |
| HTTP client | **httpx**: calls the LI-COR Cloud API |
| Config | **python-dotenv**: loads `.env` |
| PDF reports | **reportlab**: PDF generation and encryption |
| TLS on corporate networks | **truststore**: uses the Windows certificate store |
| Time zones | **tzdata** / `zoneinfo` (plant time zone: `America/Vancouver`) |
| Email | Python `smtplib` → Gmail SMTP (SSL, port 465) |
| Phone push | **ntfy.sh** (plain HTTP POST) |
| Auth | PBKDF2-SHA256 password hashes (`hashlib`), in-memory sessions, HTTP-only cookie |
| Database | **None.** All state is kept in JSON files under `data/` |
| Frontend | Plain **HTML + CSS + JavaScript**: no framework, no build step, charts drawn on `<canvas>` |
| Containers | **Docker** + **Docker Compose** (`python:3.12-slim`) |
| Reverse proxy / HTTPS | **Caddy 2**: automatic HTTPS certificates plus basic auth |
| Windows service | Task Scheduler tasks + PowerShell watchdog |

---

## Architecture

```
 LI-COR HOBO loggers
        │  (cellular/Wi-Fi gateway)
        ▼
 LI-COR Cloud API  (api.licor.cloud)
        │  httpx, Bearer token
        ▼
 ┌──────────────────────────────────────────┐
 │ FastAPI app (app/server.py) on port 8000  │
 │  • background monitor loop every 60 s     │
 │  • alarm evaluation + state machine       │
 │  • REST API + serves app/static/          │
 └──────┬───────────┬──────────┬────────────┘
        │           │          │
        ▼           ▼          ▼
   data/*.json   Gmail SMTP   ntfy.sh push
   (state,       (email)      (phone)
    audit,
    backups)
        ▲
        │ HTTP (fetch every 60 s)
 Browser: app/static/*.html + *.js (canvas charts)
```

**Cloud deployment:** Browser → **Caddy** (HTTPS + basic auth) → Docker container (`127.0.0.1:8000`).

**Primary/backup:** the OVH cloud VPS is the primary instance. The GMKtec mini-PC on site is a local backup. Only **one** of the two should have `NOTIFICATIONS_ENABLED=true`; otherwise every alarm is sent twice.

### Background monitor
When the app starts, it launches a background task that runs every **60 seconds** and:
1. Fetches the latest readings from LI-COR and evaluates alarms (`current()`)
2. Sends the daily maintenance/downtime report if one is due
3. Runs daily audit maintenance: retention cleanup and the automatic ZIP backup

---

## Monitored loggers

Defaults are set in the `LOGGERS` dictionary in [app/server.py](app/server.py). Limits, names, monitoring on/off and schedules can be changed at runtime from the **Settings** page; those changes are saved to `data/alarm_config.json`.

| ID | Name | Serial | Alarm type | Default limit |
|---|---|---|---|---|
| L1 | Tortilla L1 Cooler | 21387391 | HIGH | > 13.0 °C |
| L2 | Tortilla L2 Cooler | 22519364 | HIGH | > 13.0 °C |
| L3 | Tortilla L3 Cooler | 21387388 | HIGH | > 13.0 °C |
| BAGEL | Bagel Cooler | 21147189 | HIGH | > 9.0 °C |
| BP1 | Bagel Proofer 1 | 22547311 | LOW | < 30.0 °C |
| BP2 | Bagel Proofer 2 | 22547310 | LOW | < 30.0 °C |
| PLANT | PBF Plant Temperature (MX1101) | 22212731 | Monitor only | none |

To **add a logger**, add an entry to `LOGGERS` in `app/server.py` and restart the app.

---

## Configuration (.env)

Create `.env` in the **project root** (next to `requirements.txt`) by copying `.env.example` (mini-PC/local) or `.env.cloud.example` (cloud).

| Variable | Required | Default | Description |
|---|---|---|---|
| `LICOR_API_TOKEN` | **Yes** | none | Private LI-COR Cloud API token |
| `LICOR_API_BASE` | No | `https://api.licor.cloud` | LI-COR API base URL |
| `GMAIL_SENDER` | For email | none | Gmail account that sends alerts |
| `GMAIL_APP_PASSWORD` | For email | none | Google **App Password** (spaces are removed automatically) |
| `ALERT_EMAIL` | For email | none | Address that receives alerts |
| `NTFY_BASE_URL` | No | `https://ntfy.sh` | ntfy server |
| `NTFY_TOPIC` | For push | none | Long, random, private topic name |
| `NOTIFICATIONS_ENABLED` | No | `false` | `true` sends automatic alarm emails and pushes |
| `DEPLOYMENT_ROLE` | No | `CLOUD-TEST` | Label shown in the UI, e.g. `CLOUD-PRIMARY` or `CLOUD-TEST` |
| `ADMIN_USERNAME` | No | `admin` | Admin login name |
| `ADMIN_PASSWORD_HASH` | **Yes** (for Settings) | none | Generate with `windows/SET_ADMIN_PASSWORD.bat` |
| `OPERATOR_USERNAME` | No | `operator` | Operator login name |
| `OPERATOR_PASSWORD_HASH` | No | none | Generate with `windows/SET_OPERATOR_PASSWORD.bat` |

> ⚠️ **Never commit or share `.env`.** It holds the LI-COR token, the Gmail app password and the password hashes. `.gitignore` already excludes it.

---

## Installation and running

### A. Manual start (Windows)

Prerequisite: Python 3.12+.

```powershell
cd C:\developer\thermoiq
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env               # then edit .env
windows\SET_ADMIN_PASSWORD.bat       # creates ADMIN_PASSWORD_HASH
windows\start_dashboard.bat
```

Then open **http://localhost:8000**. The startup window also lists the computer's LAN addresses (`http://<LAN-IP>:8000`).

To run it directly from the project root, without the batch file:
```powershell
.venv\Scripts\python.exe -m uvicorn server:app --app-dir app --host 0.0.0.0 --port 8000
```

### B. Always-on mini-PC (Windows)

1. Put your private `.env` in the project root.
2. Right-click **`windows\INSTALL_ALWAYS_ON_MINIPC.bat`** → **Run as administrator**. It:
   - creates `.venv` in the project root and installs the requirements
   - opens TCP 8000 on private networks and turns off AC sleep/hibernate
   - registers the **"PBF Temperature Dashboard"** Task Scheduler task, which runs `windows\scripts\run_dashboard_service.ps1` at boot as SYSTEM
   - registers the **"PBF Dashboard Watchdog"** task, which runs `windows\scripts\watchdog.ps1` every 5 minutes and restarts the dashboard if it stops responding
3. Day-to-day control (all in `windows\`):
   - `START_ALWAYS_ON_DASHBOARD.bat` / `STOP_…` / `RESTART_…`
   - `DASHBOARD_STATUS.bat`: is it running?
   - `OPEN_DASHBOARD.bat`: opens the browser
   - `SHOW_NETWORK_INFO.bat`: IP and MAC addresses for IT
4. Logs are written to `logs\dashboard-YYYY-MM-DD.log` and `logs\watchdog.log`.

More detail: [docs/guides/MINIPC_SETUP.txt](docs/guides/MINIPC_SETUP.txt) and [docs/guides/LAN_SETUP.txt](docs/guides/LAN_SETUP.txt).

### C. Cloud / Docker (Linux VPS)

Tested on Ubuntu 24.04 with Docker + Docker Compose v2.

```bash
# 1. Upload the project to the VPS
cd /opt/pbf-temp-dashboard
cp .env.cloud.example .env && nano .env    # project root; keep NOTIFICATIONS_ENABLED=false at first

# 2. Build and start (binds to 127.0.0.1:8000 only)
./cloud/deploy_cloud.sh

# 3. Test through an SSH tunnel from your PC
ssh -L 8000:127.0.0.1:8000 ubuntu@YOUR_VPS_IP
#    → open http://localhost:8000 and check that all seven loggers appear
```

**Enable public HTTPS** (after DNS points a domain at the VPS):
```bash
./cloud/enable_https.sh   # asks for the domain, viewer username and viewer password; writes cloud/Caddyfile
```
Caddy obtains and renews certificates automatically. Every page is protected by Caddy basic auth, and the Settings page still requires its own Admin/Operator login.

**Go-live checklist:**
1. Turn off automatic Gmail/ntfy alarms on the mini-PC backup.
2. In the cloud `.env`, set `NOTIFICATIONS_ENABLED=true` and `DEPLOYMENT_ROLE=CLOUD-PRIMARY`.
3. Run `cd cloud && docker compose restart dashboard`.

**Useful commands** (run inside `cloud/`):
```bash
docker compose ps
docker compose logs -f dashboard
docker compose restart dashboard
docker compose build --pull && docker compose up -d                        # after updating code
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d     # with Caddy/HTTPS
```

The compose project name is fixed to `pbf-temp-dashboard`. The root `data/` folder and `.env` are mounted into the container, so data survives rebuilds.

More detail: [docs/guides/CLOUD_DEPLOYMENT.txt](docs/guides/CLOUD_DEPLOYMENT.txt).

---

## Upgrading from the flat layout (v6.2.0 and earlier)

Earlier versions kept every file in one folder. Your `.env`, `data/`, `logs/` and `.venv/` **stay where they are, in the project root**, so no data has to move. What changes is where the scripts are.

**Mini-PC:** the existing scheduled task still points to the old `run_dashboard_service.ps1` in the root, which no longer exists. Re-register it once:
1. Stop the service. Either use Task Scheduler, or before updating the files, run the old `STOP_ALWAYS_ON_DASHBOARD.bat`.
2. Update the project files.
3. Right-click **`windows\INSTALL_ALWAYS_ON_MINIPC.bat`** → **Run as administrator**. It replaces both scheduled tasks with versions that point to the new paths.
4. Run `windows\DASHBOARD_STATUS.bat` to confirm the dashboard responds.

**Cloud VPS (recommended): use `release.cmd`.** It installs the new layout next to the flat files, uses the existing `.env` and `data/` in place, and if the health check fails it switches back to the flat install automatically. See [Releasing and rolling back](#releasing-and-rolling-back-cloud).

**Cloud VPS (manual alternative):**
1. Update the project files. Keep `.env` and `data/` in the project root.
2. If HTTPS was already set up, move the generated `Caddyfile` from the root into `cloud/` (`mv Caddyfile cloud/Caddyfile`).
3. Stop the old stack from the root, with the old compose files still there: `docker compose down`. Or remove the containers by name: `docker rm -f pbf-temp-dashboard pbf-caddy`.
4. Start the new layout: `./cloud/deploy_cloud.sh`. If HTTPS is in use, also run `cd cloud && docker compose -f docker-compose.yml -f docker-compose.https.yml up -d`.
   - If the old project folder wasn't named `pbf-temp-dashboard`, Caddy gets new certificate volumes and requests fresh certificates on first start. This happens automatically.

---

## Releasing and rolling back (cloud)

### How a release is deployed

`release.cmd` runs on your Windows PC. It runs `release.ps1`, which copies `cloud/deploy_release.sh` to the VPS and runs it there.

```powershell
.\release.cmd -DryRun                                   # check everything, change nothing
.\release.cmd -Version 6.2.1 -Notes "What changed"      # bump, commit, tag, package, then asks to DEPLOY
.\release.cmd -DeployOnly -Version 6.2.1                # (re)deploy an existing tag, no new commit
```

- The working tree must be clean: commit your changes first.
- It asks you to type `CREATE` before it changes version files, commits and tags, and `DEPLOY` before it uploads anything.
- It does **not** push to GitHub. Afterwards, push with `git push origin HEAD refs/tags/vX.Y.Z`.
- The package is saved as `Downloads\thermoiq-vX.Y.Z.tar.gz`, and its SHA-256 is checked on the server.

**What the server looks like after a release:**

```
/opt/pbf-temp-dashboard/
├── .env                      shared by all releases (never replaced)
├── data/                     shared by all releases (never replaced)
├── current -> releases/v6.2.1     symlink to the live release
├── releases/
│   ├── v6.2.1/               one folder per release (.env and data/ are links back to the root)
│   └── v6.2.2/
└── docker-compose.yml, server.py, …   old flat-layout files (only until you delete them)
```

> ⚠️ After the first release, **don't run `docker compose` in `/opt/pbf-temp-dashboard` itself.** The old flat `docker-compose.yml` there would rebuild the **old** code over the live release. Always use `-f current/cloud/docker-compose.yml`. Once the new layout has run for a while, delete or rename the flat files.

### Automatic rollback

`deploy_release.sh` builds the new image **while the old container keeps running**. Before building, it saves the running image as `pbf-temp-dashboard-dashboard:rollback`. Then it switches over and waits up to about 2 minutes for the container to be **healthy** and answering on `http://127.0.0.1:8000/`.

| What goes wrong | What the script does |
|---|---|
| Checksum mismatch, missing `.env`, bad package | Stops before changing anything |
| Image build fails | Stops; the old container never stopped |
| New release fails the health check, and a previous **release** exists | Points `current` back at the previous release and starts it again from the saved image |
| New release fails the health check on the **first** release (flat install) | Removes `current` and restarts the flat install from the saved image |
| Brand-new server with nothing running before | Stops the failed new container |

Look for `Previous release is healthy again.` or `Previous deployment is healthy again.` in the output. If you see `automatic rollback did not pass health checks`, use the manual steps below.

### Manual rollback

Do this when a release passed the health check but behaves wrongly, e.g. wrong readings or a page error. Run these on the VPS (`ssh ubuntu@148.113.244.247`):

**1. See what is live and what's available:**
```bash
cd /opt/pbf-temp-dashboard
readlink current          # live release
ls releases               # installed releases
```

**2a. Go back to an earlier release** (example: v6.2.1):
```bash
cd /opt/pbf-temp-dashboard
ln -s /opt/pbf-temp-dashboard/releases/v6.2.1 current.new && mv -Tf current.new current
docker compose -f current/cloud/docker-compose.yml up -d --build --force-recreate
```
`--build` rebuilds that release's code, which takes about a minute. All releases share one image name, so the existing image belongs to the newest build.

*Faster, but **only** to go back to the release that ran just before the most recent deploy:* replace the last line with
```bash
docker tag pbf-temp-dashboard-dashboard:rollback pbf-temp-dashboard-dashboard:latest
docker compose -f current/cloud/docker-compose.yml up -d --no-build --force-recreate
```

**2b. Go back to the old flat install** (only possible while the flat files are still in the root):
```bash
cd /opt/pbf-temp-dashboard
rm current                # removes only the symlink, not the release folders
docker compose -f docker-compose.yml up -d --build --force-recreate
```

**2c. Or from your Windows PC**, redeploy any earlier tag (the folder is still on the server, so it's reused):
```powershell
.\release.cmd -DeployOnly -Version 6.2.1
```

**3. Check the rollback worked:**
```bash
docker inspect -f '{{.State.Health.Status}}' pbf-temp-dashboard     # healthy
curl -s http://127.0.0.1:8000/api/deployment-status                 # version, CLOUD-PRIMARY, notifications true
docker logs --tail 50 pbf-temp-dashboard
```
Then, through the SSH tunnel, check all seven loggers and log in on **Settings**.

### Rolling back data

Rolling back the code **does not** roll back `data/`. Every release uses the same folder, so events, audit records and settings recorded by the newer release are kept. That's what you normally want. If a release damaged the data, restore the most recent good ZIP from `data/backups/`, following [Restoring a backup](#restoring-a-backup). Stop the container first (`docker stop pbf-temp-dashboard`) and start it again afterwards with `docker compose -f current/cloud/docker-compose.yml up -d`.

### Cleaning up old releases

Keep at least the live release and the one before it:
```bash
cd /opt/pbf-temp-dashboard && readlink current && ls releases
rm -r releases/v6.2.0     # an old release you no longer need; never the one 'current' points to
```

---

## User accounts and access

| Role | Access |
|---|---|
| **Viewer** (no login) | Dashboard, trends, events, downloads. The audit page is read-only. |
| **Operator** | Viewer access, plus changing **alarm schedules** and recording alarm **corrective actions/deviations** |
| **Admin** | Everything: limits, monitoring on/off, calibration, accounts, retention, backups, report settings |
| **Caddy viewer** (cloud only) | Separate HTTP basic-auth login that protects the whole site |

- Sessions last **8 hours** (`pbf_admin_session` cookie, HTTP-only, SameSite=Strict).
- Passwords are stored as `pbkdf2_sha256$iterations$salt$hash` in `.env`.
- **Username rules:** 1–64 printable characters. Letters, numbers, spaces and symbols are allowed; leading and trailing spaces are trimmed.
- **Password rules:** exactly **6 characters**, letters and numbers only (A–Z, a–z, 0–9).
- The Admin can change their own username and password and reset the Operator account from the Settings page.

**Command-line tools** (run from the project root):

| Windows double-click | Command line | Purpose |
|---|---|---|
| `windows\SET_ADMIN_PASSWORD.bat` | `python tools/set_admin_password.py` | Set the Admin username and password |
| `windows\SET_OPERATOR_PASSWORD.bat` | `python tools/set_operator_password.py` | Set the Operator username and password |
| none | `python tools/check_auth_config.py` | Check that the hashes in `.env` are valid |

In Docker: `cd cloud && docker compose exec dashboard python tools/set_admin_password.py`

Restart the dashboard after changing a password with these tools.

> The 6-character password protects Settings only. Keep the **Caddy** password long and strong, because it is the outer security layer.

---

## Alarm logic

For each logger, on every 60-second cycle:

1. **Reading:** latest temperature and %RH from LI-COR. Any calibration offsets are applied.
2. **Communication status:**
   - `ONLINE`: data is 15 minutes old or less
   - `STALE`: data is 15–30 minutes old
   - `OFFLINE`: data is more than 30 minutes old, or there is none
3. **Alarm condition:** HIGH loggers alarm when temp > limit; LOW loggers alarm when temp < limit. `monitor` loggers never alarm.
4. **Suppression:** no alarm is raised when:
   - monitoring is turned off for the logger (`NOT IN USE`), or
   - the weekday/24-hour **schedule** says monitoring is inactive (`OUTSIDE ALARM SCHEDULE`)
5. **State machine and events** (written to the event log and audit trail):
   - `HIGH/LOW TEMPERATURE ALARM`: sends one alarm email and push
   - `5-MIN REMINDER`: repeats every 5 minutes while the alarm stays active
   - `ALARM NOTIFICATION SUSPENDED`: monitoring was suspended while an alarm was active
   - `RETURN TO NORMAL`: sends one recovery email and push, including the alarm duration
6. **Acknowledge:** a flashing **red** banner turns steady **orange** ("ACKNOWLEDGED — CONDITION STILL ACTIVE"). The banner clears by itself when the reading is back within the limit. A new alarm always starts unacknowledged.

---

## Notifications

| Channel | Setup | Test |
|---|---|---|
| **Email** | Gmail account with 2-step verification, plus an **App Password** in `.env` | Dashboard "Test Email" button or `POST /api/test-email` |
| **Phone push** | Install the **ntfy** app and subscribe to the same `NTFY_TOPIC` ([guide](docs/guides/PHONE_PUSH_SETUP.txt)) | `POST /api/test-push` |

Automatic alarms are sent **only** when `NOTIFICATIONS_ENABLED=true`.

**Daily maintenance/downtime report:** configured in Settings (Admin). It is emailed automatically once a day and can also be sent on demand.

---

## Data storage and backups

There is no database. All state is kept in JSON files in `data/`, in the project root:

| File | Contents |
|---|---|
| `alarm_config.json` | Per-logger limits, names, monitoring flag, schedules |
| `alarm_state.json` | Current alarm and acknowledgement state |
| `alarm_events.json` | Alarm event log |
| `downtime_history.json`, `downtime_active.json` | Maintenance downtime records |
| `maintenance_report_config.json`, `maintenance_report_state.json` | Daily report settings and last-sent state |
| `calibration_records.json` | Calibration records and offsets per logger |
| `deviation_records.json` | Alarm deviations and corrective actions |
| `audit_trail.json` | Full audit trail (alarms, acks, config changes, logins, reports, backups) |
| `audit_config.json` | Retention and backup settings |
| `audit_backup_state.json` | Last-backup info |
| `backups/*.zip` | Daily backups |

- **Raw sensor history is not stored locally.** It is fetched from LI-COR Cloud whenever someone asks for it, so how far back you can go depends on LI-COR's retention.
- **Retention** of local records can be set to 1, 2 or 3 years (default 3).
- **Automatic backup:** a ZIP every day at **02:15 Pacific**, keeping the **30** most recent, **only on the instance with `DEPLOYMENT_ROLE=CLOUD-PRIMARY`**. The mini-PC and test copies never back up or apply retention on their own; back them up manually (see below). `.env` is **never** included in backups.
- **Timestamps** are stored in UTC and shown in `America/Vancouver` time.
- Deleting events from the dashboard is disabled, to keep the audit trail intact.

### How to back up from the dashboard

The backup controls are on the **Audit** page (`/audit`) under **Retention & Backup**, and they need an **Admin** login. Operators and viewers see the buttons greyed out.

1. **Log in as Admin.** Open **Settings** (`/settings`) and sign in with the Admin username and password. The login lasts 8 hours and also covers the Audit page.
2. **Open the Audit page** from the top navigation, or go to `http://<dashboard-address>/audit`.
3. Scroll to **Retention & Backup**, then:
   - **Create Backup Now** makes a new ZIP straight away. The message shows `Backup created: PBF_Audit_Backup_YYYYMMDD_HHMMSS.zip`.
   - **Download Latest Backup** saves the newest ZIP to your computer.
4. **Store the downloaded ZIP somewhere other than the dashboard server**, such as a network share or OneDrive. Backups are kept in `data/backups/` on the same machine, so if that machine's disk fails, the backups go with it.

The **Latest data backup** card at the top of the Audit page shows when the last backup was made, or *No backup created yet*.

**Changing the automatic schedule** (same section, Admin only): set **Automatic Backup** to ENABLED or DISABLED, set **Daily Backup Time — Pacific** and **Keep Daily Backups** (7–365), then click **Save Retention / Backup Settings**. Every change is recorded in the audit trail.

**What the ZIP contains:** `BACKUP_MANIFEST.json`, plus a `data/` folder with the alarm events, acknowledgement state, logger settings (limits, schedules, calibration offsets), downtime history, calibration records, deviations, audit trail, and report and retention settings.
**What it does NOT contain:** `.env`, which holds the LI-COR token, the Gmail app password and the password hashes. Keep your own protected copy of `.env`.

### Backing up without the browser

For example on the mini-PC, which doesn't make automatic backups. Copy the whole `data/` folder while the dashboard is stopped:

```powershell
# Windows (project root)
windows\STOP_ALWAYS_ON_DASHBOARD.bat
Compress-Archive -Path data -DestinationPath "PBF_data_$(Get-Date -Format yyyyMMdd_HHmm).zip"
windows\START_ALWAYS_ON_DASHBOARD.bat
```
```bash
# Cloud VPS (project root)
cd cloud && docker compose stop dashboard && cd ..
tar czf "PBF_data_$(date +%Y%m%d_%H%M).tar.gz" data
cd cloud && docker compose start dashboard
```

Calling the API from a script also works, using an Admin session cookie: `POST /api/admin/audit/backup-now`, then `GET /api/admin/audit/latest-backup`.

### Restoring a backup

1. Stop the dashboard: `windows\STOP_ALWAYS_ON_DASHBOARD.bat`, or `cd cloud && docker compose stop dashboard`.
2. Make a safety copy of the current `data/` folder first.
3. Extract the ZIP **into the project root**. The ZIP already contains a `data/` folder, so the files land in `data/` and overwrite the current ones.
4. Make sure `.env` is in place; it isn't in the backup.
5. Start the dashboard again and check the Events and Audit pages.

The same steps copy one instance's settings to another, for example cloud → local, so both show the same limits and calibration offsets.

---

## Web pages

| URL | Page | Files |
|---|---|---|
| `/` | Live dashboard: logger cards, alarm banner, °C/°F toggle, full-screen/TV mode, auto-refresh every 60 s | `index.html`, `dashboard.js` |
| `/trends` | Temperature and %RH trends (1 h / 24 h / 7 days) with limit lines; CSV downloads | `trends.html`, `trends.js` |
| `/events` | Alarm event log | `events.html`, `events.js` |
| `/settings` | Admin/Operator login, limits, schedules, accounts, reports | `settings.html`, `settings.js` |
| `/audit` | Calibration, alarm episodes, deviations, audit trail, PDF/CSV audit report, backups | `audit.html`, `audit.js` |

All of these files are in `app/static/`. After an update, press **Ctrl+F5** if the browser still shows the old page. Static files are versioned with `?v=6.2.0`.

---

## API reference

All endpoints are in [app/server.py](app/server.py). Endpoints marked 🔒 need an Admin (or, where noted, Operator) session cookie.

### Live data and status
| Method | Path | Description |
|---|---|---|
| GET | `/api/current` | Latest reading, alarm and communication status for every logger |
| GET | `/api/dashboard-history` | Trend data for all loggers |
| GET | `/api/history/{sn}` | Trend data for one logger |
| GET | `/api/deployment-status` | Version, deployment role, notification flag |
| GET | `/api/v501-status` | Extended system status |
| GET | `/api/email-status` | Whether Gmail is configured |
| GET | `/api/push-status` | Whether ntfy is configured |

### Alarms
| Method | Path | Description |
|---|---|---|
| GET | `/api/alarm-events` | Alarm event log |
| DELETE | `/api/alarm-events` | Disabled (protects the audit trail) |
| POST | `/api/ack/{sn}` | Acknowledge the alarm on a logger |
| POST | `/api/test-email` | Send a test email |
| POST | `/api/test-alarm-email` | Send a sample alarm email |
| POST | `/api/test-push` | Send a test ntfy push |

### Downloads and reports
| Method | Path | Description |
|---|---|---|
| GET | `/api/download-24h/{sn}` | Last 24 h CSV for one logger |
| GET | `/api/download-date/{sn}` | CSV for one calendar date |
| GET | `/api/download-date-all.csv` | CSV for one date, all loggers |
| GET | `/api/download-range/{sn}` | CSV for a date range |
| GET | `/api/download-range-all.csv` | CSV for a date range, all loggers |
| GET | `/api/temperature-history-all.csv` | Temperature history, all loggers |
| GET | `/api/maintenance-report.csv` | Maintenance/downtime report |
| GET | `/api/download-test/{sn}` | Diagnostic test of the LI-COR download |

### Authentication 🔒
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/status` | Current session and role |
| POST | `/api/admin/login` | Log in (Admin or Operator) |
| POST | `/api/admin/logout` | Log out |
| POST | `/api/admin/change-password` | Change Admin username/password |
| POST | `/api/admin/operator-password` | Set or reset the Operator account |

### Configuration 🔒
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/config` | Current per-logger configuration |
| POST | `/api/admin/config/{sn}` | Update one logger (limit, name, monitoring, schedule) |
| POST | `/api/admin/schedule/all` | Apply one schedule to all loggers (Operator allowed) |
| POST | `/api/admin/report-config` | Daily maintenance report settings |
| POST | `/api/admin/send-maintenance-report` | Send the report now |

### Audit
| Method | Path | Description |
|---|---|---|
| GET | `/api/audit/status` | Audit status, server UTC and Pacific time |
| GET | `/api/audit/calibrations` | Calibration records |
| POST | `/api/admin/audit/calibration/{sn}` 🔒 | Add a calibration record (applies offsets) |
| GET | `/api/audit/episodes` | Alarm episodes (alarm → normal) |
| GET | `/api/audit/deviations` | Deviation records |
| POST | `/api/audit/deviation` 🔒 | Record a deviation or corrective action (Operator allowed) |
| GET | `/api/audit-trail` | Audit trail (JSON) |
| GET | `/api/audit-trail.csv` | Audit trail (CSV) |
| GET | `/api/audit-report.pdf` | Audit report PDF |
| POST | `/api/admin/audit/config` 🔒 | Retention and backup settings |
| POST | `/api/admin/audit/backup-now` 🔒 | Create a backup now |
| GET | `/api/admin/audit/latest-backup` 🔒 | Download the latest backup ZIP |

FastAPI's interactive API docs are also at **`/docs`** while the app is running.

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| `ERROR: .env not found` | `.env` must be in the **project root**, not in `windows/`, `app/` or `cloud/` |
| Mini-PC dashboard stopped after updating to this layout | The scheduled task still points to the old path. Re-run `windows\INSTALL_ALWAYS_ON_MINIPC.bat` as admin ([see upgrading](#upgrading-from-the-flat-layout-v620-and-earlier)) |
| All loggers `OFFLINE` | Check `LICOR_API_TOKEN`, that the internet connection works, and that LI-COR Cloud is up |
| SSL/certificate errors on the corporate network | Make sure `truststore` is installed; it uses the Windows certificate store |
| Old page after an update | Press **Ctrl+F5** |
| No emails | Check `/api/email-status`; Gmail needs an **App Password**, not your normal password; check `NOTIFICATIONS_ENABLED` |
| No phone pushes | Make sure the ntfy app is subscribed to the exact `NTFY_TOPIC` |
| Duplicate alarms | Both the cloud and the mini-PC have `NOTIFICATIONS_ENABLED=true`. Turn it off on one of them |
| Cannot log in to Settings | Run `python tools/check_auth_config.py`; reset with `windows\SET_ADMIN_PASSWORD.bat` |
| Other LAN devices can't connect | Run `windows\enable_lan_firewall.bat` as admin; use the address from `windows\DASHBOARD_STATUS.bat` |
| Mini-PC service problems | Check `logs\dashboard-YYYY-MM-DD.log` and `logs\watchdog.log` |
| `container name "/pbf-temp-dashboard" is already in use` | An old container is still running. Run `docker rm -f pbf-temp-dashboard`, then deploy again |
| Docker container unhealthy | `cd cloud && docker compose logs -f dashboard` |

Version-specific fixes are documented in [docs/release-notes/](docs/release-notes/).

---

## Security notes

- The LI-COR token stays **on the server**. The browser never sees it.
- `.env` and `cloud/Caddyfile` are listed in `.gitignore`. `.env` is excluded from backups and from the Docker build context (`.dockerignore`).
- In the cloud, the app listens on **loopback only**. Public access goes through Caddy over HTTPS with basic auth, and Caddy adds `nosniff`, `SAMEORIGIN` and referrer-policy headers.
- The ntfy topic works like a password. Use a long, random value that contains no names or phone numbers.
- Admin and Operator actions, logins and logouts are all recorded in the audit trail.

---

## Version history

| Version | Highlights |
|---|---|
| v3 | Alarm banner, °C/°F, TV mode, 1 h/24 h/7 d trends |
| v4.x | Gmail alerts, temperature + RH trends, CSV downloads, ntfy phone push, 5-minute reminders |
| v5.0–5.1 | Persistent event log and acknowledgement state, LAN setup, route fixes |
| v5.2 | Dashboard graphics, communication status |
| v5.3 | Admin password changes, cache fix, weekday/24 h scheduler, calibration and roles, plant logger |
| v6.0 | Cloud edition (Docker/Caddy), username/password rules, auth fixes |
| v6.1 | Maintenance downtime report, 7-day trend download, calendar history export |
| **v6.2.1** | fixed lock and add release |
| **v6.2.0** | **Audit controls:** calibration records, deviations, expanded audit trail, retention, daily backups |
| *(unreleased)* | Project reorganized into `app/`, `tools/`, `windows/`, `cloud/` and `docs/`. No change to application behaviour. |

Detailed notes for each release are in [docs/release-notes/](docs/release-notes/). The oldest history (v3 to v4.x) is in [V3_TO_V4_HISTORY.txt](docs/release-notes/V3_TO_V4_HISTORY.txt).
