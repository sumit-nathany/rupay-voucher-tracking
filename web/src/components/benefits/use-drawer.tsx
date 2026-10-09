'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BenefitDrawer } from '@/components/benefit-detail/benefit-drawer';

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
  const drawer = (
    <BenefitDrawer
      instanceId={id}
      title={label?.title}
      subtitle={label?.subtitle}
      open={isOpen}
      onOpenChange={setOpen}
      onChanged={() => router.refresh()}
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
