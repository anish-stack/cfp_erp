# Production deployment — hovermessage.com (Cloudflare · Nginx · PM2 · no Docker)

| What | Host | Serves |
|---|---|---|
| Backend API | `apicfp.hovermessage.com` | Node API (PM2 `cpf-api` + `cpf-worker`) on 127.0.0.1:5050 |
| Patient booking + landing pages | `cfp.hovermessage.com` | `frontend/booking/dist` |
| Console — Super Admin | `admincfp.hovermessage.com` | `frontend/console/dist` |
| Console — Clinic | `cliniccfp.hovermessage.com` | `frontend/console/dist` |
| Console — Sales CRM | `crmcfp.hovermessage.com` | `frontend/console/dist` |
| Everything else | `*.hovermessage.com` (wildcard) | 404 page, unless another app on the VPS has its own site |

All host names live in **`deploy/domains.env`** — change them there and re-run `setup-sites.sh` + `build-frontend.sh`.
Console mode comes from the host prefix (`admin…`, `clinic…`, `crm…`), so any names starting with those words work.

> **Why not `admin.cfp.hovermessage.com`?** Cloudflare's free Universal SSL covers `hovermessage.com` and `*.hovermessage.com` only — one level. Two-level names would show an SSL error.

## 1. Cloudflare DNS (zone hovermessage.com)
Your VPS IP: `157.173.221.5`. Add (all **Proxied**, orange cloud):

| Type | Name | Content | Note |
|---|---|---|---|
| A | `apicfp` | 157.173.221.5 | already there |
| A | `cfp` | 157.173.221.5 | already there |
| A | `*` | 157.173.221.5 | **wildcard** — covers `admincfp`, `cliniccfp`, `crmcfp` and any future sub-domain. Existing records (`hovermail`, `apihovermail` …) keep working: an exact record always wins over `*`. |

(Prefer no wildcard? add three A records `admincfp`, `cliniccfp`, `crmcfp` instead and set `WILDCARD_CATCHALL=0` in `deploy/domains.env`.)

