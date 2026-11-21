import { mkdirSync, openSync, closeSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SECTORS } from '../../shared/types.ts';
import type { HeadlineTemplate } from '../../shared/types.ts';
import { HEADLINE_SEED, generatedHeadlinePath, readHeadlines } from '../../server/src/headline-files.ts';
import {
  CATEGORIES, DIRECTIONS, KINDS, MAGNITUDES, SCOPES, bucketKey, isValidSlice, normalizeText,
  requiredShockCombos, validateHeadline,
} from '../../shared/headlines.ts';
import type { HeadlineBucket, Slice } from '../../shared/headlines.ts';
import { catalysts } from './catalysts.ts';
import { headlineForms } from './headline-forms.ts';
import { buildPrompt, cleanHeadline, outputGrammar, parseLines, SYSTEM_PROMPT } from './prompt.ts';
import type { Brief } from './prompt.ts';

const DEFAULT_URL = 'http://100.79.118.13:8080/v1/chat/completions';
const DEFAULT_MODEL = 'lfm3-1.7b';
const FILTERS = {
  scope: SCOPES, sector: SECTORS, direction: DIRECTIONS, magnitude: MAGNITUDES,
  category: CATEGORIES, kind: KINDS,
} as const;

const help = `npm run generate-headlines -- [options]
  --per-bucket N    top up each selected sector/scope, direction, magnitude and kind to N
  --count N         add at most N new headlines (default 40, unlimited with --per-bucket)
  --batch N         max briefs per request (default 12, range 1–24)
  --out PATH        use a separate catalog (paths relative to the current directory)
  --dry-run         print the first prompt and coverage, without network or writes
  --scope, --sector, --direction, --magnitude, --category, --kind
                    comma-separated filters (default kind: real)
Resumes from the existing file automatically. HEADLINES_API_URL and HEADLINES_MODEL
override the local endpoint and model. HEADLINES_API_KEY is optional.`;

function options(args: string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--append') continue;
    if (arg === '--dry-run') {
      parsed.set(arg, '');
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals >= 0) parsed.set(arg.slice(0, equals), arg.slice(equals + 1));
    else {
      const value = args[index + 1];
      if (!arg.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid option: ${arg}. See --help`);
      parsed.set(arg, value);
      index++;
    }
  }
  const numeric = (flag: string, fallback: number): number => {
    if (!parsed.has(flag)) return fallback;
    const value = Number(parsed.get(flag));
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} needs a positive integer`);
    return value;
  };
  for (const [flag, value] of parsed) {
    if (flag === '--dry-run') continue;
    if (!value || !flag.startsWith('--') || !(Object.hasOwn(FILTERS, flag.slice(2)) || ['--count', '--batch', '--per-bucket', '--out'].includes(flag))) {
      throw new Error(`Invalid option: ${flag}. See --help`);
    }
  }
  function list<T extends string>(key: string, allowed: readonly T[], fallback: readonly T[] = allowed): readonly T[] {
    const raw = parsed.get(`--${key}`);
    if (raw === undefined) return fallback;
    const values = [...new Set(raw.split(',').map((entry) => entry.trim()))];
    if (values.some((value) => !allowed.includes(value as T))) throw new Error(`--${key}: choose from ${allowed.join(', ')}`);
    return values as T[];
  }
  const target = numeric('--per-bucket', Infinity);
  const batchSize = numeric('--batch', 12);
  if (batchSize > 24) throw new Error('--batch must be at most 24');
  const scopes = list('scope', SCOPES, parsed.has('--sector') ? ['stock', 'sector'] : SCOPES);
  const categories = list('category', CATEGORIES);
  const directions = list('direction', DIRECTIONS);
  const magnitudes = list('magnitude', MAGNITUDES);
  const kinds = list('kind', KINDS, ['real']);
  const sectors = list('sector', SECTORS);
  const buckets = requiredShockCombos().flatMap((combo) => {
    if (!scopes.includes(combo.scope) || !directions.includes(combo.direction) || !magnitudes.includes(combo.magnitude)) return [];
    const targets = combo.scope === 'market' ? [undefined] : sectors;
    return targets.flatMap((sector) => kinds.flatMap((kind) => {
      const bucket = { ...combo, ...(sector ? { sector } : {}), kind };
      const recipes = catalysts(bucket).flatMap((story) => {
        const slice = { ...bucket, category: story.category };
        if (!categories.includes(story.category) || !isValidSlice(slice)) return [];
        const forms = headlineForms(story.premise, slice);
        return forms.plain.length ? [{ ...story, ...forms }] : [];
      });
      return recipes.length > 0 ? [{ bucket, recipes }] : [];
    }));
  });
  if (!buckets.length) throw new Error('No eligible buckets for these filters');
  return {
    buckets, categories, target, batchSize,
    count: numeric('--count', Number.isFinite(target) ? Infinity : 40),
    path: generatedHeadlinePath(parsed.get('--out')),
    dryRun: parsed.has('--dry-run'),
    endpoint: (process.env.HEADLINES_API_URL || DEFAULT_URL).replace(/\/+$/, '').replace(/\/v1$/, '/v1/chat/completions'),
    model: process.env.HEADLINES_MODEL || DEFAULT_MODEL,
    apiKey: process.env.HEADLINES_API_KEY,
  };
}

