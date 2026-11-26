"""Change the alarm SENDER account (GMAIL_SENDER / GMAIL_APP_PASSWORD / SMTP_HOST / SMTP_PORT),
or with --report the maintenance-report sender (REPORT_SENDER / REPORT_SENDER_PASSWORD),
in the local .env and on the cloud server, after checking that the login works.

The password is typed here (hidden) and is never printed. Nothing is changed unless the
login test succeeds. Each .env is backed up first (.env.bak-YYYYMMDD-HHMMSS).

usage:
  python tools/set_sender.py --email alarm@octaveworks.com --host mail.octaveworks.com
  python tools/set_sender.py --report --email reports@octaveworks.com --host mail.octaveworks.com
  options: --port 465|587   --local-only   --server-only
           --server ubuntu@148.113.244.247   --root /opt/pbf-temp-dashboard
"""
import argparse, base64, getpass, json, smtplib, subprocess, sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]

def smtp_login(host, port, user, password):
    if port == 465:
        s = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        s = smtplib.SMTP(host, port, timeout=20); s.starttls()
    try:
        s.login(user, password)
    finally:
        try: s.quit()
        except Exception: pass

# Shared by the local update and the server update (sent to the server as source code).
EDIT_ENV = r'''
import os, re, shutil
from datetime import datetime
def edit_env(path, values):
    raw = open(path, "rb").read().decode("utf-8")
    nl = "\r\n" if "\r\n" in raw else "\n"
    lines = raw.splitlines()
    done = set()
    for i, line in enumerate(lines):
        m = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=", line)
        if m and m.group(1) in values:
            k = m.group(1)
            lines[i] = None if k in done else f"{k}={values[k]}"
            done.add(k)
    lines = [l for l in lines if l is not None]
    missing = [k for k in values if k not in done]
    if missing:
        at = next((i + 1 for i, l in enumerate(lines) if l.startswith("GMAIL_APP_PASSWORD=")), len(lines))
        lines[at:at] = [f"{k}={values[k]}" for k in missing]
    backup = f"{path}.bak-{datetime.now():%Y%m%d-%H%M%S}"
    shutil.copy2(path, backup)
    with open(path, "wb") as f:
        f.write((nl.join(lines) + nl).encode("utf-8"))
    try: os.chmod(path, 0o600)
    except OSError: pass
    return backup
'''

REMOTE = EDIT_ENV + r'''
import base64, json, smtplib, subprocess, sys, time, urllib.request
cfg = json.loads(base64.b64decode("__CFG__"))
env = cfg["root"] + "/.env"
# 1) the server itself must be able to log in (outbound mail port may differ from your PC)
try:
    if cfg["port"] == 465: s = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20)
    else:
        s = smtplib.SMTP(cfg["host"], cfg["port"], timeout=20); s.starttls()
    s.login(cfg["email"], cfg["password"]); s.quit()
except Exception as e:
    print("SERVER LOGIN TEST FAILED, server not changed:", type(e).__name__, str(e)[:200]); sys.exit(3)
print("Server login test OK")
backup = edit_env(env, cfg["values"])
print("Server .env updated (backup:", backup + ")")
compose = cfg["root"] + "/current/cloud/docker-compose.yml"
r = subprocess.run(["docker", "compose", "-f", compose, "restart", "dashboard"])
if r.returncode:
    print("Restart failed; restoring the previous .env"); shutil.copy2(backup, env)
    subprocess.run(["docker", "compose", "-f", compose, "restart", "dashboard"]); sys.exit(4)
for _ in range(30):
    time.sleep(2)
    try:
        st = json.load(urllib.request.urlopen("http://127.0.0.1:8000/api/email-status", timeout=5))
        print("Dashboard is back up. email-status:", st); sys.exit(0)
    except Exception: pass
print("WARNING: dashboard did not answer within 60 s; check: docker compose -f", compose, "ps"); sys.exit(5)
'''

def main():
    ap = argparse.ArgumentParser(description="Change the alarm sender account.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--host")
    ap.add_argument("--port", type=int, default=465, choices=[465, 587])
    ap.add_argument("--server", default="ubuntu@148.113.244.247")
    ap.add_argument("--root", default="/opt/pbf-temp-dashboard")
    ap.add_argument("--report", action="store_true",
                    help="set the REPORT sender (REPORT_SENDER), not the alarm sender; must use the same mail server")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--local-only", action="store_true")
    g.add_argument("--server-only", action="store_true")
    a = ap.parse_args()

    email = a.email.strip()
    if "@" not in email: sys.exit("Not an email address: " + email)
    domain = email.split("@", 1)[1].lower()
    host = a.host or ("smtp.gmail.com" if domain in ("gmail.com", "googlemail.com") else "mail." + domain)

    password = getpass.getpass(f"Password for {email} (typing is hidden): ")
    if not password: sys.exit("No password entered; nothing changed.")
    if any(c in password for c in "'\r\n"):
        sys.exit("Passwords containing a single quote or line break cannot be stored in .env.")
    if host == "smtp.gmail.com": password = password.replace(" ", "")

    print(f"Testing login to {host}:{a.port} as {email} ...")
    try:
        smtp_login(host, a.port, email, password)
    except smtplib.SMTPAuthenticationError:
        sys.exit("LOGIN REJECTED: wrong email or password. Nothing changed.")
    except Exception as e:
        sys.exit(f"Could not connect/log in ({type(e).__name__}: {e}). Nothing changed.")
    print("Login OK")

    # single quotes = literal value for python-dotenv (safe for # $ and spaces)
    if a.report:   # report sender shares SMTP_HOST/SMTP_PORT with the alarm sender
        values = {"REPORT_SENDER": email, "REPORT_SENDER_PASSWORD": f"'{password}'"}
    else:
        values = {"GMAIL_SENDER": email, "GMAIL_APP_PASSWORD": f"'{password}'",
                  "SMTP_HOST": host, "SMTP_PORT": str(a.port)}

    if not a.server_only:
        ns = {}; exec(EDIT_ENV, ns)
        env = BASE / ".env"
        if not env.exists(): sys.exit(f"{env} not found")
        print("Local .env updated (backup:", ns["edit_env"](str(env), values) + ")")
        print("Restart the local dashboard to use it.")

    if not a.local_only:
        cfg = {"email": email, "password": password, "host": host, "port": a.port,
               "root": a.root, "values": values}
        script = REMOTE.replace("__CFG__", base64.b64encode(json.dumps(cfg).encode()).decode())
        print(f"Updating {a.server}:{a.root}/.env ...")
        r = subprocess.run(["ssh", a.server, "python3 -"], input=script.encode())
        if r.returncode: sys.exit(f"Server update failed (exit {r.returncode}).")
    print("Done. In Settings, click " + ("'Email Report Now'" if a.report else "'Send Test Email'")
          + " to confirm the new sender.")

if __name__ == "__main__":
    main()
