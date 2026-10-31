import { ResourcePage } from '@/components/common/ResourcePage';
import { Badge } from '@/components/ui/badge';
import { inr } from '@/lib/utils';

const FIELDS = [
  { name: 'sku', label: 'SKU', required: true },
  { name: 'barcode', label: 'Barcode' },
  { name: 'name', label: 'Name', required: true, colSpan: 2 },
  { name: 'genericName', label: 'Generic / composition' },
  { name: 'manufacturer', label: 'Manufacturer' },
  { name: 'type', label: 'Type', type: 'select', required: true, options: ['medicine', 'consumable', 'product', 'service'], placeholder: undefined },
  { name: 'serviceKind', label: 'Service kind (for services)', type: 'select', options: ['consultation', 'procedure', 'treatment', 'other'] },
  { name: 'category', label: 'Category', optionsQuery: { url: '/inventory/categories', params: { all: 'true' }, map: (c) => ({ value: c._id, label: c.name }) } },
  { name: 'unit', label: 'Unit', placeholder: 'strip / tube / bottle' },
  { name: 'hsn', label: 'HSN / SAC' },
  { name: 'gstRate', label: 'GST %', type: 'select', options: [{ value: '0', label: '0%' }, { value: '5', label: '5%' }, { value: '12', label: '12%' }, { value: '18', label: '18%' }, { value: '28', label: '28%' }], placeholder: undefined },
  { name: 'mrp', label: 'MRP', type: 'number' },
  { name: 'sellPrice', label: 'Selling price', type: 'number', required: true },
  { name: 'purchasePrice', label: 'Purchase price', type: 'number' },
  { name: 'reorderLevel', label: 'Reorder level', type: 'number' },
  { name: 'prescriptionRequired', label: 'Prescription required', type: 'switch' },
  { name: 'isActive', label: 'Active', type: 'switch' },
];

export default function Products() {
  return (
    <ResourcePage
      title="Products"
      description="Medicines, consumables and billable services"
      endpoint="/inventory/products"
      module="inventory"
      fields={FIELDS}
      newDefaults={{ type: 'medicine', gstRate: '12', isActive: true, reorderLevel: 10 }}
      toForm={(p) => ({ ...p, category: p.category?._id || '', gstRate: String(p.gstRate), serviceKind: p.serviceKind || '' })}
      toPayload={(v) => ({ ...v, gstRate: Number(v.gstRate), category: v.category || null, serviceKind: v.type === 'service' ? v.serviceKind || 'other' : null })}
      columns={[
        { key: 'sku', header: 'SKU', cell: (p) => <span className="font-mono text-xs">{p.sku}</span> },
        { key: 'name', header: 'Name', cell: (p) => <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.genericName}</p></div> },
        { key: 'type', header: 'Type', cell: (p) => <Badge variant={p.type === 'service' ? 'info' : 'outline'}>{p.type}</Badge> },
        { key: 'cat', header: 'Category', cell: (p) => p.category?.name || '—' },
        { key: 'gst', header: 'GST', cell: (p) => `${p.gstRate}%` },
        { key: 'mrp', header: 'MRP', cell: (p) => inr(p.mrp) },
        { key: 'sell', header: 'Price', cell: (p) => inr(p.sellPrice) },
        { key: 'st', header: '', cell: (p) => !p.isActive && <Badge variant="secondary">Inactive</Badge> },
      ]}
    />
  );
}
