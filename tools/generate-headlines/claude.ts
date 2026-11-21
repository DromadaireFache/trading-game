/**
 * Writes funnier, slightly edgy headlines with Claude Haiku into shared/data/headlines.claude.json.
 * The game server prefers them: for every (scope, sector, direction, size, kind) this file covers, the
 * older generated catalog's entries are left out (server/src/headlineCatalog.ts). The seed stays.
 *
 *   npm run generate-headlines:claude -- --dry-run          # the plan and the first prompt, no network
 *   npm run generate-headlines:claude                        # fill every slot up to its target
 *   npm run generate-headlines:claude -- --kinds real --sectors tech,energy --scale 2
 *
 * Needs Anthropic credentials: ANTHROPIC_API_KEY, or a profile from `ant auth login`. Reruns top up:
 * only slots short of their target are asked for. Each finished group is saved at once.
 */
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { SECTORS } from '../../shared/types.ts';
import type { HeadlineTemplate, Sector } from '../../shared/types.ts';
import { normalizeText } from '../../shared/headlines.ts';
import { CLAUDE_HEADLINES, GENERATED_HEADLINES, HEADLINE_SEED, readHeadlines } from '../../server/src/headline-files.ts';
import { CLAUDE_MODEL, GROUP_KINDS, ReplySchema, SYSTEM_PROMPT, acceptReply, buildUserPrompt, describeGroup, planGroups } from './claude-prompt.ts';
import type { Group, GroupKind } from './claude-prompt.ts';

const help = `npm run generate-headlines:claude -- [options]
  --kinds LIST      ${GROUP_KINDS.join(',')} (default: all)
  --sectors LIST    ${SECTORS.join(',')} (default: all; the market groups are always included)
  --scale N         multiply the per-slot targets (default 1)
  --concurrency N   requests in flight (default 4)
  --out PATH        catalog file (default shared/data/headlines.claude.json)
  --dry-run         print the plan and the first prompt; no network, no writes
Model: ${CLAUDE_MODEL} (override with HEADLINES_CLAUDE_MODEL).`;

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--dry-run' || flag === '--help' || flag === '-h') args.set(flag, '');
    else if (flag.startsWith('--') && argv[i + 1] !== undefined) args.set(flag, argv[++i]!);
    else throw new Error(`Invalid option: ${flag}. See --help`);
  }
  const list = <T extends string>(flag: string, allowed: readonly T[]): T[] | undefined => {
    const raw = args.get(flag);
    if (raw === undefined) return undefined;
    const values = raw.split(',').map((v) => v.trim());
    const bad = values.find((v) => !allowed.includes(v as T));
    if (bad) throw new Error(`${flag}: unknown "${bad}"; choose from ${allowed.join(', ')}`);
    return values as T[];
  };
  const number = (flag: string, fallback: number) => {
    const raw = args.get(flag);
    const n = raw === undefined ? fallback : Number(raw);
    if (!(n > 0)) throw new Error(`${flag} needs a positive number`);
    return n;
  };
  return {
    help: args.has('--help') || args.has('-h'),
    dryRun: args.has('--dry-run'),
    kinds: list<GroupKind>('--kinds', GROUP_KINDS),
    sectors: list<Sector>('--sectors', SECTORS),
    scale: number('--scale', 1),
    concurrency: Math.floor(number('--concurrency', 4)),
    out: args.get('--out') ?? CLAUDE_HEADLINES,
    model: process.env.HEADLINES_CLAUDE_MODEL || CLAUDE_MODEL,
  };
}

function save(path: string, headlines: HeadlineTemplate[]): void {
  const temp = `${path}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(headlines, null, 2) + '\n');
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

async function writeGroup(client: Anthropic, model: string, group: Group): Promise<ReturnType<typeof ReplySchema.parse> | null> {
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low', format: zodOutputFormat(ReplySchema) },
    messages: [{ role: 'user', content: buildUserPrompt(group) }],
  });
  if (response.stop_reason === 'refusal') {
    console.warn(`  ${describeGroup(group)}: declined (${response.stop_details?.category ?? 'no category'}); skipped`);
    return null;
  }
  if (response.stop_reason === 'max_tokens') console.warn(`  ${describeGroup(group)}: reply cut at max_tokens`);
  return response.parsed_output ?? null;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(help);
    return;
  }
  const catalog = readHeadlines(opts.out, true);
  const seen = new Set([...readHeadlines(HEADLINE_SEED), ...readHeadlines(GENERATED_HEADLINES, true), ...catalog].map((h) => normalizeText(h.text)));
  const groups = planGroups(catalog, { ...(opts.kinds ? { kinds: opts.kinds } : {}), ...(opts.sectors ? { sectors: opts.sectors } : {}), scale: opts.scale });
  const wanted = groups.reduce((n, g) => n + g.slots.reduce((m, s) => m + s.count, 0), 0);
  console.log(`${catalog.length} headlines in ${opts.out}. ${groups.length} groups to write, ${wanted} headlines wanted, model ${opts.model}.`);
  if (groups.length === 0) return;
  if (opts.dryRun) {
    console.log(`\n--- system ---\n${SYSTEM_PROMPT}\n\n--- user (${describeGroup(groups[0]!)}) ---\n${buildUserPrompt(groups[0]!)}`);
    return;
  }

  const client = new Anthropic();
  const id = () => `h_claude_${randomUUID().slice(0, 8)}`;
  let next = 0;
  let added = 0;
  let rejected = 0;
  const worker = async () => {
    while (next < groups.length) {
      const group = groups[next++]!;
      // One retry for a group that came back short (a reply can lose a few to the checks).
      for (let attempt = 0; attempt < 2 && group.slots.some((s) => s.count > 0); attempt++) {
        let reply;
        try {
          reply = await writeGroup(client, opts.model, group);
        } catch (error) {
          if (error instanceof Anthropic.AuthenticationError) throw new Error('No valid Anthropic credentials: set ANTHROPIC_API_KEY or run `ant auth login`.');
          if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) throw error;
          console.warn(`  ${describeGroup(group)}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        if (reply === null) break;
        const result = acceptReply(group, reply, seen, id);
        catalog.push(...result.added);
        added += result.added.length;
        rejected += result.rejected.length;
        for (const r of result.rejected.slice(0, 3)) console.warn(`  rejected (${r.why}): ${r.text}`);
        // What is still missing per slot, for the retry.
        for (const [i, slot] of group.slots.entries()) {
          const got = result.added.filter((h) => h.direction === slot.direction && h.magnitude === slot.magnitude).length;
          group.slots[i] = { ...slot, count: Math.max(0, slot.count - got) };
        }
        save(opts.out, catalog);
        console.log(`  ${describeGroup(group)}: +${result.added.length} (catalog ${catalog.length})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  console.log(`Added ${added}, rejected ${rejected}. ${catalog.length} headlines in ${opts.out}. Restart the game server to use them.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
