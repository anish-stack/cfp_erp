import mongoose from 'mongoose';

/** Public media library (landing pages / CMS). Files live on local disk, S3, R2 or Cloudinary. */
const schema = new mongoose.Schema(
  {
    name: String,
    url: { type: String, required: true },
    key: { type: String, required: true },
    driver: { type: String, enum: ['local', 's3', 'r2', 'cloudinary'], required: true },
    resourceType: { type: String, enum: ['image', 'video'], default: 'image' },
    mime: String,
    size: Number,
    width: Number,
    height: Number,
    folder: { type: String, default: 'cms' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
schema.index({ createdAt: -1 });
export const Media = mongoose.model('Media', schema);
