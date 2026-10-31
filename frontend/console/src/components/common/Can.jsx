import { useCan } from '@/store/auth';

export function Can({ perm, children, fallback = null }) {
  const can = useCan();
  return can(perm) ? children : fallback;
}
