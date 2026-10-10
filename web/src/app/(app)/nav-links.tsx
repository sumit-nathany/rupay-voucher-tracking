'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Gift, Users, CreditCard, SlidersHorizontal, Library, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

const adminLink = { href: '/admin/catalog', label: 'Catalog', icon: Library, hint: 'Shared card data' };

const links = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, hint: 'Overview' },
  { href: '/benefits', label: 'Benefits', icon: Gift, hint: 'Every voucher' },
  { href: '/holders', label: 'Holders', icon: Users, hint: 'People' },
  { href: '/cards', label: 'Cards', icon: CreditCard, hint: 'Plastic' },
  { href: '/automation', label: 'Automation', icon: Bot, hint: 'Auto ordering' },
  { href: '/overrides', label: 'Overrides', icon: SlidersHorizontal, hint: 'Catalog fixes' },
];

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
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const items = showAdmin ? [...links, adminLink] : links;

  return (
    <>
      {items.map(({ href, label, icon: Icon, hint }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(
              'group relative transition-[color,background] duration-150 ease-out active:scale-[0.98]',
              variant === 'sidebar' && 'flex items-center gap-3 rounded-xl px-3 py-2.5',
              variant === 'tabbar' &&
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2.5 text-[9px] font-bold uppercase tracking-wide',
              variant === 'topbar' &&
                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium',
              active
                ? variant === 'sidebar'
                  ? 'bg-primary/10 text-primary'
                  : variant === 'topbar'
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-primary'
                : variant === 'sidebar'
                  ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  : variant === 'topbar'
                    ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {variant === 'sidebar' && active && (
              <span aria-hidden className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
            )}
            {variant === 'tabbar' && active && (
              <span aria-hidden className="absolute inset-x-1.5 top-1 bottom-1 -z-10 rounded-2xl bg-primary/10" />
            )}
            <Icon
              className={cn(
                'shrink-0 transition-transform duration-150 group-hover:scale-105',
                variant === 'sidebar' ? 'h-5 w-5' : variant === 'topbar' ? 'h-4 w-4' : 'h-5 w-5',
              )}
            />
            <span className={cn('truncate', variant === 'sidebar' && 'flex min-w-0 flex-col items-start')}>
              <span className={variant === 'sidebar' ? 'text-sm font-semibold' : ''}>{label}</span>
              {variant === 'sidebar' && hint && (
                <span className="text-[11px] font-normal text-muted-foreground/70">{hint}</span>
              )}
            </span>
          </Link>
        );
      })}
    </>
  );
}
