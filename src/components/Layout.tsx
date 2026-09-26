import {
  Bell,
  BellRing,
  Bomb,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Package,
  ReceiptText,
  ScanLine,
  ShoppingCart,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';

import { useAuth, useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { useLiveData } from '../data/LiveData';
import { useUsageReconciler } from '../data/reconcile';
import { useExpiredSalesSweeper } from '../data/sales';
import { usingEmulators } from '../firebase';
import { serviceAlertsFor, stockAlerts, type ServiceAlert, type StockAlert } from '../lib/alerts';
import { quantity } from '../lib/format';
import { ROLES, STOCK_LABEL, nameOf, serviceMessage } from '../lib/model';
import { useOnline } from '../lib/useOnline';
import { prefetchPage } from '../pages/lazy';
import { DataError } from './DataError';
import { LogoMark } from './Logo';
import { PageBoundary } from './PageBoundary';
import { Badge, IconButton, Loading, cx } from './ui';
import { useStockWatcher } from './useStockWatcher';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAV: NavEntry[] = [
  { to: '/', label: 'පුවරුව', icon: LayoutDashboard },
  { to: '/sales', label: 'විකුණුම්', icon: ShoppingCart },
  // Not here: the floating button (below) reaches it from every page,
  // so a second entry in the header would only repeat it.
  { to: '/store', label: 'ගබඩාව', icon: Package },
  { to: '/bills', label: 'බිල්පත්', icon: ReceiptText },
  { to: '/explosives', label: 'වෙඩි බඩු', icon: Bomb },
  { to: '/history', label: 'ඉතිහාසය', icon: History },
  { to: '/finance', label: 'මූල්‍ය', icon: Landmark, adminOnly: true },
  { to: '/users', label: 'පරිශීලකයින්', icon: Users, adminOnly: true },
];

export function Layout() {
  const { profile } = useSession();
  const { signOut } = useAuth();
  const { crew, store, machines, ready, error } = useLiveData();
  const permissions = permissionsFor(profile);
  const online = useOnline();
  const location = useLocation();

  // These run for as long as any page of the panel is open.
  useUsageReconciler(crew, profile);
  useStockWatcher(store, ready);
  useExpiredSalesSweeper();

  // Once the panel is up, the other pages' code follows in the background —
  // about 25 kB, once — so moving between pages never waits on the line and
  // every page opens offline too. Skipped when the browser asks to save data.
  useEffect(() => {
    if (!ready || savingData()) return;
    const timer = window.setTimeout(() => {
      for (const entry of NAV) {
        if (!entry.adminOnly || permissions.isAdmin) prefetchPage(entry.to);
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [ready, permissions.isAdmin]);

  const stock = useMemo(() => stockAlerts(store), [store]);
  const service = useMemo(() => serviceAlertsFor(crew, machines), [crew, machines]);
  const entries = NAV.filter((entry) => !entry.adminOnly || permissions.isAdmin);

  return (
    <div className="min-h-screen">
      {/* Solid rather than blurred: a backdrop blur repaints on every scroll,
          which an office PC without a graphics card feels. */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-page-deep shadow-[0_1px_0_rgb(255_255_255/0.04),0_8px_24px_-16px_rgb(0_0_0/0.8)]">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-2.5 rounded-control pr-2">
            <span className="flex size-9 items-center justify-center rounded-control bg-white text-ink shadow-control transition group-hover:brightness-95">
              <LogoMark className="size-6" />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold tracking-[0.08em]">SCM</span>
              <span className="block text-[10.5px] tracking-wide text-white/60">පාලක පුවරුව</span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            {usingEmulators && <Badge tone="low">පරීක්ෂණ දත්ත</Badge>}
            {!online && (
              <Badge tone="low">
                <WifiOff className="size-3.5" /> නොබැඳි
              </Badge>
            )}
            <AlertsBell stock={stock} service={service} />
            <span className="mx-1.5 hidden h-7 w-px bg-hairline sm:block" />
            <div className="hidden text-right sm:block">
              <p className="text-[13px] leading-tight font-semibold">{nameOf(profile)}</p>
              <p className="text-[10.5px] text-white/60">{ROLES[profile.role].label}</p>
            </div>
            <IconButton label="ඉවත් වන්න" onClick={() => void signOut()} className="ml-1">
              <LogOut className="size-[18px]" />
            </IconButton>
          </div>
        </div>

        {/* The menu gets a row to itself at every width. Sharing the brand
            row meant eight Sinhala labels competing with the logo and the
            account block for one 1440px line: it fitted at some widths, and
            at others — with the emulator badge up, or on a narrower desktop —
            the last entries were simply cut off. On its own row the full
            width is available, so every label stays readable and nothing is
            hidden. Below about a tablet the row scrolls sideways, with the
            page's own thin scrollbar as the affordance. */}
        <div className="border-t border-hairline">
          <nav className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
            {entries.map((entry) => (
              <NavItem key={entry.to} entry={entry} />
            ))}
          </nav>
        </div>

        {!online && (
          <p className="bg-signal px-4 py-1.5 text-center text-xs font-semibold text-ink">
            අන්තර්ජාලය නැත — පෙන්වන්නේ මෙම පරිගණකයේ සුරැකි දත්ත. ගබඩා වෙනස්කම් සම්බන්ධ වූ විට යවයි; බිල්පත් සහ
            ලෝඩ් / අඩි සඳහා සම්බන්ධතාවය අවශ්‍යයි.
          </p>
        )}
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pt-7 pb-20 sm:px-6">
        {/* Every page waits on this data; a refusal must not look like loading. */}
        {error ? (
          <DataError error={error} />
        ) : (
          <PageBoundary key={location.pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </PageBoundary>
        )}
      </main>

      {/* A fixed shortcut rather than a menu item to click through to:
          verifying a sale is common enough to deserve one tap from anywhere.
          Bottom-left, not bottom-right: every table on these pages puts its
          action icons in the rightmost column, and a short page needs no
          scrolling at all — so no amount of padding keeps a corner button
          clear of whatever row happens to end up there. Nothing in these
          tables' leftmost column is a button, only a name. Hidden on the
          page itself, which already opens the scanner. */}
      {location.pathname !== '/verify' && (
        <Link
          to="/verify"
          onMouseEnter={() => prefetchPage('/verify')}
          onFocus={() => prefetchPage('/verify')}
          title="බිල්පතක් තහවුරු කරන්න"
          aria-label="බිල්පතක් තහවුරු කරන්න"
          className="fixed bottom-4 left-4 z-30 flex size-13 items-center justify-center rounded-full text-white shadow-pop ring-1 ring-lime-hi/30 panel-lime transition hover:brightness-125 active:scale-[0.97] sm:bottom-6 sm:left-6"
        >
          <ScanLine className="size-6" />
        </Link>
      )}
    </div>
  );
}

/** The browser's "data saver" setting, where it has one. */
function savingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function NavItem({ entry }: { entry: NavEntry }) {
  const Icon = entry.icon;
  const warm = () => prefetchPage(entry.to);
  return (
    <NavLink
      to={entry.to}
      end={entry.to === '/'}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      className={({ isActive }) =>
        cx(
          // Tinted rather than a solid orange pill: eight solid chips in a row
          // was the loudest thing on the page, and the amber still reads as
          // "you are here" at a glance.
          'flex shrink-0 items-center gap-2 rounded-control px-3 py-1.5 text-[13.5px] font-semibold transition',
          isActive
            ? 'bg-amber-hi/15 text-amber-hi ring-1 ring-amber-hi/30'
            : 'text-white/65 hover:bg-white/[0.08] hover:text-white',
        )
      }
    >
      <Icon className="size-[17px]" />
      {entry.label}
    </NavLink>
  );
}

function AlertsBell({ stock, service }: { stock: StockAlert[]; service: ServiceAlert[] }) {
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(() =>
    'Notification' in window ? Notification.permission : 'denied',
  );
  const box = useRef<HTMLDivElement>(null);
  const count = stock.length + service.length;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <IconButton label={`අනතුරු ඇඟවීම් ${count}`} onClick={() => setOpen((value) => !value)} className="relative">
        {count > 0 ? <BellRing className="size-5 text-signal" /> : <Bell className="size-5" />}
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-alarm px-1 text-[10px] font-extrabold text-white">
            {count}
          </span>
        )}
      </IconButton>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-panel panel-surface shadow-pop ring-1 ring-hairline-hi">
          <div className="max-h-[70vh] overflow-y-auto p-4">
            <p className="mb-2 text-[11px] font-bold tracking-[0.16em] text-white/60 uppercase">ගබඩාව</p>
            {stock.length === 0 ? (
              <p className="mb-4 text-sm text-white/65">සියලු අයිතම ප්‍රමාණවත්.</p>
            ) : (
              <ul className="mb-4 space-y-2">
                {stock.map(({ item, status }) => (
                  <li key={item.id}>
                    <Link
                      to="/store"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 rounded-control bg-white/[0.05] px-3 py-2 ring-1 ring-hairline transition hover:bg-white/[0.1]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{item.name}</span>
                        <span className="text-xs text-white/55">ඉතිරි {quantity(item.quantity, item.unit)}</span>
                      </span>
                      <Badge tone={status}>{STOCK_LABEL[status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <p className="mb-2 text-[11px] font-bold tracking-[0.16em] text-white/60 uppercase">සේවා</p>
            {service.length === 0 ? (
              <p className="text-sm text-white/65">සේවා අවවාද නැත.</p>
            ) : (
              <ul className="space-y-2">
                {service.map(({ person, machine, status }) => (
                  <li key={machine.id} className="rounded-control bg-white/[0.05] px-3 py-2 ring-1 ring-hairline">
                    <p className="text-sm font-semibold">
                      {nameOf(person)} <span className="font-normal text-white/60">· {machine.id}</span>
                    </p>
                    <p className={cx('text-xs', status.isDue ? 'text-red-200' : 'text-signal')}>
                      {serviceMessage(status)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {permission === 'default' && (
            <button
              type="button"
              onClick={() => void Notification.requestPermission().then(setPermission)}
              className="w-full border-t border-hairline px-4 py-3 text-left text-[13px] font-semibold text-amber-hi transition hover:bg-white/5"
            >
              තොග අඩු වූ විට ඩෙස්ක්ටොප් දැනුම්දීම් ලබාගන්න
            </button>
          )}
        </div>
      )}
    </div>
  );
}
