/**
 * Real-time tick clock. Tick n is due at origin + n * tickMs, measured against an absolute
 * origin rather than "last callback + tickMs", so timer jitter never accumulates into drift.
 *
 * When callbacks come late the missing ticks are run at once (catch-up), at most `maxCatchUpTicks`
 * per pump. Anything beyond that (laptop slept, debugger pause) is dropped by moving the origin
 * forward, and `onResync` tells the owner that phase deadlines moved.
 */
export interface TickClockOptions {
  tickMs: number;
  maxCatchUpTicks: number;
  /** Called once per tick with the wall-clock time that tick was due at. */
  onTick: (tickTime: number) => void;
  /** Called after a pump that had to drop ticks or re-anchor the clock. */
  onResync?: () => void;
}

export interface TickClock {
  /** Run every tick that is due at `now`. Returns how many ran. */
  pump(now: number): number;
  /** Wall-clock time the most recently run tick was due at (the origin before the first tick). */
  lastTickTime(): number;
  /** Wall-clock time the next tick is due at. */
  nextTickTime(): number;
  ticks(): number;
}

export function createTickClock(startTime: number, options: TickClockOptions): TickClock {
  const { tickMs, maxCatchUpTicks, onTick, onResync } = options;
  let origin = startTime;
  let done = 0;

  return {
    pump(now) {
      let resync = false;
      // The wall clock was set backwards: re-anchor so the next tick is one tickMs away.
      if (now < origin + (done - 1) * tickMs) {
        origin = now - done * tickMs;
        resync = true;
      }

      const due = Math.floor((now - origin) / tickMs) - done;
      const run = Math.max(0, Math.min(due, maxCatchUpTicks));
      for (let i = 0; i < run; i++) {
        done += 1;
        onTick(origin + done * tickMs);
      }
      if (due > run) {
        origin += (due - run) * tickMs;
        resync = true;
      }
      if (resync) onResync?.();
      return run;
    },
    lastTickTime: () => origin + done * tickMs,
    nextTickTime: () => origin + (done + 1) * tickMs,
    ticks: () => done,
  };
}

export interface RunningClock {
  clock: TickClock;
  stop(): void;
}

/** Drives a TickClock from setTimeout, always aiming at the next absolute tick time. */
export function runTickClock(options: TickClockOptions, now: () => number = Date.now): RunningClock {
  const clock = createTickClock(now(), options);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(
      () => {
        clock.pump(now());
        schedule();
      },
      Math.max(0, clock.nextTickTime() - now()),
    );
  };
  schedule();

  return {
    clock,
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}
