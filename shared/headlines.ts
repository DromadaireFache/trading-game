/**
 * Schema and placeholder rules for headline templates (DESIGN.md section 7). Used by the generator to
 * drop bad model output and by the server to load the offline catalog.
 */
import { SECTORS } from './types.ts';
import type {
  HeadlineCategory,
  HeadlineDirection,
  HeadlineKind,
  HeadlineMagnitude,
  HeadlineScope,
  HeadlineTemplate,
  Sector,
} from './types.ts';

export const SCOPES: readonly HeadlineScope[] = ['market', 'sector', 'stock'];
export const DIRECTIONS: readonly HeadlineDirection[] = ['up', 'down', 'neutral'];
export const MAGNITUDES: readonly HeadlineMagnitude[] = ['small', 'medium', 'large', 'huge'];
export const CATEGORIES: readonly HeadlineCategory[] = [
  'earnings_leak',
  'contract',
  'legal',
  'exec',
  'macro',
  'product',
  'absurd',
  'regime_followup',
];
export const KINDS: readonly HeadlineKind[] = ['real', 'fake_template', 'debunk', 'event'];

/** The only placeholders a headline may use. COMPANY/TICKER/CEO/SECTOR/RIVAL come from the game universe. */
export const PLACEHOLDERS = [
  'COMPANY',
  'TICKER',
  'CEO',
  'SECTOR',
  'COUNTRY',
  'LEADER',
  'GOV_AGENCY',
  'CITY',
  'PRODUCT',
  'RIVAL',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** Placeholders that tie a headline to one specific company. */
export const COMPANY_PLACEHOLDERS: readonly Placeholder[] = ['COMPANY', 'TICKER', 'CEO', 'RIVAL'];

/** Neutral headlines are noise: they may only be small or medium. */
export const NEUTRAL_MAGNITUDES: readonly HeadlineMagnitude[] = ['small', 'medium'];

export const TEXT_MIN = 12;
export const TEXT_MAX = 140;

/**
 * Obvious real-world names that must never appear (countries, people, agencies, brands, exchanges).
 * Not exhaustive: it catches the usual slips of a language model. Matched case-sensitively on word
 * boundaries so ordinary words ("us", "apple pie") are not flagged.
 */
export const REAL_WORLD_TERMS: readonly string[] = [
  // countries and blocs
  'USA', 'US', 'U.S.', 'UK', 'EU', 'UN', 'NATO', 'OPEC', 'America', 'American', 'China', 'Chinese', 'Russia',
  'Russian', 'Ukraine', 'Ukrainian', 'Iran', 'Iraq', 'Israel', 'Gaza', 'Palestine', 'Syria', 'Japan', 'Germany',
  'France', 'Britain', 'British', 'England', 'India', 'Pakistan', 'Mexico', 'Canada', 'Brazil', 'Korea', 'Taiwan',
  'Europe', 'European', 'Saudi', 'Venezuela', 'Turkey', 'Italy', 'Spain', 'Australia', 'Africa',
  // agencies and markets
  'SEC', 'FDA', 'FBI', 'CIA', 'NSA', 'FTC', 'DOJ', 'IRS', 'NASA', 'IMF', 'ECB', 'Fed', 'Federal Reserve',
  'Wall Street', 'NYSE', 'Nasdaq', 'NASDAQ', 'Dow', 'S&P', 'FTSE', 'Nikkei', 'WHO', 'Pentagon', 'Kremlin',
  'White House', 'Congress', 'Senate', 'Parliament of',
  // brands
  'Apple', 'Google', 'Alphabet', 'Amazon', 'Microsoft', 'Tesla', 'Meta', 'Facebook', 'Twitter', 'Nvidia',
  'NVIDIA', 'Intel', 'Boeing', 'Airbus', 'Netflix', 'Walmart', 'Pfizer', 'Moderna', 'Exxon', 'Shell', 'OpenAI',
  'Samsung', 'Sony', 'Toyota', 'Disney', 'Coca-Cola', 'Pepsi', 'McDonald', 'Starbucks', 'iPhone', 'Bitcoin',
  // people
  'Trump', 'Biden', 'Obama', 'Musk', 'Bezos', 'Putin', 'Zelensky', 'Xi Jinping', 'Zuckerberg', 'Buffett',
  'Powell', 'Yellen', 'Gates', 'Cook', 'Altman',
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REAL_WORLD_RE = new RegExp(
  `(?<![A-Za-z0-9])(?:${[...REAL_WORLD_TERMS].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![A-Za-z0-9])`,
);

const TOKEN_RE = /\{([A-Z_]+)\}/g;

/** All {PLACEHOLDER} names used in a text, in order of appearance (duplicates kept). */
export function findPlaceholders(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[1]!);
}

/** Ignore punctuation and spelling out the same subject slot a different way. */
export function normalizeText(text: string): string {
  return text.replace(/\{(?:COMPANY|TICKER)\}/g, '{SUBJECT}').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export type ValidationResult = { ok: true; value: HeadlineTemplate } | { ok: false; errors: string[] };

export interface ValidateOptions {
  /** Require a non-empty string id (default true). The generator validates before assigning ids. */
  requireId?: boolean;
  /** Optional pattern the id must match, e.g. /^h_seed_\d{4}$/. */
  idPattern?: RegExp;
}

const FIELDS = ['id', 'text', 'scope', 'sector', 'direction', 'magnitude', 'category', 'kind'] as const;

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/** Checks one headline against the schema and the placeholder rules. Returns every problem found. */
export function validateHeadline(item: unknown, opts: ValidateOptions = {}): ValidationResult {
  const requireId = opts.requireId ?? true;
  const errors: string[] = [];
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return { ok: false, errors: ['not an object'] };
  }
  const o = item as Record<string, unknown>;

  for (const key of Object.keys(o)) {
    if (!(FIELDS as readonly string[]).includes(key)) errors.push(`unknown field "${key}"`);
  }
  if (requireId || o.id !== undefined) {
    if (typeof o.id !== 'string' || o.id.length === 0) errors.push('id must be a non-empty string');
    else if (opts.idPattern && !opts.idPattern.test(o.id)) errors.push(`id "${o.id}" does not match ${opts.idPattern}`);
  }
  if (!oneOf(SCOPES, o.scope)) errors.push(`scope must be one of ${SCOPES.join('|')}`);
  if (o.sector !== undefined && !oneOf(SECTORS, o.sector)) errors.push('sector must be a game sector');
  if (o.scope === 'market' && o.sector !== undefined) errors.push('market headlines cannot have a sector');
  if (!oneOf(DIRECTIONS, o.direction)) errors.push(`direction must be one of ${DIRECTIONS.join('|')}`);
  if (!oneOf(MAGNITUDES, o.magnitude)) errors.push(`magnitude must be one of ${MAGNITUDES.join('|')}`);
  if (!oneOf(CATEGORIES, o.category)) errors.push(`category must be one of ${CATEGORIES.join('|')}`);
  if (!oneOf(KINDS, o.kind)) errors.push(`kind must be one of ${KINDS.join('|')}`);

  if (typeof o.text !== 'string') {
    errors.push('text must be a string');
  } else {
    errors.push(...textErrors(o.text, o.scope));
  }

  // Combination rules.
  if (o.direction === 'neutral' && oneOf(MAGNITUDES, o.magnitude) && !NEUTRAL_MAGNITUDES.includes(o.magnitude)) {
    errors.push('neutral headlines may only be small or medium');
  }
  if (o.category === 'earnings_leak') {
    if (o.scope !== 'stock') errors.push('earnings_leak headlines must be stock scope');
    if (o.direction === 'neutral') errors.push('earnings_leak headlines must point up or down');
  }
  if (o.direction === 'neutral' && (o.kind === 'fake_template' || o.kind === 'debunk' || o.kind === 'event')) {
    errors.push(`${String(o.kind)} headlines must point up or down`);
  }

  if (errors.length > 0) return { ok: false, errors };
  const value: HeadlineTemplate = {
    id: typeof o.id === 'string' ? o.id : '',
    text: o.text as string,
    scope: o.scope as HeadlineScope,
    ...(oneOf(SECTORS, o.sector) ? { sector: o.sector } : {}),
    direction: o.direction as HeadlineDirection,
    magnitude: o.magnitude as HeadlineMagnitude,
    category: o.category as HeadlineCategory,
    kind: o.kind as HeadlineKind,
  };
  return { ok: true, value };
}

/** Text-only rules: length, characters, placeholder syntax, scope/placeholder fit, real-world names. */
export function textErrors(text: string, scope: unknown): string[] {
  const errors: string[] = [];
  if (text !== text.trim()) errors.push('text has leading or trailing whitespace');
  if (/[\r\n\t]/.test(text)) errors.push('text must be a single line');
  if (/\s{2,}/.test(text)) errors.push('text has repeated whitespace');
  if (text.length < TEXT_MIN || text.length > TEXT_MAX) {
    errors.push(`text length ${text.length} outside ${TEXT_MIN}..${TEXT_MAX}`);
  }

  const used = findPlaceholders(text);
  for (const name of used) {
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) errors.push(`unknown placeholder {${name}}`);
  }
  const stripped = text.replace(TOKEN_RE, '');
  if (/[{}]/.test(stripped)) errors.push('malformed placeholder (use {CURLY_CAPS} from the fixed set)');
  if (/[<>[\]]/.test(stripped)) errors.push('text contains template-like brackets');

  const has = (p: Placeholder): boolean => used.includes(p);
  const companyBound = COMPANY_PLACEHOLDERS.filter(has);
  if (scope === 'stock') {
    if (!has('COMPANY') && !has('TICKER')) errors.push('stock headlines must contain {COMPANY} or {TICKER}');
  } else if (scope === 'sector') {
    if (!has('SECTOR')) errors.push('sector headlines must contain {SECTOR}');
    if (companyBound.length > 0) {
      errors.push(`sector headlines must not name a company (${companyBound.map((p) => `{${p}}`).join(', ')})`);
    }
  } else if (scope === 'market') {
    if (companyBound.length > 0 || has('SECTOR')) {
      const bad = [...companyBound, ...(has('SECTOR') ? (['SECTOR'] as const) : [])];
      errors.push(`market headlines must not name a company or sector (${bad.map((p) => `{${p}}`).join(', ')})`);
    }
  }

  const real = REAL_WORLD_RE.exec(stripped);
  if (real) errors.push(`real-world name "${real[0]}" (use a placeholder or a fictional name)`);
  return errors;
}

