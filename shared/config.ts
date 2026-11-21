/**
 * EVERY tunable number of the game lives here. No magic numbers in sim or server code.
 *
 * - The sim receives a GameConfig object (never reads env or globals), so tests and the balance
 *   harness can pass their own: createSim(seed, mergeConfig(defaultConfig, { ... })).
 * - Dev / e2e overrides are applied by the SERVER SHELL only (server/src/env.ts):
 *     TG_PHASE_SCALE=0.1          scale all phase lengths (see scalePhaseLengths)
 *     TG_CONFIG='{"time":{"quarters":2}}'   deep-merged JSON partial of GameConfig (validated; not net ports/path)
 *     TG_SEED=123                 sim seed
 *     PORT=8787                   game server port (also read by the Vite proxy)
 *     TG_CLIENT_PORT=5173         Vite port (also read by the server to print LAN URLs)
 * - First values come from docs/DESIGN.md; later milestones tune them with the balance harness.
 */
import type { HeadlineMagnitude, QuarterPhase } from './types.ts';

export interface GameConfig {
  time: {
    /** Real ms per sim tick (10 Hz). */
    tickMs: number;
    /** Ticks per candle; 1 candle = 1 trading day. */
    ticksPerCandle: number;
    /** Trading days per quarter. TRADING lasts daysPerQuarter * ticksPerCandle ticks. */
    daysPerQuarter: number;
    /** Quarters per game. */
    quarters: number;
  };
  /** Real-time length of the non-trading phases. TRADING is derived from `time`. */
  phaseMs: Record<Exclude<QuarterPhase, 'TRADING'>, number>;
  lobby: {
    /** 1 so a dev can start alone; real games want 2. */
    minPlayers: number;
    maxPlayers: number;
    maxSpectators: number;
    nameMinLength: number;
    nameMaxLength: number;
    /** A player who dropped less than this long before Start is kept in the game (reload, Wi-Fi blip). */
    ghostGraceMs: number;
  };
  economy: {
    startingCash: number;
    /** Equity below this = eliminated for good. */
    eliminationEquity: number;
  };
  trading: {
    /** Max gross exposure = leverageCap * equity. */
    leverageCap: number;
    /** Margin call when equity < maintenanceMargin * gross exposure. */
    maintenanceMargin: number;
    /** Fraction of short notional charged per trading day. */
    shortBorrowFeePerDay: number;
    /** Quick-size buttons: fractions of buying power. */
    quickSizePct: number[];
    /** Quick-size buttons: fixed dollar amounts. */
    quickSizeUsd: number[];
  };
  market: {
    sectors: number;
    companiesPerSector: number;
    marketCapMin: number;
    marketCapMax: number;
    /** adv = marketCap * advFractionOfCap. */
    advFractionOfCap: number;
    /** Per-day volatility of the market factor M. */
    marketVolPerDay: number;
    /** Per-day volatility of each sector factor S. */
    sectorVolPerDay: number;
    /** Range of per-day idiosyncratic volatility sigma_i. */
    idioVolPerDayMin: number;
    idioVolPerDayMax: number;
    betaMarketMin: number;
    betaMarketMax: number;
    betaSectorMin: number;
    betaSectorMax: number;
    startPriceMin: number;
    startPriceMax: number;
    /** Starting policy rate and the size of one rate move. */
    startRate: number;
    rateStep: number;
  };
  impact: {
    /** fill_price = mid * (1 + sign(q) * lambda * notional / adv). */
    lambda: number;
    /** permanent = kPermanent * notional / adv. */
    kPermanent: number;
    /** temporary = kTemporary * notional / adv, decaying. */
    kTemporary: number;
    temporaryHalfLifeMs: number;
  };
  news: {
    /** Log-return applied by a headline of each magnitude. */
    shock: Record<HeadlineMagnitude, number>;
    /** A shock ramps in over this long ... */
    rampMs: number;
    /** ... overshooting by this fraction before settling. */
    overshoot: number;
    /** Global headline queue: minimum gap between two headlines. */
    minGapMs: number;
    scheduledBeatsPerQuarter: number;
    randomHeadlinesPerQuarter: number;
    /** Share of random headlines that are neutral noise. */
    noiseShare: number;
  };
  earnings: {
    /** Std-dev of true_surprise drawn at BRIEFING. */
    surpriseSigma: number;
    /** Price gap = gapFactor * (true_surprise - priced_in). */
    gapFactor: number;
    leaksPerQuarter: number;
  };
  cards: {
    handLimit: number;
    offersPerShop: number;
    /** Card price = max(minPrice, priceShareOfNetWorth[tier] * buyer net worth). */
    priceShareOfNetWorth: { insider: number; fake: number; event: number; regime: number; counter: number };
    minPrice: number;
    /** Insider tip: how long before everyone else the holder sees the headline. */
    insiderLeadMs: number;
    /** Fake headline: debunked after a random delay in this range, then the move reverts. */
    fakeDebunkMinMs: number;
    fakeDebunkMaxMs: number;
    /** Counter-card trading halt length (stretch goal). */
    haltMs: number;
  };
  regimes: {
    maxActive: number;
    minQuarters: number;
    maxQuarters: number;
    /** Probability that a lobbying bill passes. */
    lobbyPassProbability: number;
  };
  sec: {
    /** Heat added per illegal act. */
    heat: { insiderTip: number; fakeHeadline: number; tradeManipulatedTarget: number; illegalEvent: number; tipOff: number };
    /** P(caught) = min(maxCatchProbability, heat * catchProbabilityPerHeat * rankMultiplier[rank]). */
    catchProbabilityPerHeat: number;
    /** Index 0 = richest player. Richer players are watched more closely. */
    rankMultiplier: number[];
    maxCatchProbability: number;
    /** Fine as a share of net worth. */
    fineShareOfNetWorth: number;
    /** Jail: half a quarter, or a full quarter at/above longJailHeat. */
    jailDaysShort: number;
    jailDaysLong: number;
    longJailHeat: number;
    /** Heat multiplier applied at the end of each quarter when not caught. */
    heatDecayPerQuarter: number;
  };
  presentation: {
    maxMomentsPerGame: number;
    /** A market move of this size (fraction) within a day counts as a crash moment. */
    crashMoveThreshold: number;
    recapTopMoves: number;
    /** Client: the countdown turns urgent at or below this many ms. */
    countdownUrgentMs: number;
    /** Client: how often the countdown re-renders. */
    countdownRefreshMs: number;
    /** Client: how long a server error stays on screen before it dismisses itself. */
    errorVisibleMs: number;
  };
  net: {
    serverPort: number;
    clientPort: number;
    wsPath: string;
    /** Incoming frames larger than this are rejected. */
    maxMessageBytes: number;
    /** Per connection: frames beyond this many per second are dropped (one `rate_limited` error per second). */
    maxMessagesPerSecond: number;
    /** Real-time loop: at most this many catch-up ticks per timer callback. */
    maxCatchUpTicks: number;
    /** Client reconnect backoff. */
    reconnectMinMs: number;
    reconnectMaxMs: number;
  };
}

