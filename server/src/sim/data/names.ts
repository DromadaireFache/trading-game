/**
 * ALL name material of the universe lives in this one file, so the design track can replace it
 * without touching the generator (../universe.ts).
 *
 * Rules:
 * - FAKE NAMES ONLY. No real companies, brands, people, countries or leaders.
 * - Pure data: no logic, no randomness. The generator picks from these lists with the seeded RNG,
 *   so the same seed always gives the same companies.
 * - Each sector needs at least config.market.companiesPerSector entries in `stems` (more = more
 *   variety between seeds). A company name is "<stem> <suffix>", e.g. "Quorbit Systems".
 * - Tickers are derived from the stem (first letters, upper case, made unique by the generator),
 *   so keep stems pronounceable and starting with different letters where possible.
 * - Fund tickers are fixed here; the generator never gives a company one of them.
 */
import type { Sector } from '@tg/shared';

export interface SectorNames {
  /** Invented company stems. */
  stems: readonly string[];
  /** Second word of the company name. */
  suffixes: readonly string[];
}

export const SECTOR_NAMES: Record<Sector, SectorNames> = {
  tech: {
    stems: ['Quorbit', 'Zentrix', 'Nimbara', 'Pixelon', 'Voltaris', 'Synthara', 'Hexware', 'Lumorix', 'Bytewell', 'Kryovex'],
    suffixes: ['Systems', 'Labs', 'Cloud', 'Micro', 'Software', 'Networks'],
  },
  energy: {
    stems: ['Petrovia', 'Sunforge', 'Gasmere', 'Windrow', 'Corefire', 'Deepwell', 'Fluxora', 'Brinmoor', 'Ohmstead', 'Tidalis'],
    suffixes: ['Energy', 'Power', 'Petroleum', 'Renewables', 'Resources', 'Grid'],
  },
  defense: {
    stems: ['Ironvale', 'Aegivar', 'Bastivar', 'Stratovar', 'Halberion', 'Rampartis', 'Vanguarda', 'Sentrix', 'Kestrava', 'Bulwarden'],
    suffixes: ['Defense', 'Aerospace', 'Dynamics', 'Armaments', 'Systems', 'Tactical'],
  },
  airlines: {
    stems: ['Skylarka', 'Aerovia', 'Cirrovia', 'Jetmoor', 'Altaire', 'Meridoux', 'Nordwing', 'Zephyra', 'Nimbojet', 'Cloudhop'],
    suffixes: ['Airways', 'Air', 'Airlines', 'Aviation', 'Express', 'Wings'],
  },
  finance: {
    stems: ['Goldmere', 'Fidelmont', 'Norbanque', 'Crestline', 'Sterlow', 'Vaultis', 'Harborview', 'Pennymoor', 'Lombarde', 'Equivane'],
    suffixes: ['Financial', 'Capital', 'Bancorp', 'Trust', 'Insurance', 'Partners'],
  },
  health: {
    stems: ['Medivane', 'Curelia', 'Biosyra', 'Vitalune', 'Panacera', 'Genovex', 'Helixon', 'Remedora', 'Neurava', 'Carewell'],
    suffixes: ['Pharma', 'Biotech', 'Health', 'Therapeutics', 'Medical', 'Labs'],
  },
};

/** CEO name = "<first> <last>". Invented, not real people. */
export const CEO_FIRST_NAMES: readonly string[] = [
  'Astrid', 'Balthazar', 'Cordelia', 'Dashiell', 'Elspeth', 'Fitzgerald', 'Gwendolyn', 'Horatio',
  'Imogen', 'Jasper', 'Katarina', 'Leopold', 'Marguerite', 'Nikolai', 'Ottoline', 'Percival',
  'Quentin', 'Rosalind', 'Sebastian', 'Tabitha', 'Ulysses', 'Valentina', 'Wolfgang', 'Xanthe',
];

export const CEO_LAST_NAMES: readonly string[] = [
  'Abernathy', 'Blackwood', 'Castellane', 'Drummond', 'Everhart', 'Fairweather', 'Grimsby', 'Hollis',
  'Ironside', 'Jellico', 'Kingsley', 'Lockhart', 'Montague', 'Nightingale', 'Oakenshaw', 'Pemberton',
  'Quillfeather', 'Ravenscroft', 'Stonebridge', 'Thistlewood', 'Underhill', 'Vandermeer', 'Whitlock', 'Yarrow',
];

/** The index fund (all companies). */
export const INDEX_FUND = { symbol: 'TG30', name: 'Total Market 30' } as const;

/** One sector fund per sector. Tickers start with X so they stand out in the list. */
export const SECTOR_FUNDS: Record<Sector, { symbol: string; name: string }> = {
  tech: { symbol: 'XTEC', name: 'Technology Fund' },
  energy: { symbol: 'XNRG', name: 'Energy Fund' },
  defense: { symbol: 'XDEF', name: 'Defense Fund' },
  airlines: { symbol: 'XAIR', name: 'Airlines Fund' },
  finance: { symbol: 'XFIN', name: 'Finance Fund' },
  health: { symbol: 'XHLT', name: 'Healthcare Fund' },
};
