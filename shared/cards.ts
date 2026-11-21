/**
 * Card catalog (DESIGN.md section 5): the static list of every card type the shop can offer.
 * The data lives in shared/data/cards.json; this file holds its schema, the price rule and a
 * validator the tests run against the shipped file.
 *
 * - An entry is a CardDef (what the client sees) plus the fields only the sim needs: price
 *   multiplier, shop weight, heat and the effect. `toCardDef` strips it down for the wire.
 * - Price = max(cards.minPrice, cards.priceShareOfNetWorth[tier] * priceMult * buyer net worth).
 * - Heat names a key of config.sec.heat, so the amounts stay in config. Legal cards have `null`.
 * - Magnitudes reuse the headline scale (config.news.shock). Drifts are log-return per trading day.
 * - Headline ids point into shared/data/headlines.seed.json (later headlines.json).
 *
 * Nothing here is wired into the sim or server yet (M5).
 */
import type { GameConfig } from './config.ts';
import type { CardDef, CardTier, HeadlineMagnitude, HeadlineScope, HeadlineTemplate, Sector } from './types.ts';
import { SECTORS } from './types.ts';

export type HeatKey = keyof GameConfig['sec']['heat'];

/** Insider: the holder sees an upcoming real headline `leadMult * cards.insiderLeadMs` early. */
export interface InsiderTipEffect {
  kind: 'insider_tip';
  /** 'any' = the next real headline; 'sector' / 'stock' = the next one touching the chosen target. */
  focus: 'any' | 'sector' | 'stock';
  leadMult: number;
}

/** Insider: reveals the chosen stock's true earnings surprise for this quarter (DESIGN.md section 3). */
export interface EarningsPeekEffect {
  kind: 'earnings_peek';
}

/**
 * Fake: publishes a fake_template headline of this scope in the chosen direction, moves the target
 * by news.shock[magnitude], then after cards.fakeDebunk{Min,Max}Ms a matching debunk reverts the move.
 */
export interface FakeHeadlineEffect {
  kind: 'fake_headline';
  scope: HeadlineScope;
  magnitude: HeadlineMagnitude;
}

/** Event: a permanent shock through an `event` headline of this scope and direction. */
export interface EventShockEffect {
  kind: 'event_shock';
  scope: HeadlineScope;
  direction: 'up' | 'down';
  magnitude: HeadlineMagnitude;
}

export interface RegimeHeadlines {
  /** Published when the card is played. */
  start: string;
  /** Dripped out while the regime is active. */
  during: string[];
  /** Published when it ends. */
  end?: string;
}

/** Regime: becomes a `Regime` (shared/types.ts) for `quarters` quarters. */
export interface RegimeEffect {
  kind: 'regime';
  quarters: number;
  sectorDrift: Partial<Record<Sector, number>>;
  volMult: number;
  corrMult: number;
  /** Absolute change of the policy rate when it starts, e.g. 0.005 = two config.market.rateStep. */
  rateDelta?: number;
  headlines: RegimeHeadlines;
}

/**
 * Regime, multi-stage: a bill for the chosen sector. It passes with regimes.lobbyPassProbability at
 * the end of its last quarter; if it passes, the sector gets `driftIfPassed` per day for the rest of
 * the game.
 */
export interface LobbyingEffect {
  kind: 'lobbying';
  quarters: number;
  driftIfPassed: number;
  headlines: { start: string; delayed: string; passed: string; failed: string; beneficiary?: string };
}

/** Counter (stretch): debunks the newest active fake headline at once. */
export interface FactCheckEffect {
  kind: 'fact_check';
}

/** Counter (stretch): no orders on the chosen stock for cards.haltMs. */
export interface TradingHaltEffect {
  kind: 'trading_halt';
}

/** Counter (stretch): adds sec.heat[heat] to the richest other player. */
export interface SecTipOffEffect {
  kind: 'sec_tip_off';
  heat: HeatKey;
}

export type CardEffect =
  | InsiderTipEffect
  | EarningsPeekEffect
  | FakeHeadlineEffect
  | EventShockEffect
  | RegimeEffect
  | LobbyingEffect
  | FactCheckEffect
  | TradingHaltEffect
  | SecTipOffEffect;

