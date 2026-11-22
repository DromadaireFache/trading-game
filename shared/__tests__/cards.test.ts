import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config.ts';
import { cardPrice, toCardDef, validateCardCatalog } from '../cards.ts';
import type { CardCatalogEntry } from '../cards.ts';
import type { HeadlineTemplate } from '../types.ts';
import cardsJson from '../data/cards.json';
import headlinesJson from '../data/headlines.seed.json';

const cards = cardsJson as CardCatalogEntry[];
const headlines = headlinesJson as HeadlineTemplate[];

describe('card catalog', () => {
  it('the shipped catalog is valid against the headline seed and default config', () => {
    expect(validateCardCatalog(cards, headlines, defaultConfig)).toEqual([]);
  });

  it('has enough cards per tier to fill a shop', () => {
    const tiers = ['fake', 'event', 'regime', 'mayhem'] as const;
    for (const tier of tiers) expect(cards.filter((c) => c.tier === tier).length).toBeGreaterThanOrEqual(3);
    // Insider keeps a single headline tip (plus the earnings peek): the near-copies were removed on purpose.
    expect(cards.filter((c) => c.tier === 'insider').length).toBeGreaterThanOrEqual(1);
    expect(cards.length).toBeGreaterThan(defaultConfig.cards.offersPerShop);
  });

  it('catches broken entries', () => {
    const base = cards.find((c) => c.defId === 'planted_rumor')!;
    const broken: CardCatalogEntry[] = [
      { ...base, defId: 'a', legal: true },
      { ...base, defId: 'b', needsDirection: false },
      { ...base, defId: 'c', tier: 'event' },
      { ...base, defId: 'd', priceMult: 0 },
      { ...base, defId: 'd' },
    ];
    const problems = validateCardCatalog(broken, headlines, defaultConfig).join('\n');
    expect(problems).toContain('card a: legal cards have heat null');
    expect(problems).toContain('card b: needsDirection must be true');
    expect(problems).toContain('card c: effect "fake_headline" does not belong to tier event');
    expect(problems).toContain('card d: priceMult must be > 0');
    expect(problems).toContain('card d: duplicate defId');
  });

  it('flags missing headline references', () => {
    const war = cards.find((c) => c.defId === 'war')!;
    if (war.effect.kind !== 'regime') throw new Error('war must be a regime');
    const bad = { ...war, effect: { ...war.effect, headlines: { ...war.effect.headlines, start: 'h_nope' } } };
    expect(validateCardCatalog([bad], headlines, defaultConfig).join('\n')).toContain('start headline "h_nope" not found');
  });

  it('prices scale with net worth, tier and multiplier, with a floor', () => {
    const rumor = { tier: 'fake' as const, priceMult: 1 };
    expect(cardPrice(defaultConfig, rumor, 100e6)).toBeCloseTo(100e6 * defaultConfig.cards.priceShareOfNetWorth.fake);
    expect(cardPrice(defaultConfig, { ...rumor, priceMult: 2 }, 100e6)).toBeCloseTo(2 * cardPrice(defaultConfig, rumor, 100e6));
    expect(cardPrice(defaultConfig, rumor, 0)).toBe(defaultConfig.cards.minPrice);
    expect(cardPrice(defaultConfig, rumor, -5e6)).toBe(defaultConfig.cards.minPrice);
  });

  it('toCardDef keeps only the public fields', () => {
    const def = toCardDef(cards[0]!);
    expect(Object.keys(def).sort()).toEqual(['defId', 'description', 'legal', 'name', 'needsDirection', 'targetKind', 'tier']);
  });

  it('publishes the fixed price direction of event cards', () => {
    const publicCards = new Map(cards.map((card) => [card.defId, toCardDef(card)]));
    expect(publicCards.get('jensen_special')).toMatchObject({ needsDirection: false, priceDirection: 'down' });
    expect(publicCards.get('surprise_holiday')).toMatchObject({ needsDirection: false, priceDirection: 'up' });
    expect(publicCards.get('planted_rumor')).toMatchObject({ needsDirection: true });
    expect(publicCards.get('planted_rumor')).not.toHaveProperty('priceDirection');
  });
});
