# CPF Clinic ERP

Centre for Piles & Fistula — booking portal, branch clinic management, pharmacy POS/inventory, billing, CRM and super-admin console.
MERN (JavaScript only) · Express + Mongoose · Redis + BullMQ · React (Vite) + Tailwind + shadcn-style UI · TanStack Query · Zustand · RHF + Zod.

See `ARCHITECTURE.md` (design + schema) and `DEPLOY.md` (VPS/Nginx/PM2/SSL).

## Apps

| Subdomain | App | Folder |
|---|---|---|
| api. | REST API + BullMQ worker | `backend/` |
| appointment. | Patient portal: OTP login, family profiles, booking, my visits, CMS landing pages `/f/:slug` | `frontend/booking` |
| admin. / clinic. / crm. | One staff console; subdomain sets mode (visible module groups), permissions build the sidebar | `frontend/console` |

## Modules (backend `/api/v1`)

| Area | Routes |
|---|---|
| Auth | `auth/staff/*` (JWT + refresh cookie, lockout), `auth/patient/otp/*` |
| RBAC | `roles` (catalog, CRUD, escalation guard), `staff` |
| Org | `branches` (+settings, public, names) |
| Patients | `patients` (search, cross-branch mobile lookup), `portal/*` (family profiles) |
| Scheduling | `doctors` (+weekly schedules), `scheduling/availability`, `scheduling/exceptions` (holiday/leave/special day/block, leave approval) |
| Appointments | `appointments` (list/calendar/summary, book, walk-in + token, status flow, reschedule, cancel), `portal/appointments` |
| Clinical | `clinical/records`, `prescriptions` (+PDF), `followups`, `documents` (private upload/stream), `timeline/:patient` |
| Inventory | `inventory/products|categories|suppliers`, `stock`, `batches`, `alerts`, `movements`, `receive` (GRN), `adjust`, `purchase-orders` (+approve/receive), `transfers` (+receive/cancel) |
| Billing/POS | `billing/invoices` (GST, FEFO stock-out, split payments, advance use, PDF, return/credit note/refund, cancel), `billing/pos/checkout`, `billing/advances`, `billing/payments` |
| CRM | `crm/leads` (list/board, dedupe, import/export CSV, bulk assign/stage, activities, convert → patient + appointment), `stages`, `tasks`, `campaigns` (+stats), `targets`, `performance`, `dashboard`, `forms` (CMS) |
| Public | `public/forms/:slug` (+submit with UTM, honeypot), `public/leads` (x-api-key) |
| Admin | `admin/settings`, `admin/expenses` (+approval), `admin/notifications`, `admin/webhooks` |
| Reports | `reports/dashboard|revenue|appointments|patients|inventory|pnl|leads|purchases` (JSON or `?format=csv`) |
| Audit | `audit-logs` |

Key guarantees:
- **No double booking** — `slotKey` unique index + seat loop inside a transaction; losers get 409.
- **Branch isolation** — `branchScope` middleware on every staff route; restricted users can't read/write other branches.
- **Backend-enforced RBAC** — 26 modules × 9 actions; users can't grant permissions they don't hold.
- **Medical data** — separate `medical_records.*` permission; every view/export audit-logged; records lock after 24h.
- **Stock integrity** — FEFO with conditional decrements in transactions; returns restock original batches.

## Local dev

```bash
# MongoDB replica set + Redis
mongod --replSet rs0 --dbpath ~/data/cpf --bind_ip 127.0.0.1
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
redis-server

cd backend && cp .env.example .env    # fill JWT secrets + SEED_ADMIN_PASSWORD
npm i && npm run seed
npm run dev        # API :5000
npm run worker     # notifications / reminders / daily jobs

cd ../frontend && npm i
cp console/.env.example console/.env && cp booking/.env.example booking/.env
npm run dev:console   # :5174  (VITE_APP_MODE=clinic|crm to preview other modes)
npm run dev:booking   # :5173
```
Dev OTP: no `WAPP_API_KEY` + `OTP_DEV_LOG=true` → OTP printed in API log (WhatsApp sends are skipped and logged).

WhatsApp (OTP + 15 patient/staff triggers) goes through sms4power WAPP — see `DEPLOY.md` §9.

## Tests

```bash
cd backend
npm run test:unit   # slot engine, GST math, CSV (no DB)
npm run check       # boots app, auth/validation guards (no DB)
npm run test:wapp   # WhatsApp client vs mock server, messages, signed PDF links
```

## Default roles
Super Admin · Branch Admin · Branch Manager · Receptionist · Doctor · Accountant · Pharmacist · Sales Manager · Sales Executive · Marketing Manager — all editable except Super Admin; create custom roles in Console → Roles.
