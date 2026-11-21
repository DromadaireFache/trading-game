/**
 * The Claude headline writer's pure half: which headlines to ask for, the prompt, the reply schema and
 * the checks on what comes back. claude.ts does the calls and the file. No network here, so it is tested.
 *
 * One request = one group: a scope (and sector) and a kind, with a slot per legal direction and size.
 * Groups:
 *   real   ordinary news, every (direction, size) incl. neutral noise; market, and stock / sector per sector
 *   leak   earnings whispers (kind real, category earnings_leak), stock scope, up / down
 *   fake   rumors a player plants with a card (kind fake_template), up / down
 *   debunk the correction that reverts a fake (kind debunk), up / down; generic, fits any rumor
 *   event  a dramatic event a card sets off (kind event), up / down
 */
import { z } from 'zod';
import { SECTORS, SECTOR_LABELS, defaultConfig } from '../../shared/index.ts';
import type { HeadlineCategory, HeadlineKind, HeadlineMagnitude, HeadlineScope, HeadlineTemplate, Sector } from '../../shared/types.ts';
import { DIRECTIONS, MAGNITUDES, NEUTRAL_MAGNITUDES, TEXT_MAX, bucketKey, normalizeText, validateHeadline } from '../../shared/headlines.ts';
import type { HeadlineDirection } from '../../shared/types.ts';

export const CLAUDE_MODEL = 'claude-haiku-5-5';

export type GroupKind = 'real' | 'leak' | 'fake' | 'debunk' | 'event';
export const GROUP_KINDS: readonly GroupKind[] = ['real', 'leak', 'fake', 'debunk', 'event'];

const KIND_OF: Record<GroupKind, HeadlineKind> = { real: 'real', leak: 'real', fake: 'fake_template', debunk: 'debunk', event: 'event' };
const STORY_CATEGORIES: readonly HeadlineCategory[] = ['contract', 'legal', 'exec', 'product', 'macro', 'absurd'];
const MARKET_CATEGORIES: readonly HeadlineCategory[] = ['macro', 'legal', 'absurd'];

/** Default headlines per slot, by group kind and direction: neutral noise is drawn the most. */
export const DEFAULT_PER_SLOT: Record<GroupKind, { moving: number; neutral: number }> = {
  real: { moving: 6, neutral: 10 },
  leak: { moving: 3, neutral: 0 },
  fake: { moving: 3, neutral: 0 },
  debunk: { moving: 3, neutral: 0 },
  event: { moving: 3, neutral: 0 },
};

export interface Slot {
  direction: HeadlineDirection;
  magnitude: HeadlineMagnitude;
  /** How many new headlines to ask for. */
  count: number;
}

export interface Group {
  kind: GroupKind;
  scope: HeadlineScope;
  sector?: Sector;
  categories: readonly HeadlineCategory[];
  slots: Slot[];
}

/** Which slot a headline of this group fills (for top-ups): bucket plus, for leaks, the category. */
function slotKey(group: Pick<Group, 'kind' | 'scope' | 'sector'>, direction: HeadlineDirection, magnitude: HeadlineMagnitude): string {
  const bucket = bucketKey({ scope: group.scope, ...(group.sector ? { sector: group.sector } : {}), direction, magnitude, kind: KIND_OF[group.kind] });
  return `${bucket}/${group.kind === 'leak' ? 'leak' : 'story'}`;
}

export function slotKeyOf(t: HeadlineTemplate): string {
  return `${bucketKey(t)}/${t.category === 'earnings_leak' ? 'leak' : 'story'}`;
}

/**
 * Every group with the slots still short of their target, given what the Claude catalog already holds.
 * `scale` multiplies the default counts (2 = twice as many).
 */
