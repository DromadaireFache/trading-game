/** Universe generation: determinism, uniqueness, parameter ranges, sector character, fund baskets. */
import { describe, expect, it } from 'vitest';
import { SECTORS, defaultConfig, mergeConfig } from '@tg/shared';
import type { Sector } from '@tg/shared';
import { createRng, generateUniverse } from '../index.ts';
import type { Universe } from '../index.ts';

const m = defaultConfig.market;
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

function universeOf(seed: number, config = defaultConfig): Universe {
  return generateUniverse(createRng(seed), config);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

describe('universe generation', () => {
  it('is deterministic: same seed -> identical universe, different seed -> different', () => {
    expect(universeOf(11)).toEqual(universeOf(11));
    const a = universeOf(11);
    const b = universeOf(12);
    expect(a.symbols).not.toEqual(b.symbols);
    expect(a.companies.map((c) => c.marketCap)).not.toEqual(b.companies.map((c) => c.marketCap));
  });

  it('has 6 sectors x 5 companies and 7 funds with unique tickers, names and CEOs, for many seeds', () => {
    for (const seed of SEEDS) {
      const u = universeOf(seed);
      expect(u.companies).toHaveLength(30);
      expect(u.funds).toHaveLength(7);
      expect(u.companies.map((c) => c.sector)).toEqual(SECTORS.flatMap((s) => [s, s, s, s, s]));
      expect(u.symbols).toEqual([...u.funds.map((f) => f.symbol), ...u.companies.map((c) => c.symbol)]);
      expect(new Set(u.symbols).size, `tickers, seed ${seed}`).toBe(37);
      expect(new Set(u.companies.map((c) => c.name)).size, `names, seed ${seed}`).toBe(30);
      expect(new Set(u.companies.map((c) => c.ceo)).size, `ceos, seed ${seed}`).toBe(30);
      for (const symbol of u.symbols) expect(symbol).toMatch(/^[A-Z][A-Z0-9]{1,4}$/);
    }
  });

  it('draws every hidden parameter inside its configured range, with the right rate sign', () => {
    for (const seed of SEEDS) {
      for (const c of universeOf(seed).companies) {
        expect(c.marketCap).toBeGreaterThanOrEqual(m.marketCapMin);
        expect(c.marketCap).toBeLessThanOrEqual(m.marketCapMax);
        expect(c.startPrice).toBeGreaterThanOrEqual(m.startPriceMin);
        expect(c.startPrice).toBeLessThanOrEqual(m.startPriceMax);
        expect(c.betaM).toBeGreaterThanOrEqual(m.betaMarketMin);
        expect(c.betaM).toBeLessThanOrEqual(m.betaMarketMax);
        expect(c.betaS).toBeGreaterThanOrEqual(m.betaSectorMin);
        expect(c.betaS).toBeLessThanOrEqual(m.betaSectorMax);
        expect(c.sigmaI).toBeGreaterThanOrEqual(m.idioVolPerDayMin);
        expect(c.sigmaI).toBeLessThanOrEqual(m.idioVolPerDayMax);
        expect(Math.abs(c.rateSensitivity)).toBeGreaterThanOrEqual(m.rateSensitivityMin);
        expect(Math.abs(c.rateSensitivity)).toBeLessThanOrEqual(m.rateSensitivityMax);
        expect(Math.sign(c.rateSensitivity)).toBe(c.sector === 'finance' ? 1 : -1);
        expect(c.adv / c.marketCap).toBeGreaterThanOrEqual(m.advFractionOfCapMin);
        expect(c.adv / c.marketCap).toBeLessThanOrEqual(m.advFractionOfCapMax);
        expect(c.fundamentals.shares * c.startPrice).toBeCloseTo(c.marketCap, -3);
        expect(c.fundamentals.revenue).toBeGreaterThan(0);
        expect(c.fundamentals.margin).toBeGreaterThanOrEqual(m.marginMin);
        expect(c.fundamentals.margin).toBeLessThanOrEqual(m.marginMax);
        expect(c.fundamentals.debt).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is varied within a universe and gives sectors a character', () => {
    const bySector = (pick: (u: Universe, s: Sector) => number[]) =>
      Object.fromEntries(SECTORS.map((s) => [s, mean(SEEDS.flatMap((seed) => pick(universeOf(seed), s)))])) as Record<Sector, number>;
    const of = (key: 'sigmaI' | 'betaM') => (u: Universe, s: Sector) => u.companies.filter((c) => c.sector === s).map((c) => c[key]);
    const sigma = bySector(of('sigmaI'));
    const beta = bySector(of('betaM'));
    expect(sigma.airlines).toBeGreaterThan(sigma.defense * 1.3);
    expect(beta.tech).toBeGreaterThan(beta.defense * 1.3);

    // Varied: one universe spans a good part of each range.
    const u = universeOf(3);
    const spread = (values: number[]) => Math.max(...values) / Math.min(...values);
    expect(spread(u.companies.map((c) => c.marketCap))).toBeGreaterThan(10);
    expect(spread(u.companies.map((c) => c.sigmaI))).toBeGreaterThan(1.5);
    expect(spread(u.companies.map((c) => c.betaM))).toBeGreaterThan(1.5);
  });

  it('makes big caps calmer on average', () => {
    const small: number[] = [];
    const big: number[] = [];
    const middle = Math.sqrt(m.marketCapMin * m.marketCapMax);
    for (const seed of SEEDS) {
      for (const c of universeOf(seed).companies) (c.marketCap > middle ? big : small).push(c.sigmaI);
    }
    expect(mean(big)).toBeLessThan(mean(small));
  });

  it('builds funds as cap-weighted baskets that start at fundStartPrice', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const u = universeOf(seed);
      const bySymbol = new Map(u.companies.map((c) => [c.symbol, c]));
      const [index, ...sectorFunds] = u.funds;
      expect(index!.kind).toBe('index');
      expect(index!.members).toEqual(u.companies.map((c) => c.symbol));
      expect(sectorFunds.map((f) => f.sector)).toEqual([...SECTORS]);
      for (const fund of u.funds) {
        const members = fund.members.map((s) => bySymbol.get(s)!);
        if (fund.kind === 'sector') {
          expect(members).toHaveLength(5);
          for (const c of members) expect(c.sector).toBe(fund.sector);
        }
        const totalCap = members.reduce((sum, c) => sum + c.marketCap, 0);
        expect(fund.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        members.forEach((c, i) => expect(fund.weights[i]).toBeCloseTo(c.marketCap / totalCap, 12));
        const basket = members.reduce((sum, c, i) => sum + fund.units[i]! * c.startPrice, 0);
        expect(basket).toBeCloseTo(m.fundStartPrice, 9);
        expect(fund.startPrice).toBe(m.fundStartPrice);
        expect(fund.marketCap).toBeCloseTo(totalCap, -3);
        expect(fund.adv).toBeGreaterThan(0);
      }
    }
  });

  it('supports equal weighting and other universe sizes through config', () => {
    const equal = universeOf(5, mergeConfig(defaultConfig, { market: { fundWeighting: 'equal' } }));
    for (const fund of equal.funds) for (const w of fund.weights) expect(w).toBeCloseTo(1 / fund.members.length, 12);

    // More companies than name stems: still unique tickers.
    const wide = universeOf(5, mergeConfig(defaultConfig, { market: { companiesPerSector: 14 } }));
    expect(wide.companies).toHaveLength(84);
    expect(new Set(wide.symbols).size).toBe(91);
  });
});
