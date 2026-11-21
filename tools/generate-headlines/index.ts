/**
 * Headline generator (DESIGN.md section 7). Asks a local OpenAI-compatible model (Ollama, LM Studio) for
 * headline templates, one slice at a time, and writes them in the same schema as
 * shared/data/headlines.seed.json.
 *
 *   npx tsx tools/generate-headlines/index.ts --count 40
 *   npm run generate-headlines -- --scope stock --category legal --kind debunk --count 10 --append
 *   npm run generate-headlines -- --dry-run
 *
 * Env: HEADLINES_API_URL (default http://localhost:11434/v1), HEADLINES_MODEL (default llama3.1),
 *      HEADLINES_API_KEY (optional, sent as a Bearer token).
 * Relative paths (--out) are resolved against the repo root. See README.md next to this file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HeadlineTemplate } from '../../shared/types.ts';
import {
  CATEGORIES,
  DIRECTIONS,
  KINDS,
  MAGNITUDES,
  PLACEHOLDERS,
  SCOPES,
  allSlices,
  comboKey,
  normalizeText,
  requiredShockCombos,
  sliceKey,
  validateHeadline,
  validateHeadlineFile,
  type Slice,
} from './validate.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED_PATH = resolve(repoRoot, 'shared', 'data', 'headlines.seed.json');
const DEFAULT_OUT = 'shared/data/headlines.generated.json';
const RETRIES = 2;
const REQUEST_TIMEOUT_MS = 180_000;

/** Relative weight per kind when deciding what is under-represented: most of the database is "real". */
const KIND_WEIGHT: Record<Slice['kind'], number> = { real: 4, fake_template: 1, debunk: 1, event: 1 };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  count: number;
  out: string;
  batch: number;
  append: boolean;
  dryRun: boolean;
  filter: { [K in keyof Slice]?: Slice[K][] };
  apiUrl: string;
  model: string;
  apiKey?: string;
}

const HELP = `Usage: npx tsx tools/generate-headlines/index.ts [flags]

  --count N        new headlines to add this run (default 40)
  --batch N        headlines requested per model call (default 8)
  --out PATH       output file (default ${DEFAULT_OUT}, relative to the repo root)
  --append         keep the existing output file and add to it (default: replace it)
  --scope LIST     restrict to scopes      (${SCOPES.join(',')})
  --direction LIST restrict to directions  (${DIRECTIONS.join(',')})
  --magnitude LIST restrict to magnitudes  (${MAGNITUDES.join(',')})
  --category LIST  restrict to categories  (${CATEGORIES.join(',')})
  --kind LIST      restrict to kinds       (${KINDS.join(',')})
  --dry-run        print the prompts and the plan, call nothing, write nothing
  --help           show this help

LIST is comma-separated. Env: HEADLINES_API_URL, HEADLINES_MODEL, HEADLINES_API_KEY.`;

class UsageError extends Error {}

function parseList<T extends string>(flag: string, raw: string, allowed: readonly T[]): T[] {
  const values = raw.split(',').map((v) => v.trim()).filter(Boolean);
  for (const v of values) {
    if (!(allowed as readonly string[]).includes(v)) {
      throw new UsageError(`${flag}: "${v}" is not one of ${allowed.join(', ')}`);
    }
  }
  if (values.length === 0) throw new UsageError(`${flag} needs a value`);
  return values as T[];
}