Cloudflare settings for the zone:
- **SSL/TLS → Overview → Full (strict)**
- **SSL/TLS → Edge Certificates →** Always Use HTTPS: on · Minimum TLS 1.2
- **Rules → Settings → Managed Transforms → “Add visitor location headers”: on** (spin-wheel analytics get the visitor's city)
- **Caching → Configuration → Browser Cache TTL: Respect Existing Headers** (the PWA service worker must not be cached)
- Optional: **Security → WAF → rate limiting** on `apicfp.hovermessage.com/api/v1/auth/*`

## 2. Origin certificate (one wildcard cert for every host)
Cloudflare → SSL/TLS → **Origin Server → Create Certificate** → hosts `hovermessage.com, *.hovermessage.com`, RSA, 15 years → copy both blocks:
```bash
sudo mkdir -p /etc/ssl/cloudflare && sudo chmod 700 /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/hovermessage.com.pem   # paste "Origin Certificate"
sudo nano /etc/ssl/cloudflare/hovermessage.com.key   # paste "Private key"
sudo chmod 600 /etc/ssl/cloudflare/*
```
(No certbot needed. If your other apps already use a cert at another path, either reuse this one or point `SSL_CERT` / `SSL_KEY` in `deploy/domains.env` to yours — it must cover `*.hovermessage.com`.)

## 3. Packages (skip what the VPS already has)
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs nginx redis-server
sudo npm i -g pm2
# MongoDB 7: https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/
```
Check the API port is free: `sudo ss -ltnp | grep 5050` (busy? pick another, set it in `deploy/domains.env` → `API_PORT` **and** `backend/.env` → `PORT`).

## 4. MongoDB replica set (required — booking & billing use transactions)
Already running Mongo for other apps? Just make sure it is a replica set and create a separate user/database:
```bash
sudo mkdir -p /etc/mongodb && openssl rand -base64 756 | sudo tee /etc/mongodb/keyfile
sudo chown mongodb:mongodb /etc/mongodb/keyfile && sudo chmod 400 /etc/mongodb/keyfile
sudo cp deploy/mongod.conf /etc/mongod.conf          # only on a fresh Mongo
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
mongosh admin --eval 'db.createUser({user:"admin",pwd:"<strong>",roles:["root"]})'
mongosh admin -u admin -p --eval 'db.getSiblingDB("cpf_erp").createUser({user:"cpf",pwd:"<strong>",roles:["readWrite"]})'
sudo systemctl restart mongod
```
Redis: bound to 127.0.0.1 with `requirepass`. This app uses **database 3** (`/3` in `REDIS_URL`) so its job queues never mix with other apps.

## 5. App + backend
```bash
mkdir -p /var/log/cpf
git clone <repo> /root/cfp_erp && cd /root/cfp_erp
cp deploy/env/backend.env.production backend/.env && nano backend/.env   # fill every <…>
cd backend && npm ci --omit=dev && npm run seed:live && cd ..
pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
curl -s http://127.0.0.1:5050/health || pm2 logs cpf-api --lines 50
```
Exactly one `cpf-worker` — it owns reminders and daily jobs (09:00 follow-ups, 08:00 stock alerts, 20:45 no-show close; IST).

## 6. Frontends
```bash
deploy/build-frontend.sh        # writes .env.production for console + booking from domains.env, then builds
```

## 7. Nginx
```bash
sudo deploy/setup-sites.sh
```
Creates `apicfp`, `cfp`, `admincfp`, `cliniccfp`, `crmcfp` sites, the `*.hovermessage.com` catch-all (`zz-wildcard.hovermessage.com`), and `/etc/nginx/conf.d/cloudflare-realip.conf` (real visitor IPs instead of Cloudflare's). It runs `nginx -t` before reloading and never edits your other sites.
Refresh Cloudflare IP ranges monthly: `sudo crontab -e` → `0 4 1 * * /root/cfp_erp/deploy/cloudflare-realip.sh && systemctl reload nginx`

Check:
```bash
curl -sI https://apicfp.hovermessage.com/health | head -1     # 200
curl -sI https://cfp.hovermessage.com | head -1                      # 200
curl -sI https://admincfp.hovermessage.com | head -1                 # 200
curl -sI https://random.hovermessage.com | head -1                   # 404 (catch-all)
```
Then open `https://admincfp.hovermessage.com` and log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## 8. Backups & updates
```bash
crontab -e
30 2 * * * MONGO_BACKUP_URI='mongodb://admin:<pwd>@127.0.0.1/cpf_erp?authSource=admin' /root/cfp_erp/deploy/backup-mongo.sh
```
Copy `/var/backups/cpf-mongo` off-server (rclone/S3).

Update:
```bash
cd /root/cfp_erp && git pull
(cd backend && npm ci --omit=dev && npm run seed:live) && deploy/build-frontend.sh
pm2 reload cpf-api && pm2 restart cpf-worker
```
After an update, Cloudflare may serve old files for a minute: **Caching → Purge Everything** if the console looks stale.

### Moving to the clinic's own domain later
Edit `deploy/domains.env` (e.g. `API_HOST=api.centreforpilesandfistula.com`, `ADMIN_HOST=admin.centreforpilesandfistula.com` …), update `CORS_ORIGINS`, `PUBLIC_API_URL`, `BOOKING_URL` in `backend/.env`, install that domain's origin cert, then run `deploy/build-frontend.sh`, `sudo deploy/setup-sites.sh`, `pm2 reload cpf-api`. Update the Razorpay webhook URL too.

## 9. Integrations

### WhatsApp — sms4power WAPP API (OTP + all patient messages)
`.env`: `WAPP_API_KEY=<key>`, `WAPP_API_URL=https://api.wtap.sms4power.com/wapp/v2/api/send` (switch to `http://` only if https is refused — the key travels in the query string), `OTP_CHANNEL=whatsapp`.
`PUBLIC_API_URL=https://apicfp.hovermessage.com` and `DOC_LINK_SECRET=<48 random chars>` — invoice/prescription PDFs are sent as signed links that expire after `DOC_LINK_TTL_DAYS` (default 30).

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
- Server-side: `POST https://apicfp.hovermessage.com/api/v1/public/leads` with header `x-api-key: $WEBSITE_API_KEY`, body `{ name, phone, email?, city?, condition?, message?, utm? }`.
- Or link CTA buttons to `https://cfp.hovermessage.com/?utm_source=website` (booking portal) or a CMS landing page `/f/<slug>`.
- Webhooks out: Console → Settings → Integrations (HMAC-SHA256 signed: `X-CPF-Signature: sha256=hex(HMAC(secret, timestamp + "." + body))`).

### Razorpay
Webhook URL: `https://apicfp.hovermessage.com/api/v1/payments/webhook` — events `payment_link.paid`, `payment_link.expired`, `qr_code.credited`, `payment.captured`; same secret in Console → Settings → Integrations → Razorpay.

## 10. Go-live checklist
- [ ] `NODE_ENV=production`, 48-byte random JWT secrets, `OTP_DEV_LOG` irrelevant in prod (ignored)
- [ ] Super admin password changed after first login
- [ ] Branch addresses/phones/GSTIN, doctor schedules, holidays entered
- [ ] Service prices (SRV-CONSULT etc.) set in Products
- [ ] Roles reviewed; staff created with correct branches
- [ ] WAPP key set; OTP + booking WhatsApp tested on a real number; signed PDF link opens from outside the network
- [ ] Staff mobile numbers filled (lead alerts) and branch WhatsApp numbers (stock alerts)
- [ ] Backups running + restore tested