export function planGroups(existing: readonly HeadlineTemplate[], opts: { kinds?: readonly GroupKind[]; sectors?: readonly Sector[]; scale?: number } = {}): Group[] {
  const kinds = opts.kinds ?? GROUP_KINDS;
  const sectors = opts.sectors ?? SECTORS;
  const scale = opts.scale ?? 1;
  const have = new Map<string, number>();
  for (const t of existing) have.set(slotKeyOf(t), (have.get(slotKeyOf(t)) ?? 0) + 1);

  const targets: Array<Pick<Group, 'kind' | 'scope' | 'sector'>> = [];
  for (const kind of kinds) {
    const scopes: HeadlineScope[] = kind === 'leak' ? ['stock'] : ['market', 'sector', 'stock'];
    for (const scope of scopes) {
      if (scope === 'market') targets.push({ kind, scope });
      else for (const sector of sectors) targets.push({ kind, scope, sector });
    }
  }
  const groups: Group[] = [];
  for (const target of targets) {
    const want = DEFAULT_PER_SLOT[target.kind];
    const slots: Slot[] = [];
    for (const direction of DIRECTIONS) {
      if (direction === 'neutral' && want.neutral === 0) continue;
      for (const magnitude of direction === 'neutral' ? NEUTRAL_MAGNITUDES : MAGNITUDES) {
        const goal = Math.round((direction === 'neutral' ? want.neutral : want.moving) * scale);
        const count = goal - (have.get(slotKey(target, direction, magnitude)) ?? 0);
        if (count > 0) slots.push({ direction, magnitude, count });
      }
    }
    if (slots.length === 0) continue;
    const categories = target.kind === 'leak' ? (['earnings_leak'] as const) : target.scope === 'market' ? MARKET_CATEGORIES : STORY_CATEGORIES;
    groups.push({ ...target, categories, slots });
  }
  return groups;
}

export const SYSTEM_PROMPT = `You write headlines for the news wire of a fast, funny stock-trading party game. Players read one headline, then have a few seconds to bet on the stock it names.

TONE: absurd, funny and slightly edgy, told with a straight face, like a financial wire from a slightly broken universe. Most headlines should be properly absurd: aliens, dinosaurs, portals, time travelers, ghosts, curses, krakens, wizards, cults, clones, robots, secret tunnels, moon bases. Mix in juicy human mischief: affairs between executives, spies sent to steal secrets, sabotage, heists, blackmail, petty feuds. The rest is deadpan corporate satire: greedy executives, hype, buzzwords, incompetent regulators. Dark humor and mild innuendo are fine. Punch up at companies, executives and governments, never at groups of people. No slurs, nothing sexual beyond a wink, no real tragedies (terror attacks, mass casualties, real diseases), no politics of real parties.

FORMAT: each headline reads like a real wire headline: one line, 40 to ${TEXT_MAX} characters, no emoji, no hashtags, no quotes around the whole thing, no trailing period. Vary the openings and the sentence shapes; never start two headlines in a reply the same way.

THE MOVE MUST BE OBVIOUS: a player must be able to tell from the headline alone which way the price goes and roughly how hard. "up" = clearly good for the business, "down" = clearly bad, "neutral" = funny but with no money at stake. The size tells how big the business news is: small = a minor blip, medium = real money, large = a major hit or windfall, huge = life or death for the company (takeover, bankruptcy, fraud, nationalization).

NAMES: everything is fictional. Never name a real person, company, brand, product, country, city, agency, exchange or currency. Use these slots instead, written exactly with braces:
{COMPANY} the company's name, {TICKER} its ticker, {CEO} its chief executive, {RIVAL} a rival company in the same industry, {PRODUCT} one of its products, {SECTOR} the industry's name, {COUNTRY} a country, {CITY} a city, {LEADER} a head of state, {GOV_AGENCY} a government agency.
Slot rules by scope:
- stock: must contain {COMPANY} or {TICKER}; may use any slot except {SECTOR}.
- sector: must contain {SECTOR}; must not use {COMPANY}, {TICKER}, {CEO} or {RIVAL}.
- market: about the whole economy; must not use {COMPANY}, {TICKER}, {CEO}, {RIVAL} or {SECTOR}.`;

