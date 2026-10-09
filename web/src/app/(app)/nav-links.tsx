'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Gift, Users, CreditCard, SlidersHorizontal, Library } from 'lucide-react';
import { cn } from '@/lib/utils';

const adminLink = { href: '/admin/catalog', label: 'Catalog', icon: Library, hint: 'Shared card data' };

const links = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, hint: 'Overview' },
  { href: '/benefits', label: 'Benefits', icon: Gift, hint: 'Every voucher' },
  { href: '/holders', label: 'Holders', icon: Users, hint: 'People' },
  { href: '/cards', label: 'Cards', icon: CreditCard, hint: 'Plastic' },
  { href: '/overrides', label: 'Overrides', icon: SlidersHorizontal, hint: 'Catalog fixes' },
];

export function NavLinks({ variant, showAdmin }: { variant: 'sidebar' | 'tabbar'; showAdmin?: boolean }) {
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
            className={cn(
              'group relative transition-[color,background,transform] duration-200 ease-out active:scale-[0.98]',
              variant === 'sidebar'
                ? 'flex items-center gap-3 rounded-xl px-3 py-3'
                : 'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2.5 text-[9px] font-bold uppercase tracking-wide',
              active
                ? variant === 'sidebar'
                  ? 'bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]'
                  : 'text-gold'
                : variant === 'sidebar'
                  ? 'text-white/55 hover:bg-white/8 hover:text-white'
                  : 'text-white/45 hover:text-white/85',
            )}
          >
            {variant === 'sidebar' && active && (
              <span aria-hidden className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-gold" />
            )}
            {variant === 'tabbar' && active && (
              <span aria-hidden className="absolute inset-x-1.5 top-1 bottom-1 -z-10 rounded-2xl bg-white/10" />
            )}
            <Icon
              className={cn(
                'shrink-0 transition-transform duration-200 group-hover:scale-105',
                variant === 'sidebar' ? 'h-5 w-5' : 'h-5 w-5',
                active && 'text-gold',
              )}
            />
            <span className={cn('truncate', variant === 'sidebar' && 'flex min-w-0 flex-col items-start')}>
              <span className={variant === 'sidebar' ? 'text-sm font-semibold' : ''}>{label}</span>
              {variant === 'sidebar' && hint && (
                <span className="text-[11px] font-normal text-white/40">{hint}</span>
              )}
            </span>
          </Link>
        );
      })}
    </>
  );
}
