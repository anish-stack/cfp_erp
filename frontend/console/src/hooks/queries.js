import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, getPaged } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { errMsg } from '@/lib/utils';

/** branch-aware query key so switching branch refetches */
export const useBranchKey = () => useAuth((s) => s.branchId);

export function useGet(key, url, params, opts = {}) {
  const b = useBranchKey();
  return useQuery({ queryKey: [...[].concat(key), params, b], queryFn: () => get(url, params), ...opts });
}

export function usePaged(key, url, params, opts = {}) {
  const b = useBranchKey();
  return useQuery({ queryKey: [...[].concat(key), params, b], queryFn: () => getPaged(url, params), placeholderData: keepPreviousData, ...opts });
}

/** mutation with toast + invalidate */
export function useAction(fn, { success, invalidate = [], onSuccess, onError } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      if (success) toast.success(typeof success === 'function' ? success(data) : success);
      [].concat(invalidate).forEach((k) => qc.invalidateQueries({ queryKey: [].concat(k) }));
      onSuccess?.(data, vars);
    },
    onError: (e) => {
      const details = e?.response?.data?.details;
      const extra = Array.isArray(details) ? details.slice(0, 3).map((d) => d.message).join(' · ') : '';
      toast.error(errMsg(e), extra ? { description: extra } : undefined);
      onError?.(e);
    },
  });
}

/** public clinic profile (name, logo URL) */
export const usePublicClinic = () => useQuery({ queryKey: ['public-clinic'], queryFn: () => get('/public/clinic', undefined, { branchScoped: false }).then((r) => r.clinic), staleTime: 300_000 });

/** common lookups */
/** branches the user may act on (needs branches.view; falls back to own branches) */
export const useBranches = () => {
  const me = useAuth((s) => s.me);
  return useQuery({
    queryKey: ['branches-all'],
    queryFn: () => get('/branches', undefined, { branchScoped: false }).catch(() => me?.user?.branches || []),
    staleTime: 300_000,
  });
};
export const useDoctors = (branch) => useGet(['doctors', branch], '/doctors', branch ? { branch, active: 'true' } : { active: 'true' }, { staleTime: 120_000 });
/** sales staff for lead/task assignment */
export const useStaffList = () => useQuery({ queryKey: ['crm-users'], queryFn: () => get('/crm/users'), staleTime: 120_000 });
export const useStages = () => useQuery({ queryKey: ['lead-stages'], queryFn: () => get('/crm/stages'), staleTime: 300_000 });
