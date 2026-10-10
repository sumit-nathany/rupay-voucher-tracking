'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BenefitDrawer } from '@/components/benefit-detail/benefit-drawer';
import { useBenefitsLoading } from './benefits-loading-provider';

interface DrawerLabel {
  title: string;
  subtitle: string;
}

/** Shared drawer wiring: returns an `open(id)` handler and the drawer element. */
export function useBenefitDrawer() {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [label, setLabel] = useState<DrawerLabel | undefined>();
  const { startTransition: loadingStart } = useBenefitsLoading();
  const [, localStart] = useTransition();
  const start = loadingStart || localStart;
  const drawer = (
    <BenefitDrawer
      instanceId={id}
      title={label?.title}
      subtitle={label?.subtitle}
      open={isOpen}
      onOpenChange={setOpen}
      onChanged={() => start(() => router.refresh())}
    />
  );
  return {
    open: (instanceId: string, l?: DrawerLabel) => {
      setId(instanceId);
      setLabel(l);
      setOpen(true);
    },
    drawer,
  };
}
