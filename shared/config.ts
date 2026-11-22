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
import { SECTORS } from './types.ts';
import type { HeadlineMagnitude, Phase, QuarterPhase, ReadyPhase, Sector } from './types.ts';

/**
 * Where a sector's companies sit inside the generation ranges of config.market: each value is a
 * POSITION 0..1 between the matching Min and Max (0 = at Min, 1 = at Max).
 */
export interface SectorProfile {
  /** Position in [betaMarketMin, betaMarketMax]. */
  betaMarket: number;
  /** Position in [betaSectorMin, betaSectorMax]. */
  betaSector: number;
  /** Position in [idioVolPerDayMin, idioVolPerDayMax]. */
  idioVol: number;
  /** Position in [rateSensitivityMin, rateSensitivityMax] (magnitude). */
  rateSensitivity: number;
}

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
    /** At most this many margin-call liquidations per player per tick (the largest position goes first). */
    liquidationsPerTick: number;
    /** Quick bets (Simple mode): trading days a bet runs before it cashes out by itself. */
    quickBetDays: number;
    /** Quick bet stakes (Small / Medium / Big) as shares of the player's buying power. */
    quickBetStakes: number[];
  };
  market: {
    /** Must equal SECTORS.length (10): sector ids are fixed in shared/types.ts. */
    sectors: number;
    companiesPerSector: number;

    // --- company generation (drawn once per game from the seed) ---
    /** Market caps are drawn log-uniformly in [marketCapMin, marketCapMax] $. */
    marketCapMin: number;
    marketCapMax: number;
    /** adv (daily dollar volume) = marketCap * a fraction drawn in [advFractionOfCapMin, advFractionOfCapMax]. */
    advFractionOfCapMin: number;
    advFractionOfCapMax: number;
    /** A fund's own adv = sum of its members' adv * this. */
    fundAdvShareOfMembers: number;
    /** Range of the loading on the market factor. */
    betaMarketMin: number;
    betaMarketMax: number;
    /** Range of the loading on the company's sector factor. */
    betaSectorMin: number;
    betaSectorMax: number;
    /** Range of per-day idiosyncratic volatility sigma_i. */
    idioVolPerDayMin: number;
    idioVolPerDayMax: number;
    /**
     * Range of the MAGNITUDE of rate_sensitivity (log-return per unit of rate: 8 means a +0.25 pt
     * hike moves the stock 2%). The sim applies the sign: negative, except rate-loving sectors (finance).
     */
    rateSensitivityMin: number;
    rateSensitivityMax: number;
    /** Starting share prices are drawn log-uniformly in this range, $. shares = marketCap / price. */
    startPriceMin: number;
    startPriceMax: number;
    /** Fundamentals: revenue = marketCap / priceToSales; debt = marketCap * debtToCap. */
    priceToSalesMin: number;
    priceToSalesMax: number;
    marginMin: number;
    marginMax: number;
    debtToCapMin: number;
    debtToCapMax: number;
    /** Sector character: the centre of each sector's companies inside the ranges above. */
    sectorProfiles: Record<Sector, SectorProfile>;
    /** A company is drawn within +- this (as a fraction of the range) around its sector's centre. */
    sectorProfileSpread: number;
    /** Big caps are calmer: idio-vol position shifts by capVolTilt * (0.5 - log-position of the cap in its range). */
    capVolTilt: number;
    /** Sectors whose rate sensitivity is POSITIVE (they gain from hikes); all others lose. */
    rateLovingSectors: Sector[];

    // --- funds ---
    /** 'cap' = members weighted by market cap; 'equal' = equal weights. */
    fundWeighting: 'cap' | 'equal';
    /** Every fund starts at this price, $. */
    fundStartPrice: number;

    // --- price process (volatilities are per TRADING DAY; the sim scales by sqrt(1 / ticksPerCandle) per tick) ---
    /** Per-day volatility of the market factor M. */
    marketVolPerDay: number;
    /** Per-day volatility of each sector factor S. */
    sectorVolPerDay: number;
    /**
     * Realism of the price process (used when createSim runs the market; a bare createMarket without a
     * dynamics stream is the plain factor model). Volatility clusters: the market and each sector carry
     * a log-volatility that wanders (volOfVolPerDay), is pulled back to normal (volReversionPerDay),
     * jumps up after market drops (volLeverage) and never exceeds volMultMax x. Stocks also take rare
     * jumps with no headline: jumpsPerDay per stock, log size ~ N(0, jumpSize). Scaled so the long-run
     * variance still matches the configured daily volatilities.
     */
    dynamics: {
      volOfVolPerDay: number;
      volReversionPerDay: number;
      volLeverage: number;
      volMultMax: number;
      jumpsPerDay: number;
      jumpSize: number;
    };
    /** No price ever goes below this, $. */
    priceFloor: number;
    /** Decimals of prices on the wire (the sim keeps full precision). */
    priceDecimals: number;

    // --- rates ---
    /** Starting policy rate (0.03 = 3%) and the size of one rate move. */
    startRate: number;
    rateStep: number;
    /** The rate decision never takes the policy rate outside [rateMin, rateMax]. */
    rateMin: number;
    rateMax: number;
  };
  impact: {
    /** fill_price = mid * (1 + sign(q) * lambda * notional / adv). */
    lambda: number;
    /** permanent = kPermanent * notional / adv. */
    kPermanent: number;
    /** temporary = kTemporary * notional / adv, decaying. */
    kTemporary: number;
    temporaryHalfLifeMs: number;
    /**
     * Caps on each impact term (fractions / log-returns) so a whale order into a small cap cannot
     * produce absurd prices. notional / adv itself is not capped.
     */
    maxSlippage: number;
    maxPermanent: number;
    maxTemporary: number;
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
    /**
     * Longest wait for the next headline: each quarter a chain of filler headlines runs through the
     * whole trading window, each one minGapMs to maxGapMs after the previous, so there is always news
     * on the desk. 0 turns the chain off.
     */
    maxGapMs: number;
    /**
     * Average time between two headlines over a quarter, all of them counted (the planned ones too):
     * the chain's gaps are skewed toward minGapMs (gap = min + (max - min) * u^k, u uniform) with k set
     * so the whole quarter averages this.
     */
    meanGapMs: number;
    /** The filler chain: mostly noise and small moves, so frequent news does not mean a wild market. */
    filler: {
      noiseShare: number;
      magnitudeWeights: Record<HeadlineMagnitude, number>;
    };
    /**
     * Delay between an engine headline and its market effect. A player's card headline (and a regime a
     * card starts) moves the market at once: only the player who made it can be positioned for it.
     */
    leadMinMs: number;
    leadMaxMs: number;
    scheduledBeatsPerQuarter: number;
    randomHeadlinesPerQuarter: number;
    /** Share of random headlines that are neutral noise. */
    noiseShare: number;
    /** Relative odds of a random (non-noise) headline's scope. */
    scopeWeights: Record<'market' | 'sector' | 'stock', number>;
    /** Relative odds of a random headline's magnitude. */
    magnitudeWeights: Record<HeadlineMagnitude, number>;
    /** A shock's size is shock[magnitude] * (1 + shockJitter * u), u uniform in [-1, 1]. */
    shockJitter: number;
    /** No random headline in the first quietDays trading days of a quarter. */
    quietDays: number;
    /**
     * Names of the quarter's scheduled beats, announced at BRIEFING with their day (direction hidden).
     * The FIRST one is the central-bank rate decision: it also moves the policy rate by market.rateStep.
     */
    beatTitles: string[];
    /** How many recent headlines a (re)joining client gets. */
    replayHeadlines: number;
    /**
     * How the market reacts to the engine's own headlines (cards keep their exact effect), so the
     * same headline never moves a price the same way twice:
     *   size        x exp(N(0, sizeSigma)) (median 1)
     *   reversal    with reverseChance the market shrugs the other way ("sell the news"), x reverseScale
     *   shape       overshoot drawn in [overshootMin, overshootMax], ramp time x [rampMultMin, rampMultMax]
     *   aftermath   with driftChance a slow follow-through (> 0) or fade (< 0) of driftShare x the move over
     *               driftDays days
     *   leaks       an earnings leak points the right way with leakAccuracy, else it misleads (the gap at
     *               the report corrects it)
     */
    reaction: {
      sizeSigma: number;
      reverseChance: number;
      reverseScale: number;
      overshootMin: number;
      overshootMax: number;
      rampMultMin: number;
      rampMultMax: number;
      driftChance: number;
      driftShareMin: number;
      driftShareMax: number;
      driftDaysMin: number;
      driftDaysMax: number;
      leakAccuracy: number;
    };
  };
  earnings: {
    /** Std-dev of true_surprise drawn at BRIEFING. */
    surpriseSigma: number;
    /** Price gap = gapFactor * (true_surprise - priced_in). */
    gapFactor: number;
    /** Delay from the next trading open to the earnings gap. Zero means the first market tick. */
    gapDelayMinMs: number;
    gapDelayMaxMs: number;
    leaksPerQuarter: number;
    /** A leak prices in a share, drawn in [leakShareMin, leakShareMax], of the surprise not yet priced in. */
    leakShareMin: number;
    leakShareMax: number;
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
  /**
   * The game gets wilder each quarter so a trailing player can still come back. Each multiplier runs
   * linearly from 1 in the first quarter to its value in the last (see quarterRamp):
   *   volLastQuarter    all random volatility (market, sector, stock) and the engine's headline moves
   *   cardsLastQuarter  the price effect of a card played that quarter (headline size, regime drift,
   *                     regime vol and correlation boosts, a lobbying bill's drift)
   */
  progression: {
    volLastQuarter: number;
    cardsLastQuarter: number;
    /**
     * Shop discount (0.25 = 25% off) for the players in the bottom half of net worth when the shop
     * opens (with an odd count the middle player pays full price).
     */
    underdogDiscount: number;
  };
  regimes: {
    maxActive: number;
    minQuarters: number;
    maxQuarters: number;
    /** Probability that a lobbying bill passes. */
    lobbyPassProbability: number;
  };
  sec: {
    /**
     * Heat added per act. selfDeal: a card that moves a stock or sector you hold (legal cards too);
     * selfDealInFavor: added on top when it moves it your way (pumping your long, sinking your short).
     * A market-wide card only adds selfDealInFavor, when it moves the market your way.
     */
    heat: {
      insiderTip: number;
      fakeHeadline: number;
      tradeManipulatedTarget: number;
      illegalEvent: number;
      tipOff: number;
      selfDeal: number;
      selfDealInFavor: number;
    };
    /** P(caught) = min(maxCatchProbability, heat * catchProbabilityPerHeat * rankMultiplier[rank]). */
    catchProbabilityPerHeat: number;
    /** Index 0 = richest player. Richer players are watched more closely. */
    rankMultiplier: number[];
    maxCatchProbability: number;
    /** Fine as a share of net worth. */
    fineShareOfNetWorth: number;
    /** Jail length in quarters (of trading days), counted from the next quarter's open. */
    jailQuarters: number;
    /** In jail: no cards (playing or buying), and every order fills this long after it was sent. */
    jailOrderDelayMs: number;
    /** Heat multiplier applied at the end of each quarter when not caught. */
    heatDecayPerQuarter: number;
    /**
     * Share of the self-dealing and traded-a-moved-stock heat that a LEGAL card brings (illegal cards
     * bring all of it). Heat from legal cards only raises the odds: the SEC rolls only for players who
     * played an illegal card that quarter, so playing legal cards alone never lands you in jail.
     */
    legalHeatShare: number;
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
    /** Projector: how long a BREAKING moment banner stays on screen. */
    momentVisibleMs: number;
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
    quarters: 4,
  },
  phaseMs: {
    BRIEFING: 5_000,
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
    liquidationsPerTick: 1,
    quickBetDays: 5,
    quickBetStakes: [0.1, 0.25, 0.5],
  },
  market: {
    sectors: 6,
    companiesPerSector: 5,
    marketCapMin: 5e9,
    marketCapMax: 500e9,
    // M7 tuning: 12x the first guess (0.005..0.02), so a winner's orders don't drown in slippage as
    // net worth grows, while a $500M order still visibly moves a mid-cap (about 0.2-0.8% slippage).
    // Second pass (with cards): 0.04..0.16 gave a winner median of $0.87B at a 4-skilled-player table.
    advFractionOfCapMin: 0.06,
    advFractionOfCapMax: 0.24,
    fundAdvShareOfMembers: 0.25,
    betaMarketMin: 0.5,
    betaMarketMax: 1.6,
    betaSectorMin: 0.5,
    betaSectorMax: 1.5,
    idioVolPerDayMin: 0.005,
    idioVolPerDayMax: 0.015,
    rateSensitivityMin: 2,
    rateSensitivityMax: 12,
    startPriceMin: 20,
    startPriceMax: 400,
    priceToSalesMin: 0.5,
    priceToSalesMax: 8,
    marginMin: 0.03,
    marginMax: 0.35,
    debtToCapMin: 0,
    debtToCapMax: 0.6,
    sectorProfiles: {
      tech: { betaMarket: 0.8, betaSector: 0.6, idioVol: 0.7, rateSensitivity: 0.8 },
      energy: { betaMarket: 0.5, betaSector: 0.8, idioVol: 0.6, rateSensitivity: 0.3 },
      defense: { betaMarket: 0.2, betaSector: 0.7, idioVol: 0.3, rateSensitivity: 0.2 },
      airlines: { betaMarket: 0.8, betaSector: 0.8, idioVol: 0.8, rateSensitivity: 0.4 },
      finance: { betaMarket: 0.6, betaSector: 0.6, idioVol: 0.4, rateSensitivity: 0.7 },
      health: { betaMarket: 0.2, betaSector: 0.4, idioVol: 0.5, rateSensitivity: 0.3 },
    },
    sectorProfileSpread: 0.25,
    capVolTilt: 0.4,
    rateLovingSectors: ['finance'],
    fundWeighting: 'cap',
    fundStartPrice: 100,
    // Between the first guess (1% / 0.8%) and the calm pass (0.25% / 0.2%): calm days stay calm, the
    // dynamics below add storms.
    marketVolPerDay: 0.005,
    sectorVolPerDay: 0.004,
    dynamics: {
      volOfVolPerDay: 0.12,
      volReversionPerDay: 0.08,
      volLeverage: 0.15,
      volMultMax: 3.5,
      jumpsPerDay: 0.012,
      jumpSize: 0.05,
    },
    priceFloor: 1,
    priceDecimals: 2,
    startRate: 0.03,
    rateStep: 0.0025,
    rateMin: 0,
    rateMax: 0.12,
  },
  impact: {
    lambda: 0.05,
    kPermanent: 0.02,
    kTemporary: 0.05,
    temporaryHalfLifeMs: 5_000,
    maxSlippage: 0.15,
    // kPermanent / lambda (0.4) times maxSlippage: at the cap, permanent impact stays well below what the
    // order paid in slippage, so a whale cannot buy a mark-up worth more than it cost.
    maxPermanent: 0.06,
    maxTemporary: 0.25,
  },
  news: {
    // M7 tuning: only `huge` grew (0.25 -> 0.5). Scheduled beats use medium / large, so the whole market
    // stays calm while big tradable news lands on stocks and sectors (see scopeWeights).
    shock: { small: 0.02, medium: 0.05, large: 0.12, huge: 0.5 },
    rampMs: 3_000,
    overshoot: 0.15,
    // A headline every 5 to 20 s, 10 s on average (about 9 a quarter): the filler chain plus the planned ones below.
    minGapMs: 5_000,
    maxGapMs: 20_000,
    meanGapMs: 10_000,
    filler: {
      noiseShare: 0.6,
      magnitudeWeights: { small: 0.55, medium: 0.35, large: 0.1, huge: 0 },
    },
    // An engine headline lands on every desk; its price starts moving 8-11 s later, time to read and act.
    leadMinMs: 8_000,
    leadMaxMs: 11_000,
    // Planned on top of the filler: 1 scheduled beat (the rate decision), 1 random (can be huge), 1 earnings leak.
    scheduledBeatsPerQuarter: 1,
    randomHeadlinesPerQuarter: 1,
    noiseShare: 0.25,
    scopeWeights: { market: 0.05, sector: 0.3, stock: 0.65 },
    magnitudeWeights: { small: 0.3, medium: 0.3, large: 0.2, huge: 0.2 },
    shockJitter: 0.25,
    quietDays: 2,
    beatTitles: ['Central bank rate decision', 'Jobs report', 'GDP flash estimate', 'Inflation print'],
    replayHeadlines: 30,
    reaction: {
      sizeSigma: 0.35,
      reverseChance: 0.08,
      reverseScale: 0.5,
      overshootMin: -0.2,
      overshootMax: 0.6,
      rampMultMin: 0.5,
      rampMultMax: 1.8,
      driftChance: 0.5,
      driftShareMin: -0.4,
      driftShareMax: 0.5,
      driftDaysMin: 3,
      driftDaysMax: 10,
      leakAccuracy: 0.75,
    },
  },
  earnings: {
    surpriseSigma: 0.08,
    gapFactor: 1,
    gapDelayMinMs: 0,
    gapDelayMaxMs: 3_000,
    leaksPerQuarter: 1,
    // Leaks hint at direction while leaving most of the move for the reported beat or miss.
    leakShareMin: 0.05,
    leakShareMax: 0.1,
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
  progression: {
    volLastQuarter: 2,
    cardsLastQuarter: 2,
    underdogDiscount: 0.25,
  },
  regimes: {
    maxActive: 2,
    minQuarters: 1,
    maxQuarters: 4,
    lobbyPassProbability: 0.6,
  },
  sec: {
    heat: { insiderTip: 20, fakeHeadline: 30, tradeManipulatedTarget: 25, illegalEvent: 40, tipOff: 25, selfDeal: 30, selfDealInFavor: 30 },
    catchProbabilityPerHeat: 0.006,
    rankMultiplier: [1.5, 1.2, 1, 0.8],
    maxCatchProbability: 0.9,
    fineShareOfNetWorth: 0.1,
    jailQuarters: 1,
    jailOrderDelayMs: 3_000,
    heatDecayPerQuarter: 0.5,
    legalHeatShare: 0.4,
  },
  presentation: {
    maxMomentsPerGame: 5,
    crashMoveThreshold: 0.08,
    recapTopMoves: 3,
    countdownUrgentMs: 5_000,
    countdownRefreshMs: 200,
    errorVisibleMs: 6_000,
    momentVisibleMs: 6_000,
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

/** The only numbers that may be negative (an undershoot, a fade after the news). */
const SIGNED_PATHS = new Set(['config.news.reaction.overshootMin', 'config.news.reaction.driftShareMin']);

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
    const signed = SIGNED_PATHS.has(path);
    if (typeof value !== 'number' || !Number.isFinite(value) || (!signed && value < 0)) {
      out.push(`${path} must be a finite number${signed ? '' : ' >= 0'}, got ${typeof value === 'number' ? String(value) : describeType(value)}`);
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
    // Not always whole: the lobby's game length tunes it so a day lands exactly (withGameLength).
    if (!(Number.isFinite(config.time.tickMs) && config.time.tickMs >= 1)) problems.push(`config.time.tickMs must be >= 1, got ${config.time.tickMs}`);
    positiveInt('time.ticksPerCandle', config.time.ticksPerCandle);
    positiveInt('time.daysPerQuarter', config.time.daysPerQuarter);
    positiveInt('time.quarters', config.time.quarters);
    const pr = config.progression;
    if (!(pr.volLastQuarter > 0)) problems.push('config.progression.volLastQuarter must be > 0');
    if (!(pr.cardsLastQuarter > 0)) problems.push('config.progression.cardsLastQuarter must be > 0');
    if (!(pr.underdogDiscount >= 0 && pr.underdogDiscount < 1)) problems.push('config.progression.underdogDiscount must be in [0, 1)');
    positiveInt('lobby.minPlayers', config.lobby.minPlayers);
    positiveInt('lobby.maxPlayers', config.lobby.maxPlayers);
    positiveInt('lobby.nameMinLength', config.lobby.nameMinLength);
    positiveInt('net.maxMessageBytes', config.net.maxMessageBytes);
    positiveInt('net.maxMessagesPerSecond', config.net.maxMessagesPerSecond);
    positiveInt('net.maxCatchUpTicks', config.net.maxCatchUpTicks);
    positiveInt('net.reconnectMinMs', config.net.reconnectMinMs);
    positiveInt('presentation.countdownRefreshMs', config.presentation.countdownRefreshMs);
    positiveInt('trading.liquidationsPerTick', config.trading.liquidationsPerTick);
    if (config.trading.leverageCap <= 0) problems.push('config.trading.leverageCap must be > 0');
    if (config.trading.maintenanceMargin * config.trading.leverageCap >= 1) {
      problems.push('config.trading.maintenanceMargin * leverageCap must be < 1, or a fully levered position is margin-called at once');
    }
    if (config.impact.temporaryHalfLifeMs <= 0) problems.push('config.impact.temporaryHalfLifeMs must be > 0');
    for (const [phase, ms] of Object.entries(config.phaseMs)) {
      if (ms <= 0) problems.push(`config.phaseMs.${phase} must be > 0, got ${ms}`);
    }
    if (config.lobby.minPlayers > config.lobby.maxPlayers) problems.push('config.lobby.minPlayers must be <= lobby.maxPlayers');
    if (config.lobby.nameMinLength > config.lobby.nameMaxLength) problems.push('config.lobby.nameMinLength must be <= lobby.nameMaxLength');
    if (config.net.reconnectMinMs > config.net.reconnectMaxMs) problems.push('config.net.reconnectMinMs must be <= net.reconnectMaxMs');
    if (!config.net.wsPath.startsWith('/')) problems.push('config.net.wsPath must start with "/"');

    const m = config.market;
    if (m.sectors !== SECTORS.length) problems.push(`config.market.sectors must be ${SECTORS.length} (the sector ids are fixed), got ${m.sectors}`);
    positiveInt('market.companiesPerSector', m.companiesPerSector);
    if (!Number.isInteger(m.priceDecimals) || m.priceDecimals > 6) problems.push(`config.market.priceDecimals must be an integer 0..6, got ${m.priceDecimals}`);
    if (m.fundWeighting !== 'cap' && m.fundWeighting !== 'equal') problems.push(`config.market.fundWeighting must be "cap" or "equal", got "${String(m.fundWeighting)}"`);
    const positive = (path: string, n: number) => {
      if (n <= 0) problems.push(`config.${path} must be > 0, got ${n}`);
    };
    positive('market.marketCapMin', m.marketCapMin);
    positive('market.advFractionOfCapMin', m.advFractionOfCapMin);
    positive('market.fundAdvShareOfMembers', m.fundAdvShareOfMembers);
    positive('market.startPriceMin', m.startPriceMin);
    positive('market.priceToSalesMin', m.priceToSalesMin);
    positive('market.fundStartPrice', m.fundStartPrice);
    positive('market.priceFloor', m.priceFloor);
    const ranges: Array<[string, number, number]> = [
      ['marketCap', m.marketCapMin, m.marketCapMax],
      ['advFractionOfCap', m.advFractionOfCapMin, m.advFractionOfCapMax],
      ['betaMarket', m.betaMarketMin, m.betaMarketMax],
      ['betaSector', m.betaSectorMin, m.betaSectorMax],
      ['idioVolPerDay', m.idioVolPerDayMin, m.idioVolPerDayMax],
      ['rateSensitivity', m.rateSensitivityMin, m.rateSensitivityMax],
      ['startPrice', m.startPriceMin, m.startPriceMax],
      ['priceToSales', m.priceToSalesMin, m.priceToSalesMax],
      ['margin', m.marginMin, m.marginMax],
      ['debtToCap', m.debtToCapMin, m.debtToCapMax],
    ];
    for (const [name, min, max] of ranges) {
      if (min > max) problems.push(`config.market.${name}Min must be <= market.${name}Max`);
    }
    for (const [sector, profile] of Object.entries(m.sectorProfiles)) {
      for (const [key, position] of Object.entries(profile)) {
        if (position > 1) problems.push(`config.market.sectorProfiles.${sector}.${key} must be a position 0..1, got ${position}`);
      }
    }
    if (m.rateMin > m.rateMax || m.startRate < m.rateMin || m.startRate > m.rateMax) {
      problems.push('config.market.rateMin <= startRate <= rateMax must hold');
    }
    const d = m.dynamics;
    if (d.volReversionPerDay <= 0) problems.push('config.market.dynamics.volReversionPerDay must be > 0');
    if (d.volMultMax < 1) problems.push('config.market.dynamics.volMultMax must be >= 1');
    if (d.jumpsPerDay > config.time.ticksPerCandle) problems.push('config.market.dynamics.jumpsPerDay is a rate per day: at most ticksPerCandle');
    const rc = config.news.reaction;
    if (rc.reverseChance > 1 || rc.driftChance > 1 || rc.leakAccuracy > 1) problems.push('config.news.reaction chances must be <= 1');
    if (rc.overshootMin > rc.overshootMax || rc.rampMultMin > rc.rampMultMax || rc.driftShareMin > rc.driftShareMax || rc.driftDaysMin > rc.driftDaysMax) {
      problems.push('config.news.reaction: every Min must be <= its Max');
    }
    if (rc.rampMultMin <= 0 || rc.driftDaysMin < 1) problems.push('config.news.reaction: rampMultMin must be > 0 and driftDaysMin >= 1');
    const n = config.news;
    if (n.leadMinMs <= 0 || n.leadMinMs > n.leadMaxMs) problems.push('config.news.leadMinMs must be > 0 and <= leadMaxMs');
    if (n.maxGapMs !== 0 && n.maxGapMs < Math.max(n.minGapMs, config.time.tickMs)) problems.push('config.news.maxGapMs must be 0 or >= minGapMs');
    if (n.maxGapMs !== 0 && (n.meanGapMs <= n.minGapMs || n.meanGapMs > n.maxGapMs)) problems.push('config.news.meanGapMs must be > minGapMs and <= maxGapMs');
    if (n.filler.noiseShare > 1) problems.push('config.news.filler.noiseShare must be <= 1');
    if (Object.values(n.filler.magnitudeWeights).every((w) => w === 0)) problems.push('config.news.filler.magnitudeWeights must not all be 0');
    if (n.shockJitter > 1) problems.push('config.news.shockJitter must be <= 1');
    if (Object.values(n.scopeWeights).every((w) => w === 0)) problems.push('config.news.scopeWeights must not all be 0');
    if (Object.values(n.magnitudeWeights).every((w) => w === 0)) problems.push('config.news.magnitudeWeights must not all be 0');
    if (n.scheduledBeatsPerQuarter > n.beatTitles.length) problems.push('config.news.beatTitles needs one title per scheduled beat');
    const e = config.earnings;
    if (e.gapDelayMinMs > e.gapDelayMaxMs) problems.push('config.earnings.gapDelayMinMs must be <= gapDelayMaxMs');
    if (e.leakShareMin > e.leakShareMax || e.leakShareMax > 1) problems.push('config.earnings.leakShareMin must be <= leakShareMax <= 1');
    for (const sector of m.rateLovingSectors) {
      if (!SECTORS.includes(sector)) problems.push(`config.market.rateLovingSectors: unknown sector "${String(sector)}"`);
    }
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

export function canReadyUp(phase: Phase, debugMode = false): phase is ReadyPhase {
  return phase === 'RESULTS' || phase === 'SHOP' || (phase === 'TRADING' && debugMode);
}

/** Total ticks of a quarter that runs through the full shop timer. */
export function quarterTicks(config: GameConfig): number {
  return (
    phaseTicks(config, 'BRIEFING') +
    phaseTicks(config, 'TRADING') +
    phaseTicks(config, 'RESULTS') +
    phaseTicks(config, 'SHOP')
  );
}

/**
 * Multiplier for `quarter` (1-based) on a ramp from 1 in the first quarter to `last` in the final one.
 * A one-quarter game stays at 1.
 */
export function quarterRamp(config: GameConfig, quarter: number, last: number): number {
  const n = config.time.quarters;
  if (n <= 1) return 1;
  const t = Math.min(1, Math.max(0, (quarter - 1) / (n - 1)));
  return 1 + (last - 1) * t;
}

/** Real-time length of a quarter's trading, in seconds. */
export function quarterSeconds(config: GameConfig): number {
  return Math.round((config.time.daysPerQuarter * config.time.ticksPerCandle * config.time.tickMs) / 1000);
}

/**
 * `base` with a game length from the lobby: `quarters` quarters whose trading lasts `seconds` each.
 * A quarter keeps its days; a day gets longer or shorter. The tick stays close to base.time.tickMs
 * (a whole number of ticks per day, tickMs adjusted to land the day exactly), so the server's load
 * and the price path's smoothness barely change. Volatilities are per day, so the market is the same.
 */
export function withGameLength(base: GameConfig, quarters: number, seconds: number): GameConfig {
  if (seconds === quarterSeconds(base)) return mergeConfig(base, { time: { quarters } });
  const dayMs = (seconds * 1000) / base.time.daysPerQuarter;
  const ticksPerCandle = Math.max(1, Math.round(dayMs / base.time.tickMs));
  return mergeConfig(base, { time: { quarters, ticksPerCandle, tickMs: dayMs / ticksPerCandle } });
}
