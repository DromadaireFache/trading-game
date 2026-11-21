import { TEXT_MAX } from '../../shared/headlines.ts';
import type { Slice } from '../../shared/headlines.ts';

const qualifiers = { real: '', event: '', fake_template: 'Rumor: ', debunk: 'Fact check: ' } as const;
const subjects = { stock: '{COMPANY} ', sector: 'The {SECTOR} sector ', market: '' } as const;

const variants: Record<Slice['category'], readonly string[]> = {
  contract: ['in {CITY}', 'under a municipal tender', 'on a cross-border bid', 'at an industry showcase'],
  product: ['in {CITY}', 'during retail trials', 'in a pilot run', 'in its overseas business'],
  legal: ['in {CITY}', 'under a ruling from {GOV_AGENCY}', 'in an appellate ruling', 'in the country\'s largest trading hub'],
  exec: ['in {CITY}', 'in a closed-door board vote', 'on the night shift', 'at the annual board retreat'],
  macro: ['in {COUNTRY}', 'in the border provinces', 'across coastal territories', 'in major port cities'],
  regime_followup: ['in {COUNTRY}', 'in the capital region', 'on key freight corridors', 'in the northern provinces'],
  earnings_leak: ['in {COUNTRY}', 'in an internal draft', 'in a memo sent to suppliers', 'in numbers circulated to the board'],
  absurd: ['in {CITY}', 'on a live trade show feed', 'during the televised demo', 'on a shareholder webcast', 'during the night shift'],
};

export interface HeadlineForms {
  plain: string[];
  contextual: string[];
}

/** Keep the whole event legible. Context goes before the fact, so there is no free-form tail. */
export function headlineForms(core: string, bucket: Slice): HeadlineForms {
  const subject = subjects[bucket.scope];
  const body = subject + core;
  const inSentence = (text: string) => bucket.scope === 'stock' ? text : text[0]!.toLowerCase() + text.slice(1);
  const pivot = / (after|as|when|following) /.exec(core);
  const plain = [body];
  if (pivot && pivot.index > 15 && core.length - pivot.index > 16) {
    const cause = core.slice(pivot.index + pivot[0].length);
    const connector = pivot[1]!;
    const head = inSentence(subject + core.slice(0, pivot.index));
    plain.push(`${connector[0]!.toUpperCase()}${connector.slice(1)} ${cause}, ${head}`);
  }
  const context = variants[bucket.category];
  const contextual = context.map((where) => {
    const intro = where[0]!.toUpperCase() + where.slice(1);
    const tail = inSentence(body);
    return `${intro}, ${tail}`;
  });
  function finish(options: string[]): string[] {
    return [...new Set(options.map((text) => qualifiers[bucket.kind] + text))].filter((text) => text.length <= TEXT_MAX);
  }
  return { plain: finish(plain), contextual: finish(contextual) };
}