export const defaultConfig: GameConfig = {
  time: {
    tickMs: 100,
    ticksPerCandle: 10,
    daysPerQuarter: 90,
    quarters: 8,
  },
  phaseMs: {
    BRIEFING: 15_000,
    EARNINGS: 5_000,
    RESULTS: 20_000,
    SHOP: 30_000,
  },
  lobby: {
    minPlayers: 1,
    maxPlayers: 4,
    maxSpectators: 8,
    nameMinLength: 1,
    nameMaxLength: 16,
    ghostGraceMs: 10_000,
  },
  economy: {
    startingCash: 10_000_000,
    eliminationEquity: 100_000,
  },
  trading: {
    leverageCap: 4,
    maintenanceMargin: 0.15,
    shortBorrowFeePerDay: 0.0002,
    quickSizePct: [0.1, 0.25, 0.5, 1],
    quickSizeUsd: [1_000_000, 10_000_000, 100_000_000, 500_000_000],
  },
  market: {
    sectors: 10,
    companiesPerSector: 5,
    marketCapMin: 5e9,
    marketCapMax: 500e9,
    advFractionOfCap: 0.01,
    marketVolPerDay: 0.01,
    sectorVolPerDay: 0.008,
    idioVolPerDayMin: 0.01,
    idioVolPerDayMax: 0.03,
    betaMarketMin: 0.5,
    betaMarketMax: 1.6,
    betaSectorMin: 0.5,
    betaSectorMax: 1.5,
    startPriceMin: 20,
    startPriceMax: 400,
    startRate: 0.03,
    rateStep: 0.0025,
  },
  impact: {
    lambda: 0.05,
    kPermanent: 0.02,
    kTemporary: 0.05,
    temporaryHalfLifeMs: 5_000,
  },
  news: {
    shock: { small: 0.02, medium: 0.05, large: 0.12, huge: 0.25 },
    rampMs: 3_000,
    overshoot: 0.15,
    minGapMs: 2_000,
    scheduledBeatsPerQuarter: 3,
    randomHeadlinesPerQuarter: 12,
    noiseShare: 0.25,
  },
  earnings: {
    surpriseSigma: 0.08,
    gapFactor: 1,
    leaksPerQuarter: 4,
  },
  cards: {
    handLimit: 3,
    offersPerShop: 4,
    priceShareOfNetWorth: { insider: 0.03, fake: 0.05, event: 0.08, regime: 0.15, counter: 0.03 },
    minPrice: 100_000,
    insiderLeadMs: 4_000,
    fakeDebunkMinMs: 10_000,
    fakeDebunkMaxMs: 20_000,
    haltMs: 5_000,
  },
  regimes: {
    maxActive: 2,
    minQuarters: 1,
    maxQuarters: 4,
    lobbyPassProbability: 0.6,
  },
  sec: {
    heat: { insiderTip: 20, fakeHeadline: 30, tradeManipulatedTarget: 15, illegalEvent: 40, tipOff: 25 },
    catchProbabilityPerHeat: 0.006,
    rankMultiplier: [1.5, 1.2, 1, 0.8],
    maxCatchProbability: 0.9,
    fineShareOfNetWorth: 0.1,
    jailDaysShort: 45,
    jailDaysLong: 90,
    longJailHeat: 60,
    heatDecayPerQuarter: 0.5,
  },
  presentation: {
    maxMomentsPerGame: 5,
    crashMoveThreshold: 0.08,
    recapTopMoves: 3,
    countdownUrgentMs: 5_000,
    countdownRefreshMs: 200,
    errorVisibleMs: 6_000,
  },
  net: {
    serverPort: 8787,
    clientPort: 5173,
    wsPath: '/ws',
    maxMessageBytes: 4_096,
    maxMessagesPerSecond: 40,
    maxCatchUpTicks: 50,
    reconnectMinMs: 500,
    reconnectMaxMs: 5_000,
  },
};