export interface FileReport {
  valid: HeadlineTemplate[];
  /** One entry per invalid item, index into the input array. */
  invalid: Array<{ index: number; id?: string; errors: string[] }>;
  duplicateIds: string[];
  duplicateTexts: string[];
}

/** Validates a whole headline file: every item, plus unique ids and unique (normalized) texts. */
export function validateHeadlineFile(items: unknown, opts: ValidateOptions = {}): FileReport {
  const report: FileReport = { valid: [], invalid: [], duplicateIds: [], duplicateTexts: [] };
  if (!Array.isArray(items)) {
    report.invalid.push({ index: -1, errors: ['file must be a JSON array'] });
    return report;
  }
  const ids = new Set<string>();
  const texts = new Set<string>();
  items.forEach((item, index) => {
    const r = validateHeadline(item, opts);
    if (!r.ok) {
      const id = (item as { id?: unknown } | null)?.id;
      report.invalid.push({ index, id: typeof id === 'string' ? id : undefined, errors: r.errors });
      return;
    }
    report.valid.push(r.value);
    if (ids.has(r.value.id)) report.duplicateIds.push(r.value.id);
    ids.add(r.value.id);
    const key = normalizeText(r.value.text);
    if (texts.has(key)) report.duplicateTexts.push(r.value.text);
    texts.add(key);
  });
  return report;
}

