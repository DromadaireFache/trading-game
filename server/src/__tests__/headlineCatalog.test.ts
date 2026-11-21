import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@tg/shared';
import type { HeadlineTemplate } from '@tg/shared';
import { ABSURD_GENERATED_SHARE, createHeadlineCatalog, loadHeadlineTemplates, PLAIN_GENERATED_SHARE } from '../headlineCatalog.ts';
import { ABSURD_HEADLINES, GENERATED_HEADLINES, readHeadlines } from '../headline-files.ts';
import { createRng, generateUniverse } from '../sim/index.ts';

const seed = 17;
const universe = generateUniverse(createRng(seed), defaultConfig);
const airline = universe.companies.find(({ sector }) => sector === 'airlines')!;
const stock = { scope: 'stock', direction: 'up', magnitude: 'large', kind: 'real', category: 'product' } as const;
const templates: HeadlineTemplate[] = [
  { ...stock, id: 'wrong-sector', sector: 'tech', text: '{COMPANY} wins a cloud contract' },
  { ...stock, id: 'wrong-direction', sector: 'airlines', direction: 'down', text: '{COMPANY} loses landing slots' },
  { ...stock, id: 'stock', sector: 'airlines', text: '{COMPANY} CEO {CEO} launches {PRODUCT} at {CITY}; {PRODUCT} sells out' },
  { ...stock, id: 'generic', text: '{TICKER} reopens its biggest market' },
  { ...stock, id: 'sector', scope: 'sector', sector: 'airlines', text: '{SECTOR} wins new landing rights' },
  { ...stock, id: 'market', scope: 'market', text: 'Central bank opens emergency credit facility' },
];

describe('headline catalog', () => {
  it('prefers a stock sector match and formats slots consistently before using the exact generic fallback', () => {
    const catalog = createHeadlineCatalog(templates, universe, seed);
    const query = { ...stock, symbol: airline.symbol };
    const result = catalog.drawForMove({ scope: 'stock', symbol: airline.symbol, category: 'product' }, 0.12);
    expect(result).toMatchObject({ id: 'stock', symbol: airline.symbol, sector: 'airlines' });
    const product = / launches (.+) at /.exec(result!.text)![1];
    expect(result!.text).toEqual(expect.stringContaining(`${airline.name} CEO ${airline.ceo}`));
    expect(result?.text).toContain(`; ${product} sells out`);
    expect(result?.text).not.toMatch(/[{}]/);
    expect(catalog.draw(query)).toMatchObject({ id: 'generic', text: `${airline.symbol} reopens its biggest market` });
    expect(catalog.draw(query)).toBeUndefined();
  });

  it('keeps scope, direction, magnitude and explicit categories exact', () => {
    const catalog = createHeadlineCatalog(templates, universe, seed);
    expect(catalog.draw({ ...stock, scope: 'sector', sector: 'energy' })).toBeUndefined();
    expect(catalog.draw({ ...stock, scope: 'sector', sector: 'airlines', magnitude: 'small' })).toBeUndefined();
    expect(catalog.draw({ ...stock, scope: 'market', kind: 'debunk' })).toBeUndefined();
    expect(catalog.draw({ ...stock, scope: 'market', category: 'exec' })).toBeUndefined();
    expect(catalog.draw({ ...stock, scope: 'sector', sector: 'airlines' })).toMatchObject({
      id: 'sector', text: 'Airlines wins new landing rights',
    });
    expect(catalog.draw({ ...stock, scope: 'market' })?.id).toBe('market');
  });

  it('loads every hand-written absurd headline and thins the generated catalog toward the absurd', () => {
    const templates = loadHeadlineTemplates();
    const ids = new Set(templates.map((t) => t.id));
    const absurd = readHeadlines(ABSURD_HEADLINES);
    expect(absurd.length).toBeGreaterThan(150);
    expect(absurd.every((t) => ids.has(t.id) && t.sector === undefined)).toBe(true);
    // Themes asked for: aliens, dinosaurs, portals, time travel, affairs, spies.
    for (const theme of [/alien/i, /dinosaur/i, /portal/i, /time travel/i, /affair/i, /spy|spies/i]) {
      expect(absurd.filter((t) => theme.test(t.text)).length, String(theme)).toBeGreaterThanOrEqual(8);
    }
    const generated = readHeadlines(GENERATED_HEADLINES, true);
    if (generated.length === 0) return;
    const share = (pick: (t: { category: string }) => boolean) =>
      generated.filter((t) => pick(t) && ids.has(t.id)).length / generated.filter(pick).length;
    expect(share((t) => t.category === 'product')).toBeCloseTo(PLAIN_GENERATED_SHARE, 1);
    expect(share((t) => t.category === 'absurd')).toBeCloseTo(ABSURD_GENERATED_SHARE, 1);
    expect(share((t) => t.category === 'earnings_leak')).toBe(1);
  });

  it('loads the bundled catalog without inference', () => {
    const templates = loadHeadlineTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(158);
    expect(new Set(templates.map(({ id }) => id)).size).toBe(templates.length);
  });
});
