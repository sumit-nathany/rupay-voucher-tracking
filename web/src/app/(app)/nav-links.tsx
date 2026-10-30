'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Gift,
  Users,
  CreditCard,
  SlidersHorizontal,
  Library,
  Bot,
  KeyRound,
  User,
  Loader2,
  ChevronDown,
  MoreHorizontal,
  Cpu,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigationProgress } from '@/components/layout/navigation-progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
}

export const primaryLinks: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, hint: 'Overview' },
  { href: '/benefits', label: 'Benefits', icon: Gift, hint: 'Every voucher' },
  { href: '/cards', label: 'Cards', icon: CreditCard, hint: 'Plastic' },
  { href: '/accounts', label: 'Accounts', icon: KeyRound, hint: 'Portal logins' },
  { href: '/automation', label: 'Automation', icon: Bot, hint: 'Auto ordering' },
];

export const secondaryLinks: NavItem[] = [
  { href: '/holders', label: 'Holders', icon: Users, hint: 'Family members' },
  { href: '/overrides', label: 'Overrides', icon: SlidersHorizontal, hint: 'Catalog fixes' },
];

export const adminLink: NavItem = {
  href: '/admin/catalog',
  label: 'Catalog',
  icon: Library,
  hint: 'Shared card data',
};

export const adminWorkerLink: NavItem = {
  href: '/admin/worker',
  label: 'Cloud Worker',
  icon: Cpu,
  hint: 'GCP worker & scheduler',
};

export const adminLinks: NavItem[] = [adminLink, adminWorkerLink];

export const profileLink: NavItem = {
  href: '/profile',
  label: 'Profile',
  icon: User,
  hint: 'Account & password',
};

function TopbarMoreMenu({
  items,
  pathname,
  navigatingHref,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  navigatingHref: string | null;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { startNavigation } = useNavigationProgress();

  const activeItem = items.find((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  );
  const isNavigating = items.some((item) => navigatingHref === item.href);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className={cn(
            'group relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-[color,background] duration-150 ease-out active:scale-[0.98]',
            isNavigating
              ? 'bg-primary/15 text-primary border border-primary/25 shadow-2xs animate-pulse font-semibold'
              : activeItem
              ? 'bg-primary/10 text-primary font-semibold'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {isNavigating ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : activeItem ? (
            <activeItem.icon className="h-4 w-4 shrink-0" />
          ) : (
            <MoreHorizontal className="h-4 w-4 shrink-0" />
          )}
          <span>{activeItem ? activeItem.label : 'More'}</span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 opacity-60 transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-56 p-1.5 rounded-xl border-border/80 shadow-md bg-popover"
      >
        <div className="flex flex-col gap-0.5">
          {items.map(({ href, label, icon: Icon, hint }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            const isItemNavigating = navigatingHref === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => {
                  setOpen(false);
                  onNavigate?.();
                  if (href === pathname) return;
                  if (
                    e.defaultPrevented ||
                    e.button !== 0 ||
                    e.metaKey ||
                    e.ctrlKey ||
                    e.altKey ||
                    e.shiftKey
                  ) {
                    return;
                  }
                  e.preventDefault();
                  startNavigation(href);
                }}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors',
                  active
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {isItemNavigating ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                )}
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-foreground">{label}</span>
                  {hint && <span className="text-[10px] text-muted-foreground/80">{hint}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NavLinks({
  variant,
  showAdmin,
  onNavigate,
}: {
  variant: 'sidebar' | 'tabbar' | 'topbar';
  showAdmin?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { navigatingHref, startNavigation } = useNavigationProgress();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  // Topbar mode: primary links + sleek "More" dropdown
  if (variant === 'topbar') {
    const moreItems = showAdmin ? [...secondaryLinks, ...adminLinks] : secondaryLinks;

    return (
      <div className="flex items-center gap-1">
        {primaryLinks.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          const isNavigating = navigatingHref === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                onNavigate?.();
                if (href === pathname) return;
                if (
                  e.defaultPrevented ||
                  e.button !== 0 ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.altKey ||
                  e.shiftKey
                ) {
                  return;
                }
                e.preventDefault();
                startNavigation(href);
              }}
              className={cn(
                'group relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-[color,background] duration-150 ease-out active:scale-[0.98]',
                isNavigating
                  ? 'bg-primary/15 text-primary border border-primary/25 shadow-2xs animate-pulse font-semibold'
                  : active
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {isNavigating ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              ) : (
                <Icon className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-105" />
              )}
              <span>{label}</span>
            </Link>
          );
        })}

        <TopbarMoreMenu
          items={moreItems}
          pathname={pathname}
          navigatingHref={navigatingHref}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  // Sidebar / Mobile Drawer: All links in structured order
  const sidebarItems = [
    ...primaryLinks,
    ...secondaryLinks,
    ...(showAdmin ? adminLinks : []),
  ];

  return (
    <>
      {sidebarItems.map(({ href, label, icon: Icon, hint }) => {
        const active = isActive(href);
        const isNavigating = navigatingHref === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              onNavigate?.();
              if (href === pathname) return;
              if (
                e.defaultPrevented ||
                e.button !== 0 ||
                e.metaKey ||
                e.ctrlKey ||
                e.altKey ||
                e.shiftKey
              ) {
                return;
              }
              e.preventDefault();
              startNavigation(href);
            }}
            className={cn(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-[color,background] duration-150 ease-out active:scale-[0.98]',
              isNavigating
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-sm animate-pulse font-semibold'
                : active
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {(active || isNavigating) && (
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-primary',
                  isNavigating && 'animate-ping',
                )}
              />
            )}
            {isNavigating ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
            ) : (
              <Icon className="h-5 w-5 shrink-0 transition-transform duration-150 group-hover:scale-105" />
            )}
            <span className="flex min-w-0 flex-col items-start truncate">
              <span className="text-sm font-semibold">{label}</span>
              {isNavigating ? (
                <span className="text-[11px] font-medium text-primary flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Loading...
                </span>
              ) : hint ? (
                <span className="text-[11px] font-normal text-muted-foreground/70">{hint}</span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </>
  );
}
