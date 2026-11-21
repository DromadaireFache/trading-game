import { describe, expect, it, vi } from 'vitest';
import { QuotePaintQueue } from '../quotePaintQueue.ts';

describe('company list quote paints', () => {
  it('paints only a random tenth of rows per interval using the latest quote', () => {
    const queue = new QuotePaintQueue(() => 0.99);
    const prices = Array.from({ length: 20 }, () => 1);
    const shown = [...prices];
    for (let i = 0; i < prices.length; i++) {
      queue.register(String(i), () => { shown[i] = prices[i]!; });
      prices[i] = 2;
      queue.mark(String(i));
    }
    prices[19] = 3;
    queue.flush();
    expect(shown.filter((price) => price !== 1)).toHaveLength(2);
    expect(shown[19]).toBe(3);
    expect(shown[1]).toBe(1);
    for (let i = 0; i < 9; i++) queue.flush();
    expect(shown).toEqual(prices);
  });

  it('refreshes all rows on reset and removes unregistered rows', () => {
    const queue = new QuotePaintQueue();
    const paint = vi.fn();
    const unregister = queue.register('A', paint);
    queue.mark('A');
    queue.reset();
    queue.flush();
    expect(paint).toHaveBeenCalledTimes(2);
    queue.mark('A');
    unregister();
    queue.flush();
    expect(paint).toHaveBeenCalledTimes(2);
  });
});
