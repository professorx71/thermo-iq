<img src="app/static/thermoiq-logo.svg" alt="ThermoIQ" width="320">

# ThermoIQ: PBF Rise Baking Burnaby Temperature Monitoring

**Current version: v6.7.0 (Cloud Edition)**

A web dashboard that monitors the plant's coolers and proofers through **LI-COR HOBO loggers**. It reads live temperature and humidity from **LI-COR Cloud** and raises alarms when a reading goes past its limit. Alarms are sent by email and text message, to recipients managed on the Settings page. The dashboard also shows trends, exports CSV and PDF reports, and keeps an audit trail with calibration and deviation records.

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
11. [Reports](#reports)
12. [Data storage and backups](#data-storage-and-backups)
    - [How to back up from the dashboard](#how-to-back-up-from-the-dashboard)
    - [Backing up without the browser](#backing-up-without-the-browser)
    - [Restoring a backup](#restoring-a-backup)
13. [Web pages](#web-pages)
14. [API reference](#api-reference)
15. [Troubleshooting](#troubleshooting)
16. [Security notes](#security-notes)
17. [Version history](#version-history)

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
│       ├── thermoiq-logo.svg           Logo (snowflake + wordmark)
│       └── thermoiq-mark.svg           Snowflake icon (page header, favicon)
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
│   │   └── TEXT_MESSAGE_SETUP.txt Text message (SMS) alarm alerts
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
| Excel reports | **openpyxl**: per-logger temperature history workbook |
| TLS on corporate networks | **truststore**: uses the Windows certificate store |
| Time zones | **tzdata** / `zoneinfo` (plant time zone: `America/Vancouver`) |
| Email | Python `smtplib` → Gmail SMTP (SSL, port 465) by default; any SMTP server via `SMTP_HOST`/`SMTP_PORT` |
| Text messages | Same SMTP account, sent to each phone's **carrier email-to-text address** (e.g. `6045551234@txt.bell.ca`) |
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
   data/*.json   SMTP (email + carrier email-to-text)
   (state,       → inboxes and phones
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
1. Fetches the latest readings from LI-COR and evaluates alarms (`current()`), no-data alarms and escalation
2. Sends the daily maintenance/downtime report if one is due
3. Runs daily audit maintenance: retention cleanup and the automatic ZIP backup

Each finished cycle is recorded; `GET /healthz` answers `200 {"status":"ok"}` while cycles keep finishing and `503` when none has finished for 5 minutes (see [Outside uptime check](#outside-uptime-check)).

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
| `GMAIL_SENDER` | For email/texts | none | **Sender** account that sends alarm emails and texts. Change this (and the password) to change the sender |
| `GMAIL_APP_PASSWORD` | For email/texts | none | Google **App Password**, or the sender account's SMTP password (spaces are removed automatically) |
| `SMTP_HOST` | No | `smtp.gmail.com` | Mail server, for a non-Gmail sender |
| `SMTP_PORT` | No | `465` | `465` = SSL; any other port uses STARTTLS (e.g. `587`) |
| `ALERT_EMAIL` | No | none | Starting email recipient(s), comma-separated. Used only until recipients are saved on the Settings page |
| `REPORT_SENDER` | No | none | Separate sender for the maintenance report (e.g. `reports@octaveworks.com`), same mail server. Unset = reports come from `GMAIL_SENDER` |
| `REPORT_SENDER_PASSWORD` | With `REPORT_SENDER` | none | Password for `REPORT_SENDER` |
| `NOTIFICATIONS_ENABLED` | No | `false` | `true` sends automatic alarm emails and texts |
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

**Production address: https://thermoiq.octaveworks.com.** The production VPS also hosts other sites, so it runs Caddy as a system service (`/etc/caddy/Caddyfile`) with certbot certificates instead of `enable_https.sh`. To add or move the domain there, run `cloud/add_domain.sh`. It backs up the Caddyfile, gets the certificate, adds a renewal hook and reuses the existing viewer login:
```bash
scp cloud/add_domain.sh ubuntu@148.113.244.247:/tmp/ && ssh -t ubuntu@148.113.244.247 "sudo bash /tmp/add_domain.sh thermoiq.octaveworks.com"
```

**Go-live checklist:**
1. Turn off automatic email/text alarms on the mini-PC backup.
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

`release.cmd` runs on your Windows PC. It runs `release.ps1`, which copies `cloud/deploy_release.sh` to the VPS and runs it there. You don't need to commit first; the script does it.

```powershell
.\release.cmd -DryRun                                   # show what would be committed and deployed; change nothing
.\release.cmd -Notes "What changed"                     # commit + push everything, deploy, tag if healthy
.\release.cmd -Version 6.3.0 -Notes "Quarterly release" # same, with a chosen version number
.\release.cmd -DeployOnly                               # deploy the current commit (tagged if healthy)
.\release.cmd -DeployOnly -Version 6.2.1                # redeploy / roll back to an existing tag
```

**What happens, step by step:**

| Step | Prompt | What it does |
|---|---|---|
| 1. Plan | none | Shows the version, and every changed file that will be committed. Stops if any of them is private (`.env`, `data/`, `logs/`, `.venv/`, databases). |
| 2. Commit and push | type `CREATE` | Updates the version in all files, writes `docs/release-notes/VX_Y_Z_RELEASE.txt`, runs **`git add -A`**, commits `Release vX.Y.Z`, and **pushes the branch to GitHub** |
| 3. Deploy | type `DEPLOY` | Packages that commit (`Downloads\thermoiq-vX.Y.Z.tar.gz`), uploads it, checks its SHA-256 on the server and switches over, with automatic rollback |
| 4. Tag and Release | none | **Only if the deploy is healthy**: creates tag `vX.Y.Z` on the deployed commit and pushes it. The workflow in [.github/workflows/release.yml](.github/workflows/release.yml) then creates the **GitHub Release**, with the notes plus the `.tar.gz` and `.sha256` |

- **Version numbers:** the patch number goes up (6.2.1 → 6.2.2) only when the current version has been released, meaning it has a tag. If a deploy was skipped or failed, the next run **reuses** the same version and adds to its release notes, so no numbers are skipped.
- **A deploy you skip or that fails** leaves your work committed and pushed, but with **no tag and no GitHub Release**. Deploy it later with `.\release.cmd -DeployOnly`.
- **Check `git status` before running.** `git add -A` includes every file that `.gitignore` doesn't exclude.
- **Publishing a tag that's already on GitHub** (or one pushed before the workflow existed): GitHub → **Actions** → **GitHub Release** → **Run workflow** → enter the tag, e.g. `v6.2.1`.

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
| **Guest** | Default: view the Settings page, read only |
| **Operator** | Default: view settings, change **alarm schedules**, record alarm **corrective actions/deviations** |
| **Engineering** | Default: Operator rights plus alarm **limits**, equipment mode, calibration offsets and calibration records |
| **Admin** | Everything, including user logins and the rights of each role |
| **Caddy viewer** (cloud only) | Separate HTTP basic-auth login that protects the whole site |

- **Settings → Accounts and passwords** (Admin only):
  - change the Admin username and password (6+ characters);
  - add or reset a personal login for each person (Engineering, Operator or Guest, password 4+ characters), remove a login, or turn off all Operator logins at once. A removed or reset login is signed out immediately;
  - **Rights for each role**: tick what Engineering, Operator and Guest may do. Rights are checked by the server on every request, so a change applies on the person's next action.
- Every login, failed login, account change and rights change is recorded in the Event and Audit logs.
- **Lockout:** after 10 wrong passwords from one address within 15 minutes, sign-in from that address is locked for 15 minutes.
- Sessions last **8 hours** (`pbf_admin_session` cookie, HTTP-only, SameSite=Strict).
- The Admin password hash is stored in `.env`. User logins are stored in `data/users.json` (PBKDF2 hashes only) and role rights in `data/role_rights.json`.
- On first start of v6.3, the old single Operator login from `.env` (`OPERATOR_USERNAME` / `OPERATOR_PASSWORD_HASH`) is copied into `data/users.json`. After that, manage Operators in Settings; `SET_OPERATOR_PASSWORD.bat` no longer affects sign-in.
- **Username rules:** 1–64 printable characters. Letters, numbers, spaces and symbols are allowed; leading and trailing spaces are trimmed. User login names are not case-sensitive.

**Command-line tools** (run from the project root):

| Windows double-click | Command line | Purpose |
|---|---|---|
| `windows\SET_ADMIN_PASSWORD.bat` | `python tools/set_admin_password.py` | Set the Admin username and password |
| `windows\SET_OPERATOR_PASSWORD.bat` | `python tools/set_operator_password.py` | Legacy (before v6.3): set the single Operator login in `.env` |
| none | `python tools/check_auth_config.py` | Check that the hashes in `.env` are valid |

In Docker: `cd cloud && docker compose exec dashboard python tools/set_admin_password.py`

Restart the dashboard after changing a password with these tools.

> The Settings passwords protect Settings only. Keep the **Caddy** password long and strong, because it is the outer security layer.

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
   - the weekly **schedule** says alarms are OFF right now (`OUTSIDE ALARM SCHEDULE`)
5. **State machine and events** (written to the event log and audit trail):
   - `HIGH/LOW TEMPERATURE ALARM`: sends one alarm email and text message
   - `5-MIN REMINDER`: repeats every 5 minutes while the alarm stays active
   - `ALARM NOTIFICATION SUSPENDED`: monitoring was suspended while an alarm was active
   - `RETURN TO NORMAL`: sends one recovery email and text, including the alarm duration
   - `ALARM ESCALATED`: nobody acknowledged the alarm in time; the supervisor list is told (see below)
6. **Acknowledge:** a flashing **red** banner turns steady **orange** ("ACKNOWLEDGED — CONDITION STILL ACTIVE"). The banner clears by itself when the reading is back within the limit. A new alarm always starts unacknowledged.
7. **Restarts and deploys:** an alarm still active after a restart carries on quietly. It is not raised again, the acknowledgement is kept, and reminders continue. An alarm that ended while the server was down is closed at the last time it was seen in alarm (`ALARM EPISODE CLOSED AFTER RESTART`). An episode not seen in alarm for more than 15 minutes is never resumed: a new alarm starts a new episode, so durations stay correct.
8. **No reading:** a logger with no reading in the last 40 minutes keeps its alarm state unchanged; the no-data alarm reports the gap.

---

## Notifications

| Channel | Setup | Test |
|---|---|---|
| **Email** | Settings → **Alarm Notifications** → **Email recipients** (one per line) | **Send Test Email** |
| **Text message** | Settings → **Alarm Notifications** → **Text Message Alerts**: enter the mobile number, pick the carrier, **Add**, **Save** ([guide](docs/guides/TEXT_MESSAGE_SETUP.txt)) | **Send Test Text** |

Recipients are managed by the **Admin** on the Settings page and saved in `data/notification_config.json` (included in backups). Every change is recorded in the audit trail. Each recipient gets their own message, so nobody sees the other addresses or phone numbers.

**The sender** (the account messages come *from*) needs a password, so it stays in `.env`: set `GMAIL_SENDER` and `GMAIL_APP_PASSWORD` (plus `SMTP_HOST`/`SMTP_PORT` for a non-Gmail account), then restart. The **sender name** shown in the "From" field is set on the Settings page.

**Text messages** go through the carrier's email-to-text gateway, are kept under 150 plain characters, and can be delayed or filtered by the carrier. Always confirm each phone with **Send Test Text**, and keep at least one email recipient.

Automatic alarms are sent **only** when `NOTIFICATIONS_ENABLED=true`.

### No-data alarm

Settings → **Alarm notifications** → **No-Data Alarm and Escalation** → **No-data alert**: OFF, or after 15 min, 30 min (default), 1 h, 2 h or 4 h.

- **A logger stops sending readings** for that long: one email and text (`NO DATA ALARM`) listing every logger that went quiet, then one `DATA RESTORED` message when readings arrive again. There are no repeats in between.
- **LI-COR Cloud cannot be reached** for that long, for example an API error, an expired token, or the internet being down: one `LI-COR CONNECTION LOST` message, then `LI-COR CONNECTION RESTORED`. Short blips send nothing.
- Goes to the normal alarm recipients **whatever the alarm schedule says**, because the temperature record has a gap either way. Loggers in **NOT IN USE** are skipped.
- State is kept in `data/no_data_state.json`, so a restart does not repeat the message.

### Escalation (unacknowledged alarms)

On the same card: **Escalate unacknowledged alarms** (OFF, or 15, 30 (default), 45, 60, 120 min), plus **Supervisor email recipients** and **Supervisor text addresses**.

- A temperature alarm nobody acknowledges within that time is sent **once** to the supervisor list (`ALARM ESCALATED`).
- After that, the supervisors are also told when it is **acknowledged** (and by whom), when it **returns to normal**, or when its notifications are **suspended** by the schedule or NOT IN USE.
- Without supervisor addresses, escalation does nothing. Use **Test Supervisor Email / Text** to check them.

### Outside uptime check

If the whole server or the alarm monitor stops, the dashboard cannot send any alarm. An **outside** service has to notice that:

1. The server answers `https://thermoiq.octaveworks.com/healthz` without the viewer login. This was set up once with `sudo bash cloud/allow_healthz.sh thermoiq.octaveworks.com`; everything else still asks for the login.
2. A free uptime monitor, e.g. [UptimeRobot](https://uptimerobot.com), checks it every 5 minutes. Use monitor type **HTTP(s)**, URL `https://thermoiq.octaveworks.com/healthz`, and alert contacts set to the maintenance email (and phone app).
3. It alerts when the page is unreachable (server, Caddy or container down) **or** answers 503 (the alarm monitor has stalled for 5 minutes).

### Alarm notification schedule

Each logger card on the Settings page has an **Alarm Notification Scheduler** (Admin and Operator):

| Setting | Meaning |
|---|---|
| **Weekly scheduler** OFF | Alarms follow RUNNING / NOT IN USE only |
| **Weekly scheduler** ON | Alarms are sent only inside each day's window |
| **Alarms** ON/OFF (per day) | OFF = no alarm notifications that day |
| **24 h** | Alarms all day |
| **Alarm ON / Alarm OFF** (per day) | That day's window, Pacific Time. An OFF time earlier than the ON time runs overnight: Mon ON 22:00 · OFF 06:00 covers Monday 22:00 to Tuesday 06:00. A one-minute gap between two windows (OFF 05:59, next ON 06:00) is treated as continuous, so an alarm is not suspended and raised again at that minute |

Buttons: **Copy Mon → Tue–Fri**, **Copy Mon → every day**, **Preset: Mon–Fri 24 h**, and **Apply this schedule to ALL loggers**. Readings are still displayed and logged while alarms are scheduled OFF. Schedules saved by v6.2.x are converted automatically.

The daily maintenance report is described in [Reports](#reports).

---

## Reports

### Daily maintenance report (email)

Once a day the dashboard emails a maintenance report. The email text starts with a **summary**:
- loggers out of limit, with minutes in alarm, alarm episodes and readings past the limit, and whether each logger is still in alarm;
- total time out of limit;
- open deviations, and alarm episodes that have no deviation record yet;
- loggers whose calibration is due within the reminder window, or overdue.

The email has **two attachments**:

| Attachment | Format | Contents |
|---|---|---|
| `PBF_Temperature_Downtime_24h_YYYYMMDD_HHMM.csv` | CSV | Temperature-alarm downtime report (sections listed below) |
| `PBF_All_Logger_Temperature_History_24h_YYYYMMDD_HHMM.xlsx` | Excel workbook | Temperature and humidity history, **one worksheet per logger** |

**Settings** (Settings page → Daily Maintenance Report, Admin only):

| Setting | Meaning |
|---|---|
| **Daily report** | ENABLED / DISABLED |
| **Send time** | Time of day, Pacific Time (default 08:00) |
| **Recipient email(s)** | One or more addresses, separated by commas. Blank = the `ALERT_EMAIL` address from `.env` |
| **Report window** | Last 24 hours, 48 hours or 7 days |
| **Weekly QA report** | ENABLED / DISABLED. Sent on Mondays at the send time, covering last Monday–Sunday |
| **Monthly QA report** | ENABLED / DISABLED. Sent on the 1st at the send time, covering last calendar month |
| **Calibration-due reminder email** | ENABLED / DISABLED, plus how many days before the due date (default 14) |
| **Email Report Now** | Sends the daily report immediately with the saved settings, e.g. as a test |
| **Email Last Week's / Last Month's QA Report**, **Email Calibration Reminder Now** | Send those emails immediately |

**When it is sent automatically:** once per day, at or after the send time, and only on the server where **all** of these are true:
- `DEPLOYMENT_ROLE=CLOUD-PRIMARY`;
- `NOTIFICATIONS_ENABLED=true`;
- the sender account in `.env` is set.

This stops the mini-PC backup and test installs from sending duplicates. If the server is down at the send time, the report goes out as soon as it is running again that day. **Email Report Now** works on any install.

**Who it comes from:** `REPORT_SENDER` (e.g. `reports@octaveworks.com`, display name *ThermoIQ Reports*) if `REPORT_SENDER` and `REPORT_SENDER_PASSWORD` are set in `.env`; otherwise the alarm sender (`GMAIL_SENDER`). Set it with:
```
.\windows\SET_SENDER_EMAIL.bat --report --email reports@octaveworks.com --host mail.octaveworks.com
```
The script tests the login first, then updates both the local and the server `.env`.

### Downtime report (CSV)

| Section | Contents |
|---|---|
| Header | Report window (Pacific), window length, reading basis (calibrated readings) |
| **LOGGER SUMMARY** | Per logger: alarm events, downtime minutes, availability, min/avg/max temperature |
| **DAILY LOGGER SUMMARY** | The same figures per logger per day |
| **DOWNTIME HISTORY** | Each alarm episode: start, end (or OPEN), downtime inside the window, full duration, start/worst/recovery temperature, how it ended |
| **ALARM EVENT AUDIT TRAIL** | Every alarm event in the window, with the email and text-message delivery result |

### Temperature history workbook (Excel)

- **One worksheet per logger**, and each tab is named after the logger: *Tortilla L1 Cooler*, *Tortilla L2 Cooler*, *Tortilla L3 Cooler*, *Bagel Cooler*, *Bagel Proofer 1*, *Bagel Proofer 2*, *PBF Plant Temperature*.
- **Top of each sheet:** logger name, serial, alarm limit, report window, the number of out-of-limit readings, and min / avg / max temperature.
- **Data:** one row per reading time, **Date · Time · Temperature (C) · Humidity (%RH)**, stored as numbers so they can be sorted, filtered and charted.
- **Temperatures past the alarm limit are highlighted red.** The plant-temperature logger is monitor-only and has no limit.
- The header row stays visible while scrolling, and every column has a filter.
- **Chart on each sheet:** min / avg / max per hour, with the alarm limit as a dashed line. Workbooks longer than 48 hours chart per day instead.
- All times are Pacific Time and all readings include the calibration offsets.

### Weekly and monthly QA report (Excel)

One workbook for QA and audits, `PBF_Weekly_Temperature_QA_<from>_to_<to>.xlsx` (or `Monthly`):

| Sheet | Contents |
|---|---|
| **Summary** | The summary above, then one row per logger: min / avg / max, samples, readings past the limit, alarm episodes, minutes in alarm, availability, last calibration and next due date |
| **One sheet per logger** | One row per Pacific day: min / avg / max, limit, samples, readings past the limit, alarm episodes started, minutes in alarm. Days out of limit are red. A chart of daily min / avg / max with the limit line |
| **Alarm Episodes** | Each alarm episode in the period, with who acknowledged it and its deviation status (**NO RECORD** in red when none was entered) |

- **Automatic emails:** weekly on Mondays, monthly on the 1st. The first time the server runs v6.6, it only notes the current periods, so the first emails are the next Monday and the next 1st (no back-dated reports).
- **Download:** Events page → *Weekly / monthly QA report*. Choose last week, this week so far, last month, this month so far, or any dates up to 31 days.
- **Speed:** finished days are stored in `thermoiq.db` the first time they are fetched, and the server fills in yesterday every night. Reports then take seconds instead of the ~2 seconds per day LI-COR needs.
- **Stored days are cleared** when a logger's alarm limit or calibration offset changes. They refill automatically.

### Calibration-due reminders

- **When:** once a day, at the report send time, for each logger whose latest calibration record has a *Next Calibration Due* date.
- **How often:** one email when the due date is within the reminder window (default 14 days), one on the due date, then one a week while overdue.
- **To:** the report recipients, as one email listing every logger due.
- **Stopping them:** add the new calibration record on the Audit page, with its new due date.
- **Logging:** each reminder is recorded in the event log as **CALIBRATION DUE REMINDER EMAILED**.
- **On the Audit page:** the Calibration section shows which loggers are due or overdue.

### Downloading reports from the dashboard

| Where | Button / link | File |
|---|---|---|
| **Alarm & Event History** (`/events`) | Download 24H Downtime CSV / 30-Day Downtime CSV | Downtime report |
| **Alarm & Event History** (`/events`) | Download 24H Temperature CSV | Temperature history, all loggers in one CSV |
| **Alarm & Event History** (`/events`) | Download 24H / 7-Day Temperature Excel | Temperature history workbook, one sheet per logger, with chart |
| **Alarm & Event History** (`/events`) | **Download Excel** (next to the filters) | The event log exactly as filtered: period, day or date range, logger, event type |
| **Alarm & Event History** (`/events`) | Download QA Excel | Weekly / monthly / custom QA workbook |
| Browser address bar | `/api/temperature-history-all.xlsx?hours=24` (1–168) | Temperature history workbook, one sheet per logger |
| **Trends** (`/trends`) | Download 24 Hours / Selected Date CSV | Temperature + humidity for the selected range or date |
| **Audit** (`/audit`) | Download Modification-Restricted PDF | Audit report PDF for one logger and date |
| **Audit** (`/audit`) | **Download Excel** / **Download CSV** (audit trail filters) | The audit trail exactly as filtered: period, day or date range, logger, category. Choose *Everything* for the full trail |

Every report email is recorded in the event log as **24H MAINTENANCE REPORT EMAILED**, with the recipients and window. The send status and last error are kept in `data/maintenance_report_state.json`.

---

## Data storage and backups

All state is kept in `data/`, in the project root. Since v6.5 the two growing logs (alarm events and the audit trail) are in a small SQLite database, `thermoiq.db`; settings stay in JSON files:

| File | Contents |
|---|---|
| `alarm_config.json` | Per-logger limits, names, monitoring flag, weekly schedules |
| `notification_config.json` | Email and text-message recipients, sender name |
| `alarm_state.json` | Current alarm and acknowledgement state |
| `thermoiq.db` (+ `-wal`, `-shm`) | SQLite: alarm event log (`events` table) and full audit trail (`audit` table) |
| `alarm_events.json`, `audit_trail.json` | Before v6.5: the event log and audit trail. Kept read-only after the upgrade (see below) |
| `downtime_history.json`, `downtime_active.json` | Maintenance downtime records |
| `maintenance_report_config.json`, `maintenance_report_state.json` | Daily report settings and last-sent state |
| `calibration_records.json` | Calibration records and offsets per logger |
| `deviation_records.json` | Alarm deviations and corrective actions |
| `audit_config.json` | Retention and backup settings |
| `audit_backup_state.json` | Last-backup info |
| `backups/*.zip` | Daily backups |

- **Raw sensor history is not stored locally.** It is fetched from LI-COR Cloud whenever someone asks for it, so how far back you can go depends on LI-COR's retention.
- **Retention** of local records can be set to 1, 2 or 3 years (default 3).
- **Automatic backup:** a ZIP every day at **02:15 Pacific**, keeping the **30** most recent, **only on the instance with `DEPLOYMENT_ROLE=CLOUD-PRIMARY`**. The mini-PC and test copies never back up or apply retention on their own; back them up manually (see below). `.env` is **never** included in backups.
- **Timestamps** are stored in UTC and shown in `America/Vancouver` time.
- **Upgrade to v6.5:** on start-up the app copies `alarm_events.json` and `audit_trail.json` into `thermoiq.db` (records already there are skipped, so this is safe to repeat). The JSON files are not changed or written to again, so rolling back to v6.4 still shows history up to the upgrade; anything recorded after the upgrade is only in the database.
- **Backups** still contain `alarm_events.json` and `audit_trail.json`: they are exported from the database when the ZIP is made, so the backup format is unchanged.
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
| `/settings` | Admin/Operator login, limits, per-day alarm schedules, email/text recipients, accounts, reports | `settings.html`, `settings.js` |
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
| GET | `/healthz` | `200` while the alarm monitor runs, `503` when stalled 5 min. No viewer login (for the outside uptime monitor) |
| GET | `/api/v501-status` | Extended system status |
| GET | `/api/email-status` | Whether email and texts are configured (recipient counts only) |

### Alarms
| Method | Path | Description |
|---|---|---|
| GET | `/api/alarm-events` | Alarm event log |
| DELETE | `/api/alarm-events` | Disabled (protects the audit trail) |
| POST | `/api/ack/{sn}` | Acknowledge the alarm on a logger |
| POST | `/api/test-email` | Send a test email |
| POST | `/api/test-alarm-email` | Send a sample alarm email |

### Downloads and reports
| Method | Path | Description |
|---|---|---|
| GET | `/api/download-24h/{sn}` | Last 24 h CSV for one logger |
| GET | `/api/download-date/{sn}` | CSV for one calendar date |
| GET | `/api/download-date-all.csv` | CSV for one date, all loggers |
| GET | `/api/download-range/{sn}` | CSV for a date range |
| GET | `/api/download-range-all.csv` | CSV for a date range, all loggers |
| GET | `/api/temperature-history-all.csv` | Temperature history, all loggers |
| GET | `/api/temperature-history-all.xlsx` | Temperature history workbook: one worksheet per logger (also attached to the maintenance report email) |
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
| POST | `/api/admin/config/{sn}` | Update one logger (limit, monitoring, calibration, `schedule_week`) |
| POST | `/api/admin/schedule/all` | Apply one weekly schedule to all loggers (Operator allowed) |
| POST | `/api/admin/notifications` | Save email/text recipients and sender name (Admin) |
| POST | `/api/admin/notifications/test-email` | Send a test email to all email recipients (Admin) |
| POST | `/api/admin/notifications/test-text` | Send a test text to all text recipients (Admin) |
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
| No emails | Click **Send Test Email** in Settings; Gmail needs an **App Password**, not your normal password; check `NOTIFICATIONS_ENABLED` |
| No text messages | Click **Send Test Text**; check the carrier domain in [the guide](docs/guides/TEXT_MESSAGE_SETUP.txt). Some carriers delay or block gateway texts |
| Daily report not arriving | Only the server with `DEPLOYMENT_ROLE=CLOUD-PRIMARY` and `NOTIFICATIONS_ENABLED=true` sends it. Check that **Daily report** is ENABLED, then click **Email Report Now**; the last error is in `data/maintenance_report_state.json`. Look in the spam folder too |
| Report sender login rejected | Re-run `windows\SET_SENDER_EMAIL.bat --report ...`; `REPORT_SENDER` must be a mailbox on the same mail server as `SMTP_HOST` |
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
- Email and text recipients (phone numbers) are visible to the Admin only, never to the Operator or the public status endpoints.
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
| **v6.7.0** | U5-U10: no-data and LI-COR alarms, escalation to supervisors, /healthz, one-minute schedule gap bridged, alarm episodes no longer resumed after restarts, no ... |
| **v6.6.0** | Report summary, weekly/monthly QA Excel, calibration-due reminders, filtered Excel downloads for events and audit trail, charts in Excel |
| **v6.5.0** | Event log and audit trail moved to SQLite (faster filters), buildx on server |
| **v6.4.0** | Same header on all pages, Trends compare and custom dates, big screen mode, phone fixes, HTTPS-only login cookie |
| **v6.3.1** | Alarm Reliability |
| **v6.3.0** | User logins and role rights, collapsible settings, event/audit date filters, trends logger picker |
| **v6.2.9** | Softer selected tab, heavier ThermoIQ wordmark, lighter title |
| **v6.2.8** | Softer tab glow, larger site name, smaller title, white bold date and time |
| **v6.2.7** | New dashboard header and colored navigation tabs |
| **v6.2.6** | Reports format and add reports email |
| **v6.2.5** | Remove design credit |
| **v6.2.4** | add sender email |
| **v6.2.3** | setting and alarm scheduler |
| **v6.2.2** | update the release tag workflow |
| **v6.2.1** | fixed lock and add release |
| **v6.2.0** | **Audit controls:** calibration records, deviations, expanded audit trail, retention, daily backups |
| *(unreleased)* | Project reorganized into `app/`, `tools/`, `windows/`, `cloud/` and `docs/`. No change to application behaviour. |

Detailed notes for each release are in [docs/release-notes/](docs/release-notes/). The oldest history (v3 to v4.x) is in [V3_TO_V4_HISTORY.txt](docs/release-notes/V3_TO_V4_HISTORY.txt).
