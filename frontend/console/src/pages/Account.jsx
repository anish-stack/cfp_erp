import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/common/Field';
import { Badge } from '@/components/ui/badge';
import { post } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { errMsg } from '@/lib/utils';
import { SignatureUpload } from '@/components/clinic/SignatureUpload';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(8, 'Min 8 characters').regex(/[A-Z]/, 'Needs uppercase').regex(/[a-z]/, 'Needs lowercase').regex(/\d/, 'Needs a number'),
    confirm: z.string(),
  })
  .refine((d) => d.newPassword === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export default function Account() {
  const me = useAuth((s) => s.me);
  const form = useForm({ resolver: zodResolver(schema) });
  const submit = async ({ currentPassword, newPassword }) => {
    try {
      const { accessToken } = await post('/auth/staff/change-password', { currentPassword, newPassword });
      useAuth.getState().setToken(accessToken);
      toast.success('Password changed. Other sessions signed out.');
      form.reset({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="max-w-2xl">
      <PageHeader title="Account" />
      <Card className="mb-4 p-5">
        <p className="text-lg font-semibold">{me.user.name}</p>
        <p className="text-sm text-muted-foreground">{me.user.email} {me.user.phone && `· ${me.user.phone}`}</p>
        <div className="mt-2 flex flex-wrap gap-1.5"><Badge>{me.user.role?.name}</Badge>{me.user.allBranches ? <Badge variant="secondary">All branches</Badge> : me.user.branches?.map((b) => <Badge key={b._id} variant="secondary">{b.name}</Badge>)}</div>
      </Card>
      {me.user.doctor && (
        <Card className="mb-4 p-5">
          <p className="mb-3 font-semibold">My prescription signature</p>
          <SignatureUpload doctorId={me.user.doctor?._id || me.user.doctor} hasSignature />
        </Card>
      )}
      <Card className="p-5">
        <h3 className="mb-3 font-semibold">Change password</h3>
        <form onSubmit={form.handleSubmit(submit)} className="grid gap-3 sm:grid-cols-2">
          <Field label="Current password" error={form.formState.errors.currentPassword?.message} className="sm:col-span-2"><Input type="password" {...form.register('currentPassword')} /></Field>
          <Field label="New password" error={form.formState.errors.newPassword?.message}><Input type="password" {...form.register('newPassword')} /></Field>
          <Field label="Confirm" error={form.formState.errors.confirm?.message}><Input type="password" {...form.register('confirm')} /></Field>
          <div className="sm:col-span-2"><Button type="submit" loading={form.formState.isSubmitting}>Update password</Button></div>
        </form>
      </Card>
    </div>
  );
}
