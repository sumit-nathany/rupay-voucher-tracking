'use client';

import { deleteBenefitValueOverrideAction } from '@/actions/benefit-values';
import { ConfirmDelete } from '@/components/holders/form-kit';

export function DeleteBenefitValueButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDelete
      label="valuation override"
      name={name}
      warning="This will revert this benefit back to RuPay's default catalog value across all your cards."
      failHint="Could not remove custom valuation."
      onConfirm={() => deleteBenefitValueOverrideAction({ id })}
    />
  );
}