type Options = ReturnType<typeof options>;
type BucketState = Options['buckets'][number] & { key: string; existing: HeadlineTemplate[]; misses: number; storyUses: Map<string, number> };
const groupOf = (bucket: HeadlineBucket): string => [bucket.scope, bucket.sector, bucket.direction, bucket.kind].join('/');

function plan(states: BucketState[], size: number, target: number, attempt: number, seen: ReadonlySet<string>): Brief[] {
  const eligible = states.filter((state) => state.existing.length < target && state.misses < 4);
  const first = eligible.reduce<BucketState | undefined>(
    (low, state) => !low || state.existing.length < low.existing.length || (
      state.existing.length === low.existing.length && state.misses < low.misses
    ) ? state : low, undefined,
  );
  if (!first) return [];

  const group = eligible.filter((state) => groupOf(state.bucket) === groupOf(first.bucket));
  const planned = new Map<BucketState, number>();
  const briefs: Brief[] = [];
  while (briefs.length < size) {
    const count = (state: BucketState) => state.existing.length + (planned.get(state) ?? 0);
    const next = group.reduce<BucketState | undefined>((low, state) =>
      count(state) < target && (!low || count(state) < count(low)) ? state : low, undefined);
    if (!next) break;
    const inBucket = briefs.filter((brief) => bucketKey(brief) === next.key);
    const used = (premise: string) => (next.storyUses.get(premise) ?? 0) +
      inBucket.filter((brief) => brief.core === premise).length;
    const usedFamily = (family: string) => (next.storyUses.get(family) ?? 0) +
      inBucket.filter((brief) => brief.family === family).length;
    const funny = next.existing.filter((headline) => headline.category === 'absurd').length +
      inBucket.filter((brief) => brief.category === 'absurd').length;
    const bucketIndex = states.indexOf(next);
    const wantFunny = funny < Math.floor((count(next) + 1 + bucketIndex % 3) / 3);
    const isNew = (text: string) => !seen.has(normalizeText(text)) &&
      !briefs.some((brief) => brief.choices.includes(text));
    const candidates = next.recipes
      .filter(({ category }) => (category === 'absurd') === wantFunny)
      .flatMap((recipe) => {
        const allowed = used(recipe.premise) === 0 ? [...recipe.plain, ...recipe.contextual] : recipe.contextual;
        const options = allowed.filter(isNew);
        return options.length > 0 ? [{ recipe, options }] : [];
      });
    if (!candidates.length) {
      // This bucket may only have recipes of one kind with a narrow --category filter.
      const filteredKind = next.recipes.every(({ category }) => (category === 'absurd') !== wantFunny);
      const fallback = filteredKind ? next.recipes.flatMap((recipe) => {
        const options = [...recipe.plain, ...recipe.contextual].filter(isNew);
        return options.length > 0 ? [{ recipe, options }] : [];
      }) : [];
      if (!fallback.length) {
        group.splice(group.indexOf(next), 1);
        if (inBucket.length === 0) next.misses = 4;
        continue;
      }
      candidates.push(...fallback);
    }
    const offset = (bucketIndex + attempt + briefs.length) % candidates.length;
    const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];
    const score = ({ recipe }: typeof rotated[number]) => 50 * used(recipe.premise) +
      usedFamily(recipe.family) / Math.sqrt(next.recipes.filter((candidate) => candidate.family === recipe.family).length);
    const { recipe, options } = rotated.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
    const then = next.storyUses.get(recipe.premise) ?? 0;
    const choices = then === 0 && options.some((text) => recipe.plain.includes(text))
      ? options.filter((text) => recipe.plain.includes(text)) : options;
    briefs.push({ ...next.bucket, category: recipe.category, core: recipe.premise, family: recipe.family, choices });
    planned.set(next, (planned.get(next) ?? 0) + 1);
  }
  return briefs.length > 0 ? briefs : plan(states, size, target, attempt, seen);
}

class EndpointError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.retryable = retryable;
  }
}

async function complete(
  opts: Options,
  messages: { role: 'system' | 'user'; content: string }[],
  grammar: string,
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(opts.endpoint, {
        method: 'POST',
        headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
        body: JSON.stringify({
          model: opts.model,
          temperature,
          max_tokens: maxTokens,
          grammar,
          reasoning_format: 'deepseek',
          chat_template_kwargs: { enable_thinking: false },
          messages,
        }),
      });
      if (!response.ok) {
        throw new EndpointError(`HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`,
          response.status >= 500 || [408, 429].includes(response.status));
      }
      const result = await response.json() as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] };
      const choice = result.choices?.[0];
      if (typeof choice?.message?.content !== 'string') throw new EndpointError('Model returned no text');
      // If capped mid-row, keep only rows that ended with a newline.
      return choice.finish_reason === 'length'
        ? choice.message.content.slice(0, Math.max(0, choice.message.content.lastIndexOf('\n') + 1))
        : choice.message.content;
    } catch (error) {
      if (signal.aborted || attempt >= 2 || (error instanceof EndpointError && !error.retryable)) throw error;
      await delay(1_000 * (attempt + 1), undefined, { signal });
    }
  }
}

