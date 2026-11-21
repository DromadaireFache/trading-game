import { comedy } from './comedy.ts';
import { beats } from './beats.ts';
import { worldEvents } from './world-events.ts';
import type { HeadlineCategory } from '../../shared/types.ts';
import type { HeadlineBucket } from '../../shared/headlines.ts';

type Recipe = readonly [category: HeadlineCategory, core: string];
export type Story = { category: HeadlineCategory; premise: string; family: string };
const stock: Record<string, Recipe[]> = {
  'up/small': [
    ['contract', 'lands a small add-on order for PRODUCT'],
    ['product', 'cuts the cost of offering PRODUCT slightly'],
    ['exec', 'trims routine OPERATION expenses under a new cost plan'],
    ['absurd', 'earns a small windfall after a novelty edition of PRODUCT sells out'],
  ],
  'up/medium': [
    ['legal', 'avoids a material penalty in settlement over RULE'],
    ['contract', 'lands a profitable regional deal for PRODUCT'],
    ['product', 'reports stronger-than-expected margins on PRODUCT'],
    ['earnings_leak', 'looks set to beat profit forecasts on sales of PRODUCT, leaked memo suggests'],
  ],
  'up/large': [
    ['contract', 'wins a major multiyear contract for PRODUCT'],
    ['product', 'unlocks a major market for PRODUCT with regulatory approval'],
    ['exec', 'raises annual profit outlook sharply on demand for PRODUCT'],
    ['macro', 'receives major new subsidies for its OPERATION expansion'],
    ['earnings_leak', 'expects a record quarter in PRODUCT, leaked orders suggest'],
  ],
  'up/huge': [
    ['exec', 'receives a takeover bid at a steep premium for its business in PRODUCT'],
    ['macro', 'secures a rescue package that saves its business in PRODUCT from collapse'],
    ['product', 'gains exclusive rights to a breakthrough in PRODUCT'],
    ['legal', 'wins court ruling that reopens its biggest market for PRODUCT'],
  ],
  'down/small': [
    ['contract', 'loses a small trial order for PRODUCT'],
    ['legal', 'pays a minor fine over RULE compliance'],
    ['product', 'delays a minor update to PRODUCT'],
    ['absurd', 'takes a small cleanup charge after a novelty display disrupts its OPERATION site'],
  ],
  'down/medium': [
    ['contract', 'loses a profitable regional deal for PRODUCT'],
    ['legal', 'faces a material fine over RULE requirements'],
    ['product', 'pulls a major offering of PRODUCT after safety complaints'],
    ['earnings_leak', 'looks set to miss profit forecasts on sales of PRODUCT, leaked memo suggests'],
  ],
  'down/large': [
    ['contract', 'loses a major multiyear contract for PRODUCT'],
    ['legal', 'must suspend its main OPERATION site after an adverse safety ruling'],
    ['exec', 'slashes annual profit outlook as demand for PRODUCT falls'],
    ['regime_followup', 'cancels its flagship OPERATION project as funding dries up'],
    ['earnings_leak', 'braces for a severe profit miss as orders for PRODUCT collapse, leaked memo shows'],
  ],
  'down/huge': [
    ['legal', 'loses its license in the largest market for PRODUCT'],
    ['exec', 'warns the collapse of its business in PRODUCT could force bankruptcy'],
    ['product', 'halts worldwide sales of PRODUCT over a critical defect'],
    ['macro', 'loses emergency funding for its core business in PRODUCT'],
  ],
  'neutral/small': [
    ['product', 'updates its PRODUCT catalog with prices and offerings unchanged'],
    ['exec', 'moves its routine OPERATION briefing to a new date'],
    ['absurd', 'unveils a mascot at its OPERATION site'],
  ],
  'neutral/medium': [
    ['product', 'rebrands PRODUCT with pricing and production unchanged'],
    ['exec', 'confirms its existing OPERATION plan at annual meeting'],
    ['legal', 'files its routine RULE disclosure with no changes'],
  ],
};

