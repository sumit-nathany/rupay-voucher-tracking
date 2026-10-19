'use client';

import React, { createContext, useContext, useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface NavigationProgressContextValue {
  navigatingHref: string | null;
  isNavigating: boolean;
  startNavigation: (href: string) => void;
}

const NavigationProgressContext = createContext<NavigationProgressContextValue>({
  navigatingHref: null,
  isNavigating: false,
  startNavigation: () => {},
});

export function useNavigationProgress() {
  return useContext(NavigationProgressContext);
}

export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [navigatingHref, setNavigatingHref] = useState<string | null>(null);

  // Clear pending state whenever route pathname changes
  useEffect(() => {
    setNavigatingHref(null);
  }, [pathname, searchParams]);

  // Safety timeout: reset if navigation stalls for more than 12 seconds
  useEffect(() => {
    if (!navigatingHref) return;
    const timer = setTimeout(() => {
      setNavigatingHref(null);
    }, 12000);
    return () => clearTimeout(timer);
  }, [navigatingHref]);

  const startNavigation = (href: string) => {
    if (href === pathname) {
      // Already on this page
      return;
    }
    setNavigatingHref(href);
    startTransition(() => {
      router.push(href);
    });
  };

  const isNavigating = Boolean(navigatingHref || isPending);

  return (
    <NavigationProgressContext.Provider value={{ navigatingHref, isNavigating, startNavigation }}>
      <NavigationProgressBar isNavigating={isNavigating} />
      {children}
    </NavigationProgressContext.Provider>
  );
}

export function NavigationProgressBar({ isNavigating }: { isNavigating: boolean }) {
  if (!isNavigating) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="fixed top-0 inset-x-0 z-[100] h-[3px] bg-primary/20 overflow-hidden pointer-events-none"
    >
      <div className="h-full w-full bg-primary origin-left animate-nav-progress shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
    </div>
  );
}
