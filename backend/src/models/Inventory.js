import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// ---------- Category ----------
export const Category = mongoose.model(
  'Category',
  new mongoose.Schema(
    { name: { type: String, required: true, trim: true, unique: true }, description: String, isActive: { type: Boolean, default: true } },
    { timestamps: true }
  )
);

// ---------- Supplier ----------
const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    contactPerson: String,
    phone: String,
    email: { type: String, lowercase: true, trim: true },
    gstin: { type: String, uppercase: true },
    drugLicense: String,
    address: String,
    paymentTermsDays: { type: Number, default: 30 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
supplierSchema.index({ name: 1 });
export const Supplier = mongoose.model('Supplier', supplierSchema);

// ---------- Product (medicine / consumable / service) ----------
export const STOCK_TYPES = ['medicine', 'consumable', 'product'];
const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, uppercase: true, trim: true, unique: true },
    barcode: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    genericName: String,
    manufacturer: String,
    category: { type: ObjectId, ref: 'Category' },
    type: { type: String, enum: ['medicine', 'consumable', 'product', 'service'], default: 'medicine' },
    serviceKind: { type: String, enum: ['consultation', 'procedure', 'treatment', 'other', null], default: null },
    unit: { type: String, default: 'unit' }, // strip, tab, bottle, tube
    packSize: Number,
    hsn: String,
    gstRate: { type: Number, default: 12, enum: [0, 5, 12, 18, 28] },
    mrp: { type: Number, default: 0, min: 0 },
    sellPrice: { type: Number, default: 0, min: 0 },
    purchasePrice: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 10, min: 0 },
    prescriptionRequired: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
productSchema.index({ barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } });
productSchema.index({ name: 'text', genericName: 'text', sku: 'text' });
productSchema.virtual('tracksStock').get(function () {
  return STOCK_TYPES.includes(this.type);
});
export const Product = mongoose.model('Product', productSchema);

// ---------- Batch (stock lives here) ----------
const batchSchema = new mongoose.Schema(
  {
    product: { type: ObjectId, ref: 'Product', required: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    batchNo: { type: String, required: true, uppercase: true, trim: true },
    expiry: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    purchasePrice: { type: Number, default: 0 },
    mrp: { type: Number, default: 0 },
    sellPrice: { type: Number, default: 0 },
    qty: { type: Number, default: 0, min: 0 },
    supplier: { type: ObjectId, ref: 'Supplier' },
  },
  { timestamps: true }
);
batchSchema.index({ product: 1, branch: 1, batchNo: 1 }, { unique: true });
batchSchema.index({ branch: 1, expiry: 1, qty: 1 });
export const Batch = mongoose.model('Batch', batchSchema);

// ---------- Stock movement ledger ----------
const mvSchema = new mongoose.Schema(
  {
    product: { type: ObjectId, ref: 'Product', required: true },
    batch: { type: ObjectId, ref: 'Batch' },
    batchNo: String,
    branch: { type: ObjectId, ref: 'Branch', required: true },
    type: { type: String, enum: ['purchase', 'sale', 'return', 'transfer_in', 'transfer_out', 'adjust', 'issue', 'expired', 'cancel'], required: true },
    qty: { type: Number, required: true }, // signed
    balanceAfter: Number,
    refType: String,
    refId: ObjectId,
    refNo: String,
    reason: String,
    by: { type: ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
mvSchema.index({ branch: 1, createdAt: -1 });
mvSchema.index({ product: 1, createdAt: -1 });
export const StockMovement = mongoose.model('StockMovement', mvSchema);

// ---------- Purchase order ----------
const poItem = new mongoose.Schema(
  {
    product: { type: ObjectId, ref: 'Product', required: true },
    name: String,
    qty: { type: Number, required: true, min: 1 },
    rate: { type: Number, default: 0 },
    gstRate: { type: Number, default: 12 },
    receivedQty: { type: Number, default: 0 },
  },
  { _id: true }
);
const poSchema = new mongoose.Schema(
  {
    poNo: { type: String, unique: true },
    supplier: { type: ObjectId, ref: 'Supplier', required: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    items: [poItem],
    status: { type: String, enum: ['draft', 'ordered', 'partial', 'received', 'cancelled'], default: 'draft' },
    expectedDate: String,
    notes: String,
    supplierInvoiceNo: String,
    total: Number,
    createdBy: { type: ObjectId, ref: 'User' },
    approvedBy: { type: ObjectId, ref: 'User' },
    receipts: [{ at: Date, by: { type: ObjectId, ref: 'User' }, invoiceNo: String, lines: [{ product: ObjectId, batchNo: String, expiry: String, qty: Number, purchasePrice: Number, mrp: Number }] }],
  },
  { timestamps: true }
);
poSchema.index({ branch: 1, createdAt: -1 });
export const PurchaseOrder = mongoose.model('PurchaseOrder', poSchema);

// ---------- Stock transfer ----------
const trSchema = new mongoose.Schema(
  {
    transferNo: { type: String, unique: true },
    fromBranch: { type: ObjectId, ref: 'Branch', required: true },
    toBranch: { type: ObjectId, ref: 'Branch', required: true },
    items: [{ product: { type: ObjectId, ref: 'Product' }, name: String, qty: Number, allocations: [{ batchNo: String, expiry: String, qty: Number, purchasePrice: Number, mrp: Number, sellPrice: Number }] }],
    status: { type: String, enum: ['in_transit', 'received', 'cancelled'], default: 'in_transit' },
    notes: String,
    createdBy: { type: ObjectId, ref: 'User' },
    receivedBy: { type: ObjectId, ref: 'User' },
    receivedAt: Date,
  },
  { timestamps: true }
);
trSchema.index({ fromBranch: 1, createdAt: -1 });
trSchema.index({ toBranch: 1, status: 1 });
export const StockTransfer = mongoose.model('StockTransfer', trSchema);
