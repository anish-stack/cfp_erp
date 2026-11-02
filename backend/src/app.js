import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { redis } from './config/redis.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/error.js';

import authRoutes from './modules/auth/auth.routes.js';
import roleRoutes from './modules/roles/roles.routes.js';
import branchRoutes from './modules/branches/branches.routes.js';
import userRoutes from './modules/users/users.routes.js';
import patientRoutes from './modules/patients/patients.routes.js';
import portalRoutes from './modules/portal/portal.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import doctorRoutes from './modules/doctors/doctors.routes.js';
import schedulingRoutes from './modules/scheduling/scheduling.routes.js';
import appointmentRoutes from './modules/appointments/appointments.routes.js';
import portalApptRoutes from './modules/portal/portal.appointments.routes.js';
import clinicalRoutes from './modules/clinical/clinical.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import billingRoutes from './modules/billing/billing.routes.js';
import crmRoutes from './modules/crm/crm.routes.js';
import paymentRoutes from './modules/payments/payments.routes.js';
import lookupRoutes from './modules/lookup/lookup.routes.js';
import { adminRoutes as wheelAdminRoutes, publicRoutes as wheelPublicRoutes } from './modules/wheels/wheels.routes.js';
import publicRoutes from './modules/public/public.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import reportRoutes from './modules/reports/reports.routes.js';
import callRoutes from './modules/calls/calls.routes.js';
import mediaRoutes from './modules/cms/media.routes.js';
import integrationRoutes from './modules/admin/integrations.routes.js';
import cmsAiRoutes from './modules/crm/ai.routes.js';
import marketingRoutes from './modules/marketing/marketing.routes.js';
import ipdRoutes from './modules/ipd/ipd.routes.js';
import { auth } from './middleware/auth.js';
import { branchScope } from './middleware/branchScope.js';
import { requireFeature } from './middleware/feature.js';
import ipdOpsRoutes from './modules/ipd/ipd.ops.routes.js';
import ipdClaimRoutes from './modules/ipd/ipd.claims.js';
import { LOCAL_MEDIA_DIR } from './services/storage.js';
import exotelWebhooks from './modules/calls/exotel.webhooks.js';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Nginx
  app.disable('x-powered-by');

  app.use(helmet());
  const corsOrigins = env.corsOrigins || [];
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || corsOrigins.includes(origin)) {
          return cb(null, true);
        }

        console.error('[CORS BLOCKED]:', origin);
        return cb(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-branch-id', 'x-api-key', 'X-Requested-With', 'Accept'],
      exposedHeaders: ['Content-Disposition'],
    })
  );
  app.use(compression());
  // raw body kept only for the payment webhook (signature is computed over the exact bytes)
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/v1/payments/webhook')) req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: true, limit: '200kb' })); // Exotel form callbacks
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  // public media (local storage driver) — images/videos used on landing pages, cross-origin readable
  app.use('/media', (_req, res, next) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); },
    express.static(LOCAL_MEDIA_DIR, { maxAge: '365d', immutable: true, index: false, dotfiles: 'deny' }));

  app.get('/health', (_req, res) =>
    res.json({
      ok: true,
      mongo: mongoose.connection.readyState === 1,
      redis: redis.status === 'ready',
      time: new Date().toISOString(),
    })
  );

  const v1 = express.Router();
  v1.use(apiLimiter);
  v1.use('/auth', authRoutes);
  v1.use('/roles', roleRoutes);
  v1.use('/branches', branchRoutes);
  v1.use('/staff', userRoutes);
  v1.use('/patients', patientRoutes);
  v1.use('/public/exotel', exotelWebhooks);
  v1.use('/public/wheels', wheelPublicRoutes);
  v1.use('/public', publicRoutes);
  v1.use('/portal/appointments', portalApptRoutes);
  v1.use('/portal', portalRoutes);
  v1.use('/doctors', doctorRoutes);
  v1.use('/scheduling', schedulingRoutes);
  v1.use('/appointments', appointmentRoutes);
  v1.use('/clinical', clinicalRoutes);
  v1.use('/inventory', inventoryRoutes);
  v1.use('/payments', paymentRoutes);
  v1.use('/lookup', lookupRoutes);
  v1.use('/billing', billingRoutes);
  v1.use('/crm/calls', callRoutes);
  v1.use('/cms/media', mediaRoutes);
  v1.use('/crm/ai', cmsAiRoutes);
  v1.use('/marketing', auth, requireFeature('marketing'), marketingRoutes);
  v1.use('/ipd', auth, requireFeature('ipd'), branchScope, ipdOpsRoutes, ipdClaimRoutes, ipdRoutes);
  v1.use('/admin/integrations', integrationRoutes);
  v1.use('/crm/wheels', auth, wheelAdminRoutes);
  v1.use('/crm', crmRoutes);
  v1.use('/admin', adminRoutes);
  v1.use('/reports', reportRoutes);
  v1.use('/audit-logs', auditRoutes);
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
