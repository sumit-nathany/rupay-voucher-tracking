'use client';

import React, { createContext, useContext, useTransition, useState, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface BenefitsLoadingContextType {
  isPending: boolean;
  startTransition: (callback: () => void) => void;
  setIsLoading?: (loading: boolean) => void;
}

const BenefitsLoadingContext = createContext<BenefitsLoadingContextType>({
  isPending: false,
  startTransition: (cb) => cb(),
});

export function useBenefitsLoading() {
  return useContext(BenefitsLoadingContext);
}

export function BenefitsLoadingProvider({ children }: { children: ReactNode }) {
  const [isPending, start] = useTransition();
  const [manualLoading, setManualLoading] = useState(false);

  const active = isPending || manualLoading;

  return (
    <BenefitsLoadingContext.Provider
      value={{
        isPending: active,
        startTransition: start,
        setIsLoading: setManualLoading,
      }}
    >
      {children}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-[2px] transition-all duration-200 animate-in fade-in"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/80 bg-card/95 px-7 py-6 shadow-2xl">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">Loading benefits...</p>
              <p className="text-xs text-muted-foreground mt-0.5">Updating view and data</p>
            </div>
          </div>
        </div>
      )}
    </BenefitsLoadingContext.Provider>
  );
}
