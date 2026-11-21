import { expect, it } from 'vitest';
import { cleanHeadline, parseLines } from '../prompt.ts';
import type { Brief } from '../prompt.ts';

it('ignores ambiguous rows while keeping surviving headlines attached to their original briefs', () => {
  expect([...parseLines('<think></think>1|one\n2|two\n2|different\n4|four\n8|out of range', 4)])
    .toEqual([[0, 'one'], [3, 'four']]);
});

it('rejects changes to the assigned business fact and incomplete lines', () => {
  const approved = 'Weekend charter deal nudges {COMPANY} bookings higher';
  const brief: Brief = {
    scope: 'stock', sector: 'airlines', direction: 'up', magnitude: 'small', kind: 'real',
    category: 'contract', core: 'lands a small deal for regional flights', family: 'contract', choices: [approved],
  };
  expect(cleanHeadline(approved + '.', brief)).toBe(approved);
  expect(cleanHeadline(approved, brief)).toBeUndefined();
  expect(cleanHeadline('{COMPANY} loses its weekend charter deal.', brief)).toBeUndefined();
});
