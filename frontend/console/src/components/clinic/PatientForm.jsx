import { FormBuilder } from '@/components/common/FormBuilder';
import { useAction } from '@/hooks/queries';
import { post } from '@/lib/api';
import { useAuth } from '@/store/auth';

export const PATIENT_FIELDS = (branchOptional) => [
  { name: 'mobile', label: 'Mobile', type: 'tel', required: true },
  { name: 'name', label: 'Full name', required: true },
  { name: 'gender', label: 'Gender', type: 'select', required: true, options: ['male', 'female', 'other'] },
  { name: 'relation', label: 'Relation to account holder', type: 'select', options: ['self', 'spouse', 'child', 'parent', 'sibling', 'other'], placeholder: undefined },
  { name: 'ageYears', label: 'Age (years)', type: 'number', hint: 'Or enter DOB' },
  { name: 'dob', label: 'Date of birth', type: 'date' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'bloodGroup', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { name: 'registeredBranch', label: 'Branch', required: !branchOptional, optionsQuery: { url: '/branches/names', map: (b) => ({ value: b._id, label: b.name }) } },
  { name: 'city', label: 'City' },
];

export function NewPatientForm({ mobile, onCreated, onCancel }) {
  const branchId = useAuth((s) => s.branchId);
  const create = useAction(
    (v) => {
      const { city, ...rest } = v;
      if (!rest.dob && rest.ageYears === undefined) throw new Error('Enter age or date of birth');
      return post('/patients', { ...rest, address: city ? { city } : undefined });
    },
    { success: (p) => `Patient ${p.patientId} created`, invalidate: ['/patients'], onSuccess: onCreated }
  );
  return (
    <FormBuilder
      fields={PATIENT_FIELDS(false)}
      defaultValues={{ mobile: mobile || '', relation: 'self', registeredBranch: branchId || '' }}
      onSubmit={(v) => create.mutate(v)}
      loading={create.isPending}
      onCancel={onCancel}
      submitText="Create patient"
    />
  );
}
