import { describe, expect, it } from 'vitest';
import { formatCardLabel } from './card-label';

describe('formatCardLabel', () => {
  it('formats holder, card name, and last digits', () => {
    expect(
      formatCardLabel({
        holderName: 'Mummy',
        cardName: 'Bank of India RuPay Select Card',
        lastDigits: '5159',
      }),
    ).toBe('Mummy • Bank of India RuPay Select Card (xx5159)');
  });

  it('formats when nickname is used as cardName', () => {
    expect(
      formatCardLabel({
        holderName: 'Sumit',
        cardName: 'Papa Fuel Card',
        lastDigits: '7825',
      }),
    ).toBe('Sumit • Papa Fuel Card (xx7825)');
  });

  it('formats without holderName', () => {
    expect(
      formatCardLabel({
        cardName: 'BOI Select',
        lastDigits: '1234',
      }),
    ).toBe('BOI Select (xx1234)');
  });

  it('formats without lastDigits', () => {
    expect(
      formatCardLabel({
        holderName: 'Mummy',
        cardName: 'BOI Select',
      }),
    ).toBe('Mummy • BOI Select');
  });
});