export default defaultConfig;

// ---------------------------------------------------------------------------
// Pure helpers (safe for the sim: no I/O)
// ---------------------------------------------------------------------------

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(over)) {
    // Unknown keys are dropped so a typo in TG_CONFIG cannot add stray fields.
    if (key in base) out[key] = deepMerge(base[key], over[key]);
  }
  return out;
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Collects every place where `value` does not have the shape of `reference` (the default config). */
function shapeProblems(reference: unknown, value: unknown, path: string, out: string[]): void {
  if (isPlainObject(reference)) {
    if (!isPlainObject(value)) {
      out.push(`${path} must be an object, got ${describeType(value)}`);
      return;
    }
    for (const key of Object.keys(reference)) shapeProblems(reference[key], value[key], `${path}.${key}`, out);
    return;
  }
  if (Array.isArray(reference)) {
    if (!Array.isArray(value) || value.length === 0) {
      out.push(`${path} must be a non-empty array, got ${describeType(value)}`);
      return;
    }
    value.forEach((item, i) => shapeProblems(reference[0], item, `${path}[${i}]`, out));
    return;
  }
  if (typeof reference === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      out.push(`${path} must be a finite number >= 0, got ${typeof value === 'number' ? String(value) : describeType(value)}`);
    }
    return;
  }
  if (typeof value !== typeof reference) out.push(`${path} must be a ${typeof reference}, got ${describeType(value)}`);
}

/**
 * Throws a readable error when a config cannot run a game: a leaf with another type than in
 * `defaultConfig`, a non-finite or negative number, a zero-length tick or phase, or an impossible
 * lobby. Called by mergeConfig, so env overrides, tests and the balance harness all fail fast.
 */
