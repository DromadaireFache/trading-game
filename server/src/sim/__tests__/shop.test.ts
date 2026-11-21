import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '@tg/shared';
import type { CardCatalogEntry } from '@tg/shared/cards';
import catalogJson from '@tg/shared/data/cards.json';
import { createRng } from '../rng.ts';
import { drawShopSelection, priceShopOffers } from '../shop.ts';

const catalog = catalogJson as CardCatalogEntry[];
const ctx = { quarter: 1, activeRegimes: 0 };

describe('shop', () => {
  it('is deterministic for a seed', () => {
    const a = drawShopSelection(createRng(7), catalog, defaultConfig, ctx).entries.map((e) => e.defId);
    const b = drawShopSelection(createRng(7), catalog, defaultConfig, ctx).entries.map((e) => e.defId);
    expect(a).toEqual(b);
    expect(a).toHaveLength(defaultConfig.cards.offersPerShop);
  });

  it('never repeats a card, holds at most one regime and no counters by default', () => {
    for (let seed = 0; seed < 500; seed++) {
      const ids = drawShopSelection(createRng(seed), catalog, defaultConfig, ctx).entries;
      expect(new Set(ids.map((e) => e.defId)).size).toBe(ids.length);
      expect(ids.filter((e) => e.tier === 'regime').length).toBeLessThanOrEqual(1);
      expect(ids.some((e) => e.tier === 'counter')).toBe(false);
    }
  });

  it('offers no regime while the regime cap is reached', () => {
    const full = { quarter: 3, activeRegimes: defaultConfig.regimes.maxActive };
    for (let seed = 0; seed < 300; seed++) {
      const entries = drawShopSelection(createRng(seed), catalog, defaultConfig, full).entries;
      expect(entries.some((e) => e.tier === 'regime')).toBe(false);
    }
  });

  it('includes counters when asked', () => {
    let seen = false;
    for (let seed = 0; seed < 200 && !seen; seed++) {
      const entries = drawShopSelection(createRng(seed), catalog, defaultConfig, ctx, { includeCounters: true }).entries;
      seen = entries.some((e) => e.tier === 'counter');
    }
    expect(seen).toBe(true);
  });

  it('follows shopWeight roughly', () => {
    const one = mergeConfig(defaultConfig, { cards: { offersPerShop: 1 } });
    const counts = new Map<string, number>();
    const rng = createRng(1);
    const runs = 20_000;
    for (let i = 0; i < runs; i++) {
      const id = drawShopSelection(rng, catalog, one, ctx).entries[0]!.defId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const pool = catalog.filter((e) => e.tier !== 'counter');
    const total = pool.reduce((s, e) => s + e.shopWeight, 0);
    for (const e of pool) {
      expect((counts.get(e.defId) ?? 0) / runs).toBeCloseTo(e.shopWeight / total, 1);
    }
  });

  it('returns a smaller shop when few cards are eligible', () => {
    const tiny = catalog.filter((e) => e.tier === 'regime');
    expect(drawShopSelection(createRng(3), tiny, defaultConfig, ctx).entries).toHaveLength(1);
    expect(drawShopSelection(createRng(3), [], defaultConfig, ctx).entries).toHaveLength(0);
  });

  it('prices the same selection per buyer with stable offer ids', () => {
    const selection = drawShopSelection(createRng(11), catalog, defaultConfig, { quarter: 2, activeRegimes: 0 });
    const poor = priceShopOffers(selection, defaultConfig, 1e6);
    const rich = priceShopOffers(selection, defaultConfig, 1e9);
    expect(poor.map((o) => o.offerId)).toEqual(rich.map((o) => o.offerId));
    expect(poor[0]!.offerId).toMatch(/^q2_0_/);
    for (const [i, offer] of rich.entries()) {
      expect(offer.price).toBeGreaterThan(poor[i]!.price);
      expect(poor[i]!.price).toBeGreaterThanOrEqual(defaultConfig.cards.minPrice);
      expect(Object.keys(offer.card)).not.toContain('effect');
    }
  });
});
