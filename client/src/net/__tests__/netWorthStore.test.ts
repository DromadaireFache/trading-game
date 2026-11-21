import { describe, expect, it, vi } from 'vitest';
import type { NetWorthSample } from '@tg/shared';
import { NetWorthStore } from '../netWorthStore.ts';

const sample = (tick: number, equity: number): NetWorthSample => ({ tick, equity: { ann: equity } });

describe('NetWorthStore', () => {
  it('retains each intraday tick and replaces a corrected balance at the same tick', () => {
    const store = new NetWorthStore();
    const opening = sample(0, 100);
    const first = sample(1, 102);
    const second = sample(2, 99);
    store.apply({ t: 'net_worth', samples: [opening] });
    store.apply({ t: 'net_worth', samples: [first, second] });
    const beforeCorrection = store.getSamples();
    expect(beforeCorrection).toEqual([opening, first, second]);

    const correction = sample(2, 98);
    store.apply({ t: 'net_worth', samples: [correction] });
    expect(store.getSamples()).toEqual([opening, first, correction]);
    expect(store.getSamples()[1]).toBe(first);
    expect(beforeCorrection[2]).toBe(second);
  });

  it('restores a late projector from a full snapshot and clears it for a new game', () => {
    const store = new NetWorthStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const history = [sample(0, 100), sample(1, 125), sample(2, 111)];
    store.apply({ t: 'net_worth', samples: history, reset: true });
    const next = sample(3, 118);
    store.apply({ t: 'net_worth', samples: [next] });
    expect(store.getSamples()).toEqual([...history, next]);
    expect(store.getSamples()[2]).toBe(history[2]);

    store.apply({ t: 'net_worth', samples: [], reset: true });
    expect(store.getSamples()).toEqual([]);
    expect(listener).toHaveBeenLastCalledWith({ t: 'net_worth', samples: [], reset: true });
    unsubscribe();
    store.apply({ t: 'net_worth', samples: [sample(0, 90)] });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
