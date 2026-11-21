/**
 * Universe generation: 6 sectors x 5 companies + 1 index fund + 6 sector funds, from a seed.
 * Pure (see ./types.ts). Name material comes from ./data/names.ts only.
 *
 * CONTRACT (fixed by the milestone-2 foundation; server and client rely on it):
 *   - generateUniverse(rng, config) is deterministic: same rng state + config => identical result.
 *   - `symbols` is the CANONICAL ORDER: index fund, sector funds in SECTORS order, then companies
 *     sector by sector in SECTORS order. `companies` and `funds` follow the same relative order.
 *   - All tickers are unique (companies and funds share one namespace).
 *   - Fund price = sum(units[i] * mid(members[i])); every fund starts at config.market.fundStartPrice.
 *   - toUniverseInfo() is the ONLY thing that may reach clients: no betas, sigma, rate sensitivity,
 *     adv or fundamentals.
 *
 * How a company is drawn (every number from config.market):
 *   - market cap and start price: log-uniform in their ranges; shares = cap / price.
 *   - betaM, betaS, sigmaI, |rateSensitivity|: each has a Min..Max range; the company's POSITION in
 *     that range is its sector's centre (sectorProfiles) +- sectorProfileSpread, so airlines are
 *     jumpy and high-beta, consumer staples calm, and so on, while companies of a sector still differ.
 *   - big caps are calmer: the sigmaI position is shifted by capVolTilt * (0.5 - log-position of the cap).
 *   - rate sensitivity is negative except for rateLovingSectors.
 *   - names, tickers and CEOs are unique across the universe.
 */
import { SECTORS } from '@tg/shared';
import type { Company, Fund, GameConfig, Sector, SymbolId, SymbolInfo, UniverseInfo } from '@tg/shared';
import { CEO_FIRST_NAMES, CEO_LAST_NAMES, INDEX_FUND, SECTOR_FUNDS, SECTOR_NAMES } from './data/names.ts';
import type { Rng } from './rng.ts';

/** The full universe with hidden parameters. Lives in the sim; never sent to clients. */
export interface Universe {
  companies: Company[];
  /** Index fund first, then the sector funds in SECTORS order. */
  funds: Fund[];
  /** Every tradable ticker in canonical order (funds, then companies). */
  symbols: SymbolId[];
}

export type GenerateUniverse = (rng: Rng, config: GameConfig) => Universe;

function uniform(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng.next();
}

function logUniform(rng: Rng, min: number, max: number): number {
  return Math.exp(uniform(rng, Math.log(min), Math.log(max)));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** min + (max - min) * position, with the position clamped to 0..1. */
function atPosition(min: number, max: number, position: number): number {
  return min + (max - min) * clamp01(position);
}

/** Position 0..1 of `value` in [min, max] on a log scale (0.5 when the range is empty). */
function logPosition(value: number, min: number, max: number): number {
  return max > min ? clamp01(Math.log(value / min) / Math.log(max / min)) : 0.5;
}

/** Picks `count` distinct items (cycling with a numeric tag if the list is too short). */
function pickDistinct(rng: Rng, items: readonly string[], count: number): string[] {
  const pool = [...items];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) {
      out.push(`${items[i % items.length] ?? 'Company'}${Math.floor(i / Math.max(1, items.length)) + 1}`);
      continue;
    }
    out.push(pool.splice(rng.int(pool.length), 1)[0]!);
  }
  return out;
}

const TICKER_LENGTH = 4;

