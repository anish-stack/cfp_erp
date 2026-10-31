import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';
import { AppShell, useNavItems } from '@/components/layout/AppShell';
import { ROUTES } from '@/routes';
import { useAuth, useCan } from '@/store/auth';
import { refreshToken } from '@/lib/api';
import { loadMe } from '@/lib/session';
import { appMode } from '@/lib/mode';
import Login from '@/pages/Login';
import { EmptyState } from '@/components/common/EmptyState';
import { usePublicInfo } from '@/hooks/queries';
import { applyTheme } from '@/lib/theme';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: (n, e) => n < 2 && ![401, 403, 404].includes(e?.response?.status), refetchOnWindowFocus: false } },
});


function ThemeLoader() {
  const { data } = usePublicInfo();
  useEffect(() => {
    if (data?.theme?.console) applyTheme(data.theme.console);
    if (data?.clinic?.name) document.title = `${data.clinic.name} · Console`;
  }, [data]);
  return null;
}

function Guard({ perm, children }) {
  const can = useCan();
  if (perm && !can(perm)) return <EmptyState icon={ShieldAlert} title="No access" description="You don't have permission for this page. Contact your administrator." />;
  return children;
}

function Home() {
  const items = useNavItems();
  const mode = appMode();
  const pref = mode === 'crm' ? '/crm' : '/dashboard';
  const target = items.find((i) => i.path === pref) || items[0];
  return target ? <Navigate to={target.path} replace /> : <EmptyState icon={ShieldAlert} title="No modules available" description="Your role has no permissions in this console." />;
}

function Protected() {
  const me = useAuth((s) => s.me);
  const loc = useLocation();
  if (!me) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <AppShell />;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        await refreshToken();
        await loadMe();
      } catch {
        /* not logged in */
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  if (booting) return <div className="grid h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <QueryClientProvider client={qc}>
      <ThemeLoader />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route index element={<Home />} />
            {ROUTES.map((r) => <Route key={r.path} path={r.path} element={<Guard perm={r.perm}><r.el /></Guard>} />)}
            <Route path="*" element={<EmptyState title="Page not found" />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" closeButton />
    </QueryClientProvider>
  );
}
