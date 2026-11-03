import { BrowserRouter, Routes, Route, Link, NavLink, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useEffect } from 'react';
import { applyTheme } from '@/lib/theme';
import { Toaster } from 'sonner';
import { CalendarCheck2, LogOut, Phone, UserRound, LogIn } from 'lucide-react';
import Book from '@/pages/Book';
import MyAppointments from '@/pages/MyAppointments';
import Landing from '@/pages/Landing';
import Profile from '@/pages/Profile';
import Login from '@/pages/Login';
import { usePatient } from '@/store/patient';
import { cn } from '@/lib/utils';
import InstallPrompt from '@/components/pwa/InstallPrompt';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } } });

function Shell({ children }) {
  const { token, mobile, logout } = usePatient();
  const loc = useLocation();
  const landing = loc.pathname.startsWith('/f/');
  const { data: info } = useQuery({ queryKey: ['clinic'], queryFn: () => get('/public/clinic'), staleTime: 600_000 });
  const clinic = info?.clinic;
  useEffect(() => { if (info?.theme?.booking) applyTheme(info.theme.booking); if (clinic?.name) document.title = `Book Appointment · ${clinic.name}`; }, [info]); // eslint-disable-line react-hooks/exhaustive-deps
  // landing pages (/f/:slug) render their own full-width header/footer
  if (landing) return <div className="min-h-screen bg-white">{children}</div>;
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(to bottom, hsl(var(--app-bg)), hsl(var(--background)))' }}>
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            {clinic?.logo ? <img src={clinic.logo} alt="" className="h-36 w-36 rounded-lg object-contain" /> : <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">CPF</span>}
            {/* <span className="hidden text-sm sm:block">{clinic?.name || 'Centre for Piles & Fistula'}</span> */}
          </Link>
          {!landing && (
            <nav className="flex items-center gap-1 text-sm">
              <NavLink to="/" end className={({ isActive }) => cn('rounded-md px-3 py-1.5', isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}>Book</NavLink>
              {token && <NavLink to="/appointments" className={({ isActive }) => cn('flex items-center gap-1 rounded-md px-3 py-1.5', isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}><CalendarCheck2 className="h-4 w-4" /> My visits</NavLink>}
              {token && <NavLink to="/profile" className={({ isActive }) => cn('flex items-center gap-1 rounded-md px-3 py-1.5', isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}><UserRound className="h-4 w-4" /> <span className="hidden sm:inline">Profile</span></NavLink>}
              {!token && <NavLink to="/login" className={({ isActive }) => cn('flex items-center gap-1 rounded-md px-3 py-1.5', isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}><LogIn className="h-4 w-4" /> Login</NavLink>}
              {token && <button onClick={logout} title={`Logout ${mobile}`} className="rounded-md p-2 text-muted-foreground hover:bg-accent"><LogOut className="h-4 w-4" /></button>}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      <InstallPrompt title="Install CPF app" text="Book and track your visits from your home screen." />
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1"><Phone className="h-3 w-3" /> Need help? Call your nearest branch.</p>
        <p className="mt-1">© {new Date().getFullYear()} Centre for Piles &amp; Fistula · <a className="underline" href="https://centreforpilesandfistula.com">centreforpilesandfistula.com</a></p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<Book />} />
            <Route path="/appointments" element={<MyAppointments />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/login" element={<Login />} />
            <Route path="/f/:slug" element={<Landing />} />
            <Route path="*" element={<Book />} />
          </Routes>
        </Shell>
      </BrowserRouter>
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  );
}
