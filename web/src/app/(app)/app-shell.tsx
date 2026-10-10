'use client';

import { useEffect, useState } from 'react';
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { BrandMark } from './brand-mark';
import { NavLinks } from './nav-links';

const SIDEBAR_PINNED_KEY = 'rupay_nav_pinned';

export function AppShell({
  showAdmin,
  children,
}: {
  showAdmin: boolean;
  children: React.ReactNode;
}) {
  // true = keep nav bar always (pinned desktop sidebar); false = hide nav bar
  const [pinned, setPinned] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_PINNED_KEY);
    if (stored !== null) {
      setPinned(stored === 'true');
    }
  }, []);

  const togglePinned = () => {
    setPinned((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_PINNED_KEY, String(next));
      return next;
    });
  };

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="min-h-dvh flex">
      {/* Desktop sidebar: visible only on lg+ when pinned */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex-col border-r border-border bg-sidebar px-4 py-5 transition-all duration-200 ease-in-out',
          pinned ? 'hidden lg:flex lg:w-[17rem]' : 'hidden',
        )}
      >
        <div className="flex items-center justify-between">
          <BrandMark />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={togglePinned}
            title="Hide navigation bar"
            aria-label="Hide navigation bar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="my-4 h-px bg-border" />

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Main navigation">
          <p className="eyebrow mb-2 px-3 text-muted-foreground/70">Navigate</p>
          <NavLinks variant="sidebar" showAdmin={showAdmin} />
        </nav>

        <form action={signOut} className="mt-4 border-t border-border pt-4">
          <Button
            type="submit"
            variant="ghost"
            className="w-full justify-start rounded-xl text-muted-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </form>
      </aside>

      {/* Main content wrapper */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-in-out',
          pinned ? 'lg:pl-[17rem]' : 'lg:pl-0',
        )}
      >
        {/* Top header bar */}
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 lg:gap-4">
            {/* Mobile menu trigger */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground lg:hidden"
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            {/* Desktop toggle button when sidebar is hidden */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'hidden h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground',
                !pinned && 'lg:inline-flex',
              )}
              onClick={togglePinned}
              title="Show navigation bar"
              aria-label="Show navigation bar"
            >
              <PanelLeftOpen className="h-4 w-4" />
              <span>Show nav bar</span>
            </Button>

            {/* When sidebar is hidden or on mobile, show brandmark in topbar */}
            <div className={cn(pinned && 'lg:hidden')}>
              <BrandMark />
            </div>

            {/* Topbar navigation links when sidebar is hidden on desktop */}
            {!pinned && (
              <nav className="hidden lg:flex items-center gap-1 ml-2" aria-label="Main navigation">
                <NavLinks variant="topbar" showAdmin={showAdmin} />
              </nav>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* When sidebar is pinned, desktop option to hide nav bar from header as well */}
            {pinned && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="hidden lg:inline-flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={togglePinned}
                title="Hide navigation bar"
                aria-label="Hide navigation bar"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
                <span>Hide nav bar</span>
              </Button>
            )}

            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="hidden lg:inline-flex text-muted-foreground hover:text-foreground gap-2"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                className="lg:hidden text-muted-foreground"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:pb-10">{children}</main>
      </div>

      {/* Mobile Drawer (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="gap-0 bg-sidebar shadow-none" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Main navigation</SheetTitle>
          <div className="flex h-full flex-col px-4 py-6">
            <BrandMark />
            <div className="my-5 h-px bg-border" />
            <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
              <p className="eyebrow mb-2 px-3 text-muted-foreground/70">Navigate</p>
              <NavLinks variant="sidebar" showAdmin={showAdmin} onNavigate={closeMobile} />
            </nav>
            <form action={signOut} className="mt-4 border-t border-border pt-4">
              <Button
                type="submit"
                variant="ghost"
                className="w-full justify-start rounded-xl text-muted-foreground"
                onClick={closeMobile}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
