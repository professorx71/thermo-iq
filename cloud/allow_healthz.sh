#!/usr/bin/env bash
# Let an outside uptime monitor reach https://<domain>/healthz without the viewer login.
# Everything else on the site keeps asking for the login. Only the <domain> block changes;
# the other sites in the Caddyfile are left untouched.
#
#   sudo bash allow_healthz.sh thermoiq.octaveworks.com
#
# /healthz answers {"status":"ok"} (HTTP 200) while the alarm monitor runs and HTTP 503 when
# it has stalled for 5 minutes. It shows no readings, names or settings.
# Backs up the Caddyfile first; a failed validation restores it. Safe to run twice.
set -euo pipefail

DOMAIN="${1:-thermoiq.octaveworks.com}"
CADDYFILE=/etc/caddy/Caddyfile
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || { echo "Bad domain: $DOMAIN" >&2; exit 1; }
grep -q "^https://$DOMAIN {" "$CADDYFILE" || { echo "No 'https://$DOMAIN {' site in $CADDYFILE (run add_domain.sh first)." >&2; exit 1; }

# Already done?
if awk -v d="https://$DOMAIN {" '$0==d{inb=1;next} inb&&/^}/{exit} inb&&/basic_auth @needs_login/{found=1} END{exit !found}' "$CADDYFILE"; then
  echo "/healthz is already open on $DOMAIN."
else
  BACKUP="$CADDYFILE.before-healthz-$(date +%Y%m%d-%H%M%S)"
  cp -p "$CADDYFILE" "$BACKUP"; echo "Caddyfile backup: $BACKUP"
  # Inside the site block only: "basic_auth {" -> named matcher + "basic_auth @needs_login {".
  awk -v d="https://$DOMAIN {" '
    $0==d {inb=1; print; next}
    inb && /^}/ {inb=0}
    inb && /^[[:space:]]*basic_auth[[:space:]]*\{/ && !done {
      match($0,/^[[:space:]]*/); ind=substr($0,1,RLENGTH)
      print ind "@needs_login not path /healthz"
      sub(/basic_auth[[:space:]]*\{/,"basic_auth @needs_login {"); done=1
    }
    {print}
    END {if(!done) exit 3}' "$BACKUP" >"$CADDYFILE.new" || { rm -f "$CADDYFILE.new"; echo "No basic_auth block found in the $DOMAIN site; nothing changed." >&2; exit 1; }
  # Keep the owner and permissions of the original file.
  cat "$CADDYFILE.new" >"$CADDYFILE"; rm -f "$CADDYFILE.new"
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then
    systemctl reload caddy
    echo "/healthz opened on $DOMAIN."
  else
    tail -5 /tmp/caddy-validate.log >&2
    cp -p "$BACKUP" "$CADDYFILE"; systemctl reload caddy || true
    echo "Caddy config invalid: restored the backup, nothing changed." >&2; exit 1
  fi
fi

sleep 1
h=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/healthz" || true)
p=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/" || true)
echo "https://$DOMAIN/healthz -> HTTP $h (200 = alarm monitor running)"
echo "https://$DOMAIN/        -> HTTP $p (401 = still asks for the viewer login, correct)"