function checkpoint(path: string, output: HeadlineTemplate[]): void {
  const temp = path + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify(output, null, 2) + '\n');
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

async function run(opts: Options, signal: AbortSignal): Promise<void> {
  const seed = readHeadlines(HEADLINE_SEED);
  const output = readHeadlines(opts.path, true);
  const seen = new Set([...seed, ...output].map((headline) => normalizeText(headline.text)));
  const selected = new Set(opts.categories);
  const states: BucketState[] = opts.buckets.map(({ bucket, recipes }) => {
    const key = bucketKey(bucket);
    const existing = output.filter((headline) => bucketKey(headline) === key && selected.has(headline.category));
    const storyUses = new Map<string, number>();
    const approved = new Map(recipes.flatMap((story) => [...story.plain, ...story.contextual].map((text) => [text, story] as const)));
    for (const template of existing) {
      const story = approved.get(template.text);
      if (!story) continue;
      for (const label of new Set([story.premise, story.family])) storyUses.set(label, (storyUses.get(label) ?? 0) + 1);
    }
    return { bucket, recipes, key, existing, misses: 0, storyUses };
  });
  const byKey = new Map(states.map((state) => [state.key, state]));
  const limit = Math.min(opts.batchSize, opts.count);
  const first = plan(states, limit, opts.target, 0, seen);
  if (opts.dryRun) {
    console.log(`${states.length} selected buckets. Output: ${opts.path}. Model: ${opts.model}.`);
    console.log(first.length ? `${SYSTEM_PROMPT}\n\n${buildPrompt(first)}` : 'Coverage target already met.');
    return;
  }

  const start = performance.now();
  let calls = 0;
  let added = 0;
  let rejected = 0;
  while (added < opts.count) {
    signal.throwIfAborted();
    const briefs = plan(states, Math.min(opts.batchSize, opts.count - added), opts.target, calls, seen);
    if (!briefs.length) break;
    const reply = await complete(opts, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(briefs) },
    ], outputGrammar(briefs), 45 * briefs.length + 32, 0.8, signal);
    const lines = parseLines(reply, briefs.length);
    const touched = new Set<BucketState>();
    const accepted = new Set<BucketState>();
    let acceptedThisBatch = 0;
    for (const [index, brief] of briefs.entries()) {
      const state = byKey.get(bucketKey(brief))!;
      touched.add(state);
      const line = lines.get(index);
      const text = line && cleanHeadline(line, brief);
      const { core, family, choices, ...metadata } = brief;
      const result = validateHeadline({ ...metadata, text, id: `h_gen_${randomUUID()}` });
      if (!result.ok) continue;
      const key = normalizeText(result.value.text);
      if (seen.has(key)) continue;
      seen.add(key);
      state.existing.push(result.value);
      for (const label of new Set([core, family])) state.storyUses.set(label, (state.storyUses.get(label) ?? 0) + 1);
      output.push(result.value);
      accepted.add(state);
      acceptedThisBatch++;
      added++;
    }
    rejected += briefs.length - acceptedThisBatch;
    for (const state of touched) state.misses = accepted.has(state) ? 0 : state.misses + 1;
    if (accepted.size > 0) checkpoint(opts.path, output);
    calls++;
    if (calls % 10 === 0) console.log(`Catalog: ${output.length} generated templates (${output.filter((headline) => headline.category === 'absurd').length} comic); ${calls} calls this run.`);
  }

  const failed = states.filter((state) => state.misses >= 4).map((state) => state.key);
  const covered = states.filter((state) => state.existing.length >= opts.target).length;
  const perMinute = Math.round(added * 60_000 / Math.max(1, performance.now() - start));
  console.log(`Added ${added}, rejected ${rejected}, in ${calls} calls (${perMinute} accepted/min). Catalog: ${output.length} generated templates.`);
  if (Number.isFinite(opts.target)) console.log(`Coverage: ${covered}/${states.length} buckets with at least ${opts.target} templates.`);
  if (failed.length && added < opts.count && covered < states.length) {
    throw new Error(`No accepted output after four consecutive attempts for: ${failed.join(', ')}. Progress saved; rerun to retry.`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help);
    return;
  }
  const opts = options(args);
  if (opts.path === HEADLINE_SEED) throw new Error('Choose an output path other than the bundled seed');
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Interrupted; completed batches were saved'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  if (opts.dryRun) return run(opts, controller.signal);

  mkdirSync(dirname(opts.path), { recursive: true });
  const lock = opts.path + '.lock';
  let fd: number;
  try {
    fd = openSync(lock, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Catalog already locked: ${lock}`);
    throw error;
  }
  try {
    writeFileSync(fd, String(process.pid) + '\n');
    await run(opts, controller.signal);
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
