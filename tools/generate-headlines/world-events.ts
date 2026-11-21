import type { HeadlineCategory, HeadlineScope } from '../../shared/types.ts';

type Event = readonly [HeadlineCategory, string];
export const worldEvents: Record<HeadlineScope, Record<string, readonly Event[]>> = {
  stock: {
    'up/small': [
      ['exec', 'reduces routine OPERATION overtime with a new shift handoff'],
      ['regime_followup', 'sees a modest lift in sales of PRODUCT as the backlog clears'],
    ],
    'up/medium': [
      ['contract', 'ends an expensive exclusive supplier deal and finds a cheaper source for PRODUCT'],
      ['legal', 'gets a material insurance payout for an earlier OPERATION fire'],
      ['absurd', 'turns mistaken shipments of PRODUCT into a profitable subscription box'],
      ['absurd', 'wins a regional deal for PRODUCT after the buyers dare each other to order the deluxe package'],
    ],
    'up/large': [
      ['legal', 'wins a major patent case and collects years of royalties on PRODUCT'],
      ['product', 'cuts its OPERATION costs sharply after a pilot replaces a costly manual process'],
    ],
    'up/huge': [
      ['legal', 'avoids liquidation after a court voids guarantees tied to its OPERATION debts'],
      ['contract', 'wins exclusive rights to supply PRODUCT to the largest regional buyer for a decade'],
    ],
    'down/small': [
      ['exec', 'books a small charge after underestimating weekend staffing for OPERATION'],
      ['product', 'offers small refunds after printing the wrong set-up instructions for PRODUCT'],
    ],
    'down/medium': [
      ['exec', 'replaces its finance chief and warns an OPERATION write-off is larger than expected'],
      ['macro', 'absorbs a material cost increase on PRODUCT after its currency hedge expires'],
      ['absurd', 'writes off a shipment of PRODUCT after the warehouse uses confetti cannons for inventory control'],
      ['absurd', 'loses a regional deal for PRODUCT after the sales team invoices a customer for the free demo twice'],
    ],
    'down/large': [
      ['product', 'scraps a flagship rollout of PRODUCT after distributor testing reveals a costly design flaw'],
      ['exec', 'loses most of its OPERATION capacity after contractors walk out over unpaid invoices'],
    ],
    'down/huge': [
      ['legal', 'faces insolvency after a court attaches its OPERATION assets to an unpaid judgment'],
      ['exec', 'misses a debt repayment after discovering the cash raised for PRODUCT was counted twice'],
    ],
    'neutral/small': [
      ['exec', 'moves its OPERATION town hall online and keeps the existing agenda'],
      ['legal', 'updates the headings on its RULE compliance form without changing requirements'],
    ],
    'neutral/medium': [
      ['exec', 'holds its annual board vote and keeps its OPERATION budget and leadership unchanged'],
      ['product', 'switches the display units in its PRODUCT catalog without changing specs or prices'],
    ],
  },
  sector: {
    'up/small': [['macro', 'sees a small drop in borrowing costs for OPERATION projects']],
    'up/medium': [
      ['legal', 'gains a sizable tax credit for replacing aging OPERATION equipment'],
      ['regime_followup', 'sees a material boost as a key shipping lane reopens for PRODUCT'],
      ['absurd', 'wins meaningful new orders for PRODUCT after a quiz show mistakes it for the grand prize'],
    ],
    'up/large': [
      ['legal', 'reopens a major trade route for PRODUCT after an arbitration tribunal lifts restrictions'],
      ['regime_followup', 'sees a major productivity boost as a bottleneck in OPERATION equipment clears'],
    ],
    'up/huge': [['contract', 'wins a sweeping public purchase guarantee that saves suppliers of PRODUCT from liquidation']],
    'down/small': [['contract', 'sees minor cancellations for PRODUCT after an industry expo is postponed']],
    'down/medium': [
      ['macro', 'sees the cost of OPERATION financing rise sharply after an insurer cuts its coverage'],
      ['product', 'faces a substantial recall of shared components used across PRODUCT suppliers'],
    ],
    'down/large': [
      ['legal', 'faces a major retrofit bill under new RULE requirements'],
      ['regime_followup', 'faces widespread OPERATION strikes after joint wage talks collapse'],
    ],
    'down/huge': [['macro', 'faces mass closures after a nationwide freeze in credit for OPERATION projects']],
    'neutral/small': [['exec', 'publishes a glossary for PRODUCT buyers without changing terms']],
    'neutral/medium': [['macro', 'sees its long-term OPERATION forecast reaffirmed as statisticians revise the reporting calendar']],
  },
  market: {
    'up/small': [
      ['contract', 'Small business orders edge higher after a wet spring'],
      ['macro', 'A short cold snap lifts household spending on utilities slightly'],
      ['legal', 'A narrow waiver reduces the fee on low-value cross-border packages'],
      ['macro', 'Lower freight costs take some pressure off food prices'],
      ['absurd', 'Retail spending edges up after a misplaced minus sign discounts store deliveries'],
    ],
    'up/medium': [
      ['macro', 'Businesses revive postponed projects after banks lower loan rates'],
      ['macro', 'Lower diesel costs give truckers and retailers room to cut transport surcharges'],
      ['absurd', 'A national tax amnesty brings in more revenue than expected after the website adds a pay your grudges button'],
      ['legal', 'A court overturns a tax on cross-border services, lifting business margins'],
      ['regime_followup', 'A labor deal restores parcel service nationwide and cuts backlogs'],
    ],
    'up/large': [
      ['macro', 'A nationwide construction package jolts stalled hiring and investment back to life'],
      ['regime_followup', 'Port operators agree to reopen a key shipping channel, clearing a nationwide backlog'],
      ['macro', 'A broad drop in energy prices sharply lowers industrial costs and household bills'],
      ['legal', 'An emergency court ruling lifts a costly freeze on commercial shipments'],
      ['absurd', 'Parliament passes a massive investment bill after discovering abstentions count as yes votes'],
    ],
    'up/huge': [
      ['macro', 'A last-minute currency swap keeps banks solvent and reopens the payments system'],
      ['legal', 'A last-minute trade accord averts a threatened blockade of the main export terminals'],
      ['macro', 'A multiyear bailout pledges enough capital to reopen failed lenders nationwide'],
      ['legal', 'A regional court voids sovereign guarantees that threatened to bankrupt the treasury'],
      ['absurd', 'A national bank rescue succeeds after the missing reserves turn up in a spreadsheet tab named DO NOT OPEN'],
    ],
    'down/small': [
      ['macro', 'Survey shows retailers trim seasonal hiring as food prices edge higher'],
      ['legal', 'A small parcel inspection fee nudges online delivery charges higher'],
      ['macro', 'Employers post slightly fewer openings after a month of weaker orders'],
      ['absurd', 'Consumer spending slips as shoppers wait for a viral coupon that expires before the sale starts'],
      ['regime_followup', 'A delayed ferry reopening nudges freight rates higher on nearby routes'],
    ],
    'down/medium': [
      ['macro', 'Insurers raise rates across business lines after a costly storm season'],
      ['macro', 'The currency slides and pushes up imported food and fuel bills'],
      ['regime_followup', 'A shipping strike forces retailers to absorb a material rise in freight charges'],
      ['legal', 'A new cross-border levy sends import bills climbing and cuts retail margins'],
      ['absurd', 'National consumer confidence sinks after automated bank statements start rating purchases out of ten'],
    ],
    'down/large': [
      ['regime_followup', 'A nationwide freight strike disrupts deliveries and stalls factory output'],
      ['legal', 'A trade court blocks public procurement spending across dozens of nationwide projects'],
      ['macro', 'A major surge in electricity costs forces manufacturers to scale back output'],
      ['macro', 'The national currency sinks and pushes import bills sharply higher'],
      ['absurd', 'A nationwide business shutdown gathers pace after a payroll patch treats Thursdays as unpaid holidays'],
    ],
    'down/huge': [
      ['macro', 'The largest clearing bank fails and leaves businesses unable to settle invoices nationwide'],
      ['regime_followup', 'An indefinite closure of the main trade corridor severs the economy from its largest buyers'],
      ['macro', 'Emergency rationing grinds industrial production and commercial transport to a halt'],
      ['legal', 'A court freeze on bank collateral blocks lending across the economy'],
      ['absurd', 'A national bank run starts when an automated teller announces the reserves are mostly gift cards'],
    ],
    'neutral/small': [
      ['regime_followup', 'The statistics office moves its jobs report by a day and keeps prior figures unchanged'],
      ['macro', 'Updated payroll methods leave the latest jobs figures intact'],
      ['legal', 'Customs renames its online tariff portal without changing charges'],
      ['exec', 'National pension board publishes its minutes with investment policy unchanged'],
      ['macro', 'The treasury reopens a routine bond sale at its previously announced terms'],
      ['regime_followup', 'The monthly logistics survey shows no change in average delivery times'],
      ['absurd', 'The finance minister denies the size of the deficit is measured in vibes'],
    ],
    'neutral/medium': [
      ['legal', 'The treasury changes bond auction hours while leaving issuance unchanged'],
      ['macro', 'The revised growth estimate leaves the expected inflation path unchanged'],
      ['exec', 'Bank supervisors shuffle exam dates without changing capital requirements'],
      ['regime_followup', 'A revised holiday calendar leaves the number of trading days unchanged'],
      ['legal', 'A consolidated tax guide reorders instructions without changing exemptions'],
      ['absurd', 'The central bank confirms rates will remain on hold after losing the ceremonial rate scissors'],
    ],
  },
};
