import { useEffect, useMemo } from 'react';
import { ImageField } from './ImageField';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Input, Textarea, Select } from '@/components/ui/input';
import { Switch, Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Field } from './Field';
import { get } from '@/lib/api';
import { cn } from '@/lib/utils';

const emptyToUndef = (v) => (v === '' || v === null || (typeof v === 'number' && Number.isNaN(v)) ? undefined : v);

/** Build zod schema from field config */
export function schemaFor(fields) {
  const shape = {};
  for (const f of fields) {
    let s;
    switch (f.type) {
      case 'number':
        s = z.preprocess((v) => emptyToUndef(v === '' ? '' : Number(v)), f.required ? z.number({ required_error: `${f.label} is required`, invalid_type_error: `${f.label} is required` }) : z.number().optional());
        if (f.min !== undefined) s = s.refine((v) => v === undefined || v >= f.min, `Min ${f.min}`);
        break;
      case 'switch':
        s = z.boolean().optional();
        break;
      case 'multiselect':
        s = f.required ? z.array(z.string()).min(1, `Select at least one`) : z.array(z.string()).optional();
        break;
      case 'email':
        s = f.required ? z.string().email('Invalid email') : z.preprocess(emptyToUndef, z.string().email('Invalid email').optional());
        break;
      case 'tel':
        s = f.required ? z.string().regex(/^[6-9]\d{9}$/, 'Enter 10-digit mobile') : z.preprocess(emptyToUndef, z.string().regex(/^[6-9]\d{9}$/, 'Enter 10-digit mobile').optional());
        break;
      default:
        s = f.required ? z.string({ required_error: `${f.label} is required` }).trim().min(1, `${f.label} is required`) : z.preprocess(emptyToUndef, z.string().optional());
        if (f.pattern) s = s.refine((v) => !v || f.pattern.test(v), f.patternMessage || 'Invalid format');
    }
    shape[f.name] = s;
  }
  return z.object(shape);
}

function AsyncOptions({ f, field }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['opts', f.optionsQuery.url, f.optionsQuery.params], queryFn: () => get(f.optionsQuery.url, f.optionsQuery.params), staleTime: 120_000 });
  const opts = (Array.isArray(data) ? data : data?.items || []).map(f.optionsQuery.map);
  if (f.type === 'multiselect') return <MultiCheck options={opts} field={field} />;
  return (
    <Select {...field} value={field.value ?? ''} placeholder={isLoading ? 'Loading…' : f.placeholder || 'Select'}>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

function MultiCheck({ options, field }) {
  const val = field.value || [];
  return (
    <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border p-2 scrollbar-thin">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm">
          <Checkbox checked={val.includes(o.value)} onCheckedChange={(c) => field.onChange(c ? [...val, o.value] : val.filter((x) => x !== o.value))} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function renderInput(f, field) {
  if (f.optionsQuery) return <AsyncOptions f={f} field={field} />;
  switch (f.type) {
    case 'textarea':
      return <Textarea rows={f.rows || 3} {...field} value={field.value ?? ''} placeholder={f.placeholder} />;
    case 'select':
      return (
        <Select {...field} value={field.value ?? ''} placeholder={f.placeholder ?? 'Select'}>
          {f.options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o.replace(/_/g, ' ')}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
        </Select>
      );
    case 'multiselect':
      return <MultiCheck options={f.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))} field={field} />;
    case 'image':
      return <ImageField value={field.value} onChange={field.onChange} uploadUrl={f.uploadUrl} round={f.round} />;
    case 'switch':
      return <div className="pt-1"><Switch checked={!!field.value} onCheckedChange={field.onChange} /></div>;
    default:
      return <Input type={f.type === 'tel' ? 'tel' : f.type || 'text'} step={f.step} {...field} value={field.value ?? ''} placeholder={f.placeholder} />;
  }
}

/**
 * fields: [{ name, label, type, required, options, optionsQuery:{url,params,map}, colSpan, hint, placeholder }]
 */
export function FormBuilder({ fields, defaultValues, onSubmit, submitText = 'Save', loading, onCancel, columns = 2, extra }) {
  const schema = useMemo(() => schemaFor(fields), [fields]);
  const form = useForm({ resolver: zodResolver(schema), defaultValues });
  useEffect(() => form.reset(defaultValues), [defaultValues]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className={cn('grid gap-3', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
        {fields.map((f) => (
          <Controller
            key={f.name}
            name={f.name}
            control={form.control}
            render={({ field, fieldState }) => (
              <Field label={f.label} required={f.required} hint={f.hint} error={fieldState.error?.message} className={cn(f.colSpan === 2 && 'sm:col-span-2', f.colSpan === 3 && 'sm:col-span-3')}>
                {renderInput(f, field)}
              </Field>
            )}
          />
        ))}
      </div>
      {extra}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={loading}>{submitText}</Button>
      </div>
    </form>
  );
}
