/**
 * The market: prices of every symbol, advanced one tick at a time, plus daily candles and their
 * history. Pure (see ./types.ts).
 *
 * CONTRACT (fixed by the milestone-2 foundation; createSim, the server shell and the client rely on it):
 *   - createMarket(universe, rng, config) starts every company at company.startPrice and every fund
 *     at its basket value (= fund.startPrice). Deterministic for a given rng state.
 *   - step(input?) advances ONE trading tick (1 / ticksPerCandle of a day). createSim calls it once
 *     per tick() while the phase is TRADING and never otherwise, so prices are frozen in every
 *     other phase and a quarter has exactly daysPerQuarter candles.
 *   - step() returns, in this order:
 *       { e: 'tick', day, tickOfDay, prices }   always; ALL symbols, unrounded
 *       { e: 'candle', day, ohlc }              additionally when tickOfDay === ticksPerCandle
 *   - `day` is the 0-based trading day since game start and continues across quarters.
 *   - A candle is built from the ticksPerCandle prices AFTER each step of its day:
 *     o = price after the day's first step, c = after its last, h/l = max/min of those.
 *     (So low <= open, close <= high always. A gap between days shows between the previous close
 *     and the next open.)
 *   - Fund price = sum(fund.units[i] * mid(fund.members[i])), recomputed every step.
 *   - No price is ever below config.market.priceFloor; no NaN.
 *   - getSnapshot() returns fresh objects the caller may keep or mutate.
 *
 * Price step (DESIGN.md section 3), per company i and tick, with dt = 1 / ticksPerCandle days:
 *   r_i = corrMult * (betaM_i * M + betaS_i * S[sector_i]) + sigma_i * eps_i     all * volMult * sqrt(dt)
 *       + rateSensitivity_i * dRate
 *       + sectorDriftPerDay[sector_i] * dt
 *       + symbolReturn[i]
 *   mid_i = max(priceFloor, mid_i * exp(r_i))
 * M ~ N(0, marketVolPerDay), S[s] ~ N(0, sectorVolPerDay), eps ~ N(0, 1), fresh every tick.
 * Volatilities are per trading day, so the sum of a day's ticksPerCandle tick returns has the
 * configured daily variance whatever the tick rate.
 *
 * Fund price = basket * exp(premium). The premium is a log-premium per fund that starts at 0 and is
 * moved ONLY by symbolReturn on the fund's own ticker (fund-level price impact, later milestone),
 * so without that a fund is exactly its basket. The market does not decay the premium by itself:
 * whoever feeds symbolReturn (the impact model) also feeds the decay.
 *
 * Noise stream: every step draws the same number of normals in the same order (M, the sector
 * factors in SECTORS order, then one eps per company in universe order; one rng.fillNormal call),
 * whatever the input. So a
 * regime, a headline or an order changes only what it adds on top; the underlying noise path of a
 * seed stays the same, which keeps balance runs comparable.
 *
 * Speed: a step is a few typed-array loops plus the event objects; a full 8-quarter game is
 * 7200 steps x 61 symbols.
 */
import { SECTORS } from '@tg/shared';
import type { GameConfig, MarketSnapshot, OHLC, Sector, SymbolId } from '@tg/shared';
import type { Rng } from './rng.ts';
import type { SimEventOf } from './types.ts';
import { toUniverseInfo } from './universe.ts';
import type { Universe } from './universe.ts';

/**
 * Everything outside the market that bends this tick's returns. All fields optional; the default
 * is a quiet market. Milestone 2 passes nothing. Later milestones fill it from createSim:
 * regimes (volMult, corrMult, sectorDriftPerDay, dRate), headlines and price impact (symbolReturn).
 */
export interface MarketStepInput {
  /** Scales all random volatility. Product of the active regimes' volMult. Default 1. */
  volMult?: number;
  /** Scales the common factors (M and S) relative to idiosyncratic noise: >1 = more correlation. Default 1. */
  corrMult?: number;
  /** Change of the policy rate applied on this tick (e.g. +config.market.rateStep). Default 0. */
  dRate?: number;
  /** Log-return drift per trading day for every company of a sector (sum of the active regimes). */
  sectorDriftPerDay?: Partial<Record<Sector, number>>;
  /**
   * Extra log-return applied on THIS tick to a symbol: news shock ramps, price impact and its decay.
   * For a company it moves the company (and therefore its funds). For a fund ticker it moves only the
   * fund's own premium over its basket (DESIGN: trading a fund does not move its members).
   * Unknown tickers and non-finite values are ignored.
   */
  symbolReturn?: Partial<Record<SymbolId, number>>;
}

