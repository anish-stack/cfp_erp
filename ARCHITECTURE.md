# Centre for Piles & Fistula — Clinic ERP

## 1. Topology

```
                         Nginx (SSL, Let's Encrypt)
 appointment.*  admin.*  clinic.*  crm.*   →  static Vite builds
 api.*                                      →  PM2: cpf-api (cluster) + cpf-worker (fork)
                                                 ├─ MongoDB 7 (replica set rs0, single node OK)
                                                 └─ Redis 7 (BullMQ queues, OTP rate limits)
```

Monorepo:

```
cpf-erp/
  backend/                 Express API + BullMQ worker (shared codebase)
  frontend/
    booking/               appointment.*  (patient OTP portal, mobile-first, CMS landing pages)
    console/               admin.* / clinic.* / crm.*  (staff console, permission-driven)
  deploy/                  nginx confs, ecosystem.config.cjs, mongod.conf
```

Implemented as two Vite apps in an npm workspace: `booking` (patient portal) and `console` (one staff SPA served on admin./clinic./crm. — mode from subdomain, sidebar from `/auth/staff/me` permissions).

## 2. Backend layout

```
src/
  config/      env (zod-validated), db, redis, logger
  constants/   permissions catalog + default roles
  middleware/  auth, permit, branchScope, validate, error, rateLimit
  models/      Mongoose models
  modules/<x>/ x.routes.js  x.controller.js  x.service.js  x.validation.js
  jobs/        queues.js, worker.js
  services/    sms, whatsapp, email providers (env-driven, no hardcoded keys)
  utils/       ApiError, asyncHandler, counter (sequential IDs), audit
```

Rules: controllers thin, services hold logic, every staff route behind `auth` + `permit()`, every branch-owned query goes through `req.branchFilter`.

## 3. Auth

| Actor | Login | Token |
|---|---|---|
| Staff | email/phone + password | access JWT 15m (body) + refresh JWT 7d (httpOnly cookie, domain `.centreforpilesandfistula.com`) |
| Patient | mobile + SMS OTP | patient JWT 30d, `typ:"patient"` |

- OTP: 6 digits, bcrypt-hashed, TTL 5 min, max 5 attempts, 30s resend cooldown, 5 sends/hour/mobile (Redis). Dev logs OTP to console only when `OTP_DEV_LOG=true` and `NODE_ENV!=production`.
- `tokenVersion` on User → logout-all / password change invalidates refresh tokens.

## 4. RBAC

Permission = `module.action`. Actions: `view create edit delete import export assign approve manage_settings`.
Role: `{ name, slug, permissions[], isSystem, scope }`. Super Admin = `["*"]`.
User: `role`, `branches[]`, `allBranches`. `branchScope`:
- `allBranches` → may filter via `?branch=` / `x-branch-id`, else all.
- otherwise → forced to assigned branches; other branch = 403.

`medical_records.*` separate module → explicit grant, every read audit-logged.

## 5. MongoDB schema

### Core
- **Counter** `{ _id, seq }` — atomic sequential IDs (`CPF-000123`, `ROH-261031-0007`).
- **Branch** `{ name, code, slug, address{}, phone, email, gstin, isActive, settings{ slotMinutes, gapMinutes, openTime, closeTime, breaks[], weeklyOff[] } }`
- **Role** `{ name, slug, permissions[], isSystem, scope }`
- **User** `{ name, email, phone, passwordHash, role, branches[], allBranches, doctor?, isActive, tokenVersion, lastLoginAt }`
- **AuditLog** `{ user, actorType, action, entity, entityId, branch, before, after, ip, ua, createdAt }`
- **Otp** `{ mobile, purpose, codeHash, attempts, expiresAt (TTL) }`

### Patients
- **PatientAccount** `{ mobile (unique), isVerified, lastLoginAt }`
- **Patient** `{ patientId (unique), account, relation, name, dob, gender, email, address, bloodGroup, allergies[], emergencyContact, registeredBranch, source, isActive }`
- **MedicalRecord** `{ patient, branch, doctor, appointment, type, complaints, diagnosis, examination, plan, vitals{}, attachments[], createdBy }`
- **Prescription** `{ patient, doctor, appointment, items[], advice, followUpDate }`
- **PatientDocument** `{ patient, title, fileUrl, mime, uploadedBy }`
- **FollowUp** `{ patient, branch, doctor, dueDate, reason, status }`

### Scheduling
- **Doctor** `{ user?, name, qualification, specialization, regNo, photo, branches[], fee, isActive }`
- **DoctorSchedule** `{ doctor, branch, weekday, sessions[{start,end}], slotMinutes, gapMinutes, capacityPerSlot }`
- **ScheduleException** `{ branch?, doctor?, date, type: holiday|leave|special_day|block, sessions[], reason }`
- **Appointment** `{ bookingId, patient, account, branch, doctor, date, start, end, type, status, slotKey (unique sparse), rescheduledFrom, cancelReason, source, createdBy }`
  - **Double-booking guard:** `slotKey = doctor|date|start|seat` while active; unique sparse index → second insert fails atomically (E11000). Cancel → `$unset slotKey`. Capacity N → seats 1..N tried in order.

### Billing / POS / Inventory
- **Product** `{ sku, barcode, name, category, type, hsn, gstRate, unit, mrp, sellPrice, reorderLevel }`
- **Category**, **Supplier**
- **Batch** `{ product, branch, batchNo, expiry, purchasePrice, mrp, qty }` — stock lives here (FEFO).
- **StockMovement** `{ product, batch, branch, type, qty ±, refType, refId, by }`
- **PurchaseOrder**, **StockTransfer**
- **Invoice** `{ invoiceNo, branch, patient?, type, items[{ taxable, cgst, sgst, total }], subtotal, discount, tax, grandTotal, paid, balance, status }`
- **Payment** `{ invoice?, patient?, branch, mode, amount, ref, kind: payment|advance|refund }`
- **CreditNote**, **Expense**

### CRM / CMS
- **LeadStage** `{ name, order, isWon, isLost }` (seeded funnel, custom allowed)
- **Lead** `{ name, phone (dedupe idx), email, source, campaign, utm{}, branch, stage, assignedTo, lostReason, convertedPatient, nextFollowUpAt }`
- **LeadActivity** `{ lead, type, payload, by }`, **Task**, **SalesTarget**, **Campaign**
- **EnquiryForm** `{ slug, fields[], campaign, branch }` → public POST creates Lead.

### Notifications
- **NotificationLog** `{ channel, to, template, payload, status, error, attempts }` — single BullMQ queue `notifications` (events, delayed reminders, daily schedulers, webhook delivery).

## 6. Phases — all complete
1. Foundation: auth, OTP, RBAC, branches, staff, patient/family, audit, seed
2. Doctors, schedules, exceptions, slot engine, atomic booking API
3. Booking portal + staff console
4. Clinical: medical records, prescriptions (PDF), follow-ups, documents, patient timeline
5. Inventory (FEFO batches, GRN, PO, transfers, adjustments) + POS + invoices/payments/returns + PDFs
6. CRM (leads, funnel, dedupe, import/export, activities, tasks, campaigns, targets) + CMS forms/landing pages
7. Reports + expenses + settings
8. Notifications (SMS/WhatsApp/email), reminders, daily jobs, outbound webhooks, website lead API
9. Deploy: Nginx, PM2, SSL, Mongo replica set, backups
