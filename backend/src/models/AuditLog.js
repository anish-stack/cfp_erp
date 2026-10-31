import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    actorType: { type: String, enum: ['staff', 'patient', 'system'], required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    patientAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'PatientAccount' },
    action: { type: String, required: true }, // e.g. patients.create, auth.login, medical_records.view
    entity: String,
    entityId: mongoose.Schema.Types.ObjectId,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    meta: mongoose.Schema.Types.Mixed,
    ip: String,
    ua: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ createdAt: -1 });
schema.index({ entity: 1, entityId: 1, createdAt: -1 });
schema.index({ user: 1, createdAt: -1 });
schema.index({ branch: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', schema);
