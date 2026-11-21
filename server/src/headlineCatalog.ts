import { bucketKey, MAGNITUDES, normalizeText } from '@tg/shared/headlines';
import { defaultConfig, SECTOR_LABELS } from '@tg/shared';
import type {
  HeadlineCategory, HeadlineDirection, HeadlineKind, HeadlineMagnitude, HeadlineTemplate, Sector, SymbolId,
} from '@tg/shared';
import type { Placeholder } from '@tg/shared/headlines';
import placeholders from '../../shared/data/placeholders.json' with { type: 'json' };
import { generatedHeadlinePath, HEADLINE_SEED, readHeadlines } from './headline-files.ts';
import { createRng } from './sim/rng.ts';
import type { Universe } from './sim/universe.ts';

type Target =
  | { scope: 'stock'; symbol: SymbolId }
  | { scope: 'sector'; sector: Sector }
  | { scope: 'market' };

type HeadlineRequest = Target & { kind?: HeadlineKind; category?: HeadlineCategory };
type HeadlineMove = { direction: HeadlineDirection; magnitude: HeadlineMagnitude };
export type HeadlineQuery = HeadlineRequest & HeadlineMove;

function classifyMove(logReturn: number, shocks: Record<HeadlineMagnitude, number>): HeadlineMove {
  if (!Number.isFinite(logReturn)) throw new RangeError('Headline return must be finite');
  if (logReturn === 0) return { direction: 'neutral', magnitude: 'small' };
  const distance = (magnitude: HeadlineMagnitude) => Math.abs(Math.abs(logReturn) - shocks[magnitude]);
  const magnitude = MAGNITUDES.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best);
  return { direction: logReturn > 0 ? 'up' : 'down', magnitude };
}

export type ResolvedHeadline = HeadlineTemplate & { symbol?: SymbolId };

const products: Record<Sector, readonly string[]> = {
  tech: ['UltraChip 9', 'FlexBoard tablet', 'OmniLens camera'],
  energy: ['SolarSkin panels', 'GreenGrid inverters', 'HydroCell batteries'],
  defense: ['AeroDrone', 'FalconEye radar', 'Sentinel air defense'],
  airlines: ['SkyBridge commuter service', 'Horizon business class', 'AirLink regional service'],
  tourism: ['Harborlight cruise', 'Northstar rail tour', 'SunSpire resort packages'],
  finance: ['ClearLedger payment platform', 'Vaultline savings accounts', 'OakKey insurance plans'],
  health: ['VitaPatch', 'AirMate respirator', 'NovaScan diagnostic system'],
  consumer: ['Quantum Toaster', 'CrunchBar snacks', 'CloudBed mattresses'],
  industrials: ['MegaJet engine', 'ForgeArm assembly robot', 'Atlas motion controller'],
  materials: ['Duralloy steel', 'ClearStone ceramics', 'FlexSil industrial mesh'],
};

function productFor(sector: Sector, symbol: SymbolId, random: (count: number) => number): string {
  const menu = products[sector];
  if (symbol === '') return menu[random(menu.length)]!;
  let hash = 0;
  for (const char of symbol) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return menu[hash % menu.length]!;
}

/** The game takes a catalog snapshot at startup. A malformed generated file fails fast with its path. */
export function loadHeadlineTemplates(path?: string): HeadlineTemplate[] {
  const generated = readHeadlines(generatedHeadlinePath(path), path === undefined);
  if (generated.some((headline) => headline.scope !== 'market' && headline.sector === undefined)) {
    throw new Error(`${generatedHeadlinePath(path)}: generated stock and sector headlines must specify a sector`);
  }
  const ids = new Set<string>();
  const texts = new Set<string>();
  return [...readHeadlines(HEADLINE_SEED), ...generated].filter((headline) => {
    const text = normalizeText(headline.text);
    if (ids.has(headline.id) || texts.has(text)) return false;
    ids.add(headline.id);
    texts.add(text);
    return true;
  });
}

export function createHeadlineCatalog(
  templates: readonly HeadlineTemplate[],
  universe: Universe,
  seed: number,
  shocks = defaultConfig.news.shock,
) {
  const buckets = new Map<string, HeadlineTemplate[]>();
  const companies = new Map(universe.companies.map((company) => [company.symbol, company]));
  for (const headline of templates) {
    const key = bucketKey(headline);
    const bucket = buckets.get(key) ?? [];
    bucket.push(headline);
    buckets.set(key, bucket);
  }
  const used = new Set<string>();
  const random = createRng(seed).int;
  const pick = (values: readonly string[]) => values[random(values.length)]!;

  /** Draw once per game. Exhaustion falls back only to an unused, sector-agnostic seed match. */
  function draw(query: HeadlineQuery): ResolvedHeadline | undefined {
    const company = query.scope === 'stock' ? companies.get(query.symbol) : undefined;
    if (query.scope === 'stock' && !company) return;
    const sector = query.scope === 'sector' ? query.sector : company?.sector;
    const bucket = { ...query, sector, kind: query.kind ?? 'real' };
    const available = (key: string) => (buckets.get(key) ?? []).filter((h) =>
      !used.has(h.id) && (query.category === undefined || h.category === query.category));
    let matches = available(bucketKey(bucket));
    if (!matches.length && sector) matches = available(bucketKey({ ...bucket, sector: undefined }));
    if (!matches.length) return;

    const template = matches[random(matches.length)]!;
    const replacements: Partial<Record<Placeholder, string>> = {};
    const text = template.text.replace(/\{([A-Z_]+)\}/g, (_match, name: Placeholder) => {
      const value = () => {
        switch (name) {
          case 'COMPANY': return company!.name;
          case 'TICKER': return company!.symbol;
          case 'CEO': return company!.ceo;
          case 'SECTOR': return SECTOR_LABELS[sector!];
          case 'RIVAL': {
            const rivals = universe.companies
              .filter((other) => other.sector === sector && other.symbol !== company!.symbol)
              .map((other) => other.name);
            return rivals.length ? pick(rivals) : 'a rival';
          }
          case 'PRODUCT': return sector ? productFor(sector, company?.symbol ?? '', random) : pick(placeholders.PRODUCT);
          default: return pick(placeholders[name]);
        }
      };
      return replacements[name] ??= value();
    });
    used.add(template.id);
    return { ...template, ...(sector ? { sector } : {}), ...(company ? { symbol: company.symbol } : {}), text };
  }

  return {
    size: templates.length,
    draw,
    drawForMove(request: HeadlineRequest, logReturn: number): ResolvedHeadline | undefined {
      return draw({ ...request, ...classifyMove(logReturn, shocks) });
    },
  };
}
