/**
 * SHOP phase offers (DESIGN.md section 5). Pure and seeded: each quarter the sim calls
 * drawShopSelection once per player (in join order, from its one shop RNG stream), then
 * priceShopOffers for that player, so every player sees their own cards, priced for their net worth.
 *
 * Rules:
 * - Weighted draw by `shopWeight`, without replacement: no card type appears twice in one shop.
 * - Regime cards are left out while `regimes.maxActive` regimes are already running, and a shop
 *   holds at most `maxRegimesPerShop` of them.
 * - Counter cards are a stretch goal: left out unless `includeCounters` is set.
 * - If too few cards are eligible the shop is simply smaller than `cards.offersPerShop`.
 */
import type { CardOffer, GameConfig } from '@tg/shared';
import { cardPrice, toCardDef } from '@tg/shared/cards';
import type { CardCatalogEntry } from '@tg/shared/cards';
import type { Rng } from './rng.ts';

export interface ShopContext {
  /** 1-based quarter the shop belongs to; used in offer ids. */
  quarter: number;
  /** Regimes running right now (player-made and engine-made). */
  activeRegimes: number;
}

export interface ShopOptions {
  includeCounters?: boolean;
  maxRegimesPerShop?: number;
}

const DEFAULT_MAX_REGIMES_PER_SHOP = 1;

export interface ShopSelection {
  quarter: number;
  entries: CardCatalogEntry[];
}

export function drawShopSelection(
  rng: Rng,
  catalog: readonly CardCatalogEntry[],
  config: GameConfig,
  context: ShopContext,
  options: ShopOptions = {},
): ShopSelection {
  const maxRegimes = context.activeRegimes >= config.regimes.maxActive ? 0 : (options.maxRegimesPerShop ?? DEFAULT_MAX_REGIMES_PER_SHOP);
  const pool = catalog.filter((e) => e.shopWeight > 0 && (options.includeCounters || e.tier !== 'counter') && (e.tier !== 'regime' || maxRegimes > 0));

  const picked: CardCatalogEntry[] = [];
  let regimes = 0;
  while (picked.length < config.cards.offersPerShop) {
    const eligible = pool.filter((e) => !picked.includes(e) && (e.tier !== 'regime' || regimes < maxRegimes));
    if (eligible.length === 0) break;
    const total = eligible.reduce((sum, e) => sum + e.shopWeight, 0);
    let roll = rng.next() * total;
    // Falls back to the last card if floating-point rounding leaves `roll` just above the total.
    let choice = eligible[eligible.length - 1]!;
    for (const e of eligible) {
      roll -= e.shopWeight;
      if (roll < 0) {
        choice = e;
        break;
      }
    }
    picked.push(choice);
    if (choice.tier === 'regime') regimes++;
  }
  return { quarter: context.quarter, entries: picked };
}

/** The selection as one player's offers. Offer ids are stable per quarter, slot and card. */
export function priceShopOffers(selection: ShopSelection, config: GameConfig, netWorth: number): CardOffer[] {
  return selection.entries.map((entry, slot) => ({
    offerId: `q${selection.quarter}_${slot}_${entry.defId}`,
    card: toCardDef(entry),
    price: Math.round(cardPrice(config, entry, netWorth)),
  }));
}
