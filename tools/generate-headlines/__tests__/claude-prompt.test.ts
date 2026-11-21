import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTORS } from '../../../shared/types.ts';
import type { HeadlineTemplate } from '../../../shared/types.ts';
import { bucketKey, normalizeText } from '../../../shared/headlines.ts';
import { loadHeadlineTemplates } from '../../../server/src/headlineCatalog.ts';
import { readHeadlines, GENERATED_HEADLINES } from '../../../server/src/headline-files.ts';
import { DEFAULT_PER_SLOT, acceptReply, buildUserPrompt, planGroups, slotKeyOf } from '../claude-prompt.ts';
import type { Group } from '../claude-prompt.ts';

describe('planGroups', () => {
  it('covers every kind, scope and sector, with neutral noise only for ordinary news', () => {
    const groups = planGroups([]);
    // real: market + stock and sector per sector; leak: stock per sector; fake / debunk / event like real.
    const perKind = 1 + 2 * SECTORS.length;
    expect(groups).toHaveLength(4 * perKind + SECTORS.length);
    const market = groups.find((g) => g.kind === 'real' && g.scope === 'market')!;
    expect(market.slots).toHaveLength(10);
    expect(market.slots.find((s) => s.direction === 'neutral')!.count).toBe(DEFAULT_PER_SLOT.real.neutral);
    for (const g of groups.filter((g) => g.kind !== 'real')) expect(g.slots.every((s) => s.direction !== 'neutral')).toBe(true);
    expect(groups.filter((g) => g.kind === 'leak').every((g) => g.scope === 'stock' && g.categories.join() === 'earnings_leak')).toBe(true);
  });

  it('tops up: slots already at their target are not asked for again', () => {
    const full: HeadlineTemplate[] = Array.from({ length: DEFAULT_PER_SLOT.real.moving }, (_, i) => ({
      id: `h${i}`, text: `{COMPANY} wins contract number ${i}`, scope: 'stock', sector: 'tech', direction: 'up', magnitude: 'small', category: 'contract', kind: 'real',
    }));
    const group = planGroups(full, { kinds: ['real'], sectors: ['tech'] }).find((g) => g.scope === 'stock')!;
    expect(group.slots.some((s) => s.direction === 'up' && s.magnitude === 'small')).toBe(false);
    expect(group.slots.some((s) => s.direction === 'up' && s.magnitude === 'medium')).toBe(true);
    // An earnings leak in the same bucket counts for the leak slot, not the story slot.
    expect(slotKeyOf({ ...full[0]!, category: 'earnings_leak' })).not.toBe(slotKeyOf(full[0]!));
  });

  it('the prompt names the target, the kind and every slot with its count', () => {
    const group = planGroups([], { kinds: ['fake'], sectors: ['airlines'] }).find((g) => g.scope === 'sector')!;
    const prompt = buildUserPrompt(group);
    expect(prompt).toContain('Industry: Airlines');
    expect(prompt).toContain('UNCONFIRMED rumors');
    for (let i = 0; i < group.slots.length; i++) expect(prompt).toContain(`Slot ${i}:`);
  });
});

describe('acceptReply', () => {
  const group: Group = {
    kind: 'real', scope: 'stock', sector: 'tech', categories: ['product', 'absurd'],
    slots: [{ direction: 'up', magnitude: 'large', count: 2 }, { direction: 'neutral', magnitude: 'small', count: 1 }],
  };
  let n = 0;
  const id = () => `h_claude_t${++n}`;

  it('keeps valid headlines with the slot, scope and sector filled in, and rejects the rest', () => {
    const seen = new Set([normalizeText('{COMPANY} already said this')]);
    const result = acceptReply(group, {
      headlines: [
        { slot: 0, category: 'product', text: '{COMPANY} sells out {PRODUCT} after {CEO} accidentally livestreams it working.' },
        { slot: 0, category: 'absurd', text: 'Board of {TICKER} discovers the product actually works, orders a lot more of it' },
        { slot: 0, category: 'product', text: '{COMPANY} third one is over the slot count' },
        { slot: 1, category: 'absurd', text: 'Google buys {COMPANY} lunch' },
        { slot: 1, category: 'macro', text: '{COMPANY} intern renames the coffee machine' },
        { slot: 1, category: 'absurd', text: '{SECTOR} has a nice day' },
        { slot: 1, category: 'absurd', text: '{COMPANY} already said this' },
        { slot: 5, category: 'absurd', text: '{COMPANY} slot that does not exist' },
      ],
    }, seen, id);
    expect(result.added.map((h) => h.text)).toEqual([
      '{COMPANY} sells out {PRODUCT} after {CEO} accidentally livestreams it working',
      'Board of {TICKER} discovers the product actually works, orders a lot more of it',
    ]);
    expect(result.added[0]).toMatchObject({ scope: 'stock', sector: 'tech', direction: 'up', magnitude: 'large', kind: 'real', category: 'product' });
    const why = result.rejected.map((r) => r.why).join(' | ');
    expect(why).toContain('real-world name "Google"');
    expect(why).toContain('category macro');
    expect(why).toContain('{COMPANY} or {TICKER}');
    expect(why).toContain('duplicate');
    expect(why).toContain('no slot 5');
  });
});

describe('server loading', () => {
  it('Claude headlines replace the generated ones for the buckets they cover; the seed stays', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-claude-'));
    try {
      const generated = readHeadlines(GENERATED_HEADLINES, true);
      const sample = generated.find((h) => h.scope === 'stock' && h.sector === 'tech' && h.direction === 'up' && h.magnitude === 'large');
      if (!sample) return; // no generated catalog in this checkout: nothing to supersede
      const claude: HeadlineTemplate[] = [{ ...sample, id: 'h_claude_test', text: '{COMPANY} accidentally invents something people want' }];
      const path = join(dir, 'claude.json');
      writeFileSync(path, JSON.stringify(claude));
      const loaded = loadHeadlineTemplates(undefined, path);
      const inBucket = loaded.filter((h) => bucketKey(h) === bucketKey(sample));
      expect(inBucket.map((h) => h.id)).toContain('h_claude_test');
      expect(inBucket.some((h) => h.id.startsWith('h_gen_'))).toBe(false);
      expect(loaded.some((h) => h.id.startsWith('h_seed_'))).toBe(true);
      // Other buckets keep their generated headlines.
      expect(loaded.some((h) => h.id.startsWith('h_gen_') && bucketKey(h) !== bucketKey(sample))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
