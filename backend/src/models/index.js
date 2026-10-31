/**
 * Registers EVERY Mongoose model. Import once at process start (API, worker, scripts)
 * so .populate('doctor' | 'branch' | …) never fails with "Schema hasn't been registered".
 */
import './Counter.js';
import './AuditLog.js';
import './Otp.js';
import './Role.js';
import './User.js';
import './Branch.js';
import './Settings.js';
import './PatientAccount.js';
import './Patient.js';
import './Doctor.js';
import './DoctorSchedule.js';
import './ScheduleException.js';
import './Appointment.js';
import './Clinical.js';
import './Inventory.js';
import './Billing.js';
import './Crm.js';
import './Misc.js';
import './Media.js';
