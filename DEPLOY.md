# Production deployment (VPS · Nginx · PM2 · SSL · no Docker)

Tested target: Ubuntu 22.04/24.04, 4 vCPU / 8 GB RAM.

## 1. DNS
A-records → VPS IP: `api`, `appointment`, `admin`, `clinic`, `crm` (`.centreforpilesandfistula.com`).

## 2. Packages
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs nginx redis-server
sudo npm i -g pm2
# MongoDB 7: follow https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/
sudo apt install -y certbot python3-certbot-nginx
```

## 3. MongoDB replica set (required — booking & billing use transactions)
```bash
sudo mkdir -p /etc/mongodb && openssl rand -base64 756 | sudo tee /etc/mongodb/keyfile
sudo chown mongodb:mongodb /etc/mongodb/keyfile && sudo chmod 400 /etc/mongodb/keyfile
sudo cp deploy/mongod.conf /etc/mongod.conf
# first start WITHOUT security block to create users, then enable it:
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
mongosh admin --eval 'db.createUser({user:"admin",pwd:"<strong>",roles:["root"]})'
mongosh admin -u admin -p --eval 'db.getSiblingDB("cpf_erp").createUser({user:"cpf",pwd:"<strong>",roles:["readWrite"]})'
sudo systemctl restart mongod
```
`MONGO_URI=mongodb://cpf:<pwd>@127.0.0.1:27017/cpf_erp?replicaSet=rs0&authSource=cpf_erp`

Redis: keep bound to 127.0.0.1, set `requirepass`, use `REDIS_URL=redis://:<pwd>@127.0.0.1:6379`.

## 4. App
```bash
sudo mkdir -p /var/www /var/log/cpf && sudo chown $USER /var/www /var/log/cpf
git clone <repo> /var/www/cpf-erp && cd /var/www/cpf-erp
cd backend && cp .env.example .env && nano .env      # NODE_ENV=production, secrets, CORS_ORIGINS, COOKIE_DOMAIN=.centreforpilesandfistula.com
npm ci --omit=dev && npm run seed
cd ../frontend
printf 'VITE_API_URL=https://api.centreforpilesandfistula.com/api/v1\nVITE_BOOKING_URL=https://appointment.centreforpilesandfistula.com\n' | tee console/.env.production booking/.env.production
npm ci && npm run build
```
`CORS_ORIGINS=https://appointment.centreforpilesandfistula.com,https://admin.centreforpilesandfistula.com,https://clinic.centreforpilesandfistula.com,https://crm.centreforpilesandfistula.com`

## 5. SSL + Nginx
```bash
sudo certbot certonly --nginx -d centreforpilesandfistula.com -d api.centreforpilesandfistula.com \
  -d appointment.centreforpilesandfistula.com -d admin.centreforpilesandfistula.com \
  -d clinic.centreforpilesandfistula.com -d crm.centreforpilesandfistula.com
sudo deploy/setup-sites.sh
```
(If the main website already holds a cert under another name, adjust `ssl_certificate` paths.)

## 6. PM2
```bash
pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
pm2 logs cpf-api
```
Exactly one `cpf-worker` — it owns reminders and daily jobs (09:00 follow-ups, 08:00 stock alerts, 20:45 no-show close; IST).

## 7. Backups
```bash
crontab -e
30 2 * * * MONGO_BACKUP_URI='mongodb://admin:<pwd>@127.0.0.1/cpf_erp?authSource=admin' /var/www/cpf-erp/deploy/backup-mongo.sh
```
Copy `/var/backups/cpf-mongo` off-server (rclone/S3).

## 8. Updates
```bash
cd /var/www/cpf-erp && git pull
(cd backend && npm ci --omit=dev && npm run seed) && (cd frontend && npm ci && npm run build)
pm2 reload cpf-api && pm2 restart cpf-worker
```

## 9. Integrations

### WhatsApp — sms4power WAPP API (OTP + all patient messages)
`.env`: `WAPP_API_KEY=<key>`, `WAPP_API_URL=https://api.wtap.sms4power.com/wapp/v2/api/send` (switch to `http://` only if https is refused — the key travels in the query string), `OTP_CHANNEL=whatsapp`.
`PUBLIC_API_URL=https://api.centreforpilesandfistula.com` and `DOC_LINK_SECRET=<48 random chars>` — invoice/prescription PDFs are sent as signed links that expire after `DOC_LINK_TTL_DAYS` (default 30).

| Trigger | Sent to | Attachment |
|---|---|---|
| OTP send / resend (sent synchronously, patient waits) | patient | — |
| New patient / family profile | account mobile | — |
| Appointment booked · rescheduled · cancelled | patient | — |
| Check-in / walk-in token | patient | — |
| Reminder 24 h and 2 h before (skipped after check-in) | patient | — |
| Missed appointment (20:45 IST daily close) | patient | — |
| Prescription saved (doctor can untick) | patient | prescription PDF |
| Invoice / POS bill created | patient or walk-in customer phone | invoice PDF |
| Later payment · advance received/refunded | patient | invoice PDF once fully paid |
| Return / refund (credit note) | patient | — |
| Follow-up due (09:00 IST) | patient | — |
| Website / landing-page enquiry | lead | — |
| Lead assigned | salesperson (staff mobile) | — |
| Daily stock alert (08:00 IST) | branch WhatsApp number | — |

Every event has an on/off switch in Console → Settings → Notifications. Manual resend: appointment drawer, invoice page, patient → Prescriptions.
Provider errors 501 (bad key), 502 (no balance), 505 (no active WA number), 507 (invalid number) are not retried; network errors retry with backoff. Every send is in Console → Notifications.

### SMS (MSG91, DLT) — optional
- OTP fallback: `OTP_CHANNEL=sms` or `both` + `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID` (template contains `##OTP##`).
- Appointment flow `MSG91_FLOW_APPT` vars: `name, booking, date, time, branch, status`; reminder flow `MSG91_FLOW_REMINDER`: `name, date, time, branch`.

### Main website → CRM
- Server-side: `POST https://api.centreforpilesandfistula.com/api/v1/public/leads` with header `x-api-key: $WEBSITE_API_KEY`, body `{ name, phone, email?, city?, condition?, message?, utm? }`.
- Or link CTA buttons to `https://appointment.centreforpilesandfistula.com/?utm_source=website` (booking portal) or a CMS landing page `/f/<slug>`.
- Webhooks out: Console → Settings → Integrations (HMAC-SHA256 signed: `X-CPF-Signature: sha256=hex(HMAC(secret, timestamp + "." + body))`).

## 10. Go-live checklist
- [ ] `NODE_ENV=production`, 48-byte random JWT secrets, `OTP_DEV_LOG` irrelevant in prod (ignored)
- [ ] Super admin password changed after first login
- [ ] Branch addresses/phones/GSTIN, doctor schedules, holidays entered
- [ ] Service prices (SRV-CONSULT etc.) set in Products
- [ ] Roles reviewed; staff created with correct branches
- [ ] WAPP key set; OTP + booking WhatsApp tested on a real number; signed PDF link opens from outside the network
- [ ] Staff mobile numbers filled (lead alerts) and branch WhatsApp numbers (stock alerts)
- [ ] Backups running + restore tested
