import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@tg/shared';
import { formatCountdown, formatQuarter, phaseDurationMs, phaseProgress, remainingMs } from '../time.ts';

describe('remainingMs', () => {
  it('is null without a timer', () => {
    expect(remainingMs(null, 0, 1000)).toBeNull();
  });
  it('corrects for the clock offset (server ahead and behind)', () => {
    // Server clock is 5 s ahead of the client: the phase ends sooner than the raw client clock suggests.
    expect(remainingMs(20_000, 5_000, 10_000)).toBe(5_000);
    expect(remainingMs(20_000, -5_000, 10_000)).toBe(15_000);
  });
  it('never goes negative', () => {
    expect(remainingMs(1_000, 0, 5_000)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('formats m:ss and rounds up', () => {
    expect(formatCountdown(90_000)).toBe('1:30');
    expect(formatCountdown(89_001)).toBe('1:30');
    expect(formatCountdown(7_000)).toBe('0:07');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-50)).toBe('0:00');
    expect(formatCountdown(null)).toBe('--:--');
  });
});

describe('phase duration and progress', () => {
  it('derives durations from config', () => {
    expect(phaseDurationMs(defaultConfig, 'LOBBY')).toBeNull();
    expect(phaseDurationMs(defaultConfig, 'FINAL')).toBeNull();
    expect(phaseDurationMs(defaultConfig, 'BRIEFING')).toBe(15_000);
    expect(phaseDurationMs(defaultConfig, 'TRADING')).toBe(90_000);
  });
  it('reports the elapsed share, clamped to 0..1', () => {
    const phase = { phase: 'TRADING' as const, endsAt: 100_000, quarter: 1, totalQuarters: 8, serverTime: 10_000 };
    expect(phaseProgress(defaultConfig, phase, 0, 10_000)).toBe(0);
    expect(phaseProgress(defaultConfig, phase, 0, 55_000)).toBe(0.5);
    expect(phaseProgress(defaultConfig, phase, 0, 200_000)).toBe(1);
    expect(phaseProgress(defaultConfig, { ...phase, phase: 'LOBBY', endsAt: null }, 0, 0)).toBeNull();
  });
});

describe('formatQuarter', () => {
  it('shows Q3/8, and a dash before the first quarter', () => {
    expect(formatQuarter(3, 8)).toBe('Q3/8');
    expect(formatQuarter(0, 8)).toBe('Q-/8');
  });
});