function parseIntFlag(flag: string, raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} needs a positive integer`);
  return n;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Options | 'help' {
  const opts: Options = {
    count: 40,
    out: DEFAULT_OUT,
    batch: 8,
    append: false,
    dryRun: false,
    filter: {},
    apiUrl: (env.HEADLINES_API_URL || 'http://localhost:11434/v1').replace(/\/+$/, ''),
    model: env.HEADLINES_MODEL || 'llama3.1',
    apiKey: env.HEADLINES_API_KEY || undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case '--help':
      case '-h':
        return 'help';
      case '--count': opts.count = parseIntFlag(flag, value()); break;
      case '--batch': opts.batch = parseIntFlag(flag, value()); break;
      case '--out': opts.out = value(); break;
      case '--append': opts.append = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--scope': opts.filter.scope = parseList(flag, value(), SCOPES); break;
      case '--direction': opts.filter.direction = parseList(flag, value(), DIRECTIONS); break;
      case '--magnitude': opts.filter.magnitude = parseList(flag, value(), MAGNITUDES); break;
      case '--category': opts.filter.category = parseList(flag, value(), CATEGORIES); break;
      case '--kind': opts.filter.kind = parseList(flag, value(), KINDS); break;
      default:
        throw new UsageError(`unknown argument "${arg}" (see --help)`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function readHeadlines(path: string, label: string): HeadlineTemplate[] {
  if (!existsSync(path)) return [];
  const report = validateHeadlineFile(JSON.parse(readFileSync(path, 'utf8')));
  if (report.invalid.length > 0) {
    const first = report.invalid[0]!;
    console.warn(`warning: ${label} has ${report.invalid.length} invalid entries (first: #${first.index} ${first.errors.join('; ')}); they are ignored`);
  }
  return report.valid;
}

function matchesFilter(s: Slice, filter: Options['filter']): boolean {
  return (Object.keys(filter) as Array<keyof Slice>).every((k) => {
    const allowed = filter[k] as string[] | undefined;
    return !allowed || allowed.includes(s[k]);
  });
}

function countBySlice(items: HeadlineTemplate[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of items) m.set(sliceKey(h), (m.get(sliceKey(h)) ?? 0) + 1);
  return m;
}