// ---------------------------------------------------------------------------
// Slices and coverage
// ---------------------------------------------------------------------------

export interface Slice {
  scope: HeadlineScope;
  sector?: Sector;
  direction: HeadlineDirection;
  magnitude: HeadlineMagnitude;
  category: HeadlineCategory;
  kind: HeadlineKind;
}

/** Every (scope, direction, magnitude) the database must cover; neutral only small/medium. */
export function requiredShockCombos(): Array<Pick<Slice, 'scope' | 'direction' | 'magnitude'>> {
  const out: Array<Pick<Slice, 'scope' | 'direction' | 'magnitude'>> = [];
  for (const scope of SCOPES) {
    for (const direction of DIRECTIONS) {
      for (const magnitude of direction === 'neutral' ? NEUTRAL_MAGNITUDES : MAGNITUDES) {
        out.push({ scope, direction, magnitude });
      }
    }
  }
  return out;
}

/** True when a full slice is allowed by the combination rules in validateHeadline. */
export function isValidSlice(s: Slice): boolean {
  if (s.direction === 'neutral' && !NEUTRAL_MAGNITUDES.includes(s.magnitude)) return false;
  if (s.category === 'earnings_leak' && (s.scope !== 'stock' || s.direction === 'neutral')) return false;
  if (s.direction === 'neutral' && s.kind !== 'real') return false;
  return true;
}

export type HeadlineBucket = Omit<Slice, 'category'>;

export function bucketKey(s: HeadlineBucket): string {
  return `${s.scope}/${s.sector ?? '*'}/${s.direction}/${s.magnitude}/${s.kind}`;
}
