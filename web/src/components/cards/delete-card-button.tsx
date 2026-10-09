'use client';
import { deleteCard } from '@/actions/cards';
import { ConfirmDelete } from '@/components/holders/form-kit';

export function DeleteCardButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDelete
      label="card"
      name={name}
      warning="This permanently removes the card. A card that already has benefit history cannot be deleted; mark it inactive instead."
      failHint="Could not delete. The card likely has benefit history; edit it and mark it inactive instead."
      onConfirm={() => deleteCard({ id })}
    />
  );
}
