import { describe, expect, it } from 'vitest';
import { parseCardList } from './card-list';

describe('parseCardList', () => {
  it('decodes entities, collapses spaces, trims, drops blanks', () => {
    expect(parseCardList('Punjab &amp; Sind Bank RuPay Select Card\n\n  City Union Bank Rupay  select card  \r\n')).toEqual([
      'Punjab & Sind Bank RuPay Select Card',
      'City Union Bank Rupay select card',
    ]);
  });
  it('dedupes case-insensitively, first spelling wins', () => {
    expect(parseCardList('HDFC Bank RuPay Select Card\nhdfc bank rupay select card')).toEqual(['HDFC Bank RuPay Select Card']);
  });
  it('leaves unknown entities alone', () => {
    expect(parseCardList('A &nbsp; B')).toEqual(['A &nbsp; B']);
  });
});
