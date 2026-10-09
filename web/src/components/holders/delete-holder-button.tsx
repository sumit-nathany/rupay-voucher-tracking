'use client';
import { deleteHolder } from '@/actions/holders';
import { ConfirmDelete } from './form-kit';

export function DeleteHolderButton({ id, name, cardCount }: { id: string; name: string; cardCount: number }) {
  return (
    <ConfirmDelete
      label="holder"
      name={name}
      warning="This permanently removes the holder. This cannot be undone."
      disabledReason={
        cardCount > 0
          ? `${name} still has ${cardCount} card${cardCount === 1 ? '' : 's'}. Delete or move the cards first, or edit the holder and mark them inactive instead.`
          : undefined
      }
      failHint="Could not delete. The holder may still have cards; mark them inactive instead."
      onConfirm={() => deleteHolder({ id })}
    />
  );
}