/** The most under-represented slice: lowest count relative to its kind weight; ties keep table order. */
function pickSlice(slices: Slice[], counts: Map<string, number>, skip: Set<string>): Slice | undefined {
  let best: Slice | undefined;
  let bestScore = Infinity;
  for (const s of slices) {
    if (skip.has(sliceKey(s))) continue;
    const score = (counts.get(sliceKey(s)) ?? 0) / KIND_WEIGHT[s.kind];
    if (score < bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** Interleaves slices so ties are broken across scopes/categories instead of exhausting one corner first. */
function interleave(slices: Slice[]): Slice[] {
  // Deterministic stride shuffle: index * prime mod n visits every slot once when gcd(prime, n) = 1.
  const n = slices.length;
  if (n === 0) return slices;
  let prime = 97;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  while (gcd(prime, n) !== 1) prime += 2;
  return slices.map((_, i) => slices[(i * prime) % n]!);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const KIND_HELP: Record<Slice['kind'], string> = {
  real: 'a genuine news item',
  fake_template: 'a planted false rumour a player can publish to move a price; it is debunked 10-20 s later',
  debunk: 'a correction/denial that reverses an earlier false rumour (its direction is the reversal direction)',
  event: 'a one-off physical or freak shock (sinkhole, flood, meteor, discovery) with a permanent effect',
};

const CATEGORY_HELP: Record<Slice['category'], string> = {
  earnings_leak: 'a hint about upcoming quarterly earnings (leaked memo, supplier chatter, insider behaviour)',
  contract: 'deals, orders, contracts, takeovers',
  legal: 'lawsuits, regulators, probes, fines, bans, rulings',
  exec: 'executives and boards: hires, resignations, scandals, insider buying',
  macro: 'rates, inflation, jobs, growth, tax, disasters affecting the economy',
  product: 'launches, recalls, reviews, delays',
  absurd: 'funny or bizarre but still tradeable news',
  regime_followup: 'follow-up to an ongoing world regime: a war, a lobbying bill, a deposed head of state, a pandemic',
};

export function pickExamples(seed: HeadlineTemplate[]): HeadlineTemplate[] {
  const want: Array<Partial<Slice>> = [
    { scope: 'stock', kind: 'real', category: 'contract' },
    { scope: 'stock', kind: 'real', category: 'earnings_leak' },
    { scope: 'stock', kind: 'fake_template' },
    { scope: 'stock', kind: 'debunk' },
    { scope: 'stock', kind: 'event' },
    { scope: 'sector', kind: 'real', category: 'regime_followup' },
    { scope: 'market', kind: 'real', direction: 'neutral' },
    { scope: 'market', kind: 'real', category: 'regime_followup', direction: 'down' },
  ];
  const out: HeadlineTemplate[] = [];
  for (const w of want) {
    const hit = seed.find((h) => !out.includes(h) && (Object.keys(w) as Array<keyof Slice>).every((k) => h[k] === w[k]));
    if (hit) out.push(hit);
  }
  return out;
}

const stripId = (h: HeadlineTemplate): Omit<HeadlineTemplate, 'id'> => ({
  text: h.text,
  scope: h.scope,
  direction: h.direction,
  magnitude: h.magnitude,
  category: h.category,
  kind: h.kind,
});

export function buildSystemPrompt(examples: HeadlineTemplate[]): string {
  return [
    'You write headline templates for a fictional stock-trading party game. Output ONLY a JSON array, no prose, no code fences.',
    'Each array element is an object with exactly these keys:',
    '  "text": the headline, punchy wire-service style, one line, at most 120 characters',
    `  "scope": ${SCOPES.map((s) => `"${s}"`).join(' | ')}`,
    `  "direction": ${DIRECTIONS.map((s) => `"${s}"`).join(' | ')}  (the price move the headline causes)`,
    `  "magnitude": ${MAGNITUDES.map((s) => `"${s}"`).join(' | ')}  (how big the move is; it must read plausibly against the text)`,
    `  "category": ${CATEGORIES.map((s) => `"${s}"`).join(' | ')}`,
    `  "kind": ${KINDS.map((s) => `"${s}"`).join(' | ')}`,
    '',
    'Rules:',
    `1. Names are placeholders in curly caps. Use ONLY these: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}. {RIVAL} is another company in the same sector. Never invent other placeholders.`,
    '2. scope "stock": the text MUST contain {COMPANY} or {TICKER}. It may also use {CEO}, {RIVAL}, {PRODUCT} and the others.',
    '3. scope "sector": the text MUST contain {SECTOR} and must not use {COMPANY}, {TICKER}, {CEO} or {RIVAL}.',
    '4. scope "market": the text must not use {COMPANY}, {TICKER}, {CEO}, {RIVAL} or {SECTOR}; it is about the whole economy.',
    '5. No real countries, people, politicians, agencies, exchanges, indexes or brands. Anything political or violent uses {COUNTRY} and {LEADER} only. Use {GOV_AGENCY} for any regulator or central bank, {CITY} for places.',
    '6. "neutral" headlines are noise (small or medium only). fake_template, debunk and event headlines are never neutral.',
    '7. earnings_leak is always scope "stock" and up or down.',
    '8. Wars, coups and disasters: no gore, no casualties, nothing offensive. Absurd is welcome, mean is not.',
    '9. Every headline must be different from the others and from the examples.',
    '',
    'Kinds: ' + KINDS.map((k) => `"${k}" = ${KIND_HELP[k]}`).join('; ') + '.',
    'Categories: ' + CATEGORIES.map((c) => `"${c}" = ${CATEGORY_HELP[c]}`).join('; ') + '.',
    '',
    'Examples:',
    JSON.stringify(examples.map(stripId), null, 0),
  ].join('\n');
}

export function buildUserPrompt(slice: Slice, n: number, avoid: string[]): string {
  const lines = [
    `Write ${n} new headlines. Every one must have exactly:`,
    `scope "${slice.scope}", direction "${slice.direction}", magnitude "${slice.magnitude}", category "${slice.category}", kind "${slice.kind}".`,
    `(kind ${slice.kind}: ${KIND_HELP[slice.kind]}; category ${slice.category}: ${CATEGORY_HELP[slice.category]}.)`,
  ];
  if (avoid.length > 0) {
    lines.push('Do not repeat or lightly reword these existing headlines:', ...avoid.map((t) => `- ${t}`));
  }
  lines.push(`Return a JSON array of ${n} objects and nothing else.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Model call and parsing
// ---------------------------------------------------------------------------

/** Pulls a JSON array out of a model reply (tolerates code fences, prose around it, {"headlines": [...]}). */
export function parseModelReply(content: string): unknown[] | undefined {
  const cleaned = content.replace(/```(?:json)?/gi, '').trim();
  const attempts: string[] = [cleaned];
  const a = cleaned.indexOf('[');
  const b = cleaned.lastIndexOf(']');
  if (a !== -1 && b > a) attempts.push(cleaned.slice(a, b + 1));
  const c = cleaned.indexOf('{');
  const d = cleaned.lastIndexOf('}');
  if (c !== -1 && d > c) attempts.push(cleaned.slice(c, d + 1));
  for (const text of attempts) {
    try {
      const v: unknown = JSON.parse(text);
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        const arr = Object.values(v as Record<string, unknown>).find(Array.isArray);
        if (arr) return arr;
      }
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

async function chat(opts: Options, system: string, user: string): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const res = await fetch(`${opts.apiUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.9,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('reply has no choices[0].message.content');
  return content;
}

/**
 * Turns raw model items into candidates for the slice: bare strings become {text}, missing fields are
 * filled from the slice, items that name a different slice are rejected.
 */
export function toCandidates(raw: unknown[], slice: Slice): Array<{ item: unknown; offSlice: boolean }> {
  return raw.map((r) => {
    const obj: Record<string, unknown> = typeof r === 'string' ? { text: r } : r && typeof r === 'object' && !Array.isArray(r) ? { ...(r as Record<string, unknown>) } : { text: r };
    delete obj.id;
    let offSlice = false;
    for (const k of ['scope', 'direction', 'magnitude', 'category', 'kind'] as const) {
      if (obj[k] === undefined) obj[k] = slice[k];
      else if (typeof obj[k] === 'string' && (obj[k] as string).trim().toLowerCase() !== slice[k]) offSlice = true;
      else if (typeof obj[k] === 'string') obj[k] = (obj[k] as string).trim().toLowerCase();
    }
    if (typeof obj.text === 'string') obj.text = obj.text.trim().replace(/\s+/g, ' ');
    return { item: obj, offSlice };
  });
}

// ---------------------------------------------------------------------------
// Coverage table
// ---------------------------------------------------------------------------

export function coverageTable(items: HeadlineTemplate[]): string {
  const lines: string[] = [];
  const pad = (s: string | number, w: number): string => String(s).padStart(w);
  lines.push('scope   direction  ' + MAGNITUDES.map((m) => pad(m, 7)).join(''));
  const combos = new Set(requiredShockCombos().map(comboKey));
  for (const scope of SCOPES) {
    for (const direction of DIRECTIONS) {
      const cells = MAGNITUDES.map((magnitude) => {
        const key = comboKey({ scope, direction, magnitude });
        if (!combos.has(key)) return pad('-', 7);
        const n = items.filter((h) => comboKey(h) === key).length;
        return pad(n === 0 ? '0 !' : n, 7);
      });
      lines.push(`${scope.padEnd(8)}${direction.padEnd(11)}${cells.join('')}`);
    }
  }
  const tally = <K extends keyof Slice>(k: K, values: readonly Slice[K][]): string =>
    values.map((v) => `${v}=${items.filter((h) => h[k] === v).length}`).join('  ');
  lines.push('');
  lines.push(`category: ${tally('category', CATEGORIES)}`);
  lines.push(`kind:     ${tally('kind', KINDS)}`);
  lines.push(`total:    ${items.length}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  let parsed: Options | 'help';
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}`);
      return 2;
    }
    throw err;
  }
  if (parsed === 'help') {
    console.log(HELP);
    return 0;
  }
  const opts = parsed;
  const outPath = isAbsolute(opts.out) ? opts.out : resolve(repoRoot, opts.out);

  const seed = readHeadlines(SEED_PATH, 'seed file');
  if (seed.length === 0) throw new Error(`no valid seed headlines at ${SEED_PATH}`);
  const existing = opts.append ? readHeadlines(outPath, 'output file') : [];
  const output: HeadlineTemplate[] = [...existing];

  const seen = new Set([...seed, ...existing].map((h) => normalizeText(h.text)));
  let nextId = 1 + existing.reduce((max, h) => Math.max(max, Number(/^h_gen_(\d+)$/.exec(h.id)?.[1] ?? 0)), 0);
  const counts = countBySlice([...seed, ...existing]);

  const slices = interleave(allSlices().filter((s) => matchesFilter(s, opts.filter)));
  if (slices.length === 0) {
    console.error('error: the filters leave no valid slice (e.g. neutral headlines are only small/medium and kind real; earnings_leak is stock only)');
    return 2;
  }

  const examples = pickExamples(seed);
  const system = buildSystemPrompt(examples);
  const avoidFor = (slice: Slice): string[] =>
    [...seed, ...output]
      .filter((h) => h.category === slice.category && h.scope === slice.scope)
      .slice(-6)
      .map((h) => h.text);

  console.log(`endpoint ${opts.apiUrl}/chat/completions, model ${opts.model}`);
  console.log(`output   ${relative(repoRoot, outPath) || outPath}${opts.append ? ` (append, ${existing.length} existing)` : ''}`);
  console.log(`target   ${opts.count} new headlines over ${slices.length} candidate slices, ${opts.batch} per call\n`);

  if (opts.dryRun) {
    // Plan as if every call returned a full batch.
    const planCounts = new Map(counts);
    const plan: Array<{ slice: Slice; n: number }> = [];
    let remaining = opts.count;
    while (remaining > 0) {
      const slice = pickSlice(slices, planCounts, new Set());
      if (!slice) break;
      const n = Math.min(opts.batch, remaining);
      plan.push({ slice, n });
      planCounts.set(sliceKey(slice), (planCounts.get(sliceKey(slice)) ?? 0) + n);
      remaining -= n;
    }
    console.log('=== system prompt ===\n' + system + '\n');
    if (plan[0]) console.log('=== first user prompt ===\n' + buildUserPrompt(plan[0].slice, plan[0].n, avoidFor(plan[0].slice)) + '\n');
    console.log('=== plan ===');
    for (const p of plan) console.log(`  ${sliceKey(p.slice)}  x${p.n}`);
    console.log('\n=== current coverage (seed + existing output) ===\n' + coverageTable([...seed, ...existing]));
    console.log('\ndry run: no request sent, nothing written');
    return 0;
  }

  let added = 0;
  let dropped = 0;
  let dupes = 0;
  const failed = new Set<string>();
  const maxCalls = Math.ceil(opts.count / opts.batch) * 4 + 4;
  let calls = 0;

  while (added < opts.count && calls < maxCalls) {
    const slice = pickSlice(slices, counts, failed);
    if (!slice) {
      console.warn('no slice left to try');
      break;
    }
    const n = Math.min(opts.batch, opts.count - added);
    const user = buildUserPrompt(slice, n, avoidFor(slice));
    let raw: unknown[] | undefined;
    for (let attempt = 0; attempt <= RETRIES && !raw; attempt++) {
      calls++;
      try {
        const reply = await chat(opts, system, user);
        raw = parseModelReply(reply);
        if (!raw) console.warn(`  ${sliceKey(slice)}: unparseable reply (attempt ${attempt + 1}/${RETRIES + 1})`);
      } catch (err) {
        console.warn(`  ${sliceKey(slice)}: request failed (attempt ${attempt + 1}/${RETRIES + 1}): ${(err as Error).message}`);
      }
    }
    if (!raw) {
      failed.add(sliceKey(slice));
      continue;
    }

    let kept = 0;
    for (const { item, offSlice } of toCandidates(raw, slice)) {
      if (added >= opts.count) break;
      const r = validateHeadline(item, { requireId: false });
      if (offSlice || !r.ok) {
        dropped++;
        continue;
      }
      const key = normalizeText(r.value.text);
      if (seen.has(key)) {
        dupes++;
        continue;
      }
      seen.add(key);
      const headline: HeadlineTemplate = { ...r.value, id: `h_gen_${String(nextId++).padStart(6, '0')}` };
      output.push(headline);
      counts.set(sliceKey(slice), (counts.get(sliceKey(slice)) ?? 0) + 1);
      added++;
      kept++;
    }
    console.log(`  ${sliceKey(slice)}: kept ${kept}/${raw.length}`);
    // A slice that yields nothing usable is skipped for the rest of the run, so the loop moves on.
    if (kept === 0) failed.add(sliceKey(slice));

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  }

  if (!existsSync(outPath)) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  }
  console.log(`\nadded ${added}, dropped ${dropped} invalid/off-slice, ${dupes} duplicates, ${failed.size} slices skipped, ${calls} calls`);
  console.log(`wrote ${output.length} headlines to ${relative(repoRoot, outPath) || outPath}\n`);
  console.log('=== coverage (seed + output) ===\n' + coverageTable([...seed, ...output]));
  return added >= opts.count ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