export interface CardCatalogEntry extends CardDef {
  /** Multiplies the tier's cards.priceShareOfNetWorth. 1 = the tier's base price. */
  priceMult: number;
  /** Relative chance of being one of the cards.offersPerShop offers. */
  shopWeight: number;
  /** Heat the PLAYER takes when playing it; null for legal cards. */
  heat: HeatKey | null;
  effect: CardEffect;
}

/** Which effect kinds each tier may use. */
export const TIER_EFFECTS: Record<CardTier, readonly CardEffect['kind'][]> = {
  insider: ['insider_tip', 'earnings_peek'],
  fake: ['fake_headline'],
  event: ['event_shock'],
  regime: ['regime', 'lobbying'],
  counter: ['fact_check', 'trading_halt', 'sec_tip_off'],
};

/** Price of a card for a buyer with this net worth, $. */
export function cardPrice(config: GameConfig, entry: Pick<CardCatalogEntry, 'tier' | 'priceMult'>, netWorth: number): number {
  const share = config.cards.priceShareOfNetWorth[entry.tier] * entry.priceMult;
  return Math.max(config.cards.minPrice, share * Math.max(0, netWorth));
}

/** The public part of an entry (what goes into CardOffer / Card on the wire). */
export function toCardDef(entry: CardCatalogEntry): CardDef {
  const { defId, tier, name, description, legal, targetKind, needsDirection } = entry;
  return { defId, tier, name, description, legal, targetKind, needsDirection };
}

/** What a card's target must be, given its effect. */
function expectedTarget(effect: CardEffect): { targetKind: CardDef['targetKind']; needsDirection: boolean } {
  switch (effect.kind) {
    case 'insider_tip':
      return { targetKind: effect.focus === 'any' ? 'none' : effect.focus, needsDirection: false };
    case 'earnings_peek':
    case 'trading_halt':
      return { targetKind: 'stock', needsDirection: false };
    case 'fake_headline':
      return { targetKind: effect.scope === 'market' ? 'none' : effect.scope, needsDirection: true };
    case 'event_shock':
      return { targetKind: effect.scope === 'market' ? 'none' : effect.scope, needsDirection: false };
    case 'lobbying':
      return { targetKind: 'sector', needsDirection: false };
    case 'regime':
    case 'fact_check':
    case 'sec_tip_off':
      return { targetKind: 'none', needsDirection: false };
  }
}

/**
 * Returns every problem with a catalog (empty = fine): duplicate ids, an effect that does not fit
 * its tier or target, legality that disagrees with heat, numbers out of range, and headline
 * references that are missing or of the wrong kind. Fake and event cards also need at least one
 * matching headline in the database for every direction they can be played in.
 */
