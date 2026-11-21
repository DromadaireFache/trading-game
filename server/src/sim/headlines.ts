/**
 * Headline lookup and slot filling (DESIGN.md section 7). Pure; randomness from the Rng passed in.
 *
 * The engine decides the shock first, then asks the book for a template that matches it:
 *   pick({ kind, scope, direction, magnitude?, category?, prefer? })
 * Matching, most specific first; within a level a template not used yet always wins:
 *   1. kind + scope + direction + magnitude + category
 *   2. kind + scope + direction + magnitude
 *   3. kind + scope + direction, magnitude as close as possible (small < medium < large < huge)
 * `prefer` (a text test, e.g. /rate/i for the rate decision) only orders candidates of the same level.
 * Only when every template of (kind, scope, direction) has been used does a template repeat: the one
 * used longest ago. No match for (kind, scope, direction) at all = undefined (the caller skips it).
 *
 * The data (shared/data/headlines.seed.json, later headlines.json) is owned by the content team;
 * this file only reads the HeadlineTemplate shape.
 *
 * Slots: {COMPANY} {TICKER} {CEO} {SECTOR} {RIVAL} come from the game universe and the headline's
 * target; {COUNTRY} {LEADER} {GOV_AGENCY} {CITY} {PRODUCT} come from the placeholder lists. A slot
 * appears with the same value everywhere in one headline. Unknown slots are left as they are.
 */
import { SECTOR_LABELS } from '@tg/shared';
import type { Company, HeadlineCategory, HeadlineDirection, HeadlineKind, HeadlineMagnitude, HeadlineScope, HeadlineTemplate, Sector } from '@tg/shared';
import type { Rng } from './rng.ts';
import type { Universe } from './universe.ts';

export const MAGNITUDES: readonly HeadlineMagnitude[] = ['small', 'medium', 'large', 'huge'];

export interface HeadlineQuery {
  kind: HeadlineKind;
  scope: HeadlineScope;
  direction: HeadlineDirection;
  magnitude?: HeadlineMagnitude;
  category?: HeadlineCategory;
  /** Among equally good candidates, prefer texts that pass this test. */
  prefer?: RegExp;
}

export interface HeadlineBook {
  pick(query: HeadlineQuery): HeadlineTemplate | undefined;
  byId(id: string): HeadlineTemplate | undefined;
  /** Marks a template as used now (a card that names its headline by id). */
  use(template: HeadlineTemplate): void;
  /** How many times a template was picked so far. */
  timesUsed(id: string): number;
}

export function createHeadlineBook(templates: readonly HeadlineTemplate[], rng: Rng): HeadlineBook {
  const byId = new Map(templates.map((t) => [t.id, t]));
  /** id -> sequence number of its last use. */
  const lastUsed = new Map<string, number>();
  const uses = new Map<string, number>();
  let seq = 0;

  function use(t: HeadlineTemplate): void {
    lastUsed.set(t.id, ++seq);
    uses.set(t.id, (uses.get(t.id) ?? 0) + 1);
  }

  const distance = (a: HeadlineMagnitude, b: HeadlineMagnitude) => Math.abs(MAGNITUDES.indexOf(a) - MAGNITUDES.indexOf(b));

  function choose(candidates: HeadlineTemplate[], query: HeadlineQuery): HeadlineTemplate {
    let pool = candidates;
    if (query.prefer) {
      const preferred = pool.filter((t) => query.prefer!.test(t.text));
      if (preferred.length > 0) pool = preferred;
    }
    return pool[rng.int(pool.length)]!;
  }

  return {
    pick(query) {
      const base = templates.filter((t) => t.kind === query.kind && t.scope === query.scope && t.direction === query.direction);
      if (base.length === 0) return undefined;
      const fresh = base.filter((t) => !lastUsed.has(t.id));

      const levels: HeadlineTemplate[][] = [];
      if (query.magnitude !== undefined) {
        const sameSize = fresh.filter((t) => t.magnitude === query.magnitude);
        if (query.category !== undefined) levels.push(sameSize.filter((t) => t.category === query.category));
        levels.push(sameSize);
        // Closest magnitude first.
        const closest = Math.min(...fresh.map((t) => distance(t.magnitude, query.magnitude!)));
        levels.push(fresh.filter((t) => distance(t.magnitude, query.magnitude!) === closest));
      } else {
        if (query.category !== undefined) levels.push(fresh.filter((t) => t.category === query.category));
        levels.push(fresh);
      }
      for (const level of levels) {
        if (level.length > 0) {
          const picked = choose(level, query);
          use(picked);
          return picked;
        }
      }
      // Everything of this kind / scope / direction was used: repeat the one used longest ago.
      let oldest = base[0]!;
      for (const t of base) if ((lastUsed.get(t.id) ?? 0) < (lastUsed.get(oldest.id) ?? 0)) oldest = t;
      use(oldest);
      return oldest;
    },
    byId: (id) => byId.get(id),
    use,
    timesUsed: (id) => uses.get(id) ?? 0,
  };
}

/** Fictional fill lists (shared/data/placeholders.json): COUNTRY, LEADER, GOV_AGENCY, CITY, PRODUCT. */
export type PlaceholderLists = Partial<Record<string, readonly string[]>>;

export interface FillContext {
  universe: Universe;
  lists: PlaceholderLists;
  /** The company the headline is about (stock scope). */
  company?: Company;
  /** The sector it is about (sector scope; defaults to the company's). */
  sector?: Sector;
}

/**
 * Replaces every {SLOT} of a template text. Values that need a target and have none (a {COMPANY} in a
 * market headline) get a random company / sector, so the text always reads. The first letter is
 * capitalized ("{GOV_AGENCY} cuts rates" -> "The National Reserve Board cuts rates").
 */
export function fillHeadline(text: string, rng: Rng, ctx: FillContext): string {
  const companies = ctx.universe.companies;
  const memo = new Map<string, string>();
  let company = ctx.company;
  const anyCompany = () => (company ??= companies[rng.int(companies.length)]!);

  const value = (slot: string): string | undefined => {
    switch (slot) {
      case 'COMPANY':
        return anyCompany().name;
      case 'TICKER':
        return anyCompany().symbol;
      case 'CEO':
        return anyCompany().ceo;
      case 'SECTOR':
        return SECTOR_LABELS[ctx.sector ?? anyCompany().sector];
      case 'RIVAL': {
        const self = anyCompany();
        const peers = companies.filter((c) => c.sector === self.sector && c.symbol !== self.symbol);
        const pool = peers.length > 0 ? peers : companies.filter((c) => c.symbol !== self.symbol);
        return pool.length > 0 ? pool[rng.int(pool.length)]!.name : self.name;
      }
      default: {
        const list = ctx.lists[slot];
        return list && list.length > 0 ? list[rng.int(list.length)] : undefined;
      }
    }
  };

  const filled = text.replace(/\{([A-Z_]+)\}/g, (whole, slot: string) => {
    if (!memo.has(slot)) memo.set(slot, value(slot) ?? whole);
    return memo.get(slot)!;
  });
  return filled.charAt(0).toUpperCase() + filled.slice(1);
}
