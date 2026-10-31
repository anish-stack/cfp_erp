import { Suspense, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Menu, LogOut, KeyRound, ChevronDown, Building2, X } from 'lucide-react';
import { ROUTES, GROUP_ORDER } from '@/routes';
import { useAuth, useCan } from '@/store/auth';
import { appMode, MODE_GROUPS, MODE_TITLES } from '@/lib/mode';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown';
import { useQueryClient } from '@tanstack/react-query';
import { usePublicClinic } from '@/hooks/queries';
import { cn } from '@/lib/utils';

export function useNavItems() {
  const can = useCan();
  const mode = appMode();
  const groups = MODE_GROUPS[mode];
  return ROUTES.filter((r) => !r.hidden && (!r.perm || can(r.perm)) && (!groups || groups.includes(r.group)));
}

function Sidebar({ onNavigate }) {
  const items = useNavItems();
  const mode = appMode();
  const { data: clinic } = usePublicClinic();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        {clinic?.logo ? <img src={clinic.logo} alt="" className="h-8 w-8 rounded-lg object-contain" /> : <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">CPF</div>}
        <div className="leading-tight">
          <p className="text-sm font-semibold">Piles & Fistula</p>
          <p className="text-[11px] text-muted-foreground">{MODE_TITLES[mode]} Console</p>
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3 scrollbar-thin">
        {GROUP_ORDER.map((g) => {
          const list = items.filter((i) => i.group === g);
          if (!list.length) return null;
          return (
            <div key={g}>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g}</p>
              {list.map((i) => (
                <NavLink
                  key={i.path}
                  to={i.path}
                  end={i.path === '/billing'}
                  onClick={onNavigate}
                  className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground', isActive && 'bg-accent font-medium text-accent-foreground')}
                >
                  <i.icon className="h-4 w-4" /> {i.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function BranchSwitcher() {
  const me = useAuth((s) => s.me);
  const branchId = useAuth((s) => s.branchId);
  const setBranch = useAuth((s) => s.setBranch);
  const qc = useQueryClient();
  const global = me.user.allBranches || me.permissions.includes('*');
  const branches = me.user.branches || [];
  const list = global ? me.allBranches || branches : branches;
  const cur = list.find((b) => b._id === branchId);
  if (!global && branches.length <= 1) return <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex"><Building2 className="h-4 w-4" />{branches[0]?.name}</span>;
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="outline" size="sm"><Building2 /> <span className="max-w-[120px] truncate">{cur?.name || 'All branches'}</span> <ChevronDown /></Button>
      </DropdownTrigger>
      <DropdownContent align="start">
        <DropdownLabel>Branch</DropdownLabel>
        {global && <DropdownItem onSelect={() => { setBranch(''); qc.invalidateQueries(); }}>All branches</DropdownItem>}
        {list.map((b) => <DropdownItem key={b._id} onSelect={() => { setBranch(b._id); qc.invalidateQueries(); }}>{b.name}</DropdownItem>)}
      </DropdownContent>
    </Dropdown>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const me = useAuth((s) => s.me);
  const logout = useAuth((s) => s.logout);
  const nav = useNavigate();
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r bg-card lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-card shadow-xl">
            <button className="absolute right-3 top-4" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 sm:px-5">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}><Menu /></Button>
            <BranchSwitcher />
          </div>
          <Dropdown>
            <DropdownTrigger asChild>
              <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{me.user.name?.[0]}</div>
                <div className="hidden text-left leading-tight sm:block">
                  <p className="text-sm font-medium">{me.user.name}</p>
                  <p className="text-[11px] text-muted-foreground">{me.user.role?.name}</p>
                </div>
              </button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownLabel>{me.user.email || me.user.phone}</DropdownLabel>
              <DropdownSeparator />
              <DropdownItem onSelect={() => nav('/account')}><KeyRound /> Account & password</DropdownItem>
              <DropdownItem onSelect={() => logout()}><LogOut /> Sign out</DropdownItem>
            </DropdownContent>
          </Dropdown>
        </header>
        <main className="flex-1 overflow-y-auto p-3 scrollbar-thin sm:p-6">
          <Suspense fallback={<div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