const KIND_BRIEF: Record<GroupKind, string> = {
  real: 'Ordinary news stories. The story itself must justify the move.',
  leak: 'Earnings whispers ahead of the quarterly report: hints (leaked slides, supplier gossip, an exec who cannot stop smiling) that the company will beat ("up") or miss ("down") expectations, by about the given size.',
  fake: 'Juicy UNCONFIRMED rumors a player plants to push the price: hot scoops ("Sources say", "Leaked memo", "Insiders whisper") that sound just plausible enough. They will be proven false later.',
  debunk: 'Official denials of an earlier rumor ("denies reports", "calls the story fabricated", "auditors find nothing"). The direction is how the price moves on the correction: "up" = a scary rumor turned out false, "down" = a too-good rumor turned out false. Keep it generic: it must fit any rumor about this target, so do not invent the rumor\'s details.',
  event: 'Sudden dramatic events someone set off: freak weather, a viral stunt, a surprise decree, an accident, an act of god. The event must clearly help ("up") or hurt ("down") the target.',
};

const SIZE_HINT: Record<HeadlineMagnitude, number> = defaultConfig.news.shock;

export function buildUserPrompt(group: Group): string {
  const target = group.scope === 'market'
    ? 'Scope: market (the whole economy).'
    : `Scope: ${group.scope}. Industry: ${SECTOR_LABELS[group.sector!]}${group.scope === 'stock' ? ' (one company in it)' : ' (the whole industry)'}.`;
  const lines = group.slots.map((slot, i) => {
    const size = slot.direction === 'neutral' ? 'no price move' : `${slot.direction === 'up' ? '+' : '-'}${Math.round(SIZE_HINT[slot.magnitude] * 100)}% or so`;
    return `Slot ${i}: ${slot.direction}, ${slot.magnitude} (${size}). Write ${slot.count}.`;
  });
  return [
    target,
    `Kind: ${KIND_BRIEF[group.kind]}`,
    `Categories to choose from for each headline: ${group.categories.join(', ')} (absurd = the joke is the story itself).`,
    '',
    ...lines,
    '',
    'Reply with every headline as {slot, category, text}. Make each one genuinely funny or sharp; a dull headline is a wasted slot. At least two thirds should be absurd (category absurd when it is offered).',
  ].join('\n');
}

export const ReplySchema = z.object({
  headlines: z.array(z.object({ slot: z.number().int(), category: z.string(), text: z.string() })),
});
export type Reply = z.infer<typeof ReplySchema>;

export interface Accepted {
  added: HeadlineTemplate[];
  rejected: Array<{ text: string; why: string }>;
}

/**
 * Checks a reply against the schema rules, the group's slots and categories, and every text already in
 * use (`seen`, normalized; updated in place). Keeps at most `count` per slot. `id` makes the ids.
 */
export function acceptReply(group: Group, reply: Reply, seen: Set<string>, id: () => string): Accepted {
  const out: Accepted = { added: [], rejected: [] };
  const taken = new Map<number, number>();
  for (const item of reply.headlines) {
    const slot = group.slots[item.slot];
    const text = item.text.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
    if (slot === undefined) {
      out.rejected.push({ text, why: `no slot ${item.slot}` });
      continue;
    }
    if ((taken.get(item.slot) ?? 0) >= slot.count) continue;
    if (!(group.categories as readonly string[]).includes(item.category)) {
      out.rejected.push({ text, why: `category ${item.category}` });
      continue;
    }
    const result = validateHeadline({
      id: id(),
      text,
      scope: group.scope,
      ...(group.sector ? { sector: group.sector } : {}),
      direction: slot.direction,
      magnitude: slot.magnitude,
      category: item.category,
      kind: KIND_OF[group.kind],
    });
    if (!result.ok) {
      out.rejected.push({ text, why: result.errors.join('; ') });
      continue;
    }
    const key = normalizeText(text);
    if (seen.has(key)) {
      out.rejected.push({ text, why: 'duplicate' });
      continue;
    }
    seen.add(key);
    taken.set(item.slot, (taken.get(item.slot) ?? 0) + 1);
    out.added.push(result.value);
  }
  return out;
}

export function describeGroup(group: Group): string {
  return `${group.kind} ${group.scope}${group.sector ? `/${group.sector}` : ''} (${group.slots.reduce((n, s) => n + s.count, 0)} wanted)`;
}
