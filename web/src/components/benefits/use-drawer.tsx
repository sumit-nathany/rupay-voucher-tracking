'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BenefitDrawer } from '@/components/benefit-detail/benefit-drawer';
import { listItemToView } from '@/components/benefit-detail/helpers';
import type { InstanceListItem } from '@/domain/instance-queries';
import type { InstanceView } from '@/domain/instances';
import { useBenefitsLoading } from './benefits-loading-provider';

interface DrawerLabel {
  title: string;
  subtitle: string;
}

export interface UseBenefitDrawerOptions {
  portalAccounts?: Array<{ id: string; label: string; phoneNumber?: string | null; status?: string }>;
}

/** Shared drawer wiring: returns an `open(id, label, initial)` handler and the drawer element. */
export function useBenefitDrawer(options?: UseBenefitDrawerOptions) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [label, setLabel] = useState<DrawerLabel | undefined>();
  const [initialData, setInitialData] = useState<InstanceView | null>(null);
  const { startTransition: loadingStart } = useBenefitsLoading();
  const [, localStart] = useTransition();
  const start = loadingStart || localStart;
  const drawer = (
    <BenefitDrawer
      instanceId={id}
      initialData={initialData}
      title={label?.title}
      subtitle={label?.subtitle}
      open={isOpen}
      onOpenChange={setOpen}
      onChanged={() => start(() => router.refresh())}
    />
  );
  return {
    open: (instanceId: string, l?: DrawerLabel, initial?: InstanceListItem | InstanceView) => {
      setId(instanceId);
      setLabel(l);
      if (initial) {
        const view = 'status' in initial ? listItemToView(initial as InstanceListItem, options?.portalAccounts) : (initial as InstanceView);
        setInitialData(view);
      } else {
        setInitialData(null);
      }
      setOpen(true);
    },
    drawer,
  };
}
