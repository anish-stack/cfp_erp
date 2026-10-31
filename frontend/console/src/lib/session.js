import { get } from '@/lib/api';
import { useAuth } from '@/store/auth';

export async function loadMe() {
  const me = await get('/auth/staff/me');
  const global = me.user.allBranches || me.permissions.includes('*');
  if (global) me.allBranches = await get('/branches', undefined, { branchScoped: false }).catch(() => []);
  useAuth.getState().setMe(me);
  return me;
}
