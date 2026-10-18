'use client';
import { deleteCard } from '@/actions/cards';
import { ConfirmDelete } from '@/components/holders/form-kit';

export function DeleteCardButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDelete
      label="card"
      name={name}
      warning="This permanently removes the card and any un-ordered benefits. A card that has benefits in any status other than Not Ordered cannot be deleted; mark it inactive instead."
      failHint="Could not delete. The card likely has benefits in statuses other than Not Ordered; edit it and mark it inactive instead."
      onConfirm={() => deleteCard({ id })}
    />
  );
}
