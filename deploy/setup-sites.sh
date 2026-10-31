#!/usr/bin/env bash
# Generates + enables nginx sites. Run as root after certbot has issued the certificate.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APP=/var/www/cpf-erp/frontend
declare -A SITES=(
  [appointment.centreforpilesandfistula.com]=$APP/booking/dist
  [admin.centreforpilesandfistula.com]=$APP/console/dist
  [clinic.centreforpilesandfistula.com]=$APP/console/dist
  [crm.centreforpilesandfistula.com]=$APP/console/dist
)
for host in "${!SITES[@]}"; do
  sed -e "s|__HOST__|$host|g" -e "s|__ROOT__|${SITES[$host]}|g" "$DIR/nginx/spa.conf.template" > "/etc/nginx/sites-available/$host"
  ln -sf "/etc/nginx/sites-available/$host" "/etc/nginx/sites-enabled/$host"
done
cp "$DIR/nginx/api.conf" /etc/nginx/sites-available/api.centreforpilesandfistula.com
ln -sf /etc/nginx/sites-available/api.centreforpilesandfistula.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
echo "Sites enabled."
