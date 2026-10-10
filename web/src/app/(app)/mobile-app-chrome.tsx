'use client';

import { useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { BrandMark } from './brand-mark';
import { NavLinks } from './nav-links';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

export function MobileAppChrome({ showAdmin }: { showAdmin: boolean }) {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:gap-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label="Open navigation menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <BrandMark />
          <nav className="hidden lg:flex items-center gap-1" aria-label="Main navigation">
            <NavLinks variant="topbar" showAdmin={showAdmin} />
          </nav>
        </div>

        <div className="flex items-center">
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

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="gap-0 bg-sidebar shadow-none" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Main navigation</SheetTitle>
          <div className="flex h-full flex-col px-4 py-6">
            <BrandMark />
            <div className="my-5 h-px bg-border" />
            <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
              <p className="eyebrow mb-2 px-3 text-muted-foreground/70">Navigate</p>
              <NavLinks variant="sidebar" showAdmin={showAdmin} onNavigate={close} />
            </nav>
            <form action={signOut} className="mt-4 border-t border-border pt-4">
              <Button
                type="submit"
                variant="ghost"
                className="w-full justify-start rounded-xl text-muted-foreground"
                onClick={close}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