export type MarketEvent = SimEventOf<'tick'> | SimEventOf<'candle'>;

export interface Market {
  readonly universe: Universe;
  /** Advance one trading tick. See the contract in the file header. */
  step(input?: MarketStepInput): MarketEvent[];
  /** Latest price, or undefined for an unknown ticker. */
  getPrice(symbol: SymbolId): number | undefined;
  /** Latest price of every symbol (fresh object, canonical order). */
  getPrices(): Record<SymbolId, number>;
  /** Trading day in progress, or the next one to start (= number of closed candles). */
  getDay(): number;
  /** Ticks already played of getDay(): 0..ticksPerCandle-1. */
  getTickOfDay(): number;
  /** Current policy rate (config.market.startRate plus every dRate so far). */
  getRate(): number;
  /** Universe (public part) + candle history + current prices, unrounded. */
  getSnapshot(): MarketSnapshot;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export type CreateMarket =(universe: Universe, rng: Rng, config: GameConfig) => Market;

export const createMarket: CreateMarket = (universe, rng, config) => {
  const { ticksPerCandle } = config.time;
  const floor = config.market.priceFloor;
  const dt = 1 / ticksPerCandle;
  const sqrtDt = Math.sqrt(dt);

  const symbols = universe.symbols;
  const count = symbols.length;
  const indexOf = new Map<SymbolId, number>(symbols.map((s, i) => [s, i]));
  const companyIndex = universe.companies.map((c) => indexOf.get(c.symbol)!);
  const fundIndex = universe.funds.map((f) => indexOf.get(f.symbol)!);
  const fundMembers = universe.funds.map((f) => f.members.map((member) => indexOf.get(member)!));
  const companyOf = new Map<SymbolId, number>(universe.companies.map((c, k) => [c.symbol, k]));
  const fundOf = new Map<SymbolId, number>(universe.funds.map((f, k) => [f.symbol, k]));

  // Per company: per-tick loadings (daily vol * sqrt(dt)), so the hot loop is multiply-adds only.
  const companyCount = universe.companies.length;
  const sectorCount = SECTORS.length;
  const sectorIndex = new Map<Sector, number>(SECTORS.map((s, i) => [s, i]));
  const sectorOf = new Int32Array(companyCount);
  const loadMarket = new Float64Array(companyCount);
  const loadSector = new Float64Array(companyCount);
  const loadIdio = new Float64Array(companyCount);
  const rateSensitivity = new Float64Array(companyCount);
  universe.companies.forEach((c, k) => {
    sectorOf[k] = sectorIndex.get(c.sector)!;
    loadMarket[k] = c.betaM * config.market.marketVolPerDay * sqrtDt;
    loadSector[k] = c.betaS * config.market.sectorVolPerDay * sqrtDt;
    loadIdio[k] = c.sigmaI * sqrtDt;
    rateSensitivity[k] = c.rateSensitivity;
  });
  // Scratch buffers of one step.
  const sectorShock = new Float64Array(sectorCount);
  const sectorDrift = new Float64Array(sectorCount);
  const extraReturn = new Float64Array(companyCount);
  /** This step's standard normals: [M, S per sector, eps per company]. */
  const noise = new Float64Array(1 + sectorCount + companyCount);
  const epsOffset = 1 + sectorCount;
  /** Log-premium of each fund over its basket; see the file header. */
  const fundPremium = new Float64Array(universe.funds.length);

  const price = new Float64Array(count);
  universe.companies.forEach((c, k) => (price[companyIndex[k]!] = Math.max(floor, c.startPrice)));

  function priceFunds(): void {
    for (let k = 0; k < fundIndex.length; k++) {
      const units = universe.funds[k]!.units;
      const members = fundMembers[k]!;
      let value = 0;
      for (let j = 0; j < members.length; j++) value += units[j]! * price[members[j]!]!;
      const premium = fundPremium[k]!;
      if (premium !== 0) value *= Math.exp(premium);
      price[fundIndex[k]!] = value > floor ? value : floor;
    }
  }
  priceFunds();

  // Candle of the day in progress, per symbol.
  const open = new Float64Array(count);
  const high = new Float64Array(count);
  const low = new Float64Array(count);
  /** Closed candles per symbol, flat [o, h, l, c, ...]. */
  const history: number[][] = symbols.map(() => []);

  let day = 0;
  let tickOfDay = 0;
  let rate = config.market.startRate;

  function pricesRecord(): Record<SymbolId, number> {
    const out: Record<SymbolId, number> = {};
    for (let i = 0; i < count; i++) out[symbols[i]!] = price[i]!;
    return out;
  }

  function candleRecord(): Record<SymbolId, OHLC> {
    const out: Record<SymbolId, OHLC> = {};
    for (let i = 0; i < count; i++) out[symbols[i]!] = { o: open[i]!, h: high[i]!, l: low[i]!, c: price[i]! };
    return out;
  }

  return {
    universe,
    step(input) {
      // Non-finite scalars fall back to their quiet default: a NaN dRate would otherwise make the
      // rate NaN for the rest of the game, and an infinite multiplier would send prices to the floor.
      const volMult = finiteOr(input?.volMult, 1);
      const commonMult = volMult * finiteOr(input?.corrMult, 1);
      const dRate = finiteOr(input?.dRate, 0);
      rate += dRate;

      // Common factors. Always drawn, in a fixed order (see "Noise stream" in the file header).
      rng.fillNormal(noise);
      const marketShock = noise[0]! * commonMult;
      const drift = input?.sectorDriftPerDay;
      for (let s = 0; s < sectorCount; s++) {
        sectorShock[s] = noise[1 + s]! * commonMult;
        sectorDrift[s] = drift === undefined ? 0 : finiteOr(drift[SECTORS[s]!], 0) * dt;
      }

      // Per-symbol extras: on a company they move the company, on a fund only the fund's premium.
      const symbolReturn = input?.symbolReturn;
      let hasExtra = false;
      if (symbolReturn !== undefined) {
        for (const symbol of Object.keys(symbolReturn)) {
          const value = symbolReturn[symbol];
          if (value === undefined || !Number.isFinite(value)) continue;
          const company = companyOf.get(symbol);
          if (company !== undefined) {
            extraReturn[company] = value;
            hasExtra = true;
          } else {
            const fund = fundOf.get(symbol);
            if (fund !== undefined) fundPremium[fund] = fundPremium[fund]! + value;
          }
        }
      }

      for (let k = 0; k < companyCount; k++) {
        const s = sectorOf[k]!;
        const r =
          loadMarket[k]! * marketShock +
          loadSector[k]! * sectorShock[s]! +
          loadIdio[k]! * volMult * noise[epsOffset + k]! +
          rateSensitivity[k]! * dRate +
          sectorDrift[s]! +
          extraReturn[k]!;
        const i = companyIndex[k]!;
        const next = price[i]! * Math.exp(r);
        // A non-finite result (absurd input) leaves the price where it was: never NaN on the wire.
        if (Number.isFinite(next)) price[i] = next > floor ? next : floor;
      }
      if (hasExtra) extraReturn.fill(0);
      priceFunds();

      tickOfDay += 1;
      for (let i = 0; i < count; i++) {
        const p = price[i]!;
        if (tickOfDay === 1) {
          open[i] = p;
          high[i] = p;
          low[i] = p;
        } else {
          if (p > high[i]!) high[i] = p;
          if (p < low[i]!) low[i] = p;
        }
      }

      const events: MarketEvent[] = [{ e: 'tick', day, tickOfDay, prices: pricesRecord() }];
      if (tickOfDay >= ticksPerCandle) {
        for (let i = 0; i < count; i++) history[i]!.push(open[i]!, high[i]!, low[i]!, price[i]!);
        events.push({ e: 'candle', day, ohlc: candleRecord() });
        day += 1;
        tickOfDay = 0;
      }
      return events;
    },
    getPrice: (symbol) => {
      const i = indexOf.get(symbol);
      return i === undefined ? undefined : price[i];
    },
    getPrices: pricesRecord,
    getDay: () => day,
    getTickOfDay: () => tickOfDay,
    getRate: () => rate,
    getSnapshot() {
      const candles: Record<SymbolId, number[]> = {};
      for (let i = 0; i < count; i++) candles[symbols[i]!] = history[i]!.slice();
      return {
        universe: toUniverseInfo(universe),
        day,
        tickOfDay,
        prices: pricesRecord(),
        candles,
        current: tickOfDay === 0 ? null : candleRecord(),
      };
    },
  };
};