export function validateCardCatalog(entries: readonly CardCatalogEntry[], headlines: readonly HeadlineTemplate[], config: GameConfig): string[] {
  const problems: string[] = [];
  const byId = new Map(headlines.map((h) => [h.id, h]));
  const seen = new Set<string>();
  const heatKeys = Object.keys(config.sec.heat);
  const tiers = Object.keys(TIER_EFFECTS);

  const has = (kind: HeadlineTemplate['kind'], scope: HeadlineScope, direction: 'up' | 'down') =>
    headlines.some((h) => h.kind === kind && h.scope === scope && h.direction === direction);

  for (const e of entries) {
    const at = `card ${e.defId}`;
    if (!/^[a-z][a-z0-9_]*$/.test(e.defId)) problems.push(`${at}: defId must be snake_case`);
    if (seen.has(e.defId)) problems.push(`${at}: duplicate defId`);
    seen.add(e.defId);
    if (!tiers.includes(e.tier)) {
      problems.push(`${at}: unknown tier "${e.tier}"`);
      continue;
    }
    if (!e.name.trim() || e.name.length > 28) problems.push(`${at}: name must be 1..28 chars`);
    if (!e.description.trim() || e.description.length > 160) problems.push(`${at}: description must be 1..160 chars`);
    if (!(e.priceMult > 0)) problems.push(`${at}: priceMult must be > 0`);
    if (!(e.shopWeight > 0)) problems.push(`${at}: shopWeight must be > 0`);

    if (e.heat !== null && !heatKeys.includes(e.heat)) problems.push(`${at}: unknown heat key "${e.heat}"`);
    if (e.legal !== (e.heat === null)) problems.push(`${at}: legal cards have heat null, illegal cards a heat key`);
    if ((e.tier === 'insider' || e.tier === 'fake') && e.legal) problems.push(`${at}: ${e.tier} cards are illegal`);

    const fx = e.effect;
    if (!TIER_EFFECTS[e.tier].includes(fx.kind)) {
      problems.push(`${at}: effect "${fx.kind}" does not belong to tier ${e.tier}`);
      continue;
    }
    const want = expectedTarget(fx);
    if (e.targetKind !== want.targetKind) problems.push(`${at}: targetKind must be "${want.targetKind}" for this effect`);
    if (e.needsDirection !== want.needsDirection) problems.push(`${at}: needsDirection must be ${want.needsDirection}`);

    const ref = (id: string, kinds: HeadlineTemplate['kind'][], what: string) => {
      const h = byId.get(id);
      if (!h) problems.push(`${at}: ${what} headline "${id}" not found`);
      else if (!kinds.includes(h.kind)) problems.push(`${at}: ${what} headline "${id}" is kind ${h.kind}`);
    };
    const quartersOk = (q: number) => {
      if (!Number.isInteger(q) || q < config.regimes.minQuarters || q > config.regimes.maxQuarters) {
        problems.push(`${at}: quarters must be an integer ${config.regimes.minQuarters}..${config.regimes.maxQuarters}`);
      }
    };

    switch (fx.kind) {
      case 'insider_tip':
        if (!(fx.leadMult > 0)) problems.push(`${at}: leadMult must be > 0`);
        break;
      case 'fake_headline':
        for (const d of ['up', 'down'] as const) {
          if (!has('fake_template', fx.scope, d)) problems.push(`${at}: no fake_template headline for ${fx.scope}/${d}`);
          const reverse = d === 'up' ? 'down' : 'up';
          if (!has('debunk', fx.scope, reverse)) problems.push(`${at}: no debunk headline for ${fx.scope}/${reverse}`);
        }
        break;
      case 'event_shock':
        if (!has('event', fx.scope, fx.direction)) problems.push(`${at}: no event headline for ${fx.scope}/${fx.direction}`);
        break;
      case 'regime': {
        quartersOk(fx.quarters);
        if (!(fx.volMult > 0) || !(fx.corrMult > 0)) problems.push(`${at}: volMult and corrMult must be > 0`);
        for (const [s, d] of Object.entries(fx.sectorDrift)) {
          if (!SECTORS.includes(s as Sector)) problems.push(`${at}: unknown sector "${s}"`);
          if (typeof d !== 'number' || Math.abs(d) > 0.01) problems.push(`${at}: drift for ${s} must be within +-0.01 per day`);
        }
        ref(fx.headlines.start, ['real'], 'start');
        fx.headlines.during.forEach((id) => ref(id, ['real'], 'during'));
        if (fx.headlines.end) ref(fx.headlines.end, ['real'], 'end');
        break;
      }
      case 'lobbying':
        quartersOk(fx.quarters);
        if (!(fx.driftIfPassed > 0) || fx.driftIfPassed > 0.01) problems.push(`${at}: driftIfPassed must be in (0, 0.01]`);
        for (const [what, id] of Object.entries(fx.headlines)) ref(id, ['real'], what);
        break;
      case 'sec_tip_off':
        if (!heatKeys.includes(fx.heat)) problems.push(`${at}: unknown heat key "${fx.heat}"`);
        break;
      case 'earnings_peek':
      case 'fact_check':
      case 'trading_halt':
        break;
    }
  }

  for (const tier of tiers as CardTier[]) {
    if (tier !== 'counter' && !entries.some((e) => e.tier === tier)) problems.push(`no ${tier} card in the catalog`);
  }
  return problems;
}
