import { ResourcePage } from '@/components/common/ResourcePage';

export default function Suppliers() {
  return (
    <ResourcePage
      title="Suppliers"
      endpoint="/inventory/suppliers"
      module="suppliers"
      newDefaults={{ paymentTermsDays: 30, isActive: true }}
      fields={[
        { name: 'name', label: 'Name', required: true, colSpan: 2 },
        { name: 'contactPerson', label: 'Contact person' },
        { name: 'phone', label: 'Phone' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'gstin', label: 'GSTIN' },
        { name: 'drugLicense', label: 'Drug license no.' },
        { name: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number' },
        { name: 'address', label: 'Address', type: 'textarea', colSpan: 2 },
        { name: 'isActive', label: 'Active', type: 'switch' },
      ]}
      columns={[
        { key: 'name', header: 'Supplier', cell: (s) => <span className="font-medium">{s.name}</span> },
        { key: 'cp', header: 'Contact', cell: (s) => [s.contactPerson, s.phone].filter(Boolean).join(' · ') || '—' },
        { key: 'gst', header: 'GSTIN', cell: (s) => s.gstin || '—' },
        { key: 'dl', header: 'Drug lic.', cell: (s) => s.drugLicense || '—' },
        { key: 'terms', header: 'Terms', cell: (s) => `${s.paymentTermsDays} d` },
      ]}
    />
  );
}
