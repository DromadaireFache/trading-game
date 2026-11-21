import type { HeadlineScope } from '../../shared/types.ts';

/** Deadpan game news. Each joke still has a catalyst at the assigned scale. */
export const comedy: Record<HeadlineScope, Record<string, readonly string[]>> = {
  stock: {
    'up/small': [
      'earns a small licensing fee after its OPERATION mascot goes viral',
      'logs a modest boost in sales of PRODUCT after a prank ad catches on',
    ],
    'up/medium': [
      'wins a lucrative deal for PRODUCT after its demo accidentally works upside down',
      'turns a costly typo into a profitable new line of PRODUCT',
      'gets a material boost in sales of PRODUCT after a rival calls it uncool',
    ],
    'up/large': [
      'lands a flagship deal for PRODUCT after its mascot upstages the competition',
      'raises its profit outlook sharply after a parody of PRODUCT becomes a runaway hit',
    ],
    'up/huge': [
      'draws a takeover bid at a steep premium after its joke version of PRODUCT becomes a global hit',
      'escapes bankruptcy as fans of its OPERATION mascot bankroll an emergency rescue',
    ],
    'down/small': [
      'eats a small bill after a goat chews through cables at its OPERATION site',
      'pays a minor fine after its OPERATION mascot is spotted driving a forklift',
      'refunds a small batch of orders for PRODUCT after sending buyers rubber ducks instead',
    ],
    'down/medium': [
      'loses a lucrative PRODUCT deal after a snake bites {CEO} on the dick',
      'takes a costly production hit after confetti jams equipment at its OPERATION site',
      'loses a regional contract for PRODUCT after its bidding bot asks for payment in sandwiches',
    ],
    'down/large': [
      'loses its flagship contract for PRODUCT after mistakenly auctioning it off for a single coin',
      'shuts its main OPERATION site after a foam party floods the control room',
    ],
    'down/huge': [
      'faces bankruptcy after a prank coupon wipes out margins on PRODUCT worldwide',
      'loses its license in its biggest market for PRODUCT after filing paperwork signed by a goat',
    ],
    'neutral/small': [
      'reschedules its OPERATION ribbon cutting after a goose steals the scissors',
      'names a cardboard cutout acting mascot at its OPERATION site',
      'ends its PRODUCT briefing early when {CEO} gets trapped in a mascot costume',
    ],
    'neutral/medium': [
      'keeps its OPERATION plans unchanged after the board votes to ban swivel chair racing',
      'keeps prices unchanged after renaming PRODUCT in honor of a stray office cat',
    ],
  },
  sector: {
    'up/small': [
      'sees a small rise in orders for PRODUCT after a typo turns into a meme',
      'sees minor OPERATION savings after trading expense reports for vending machine snacks',
    ],
    'up/medium': [
      'gets substantial new orders for PRODUCT after a trivia show gives away the wrong prize',
      'welcomes material OPERATION savings after replacing mandatory retreats with a group email',
    ],
    'up/large': [
      'sees a surge in orders for PRODUCT after a blockbuster uses it as a running gag',
      'wins major new subsidies for OPERATION projects after a lobbying mascot becomes a folk hero',
    ],
    'up/huge': [
      'secures a sweeping rescue for suppliers of PRODUCT after a mascot telethon breaks donation records',
      'unlocks a vast new market for PRODUCT after customs lifts its ban on novelty packaging',
    ],
    'down/small': [
      'faces minor OPERATION delays after inspectors chase a goose through the main trade fair',
      'sees a small rise in returns of PRODUCT after customers mistake the manual for a coupon',
    ],
    'down/medium': [
      'faces a material rise in OPERATION costs after an insurer excludes damage from rogue livestock',
      'loses significant orders for PRODUCT after distributors discover an extra zero in a group quote',
    ],
    'down/large': [
      'faces a major OPERATION stoppage after shared dispatch software sends every truck to a wedding',
      'loses a major market for PRODUCT after an industry certification exam is leaked on a quiz show',
    ],
    'down/huge': [
      'faces sweeping export bans on PRODUCT after safety certificates are traced to a sock puppet',
      'faces widespread insolvency after a group buyer of PRODUCT pays suppliers in arcade tokens',
    ],
    'neutral/small': [
      'pauses its OPERATION expo after a goat walks off with the opening speech',
      'names a rubber duck official mascot for its PRODUCT trade show',
    ],
    'neutral/medium': [
      'keeps OPERATION targets unchanged after a convention vote to replace speeches with karaoke',
      'leaves prices and specs for PRODUCT unchanged after a trade show awards itself a trophy',
    ],
  },
  market: {
    'up/small': [
      'Retail spending edges up after a spelling error makes coupons trend',
      'Business confidence inches higher after payroll software stops sending warning sirens',
    ],
    'up/medium': [
      'A glitch turns off an unpopular transaction tax and lawmakers vote to keep it off',
      'Consumer spending jumps after a tax rebate is reissued as a romance scam awareness payment',
    ],
    'up/large': [
      'A sweeping trade deal removes costly tariffs after negotiators settle a decade-long spat over napkins',
      'A major spending bill passes after lawmakers discover the filibuster microphone is unplugged',
    ],
    'up/huge': [
      'A record bank rescue averts national collapse after bondholders agree to accept lunch vouchers as collateral',
      'A historic debt deal averts default after negotiators find the repayment calendar was printed backward',
    ],
    'down/small': [
      'Retail sales slip slightly after coupon apps direct shoppers to a parking lot',
      'Consumer confidence dips after a budget calculator labels every household expense a treat',
    ],
    'down/medium': [
      'A surprise rate hike raises borrowing costs after a central banker gets a decimal point tattoo',
      'A widespread coupon printer outage dents national retail sales',
    ],
    'down/large': [
      'A sweeping trade embargo hits exports after customs starts accepting only handwritten paperwork in triplicate',
      'A nationwide payment freeze forces businesses to shelve expansion after banks forget a shared password',
    ],
    'down/huge': [
      'The national credit system seizes up after auditors discover its collateral is a mountain of arcade tickets',
      'A sovereign default freezes lending after officials wire the emergency reserve to a prize draw',
    ],
    'neutral/small': [
      'Bond traders keep rate bets unchanged after the central bank introduces its emotional support cactus',
      'Monthly inflation forecasts hold steady as statisticians replace their pie chart with an actual pie',
    ],
    'neutral/medium': [
      'The central bank leaves rates unchanged after an intern accidentally plays a drumroll',
      'Budget forecasts hold steady after lawmakers debate the font size of the deficit',
    ],
  },
};
