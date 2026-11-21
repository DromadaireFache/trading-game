import { describe, expect, it } from 'vitest';
import { createTickClock } from '../loop.ts';

function setup(maxCatchUpTicks = 50) {
  const tickTimes: number[] = [];
  let resyncs = 0;
  const clock = createTickClock(1_000, {
    tickMs: 100,
    maxCatchUpTicks,
    onTick: (t) => tickTimes.push(t),
    onResync: () => resyncs++,
  });
  return { clock, tickTimes, resyncs: () => resyncs };
}

describe('tick clock', () => {
  it('runs nothing before the first tick is due', () => {
    const { clock, tickTimes } = setup();
    expect(clock.pump(1_000)).toBe(0);
    expect(clock.pump(1_099)).toBe(0);
    expect(tickTimes).toEqual([]);
    expect(clock.nextTickTime()).toBe(1_100);
  });

  it('does not drift when callbacks are late', () => {
    const { clock, tickTimes } = setup();
    // Every callback is 7-30 ms late; ticks stay on the 100 ms grid.
    for (const now of [1_107, 1_230, 1_315, 1_401, 1_529]) clock.pump(now);
    expect(tickTimes).toEqual([1_100, 1_200, 1_300, 1_400, 1_500]);
    expect(clock.nextTickTime()).toBe(1_600);
  });

  it('catches up on missed ticks in one pump', () => {
    const { clock, tickTimes, resyncs } = setup();
    expect(clock.pump(1_100)).toBe(1);
    expect(clock.pump(1_750)).toBe(6);
    expect(tickTimes).toEqual([1_100, 1_200, 1_300, 1_400, 1_500, 1_600, 1_700]);
    expect(resyncs()).toBe(0);
  });

  it('caps catch-up, drops the rest and reports a resync', () => {
    const { clock, tickTimes, resyncs } = setup(5);
    expect(clock.pump(61_000)).toBe(5); // a minute of sleep = 600 ticks due
    expect(tickTimes).toHaveLength(5);
    expect(resyncs()).toBe(1);
    expect(clock.ticks()).toBe(5);
    // The clock is re-anchored on "now": no backlog, next tick one tickMs later.
    expect(clock.lastTickTime()).toBe(61_000);
    expect(clock.pump(61_099)).toBe(0);
    expect(clock.pump(61_100)).toBe(1);
    expect(resyncs()).toBe(1);
  });

  it('re-anchors when the wall clock jumps backwards', () => {
    const { clock, tickTimes, resyncs } = setup();
    clock.pump(1_300);
    expect(clock.pump(500)).toBe(0);
    expect(resyncs()).toBe(1);
    expect(clock.nextTickTime()).toBe(600);
    expect(clock.pump(600)).toBe(1);
    expect(tickTimes.at(-1)).toBe(600);
  });
});