/** Upper-case ticker from a name stem, unique within `used` (which it updates). */
function makeTicker(stem: string, used: Set<string>): string {
  const letters = stem.toUpperCase().replace(/[^A-Z]/g, '') || 'CO';
  const candidates: string[] = [letters.slice(0, TICKER_LENGTH), letters.slice(0, TICKER_LENGTH - 1)];
  for (let i = TICKER_LENGTH; i < letters.length; i++) candidates.push(letters.slice(0, TICKER_LENGTH - 1) + letters[i]);
  for (let n = 2; n < 100; n++) candidates.push(letters.slice(0, TICKER_LENGTH - 1) + String(n));
  for (const candidate of candidates) {
    if (candidate.length > 0 && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `${letters.slice(0, 2)}${used.size}`;
  used.add(fallback);
  return fallback;
}

/** How often a duplicate CEO name is redrawn before a numbered fallback is used. */
const CEO_DRAW_ATTEMPTS = 50;

/** "<first> <last>", unique within `used` (which it updates). */
function makeCeo(rng: Rng, used: Set<string>): string {
  let name = '';
  for (let attempt = 0; attempt < CEO_DRAW_ATTEMPTS; attempt++) {
    name = `${CEO_FIRST_NAMES[rng.int(CEO_FIRST_NAMES.length)]!} ${CEO_LAST_NAMES[rng.int(CEO_LAST_NAMES.length)]!}`;
    if (!used.has(name)) break;
  }
  if (used.has(name)) name = `${name} ${used.size + 1}`;
  used.add(name);
  return name;
}

function makeFund(
  config: GameConfig,
  id: { symbol: string; name: string },
  kind: Fund['kind'],
  sector: Sector | undefined,
  members: Company[],
): Fund {
  const m = config.market;
  const totalCap = members.reduce((sum, c) => sum + c.marketCap, 0);
  const weights = members.map((c) => (m.fundWeighting === 'equal' ? 1 / members.length : c.marketCap / totalCap));
  return {
    symbol: id.symbol,
    name: id.name,
    kind,
    ...(sector === undefined ? {} : { sector }),
    members: members.map((c) => c.symbol),
    weights,
    units: members.map((c, i) => (m.fundStartPrice * weights[i]!) / c.startPrice),
    marketCap: totalCap,
    adv: members.reduce((sum, c) => sum + c.adv, 0) * m.fundAdvShareOfMembers,
    startPrice: m.fundStartPrice,
  };
}

export const generateUniverse: GenerateUniverse = (rng, config) => {
  const m = config.market;
  const used = new Set<string>([INDEX_FUND.symbol, ...SECTORS.map((s) => SECTOR_FUNDS[s].symbol)]);
  const usedCeos = new Set<string>();
  const companies: Company[] = [];
  /** A position drawn around a sector centre: centre +- sectorProfileSpread. */
  const around = (centre: number): number => centre + m.sectorProfileSpread * (2 * rng.next() - 1);

  for (const sector of SECTORS) {
    const names = SECTOR_NAMES[sector];
    const profile = m.sectorProfiles[sector];
    const rateSign = m.rateLovingSectors.includes(sector) ? 1 : -1;
    const stems = pickDistinct(rng, names.stems, m.companiesPerSector);
    for (const stem of stems) {
      const marketCap = logUniform(rng, m.marketCapMin, m.marketCapMax);
      const startPrice = logUniform(rng, m.startPriceMin, m.startPriceMax);
      const capTilt = m.capVolTilt * (0.5 - logPosition(marketCap, m.marketCapMin, m.marketCapMax));
      companies.push({
        symbol: makeTicker(stem, used),
        name: `${stem} ${names.suffixes[rng.int(names.suffixes.length)]!}`,
        sector,
        ceo: makeCeo(rng, usedCeos),
        betaM: atPosition(m.betaMarketMin, m.betaMarketMax, around(profile.betaMarket)),
        betaS: atPosition(m.betaSectorMin, m.betaSectorMax, around(profile.betaSector)),
        sigmaI: atPosition(m.idioVolPerDayMin, m.idioVolPerDayMax, around(profile.idioVol) + capTilt),
        rateSensitivity: rateSign * atPosition(m.rateSensitivityMin, m.rateSensitivityMax, around(profile.rateSensitivity)),
        marketCap,
        adv: marketCap * uniform(rng, m.advFractionOfCapMin, m.advFractionOfCapMax),
        startPrice,
        fundamentals: {
          revenue: marketCap / logUniform(rng, m.priceToSalesMin, m.priceToSalesMax),
          margin: uniform(rng, m.marginMin, m.marginMax),
          debt: marketCap * uniform(rng, m.debtToCapMin, m.debtToCapMax),
          shares: marketCap / startPrice,
        },
      });
    }
  }

  const funds: Fund[] = [
    makeFund(config, INDEX_FUND, 'index', undefined, companies),
    ...SECTORS.map((sector) =>
      makeFund(
        config,
        SECTOR_FUNDS[sector],
        'sector',
        sector,
        companies.filter((c) => c.sector === sector),
      ),
    ),
  ];

  return { companies, funds, symbols: [...funds.map((f) => f.symbol), ...companies.map((c) => c.symbol)] };
};

/** The public view of the universe (canonical order). */
export function toUniverseInfo(universe: Universe): UniverseInfo {
  const funds: SymbolInfo[] = universe.funds.map((f) => ({
    symbol: f.symbol,
    name: f.name,
    kind: f.kind,
    ...(f.sector === undefined ? {} : { sector: f.sector }),
    marketCap: f.marketCap,
    members: [...f.members],
  }));
  const stocks: SymbolInfo[] = universe.companies.map((c) => ({
    symbol: c.symbol,
    name: c.name,
    kind: 'stock',
    sector: c.sector,
    marketCap: c.marketCap,
    ceo: c.ceo,
  }));
  return { symbols: [...funds, ...stocks] };
}