const sector: Record<string, Recipe[]> = {
  'up/small': [['macro', 'sees modest savings on OPERATION costs'], ['product', 'reports a small rise in demand for PRODUCT'], ['contract', 'picks up a small batch of public orders for PRODUCT']],
  'up/medium': [['legal', 'welcomes lower RULE fees across the industry'], ['contract', 'lands a meaningful boost from new public orders for PRODUCT'], ['macro', 'sees healthier margins as financing costs fall for OPERATION projects']],
  'up/large': [['product', 'sees demand for PRODUCT surge after a wave of new orders'], ['legal', 'gains major new access to foreign buyers of PRODUCT'], ['contract', 'wins a major wave of multiyear orders for PRODUCT']],
  'up/huge': [['macro', 'secures a sweeping rescue plan for suppliers of PRODUCT'], ['legal', 'gains unrestricted access to a vast new market for PRODUCT'], ['product', 'unlocks a vast new market for PRODUCT with a breakthrough']],
  'down/small': [['macro', 'sees a modest rise in OPERATION costs'], ['product', 'reports slightly weaker seasonal demand for PRODUCT'], ['legal', 'faces a small increase in RULE fees']],
  'down/medium': [['legal', 'faces a material rise in RULE compliance costs'], ['contract', 'sees regional buyers postpone orders for PRODUCT'], ['regime_followup', 'faces a sustained rise in insurance costs for OPERATION sites']],
  'down/large': [['macro', 'faces major OPERATION disruption as key suppliers shut down'], ['contract', 'loses a major source of demand for PRODUCT'], ['legal', 'faces sweeping new licensing barriers for providers of PRODUCT']],
  'down/huge': [['legal', 'is shut out of its biggest foreign market for PRODUCT'], ['macro', 'faces widespread insolvency as emergency funding for PRODUCT suppliers expires'], ['regime_followup', 'faces a potential collapse as demand for PRODUCT evaporates']],
  'neutral/small': [['product', 'renames a trade show for PRODUCT without changing its program'], ['absurd', 'picks a mascot for its annual PRODUCT expo'], ['exec', 'schedules its regular OPERATION forum']],
  'neutral/medium': [['legal', 'publishes a new RULE filing guide with existing requirements intact'], ['exec', 'confirms its annual OPERATION plan and targets remain unchanged'], ['contract', 'renames its industry directory for PRODUCT suppliers without changing listings']],
};

const market: Record<string, Recipe[]> = {
  'up/small': [['macro', 'Inflation cools slightly as routine costs ease'], ['regime_followup', 'Consumer confidence edges higher after a steady jobs report'], ['macro', 'Household spending edges higher on a modest improvement in wages']],
  'up/medium': [['macro', 'Borrowing costs drop after a surprise rate cut'], ['legal', 'Businesses gain a material tax break under a new budget'], ['macro', 'A surprise easing in credit rules lowers business funding costs']],
  'up/large': [['macro', 'A major stimulus package boosts demand across the economy'], ['regime_followup', 'A sweeping trade deal removes the largest barriers to exports'], ['macro', 'Emergency liquidity measures sharply ease a major credit crunch']],
  'up/huge': [['macro', 'Emergency rescue averts collapse of the national credit system'], ['regime_followup', 'A historic debt accord pulls the economy back from default'], ['legal', 'A landmark settlement ends the nationwide freeze on bank withdrawals']],
  'down/small': [['macro', 'Inflation edges up on a modest rise in service costs'], ['regime_followup', 'Consumer confidence slips slightly as household budgets tighten'], ['macro', 'Retail spending slips as wage growth cools slightly']],
  'down/medium': [['macro', 'A surprise rate hike pushes borrowing costs materially higher'], ['legal', 'A broad tax increase squeezes business margins and household budgets'], ['regime_followup', 'Persistent inflation leads businesses to cut hiring plans materially']],
  'down/large': [['macro', 'A sudden credit crunch forces businesses to shelve expansion plans'], ['regime_followup', 'Sweeping trade barriers disrupt commerce across the economy'], ['macro', 'A steep drop in consumer spending raises the risk of recession']],
  'down/huge': [['macro', 'A sovereign default brings the national credit system to a standstill'], ['regime_followup', 'A systemic funding collapse freezes borrowing across the economy'], ['legal', 'Emergency capital controls freeze most international payments']],
  'neutral/small': [['macro', 'Monthly price report leaves inflation expectations unchanged'], ['absurd', 'Economists trade jokes at annual outlook conference without changing forecasts'], ['macro', 'Routine currency report shows officials made no policy changes']],
  'neutral/medium': [['legal', 'Budget office updates publication dates and keeps fiscal plans unchanged'], ['macro', 'Central bank reaffirms its existing rate outlook ahead of routine meeting'], ['exec', 'New statistics chief keeps the current release schedule and methods']],
};

export function catalysts(bucket: HeadlineBucket): Story[] {
  const key = `${bucket.direction}/${bucket.magnitude}`;
  const jokes = comedy[bucket.scope][key]!.map((core): Recipe => ['absurd', core]);
  const list = [...{ stock, sector, market }[bucket.scope][key]!, ...worldEvents[bucket.scope][key]!, ...jokes];
  return list.flatMap(([category, family]) => {
    const profile = bucket.sector ? beats[bucket.sector] : undefined;
    if (!profile) return [{ category, premise: family, family }];
    const { product, operation, rule } = profile;
    const count = Math.max(
      family.includes('PRODUCT') ? product.length : 1,
      family.includes('OPERATION') ? operation.length : 1,
      family.includes('RULE') ? rule.length : 1,
    );
    const variants = new Set(Array.from({ length: count }, (_, i) =>
      family.replaceAll('PRODUCT', product[i % product.length]!)
        .replaceAll('OPERATION', operation[i % operation.length]!)
        .replaceAll('RULE', rule[i % rule.length]!)));
    return [...variants].map((premise) => ({ category, premise, family }));
  });
}
