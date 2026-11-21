/**
 * Pure market helpers shared by sim, server and client: day/quarter arithmetic, wire rounding and
 * the flat candle encoding of MarketSnapshot. No I/O, safe for the sim.
 *
 * Day convention (everywhere): `day` is a 0-based trading day since game start and keeps counting
 * across quarters. Day d belongs to quarter floor(d / daysPerQuarter) + 1. Prices only move during
 * TRADING, so there are exactly daysPerQuarter days (candles) per quarter.
 */
import type { GameConfig } from './config.ts';
import type { MarketSnapshot, OHLC, SymbolId } from './types.ts';

/** Numbers per candle in the flat encoding: o, h, l, c. */
export const CANDLE_FIELDS = 4;

/** Quarter (1-based) a 0-based trading day belongs to. */
export function dayToQuarter(config: GameConfig, day: number): number {
  return Math.floor(day / config.time.daysPerQuarter) + 1;
}

/** 1-based day within its quarter (1..daysPerQuarter), for labels such as "Q2 D17". */
export function dayOfQuarter(config: GameConfig, day: number): number {
  return (Math.floor(day) % config.time.daysPerQuarter) + 1;
}

/** First 0-based trading day of a quarter (1-based). */
export function quarterFirstDay(config: GameConfig, quarter: number): number {
  return (quarter - 1) * config.time.daysPerQuarter;
}

/** Trading days in a whole game. */
export function totalTradingDays(config: GameConfig): number {
  return config.time.quarters * config.time.daysPerQuarter;
}

/** Price as sent on the wire (config.market.priceDecimals decimals). The sim never rounds. */
export function roundPrice(config: GameConfig, price: number): number {
  const f = 10 ** config.market.priceDecimals;
  return Math.round(price * f) / f;
}

export function roundPrices(config: GameConfig, prices: Record<SymbolId, number>): Record<SymbolId, number> {
  const out: Record<SymbolId, number> = {};
  for (const symbol in prices) out[symbol] = roundPrice(config, prices[symbol]!);
  return out;
}

export function roundOhlc(config: GameConfig, ohlc: Record<SymbolId, OHLC>): Record<SymbolId, OHLC> {
  const out: Record<SymbolId, OHLC> = {};
  for (const symbol in ohlc) {
    const c = ohlc[symbol]!;
    out[symbol] = { o: roundPrice(config, c.o), h: roundPrice(config, c.h), l: roundPrice(config, c.l), c: roundPrice(config, c.c) };
  }
  return out;
}

/** A sim snapshot rounded for the wire. Returns new objects; the input is not modified. */
export function roundSnapshot(config: GameConfig, snapshot: MarketSnapshot): MarketSnapshot {
  const candles: Record<SymbolId, number[]> = {};
  for (const symbol in snapshot.candles) candles[symbol] = snapshot.candles[symbol]!.map((p) => roundPrice(config, p));
  return {
    universe: snapshot.universe,
    day: snapshot.day,
    tickOfDay: snapshot.tickOfDay,
    prices: roundPrices(config, snapshot.prices),
    candles,
    current: snapshot.current === null ? null : roundOhlc(config, snapshot.current),
  };
}

/** Appends one candle to a flat [o, h, l, c, ...] array. */
export function packCandle(flat: number[], candle: OHLC): void {
  flat.push(candle.o, candle.h, candle.l, candle.c);
}

/** Number of candles in a flat array. */
export function candleCount(flat: readonly number[]): number {
  return Math.floor(flat.length / CANDLE_FIELDS);
}

/** Candle `index` (= its day, since history starts at day 0) of a flat array, or undefined. */
export function candleAt(flat: readonly number[], index: number): OHLC | undefined {
  const i = index * CANDLE_FIELDS;
  if (index < 0 || i + CANDLE_FIELDS > flat.length) return undefined;
  return { o: flat[i]!, h: flat[i + 1]!, l: flat[i + 2]!, c: flat[i + 3]! };
}

/** Flat [o, h, l, c, ...] -> one OHLC per day; element i is day i. */
export function unpackCandles(flat: readonly number[]): OHLC[] {
  const out: OHLC[] = [];
  for (let i = 0; i + CANDLE_FIELDS <= flat.length; i += CANDLE_FIELDS) {
    out.push({ o: flat[i]!, h: flat[i + 1]!, l: flat[i + 2]!, c: flat[i + 3]! });
  }
  return out;
}
