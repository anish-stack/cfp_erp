#!/usr/bin/env bash
# Generates + enables the nginx sites from deploy/domains.env. Run as root (sudo deploy/setup-sites.sh).
# Re-run any time you change a host name. Does not touch your other sites.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
set -a; source "$DIR/domains.env"; set +a

[ -f "$SSL_CERT" ] && [ -f "$SSL_KEY" ] || { echo "✖ SSL cert/key not found ($SSL_CERT / $SSL_KEY) — see DEPLOY.md step 2"; exit 1; }

# file names end in .conf — many servers only load "include /etc/nginx/sites-enabled/*.conf;"
render() { # template host root name
  local f="$4.conf"
  rm -f "/etc/nginx/sites-enabled/$4" "/etc/nginx/sites-available/$4"   # old names without .conf
  sed -e "s|__HOST__|$2|g" -e "s|__ROOT__|$3|g" -e "s|__PORT__|$API_PORT|g" -e "s|__ZONE__|$ZONE|g" \
      -e "s|__SSL_CERT__|$SSL_CERT|g" -e "s|__SSL_KEY__|$SSL_KEY|g" "$DIR/nginx/$1" > "/etc/nginx/sites-available/$f"
  ln -sf "/etc/nginx/sites-available/$f" "/etc/nginx/sites-enabled/$f"
  echo "  ✔ $f"
}

# nginx (www-data) must be able to reach the built files even when the repo lives under /root:
# give "pass-through" (execute only, no listing) on the parent folders and read access to dist/ only.
p="$APP_DIR/frontend"
while [ "$p" != "/" ]; do chmod o+x "$p"; p="$(dirname "$p")"; done
chmod -R o+rX "$APP_DIR/frontend/booking/dist" "$APP_DIR/frontend/console/dist"

echo "nginx sites:"
render api.conf.template "$API_HOST" "" "$API_HOST"
render spa.conf.template "$BOOKING_HOST" "$APP_DIR/frontend/booking/dist" "$BOOKING_HOST"
for h in "$ADMIN_HOST" "$CLINIC_HOST" "$CRM_HOST"; do
  render spa.conf.template "$h" "$APP_DIR/frontend/console/dist" "$h"
done
if [ "${WILDCARD_CATCHALL:-1}" = "1" ]; then
  render wildcard.conf.template "*.$ZONE" "" "zz-wildcard.$ZONE"
else
  rm -f "/etc/nginx/sites-enabled/zz-wildcard.$ZONE" "/etc/nginx/sites-enabled/zz-wildcard.$ZONE.conf"
fi

bash "$DIR/cloudflare-realip.sh"
# nginx -s reload works even when systemctl fails ("Too many open files" on busy servers)
nginx -t && (nginx -s reload || systemctl reload nginx)
echo "Loaded: $(nginx -T 2>/dev/null | grep -c "server_name .*$ZONE") server blocks for $ZONE"
echo "Done. Hosts: https://$API_HOST  https://$BOOKING_HOST  https://$ADMIN_HOST  https://$CLINIC_HOST  https://$CRM_HOST"