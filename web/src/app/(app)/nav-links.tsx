'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Gift, Users, CreditCard, SlidersHorizontal, Library } from 'lucide-react';
import { cn } from '@/lib/utils';

const adminLink = { href: '/admin/catalog', label: 'Catalog', icon: Library };

const links = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/benefits', label: 'Benefits', icon: Gift },
  { href: '/holders', label: 'Holders', icon: Users },
  { href: '/cards', label: 'Cards', icon: CreditCard },
  { href: '/overrides', label: 'Overrides', icon: SlidersHorizontal },
];

export function NavLinks({ variant, showAdmin }: { variant: 'sidebar' | 'tabbar'; showAdmin?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      {(showAdmin ? [...links, adminLink] : links).map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              variant === 'sidebar'
                ? 'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors'
                : 'flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors',
              active
                ? variant === 'sidebar'
                  ? 'bg-gold text-ink shadow-sm'
                  : 'text-gold'
                : 'text-white/70 hover:bg-white/10 hover:text-white',
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </>
  );
}
