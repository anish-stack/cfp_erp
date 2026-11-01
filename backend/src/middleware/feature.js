import { featureOn } from '../models/Settings.js';
import { ApiError } from '../utils/ApiError.js';

/** 403 when an optional module (ipd | exotel | marketing) is switched off in Settings → Modules */
export const requireFeature = (key) => async (_req, _res, next) => {
  try {
    if (await featureOn(key)) return next();
    return next(new ApiError(403, `The ${key.toUpperCase()} module is disabled. A Super Admin can enable it in Settings → Modules.`));
  } catch (e) {
    return next(e);
  }
};
