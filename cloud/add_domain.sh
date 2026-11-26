#!/usr/bin/env bash
# Serve the dashboard at a domain name with HTTPS, on a VPS where Caddy runs as a
# system service (/etc/caddy/Caddyfile, auto_https off) and certbot issues certificates
# through the webroot /var/www/acme. Other sites in the Caddyfile are left untouched.
#
#   sudo bash add_domain.sh thermoiq.octaveworks.com
#
# - Backs up the Caddyfile; any failed validation restores it (other sites keep running).
# - Gets a Let's Encrypt certificate and installs a renewal hook (auto-renews).
# - Uses the SAME viewer login (basic auth) as the existing https://<IP> site.
# - The existing https://<IP> address keeps working.
set -euo pipefail

DOMAIN="${1:-thermoiq.octaveworks.com}"
UPSTREAM="${UPSTREAM:-127.0.0.1:8000}"
CADDYFILE=/etc/caddy/Caddyfile
WEBROOT=/var/www/acme
TLS_DIR="/etc/caddy/${DOMAIN%%.*}-tls"
HOOK="/etc/letsencrypt/renewal-hooks/deploy/92-${DOMAIN%%.*}-caddy"
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || { echo "Bad domain: $DOMAIN" >&2; exit 1; }

BACKUP="$CADDYFILE.before-${DOMAIN%%.*}-$(date +%Y%m%d-%H%M%S)"
cp -p "$CADDYFILE" "$BACKUP"
echo "Caddyfile backup: $BACKUP"

apply() {   # validate + reload, or restore the backup
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then
    systemctl reload caddy
  else
    tail -5 /tmp/caddy-validate.log >&2
    cp -p "$BACKUP" "$CADDYFILE"; systemctl reload caddy || true
    echo "Caddy config invalid: restored the backup, nothing changed." >&2; exit 1
  fi
}

# 1) HTTP site: answers the certificate challenge, redirects everything else to HTTPS
if ! grep -q "^http://$DOMAIN {" "$CADDYFILE"; then
  cat >>"$CADDYFILE" <<CADDY

# THERMOIQ DOMAIN $DOMAIN (added by add_domain.sh)
http://$DOMAIN {
	handle /.well-known/acme-challenge/* {
		root * $WEBROOT
		file_server
	}
	handle {
		redir https://$DOMAIN{uri} 308
	}
}
CADDY
  apply; echo "HTTP site for $DOMAIN added."
fi

# 2) certificate (webroot, same as the other domains) + renewal hook
mkdir -p "$WEBROOT/.well-known/acme-challenge"
cat >"$HOOK" <<HOOKEOF
#!/bin/sh
set -eu
[ "\${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/$DOMAIN" ] || exit 0
install -d -m 0750 -o root -g caddy $TLS_DIR
install -m 0640 -o root -g caddy "\$RENEWED_LINEAGE/fullchain.pem" $TLS_DIR/fullchain.pem
install -m 0640 -o root -g caddy "\$RENEWED_LINEAGE/privkey.pem" $TLS_DIR/privkey.pem
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
HOOKEOF
chmod 755 "$HOOK"
certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --key-type ecdsa \
  --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
RENEWED_LINEAGE="/etc/letsencrypt/live/$DOMAIN" "$HOOK"
echo "Certificate installed in $TLS_DIR (renews automatically)."

# 3) HTTPS site with the same viewer login as the IP site
if ! grep -q "^https://$DOMAIN {" "$CADDYFILE"; then
  AUTH=$(awk '/^https:\/\/[0-9.]+ \{/{ip=1} ip&&/basic_auth \{/{getline; print; exit}' "$CADDYFILE" | sed 's/^[[:space:]]*//')
  [[ -n "$AUTH" ]] || { echo "Could not find the existing viewer login (basic_auth) in $CADDYFILE." >&2; exit 1; }
  cat >>"$CADDYFILE" <<CADDY

https://$DOMAIN {
	tls $TLS_DIR/fullchain.pem $TLS_DIR/privkey.pem
	encode zstd gzip
	basic_auth {
		$AUTH
	}
	reverse_proxy $UPSTREAM
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options SAMEORIGIN
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
}
CADDY
  apply; echo "HTTPS site for $DOMAIN added."
fi
unset AUTH

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/" || true)
echo "https://$DOMAIN/ answers HTTP $code (401 = asking for the viewer login, which is correct)."