export function validateConfig(config: GameConfig): GameConfig {
  const problems: string[] = [];
  shapeProblems(defaultConfig, config, 'config', problems);
  if (problems.length === 0) {
    const positiveInt = (path: string, n: number) => {
      if (!Number.isInteger(n) || n < 1) problems.push(`config.${path} must be an integer >= 1, got ${n}`);
    };
    positiveInt('time.tickMs', config.time.tickMs);
    positiveInt('time.ticksPerCandle', config.time.ticksPerCandle);
    positiveInt('time.daysPerQuarter', config.time.daysPerQuarter);
    positiveInt('time.quarters', config.time.quarters);
    positiveInt('lobby.minPlayers', config.lobby.minPlayers);
    positiveInt('lobby.maxPlayers', config.lobby.maxPlayers);
    positiveInt('lobby.nameMinLength', config.lobby.nameMinLength);
    positiveInt('net.maxMessageBytes', config.net.maxMessageBytes);
    positiveInt('net.maxMessagesPerSecond', config.net.maxMessagesPerSecond);
    positiveInt('net.maxCatchUpTicks', config.net.maxCatchUpTicks);
    positiveInt('net.reconnectMinMs', config.net.reconnectMinMs);
    positiveInt('presentation.countdownRefreshMs', config.presentation.countdownRefreshMs);
    for (const [phase, ms] of Object.entries(config.phaseMs)) {
      if (ms <= 0) problems.push(`config.phaseMs.${phase} must be > 0, got ${ms}`);
    }
    if (config.lobby.minPlayers > config.lobby.maxPlayers) problems.push('config.lobby.minPlayers must be <= lobby.maxPlayers');
    if (config.lobby.nameMinLength > config.lobby.nameMaxLength) problems.push('config.lobby.nameMinLength must be <= lobby.nameMaxLength');
    if (config.net.reconnectMinMs > config.net.reconnectMaxMs) problems.push('config.net.reconnectMinMs must be <= net.reconnectMaxMs');
    if (!config.net.wsPath.startsWith('/')) problems.push('config.net.wsPath must start with "/"');
  }
  if (problems.length > 0) throw new Error(`invalid config: ${problems.join('; ')}`);
  return config;
}

/**
 * Returns a new config: `base` with `overrides` deep-merged in. Arrays are replaced whole.
 * Throws (see validateConfig) when the result is not a usable config.
 */
export function mergeConfig(base: GameConfig, overrides: DeepPartial<GameConfig>): GameConfig {
  return validateConfig(deepMerge(base, overrides) as GameConfig);
}

/**
 * Returns a new config with every phase `factor` times as long (0.1 = ten times faster).
 * Non-trading phases scale their ms; TRADING scales daysPerQuarter (at least 1 day),
 * so a day is still ticksPerCandle ticks.
 */
export function scalePhaseLengths(base: GameConfig, factor: number): GameConfig {
  const scaleMs = (ms: number) => Math.max(base.time.tickMs, Math.round(ms * factor));
  return {
    ...base,
    time: { ...base.time, daysPerQuarter: Math.max(1, Math.round(base.time.daysPerQuarter * factor)) },
    phaseMs: {
      BRIEFING: scaleMs(base.phaseMs.BRIEFING),
      EARNINGS: scaleMs(base.phaseMs.EARNINGS),
      RESULTS: scaleMs(base.phaseMs.RESULTS),
      SHOP: scaleMs(base.phaseMs.SHOP),
    },
  };
}

/** Real ms -> whole sim ticks (at least 1). */
export function msToTicks(config: GameConfig, ms: number): number {
  return Math.max(1, Math.round(ms / config.time.tickMs));
}

/** Length of a quarter phase in sim ticks. LOBBY and FINAL have no length. */
export function phaseTicks(config: GameConfig, phase: QuarterPhase): number {
  if (phase === 'TRADING') return config.time.daysPerQuarter * config.time.ticksPerCandle;
  return msToTicks(config, config.phaseMs[phase]);
}

/** Total ticks of one full quarter (BRIEFING..SHOP). */
export function quarterTicks(config: GameConfig): number {
  return (
    phaseTicks(config, 'BRIEFING') +
    phaseTicks(config, 'TRADING') +
    phaseTicks(config, 'EARNINGS') +
    phaseTicks(config, 'RESULTS') +
    phaseTicks(config, 'SHOP')
  );
}
