import mongoose from 'mongoose';

const schema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

export const Counter = mongoose.model('Counter', schema);
