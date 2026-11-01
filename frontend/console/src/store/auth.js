import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuth = create(
  persist(
    (set, get) => ({
      token: null,
      me: null, // { user, permissions, modules }
      branchId: '',
      setToken: (token) => set({ token }),
      setMe: (me) => {
        const branches = me.user.branches || [];
        const cur = get().branchId;
        const keep = me.user.allBranches || me.permissions.includes('*') ? cur : branches.some((b) => b._id === cur) ? cur : branches[0]?._id || '';
        set({ me, branchId: keep });
      },
      setBranch: (branchId) => set({ branchId }),
      logout: async (callApi = true) => {
        if (callApi) {
          const { api } = await import('@/lib/api');
          await api.post('/auth/staff/logout').catch(() => {});
        }
        set({ token: null, me: null });
        if (!location.pathname.startsWith('/login')) location.href = '/login';
      },
    }),
    { name: 'cpf-console', partialize: (s) => ({ branchId: s.branchId }) }
  )
);

export const can = (perm) => {
  const p = useAuth.getState().me?.permissions || [];
  return p.includes('*') || p.includes(perm);
};

export const useCan = () => {
  const perms = useAuth((s) => s.me?.permissions) || [];
  return (perm) => perms.includes('*') || [].concat(perm).some((x) => perms.includes(x));
};

/** optional modules switched on by the Super Admin (Settings → Modules) */
export const useFeature = () => {
  const f = useAuth((s) => s.me?.features) || {};
  return (key) => !key || f[key] === true;
};
