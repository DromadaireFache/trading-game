import { SECTOR_LABELS } from '../../shared/types.ts';
import type { Slice } from '../../shared/headlines.ts';

export interface Brief extends Slice {
  core: string;
  family: string;
  choices: string[];
}

export const SYSTEM_PROMPT = `You are the editor of a fictional business wire for a trading game. For each numbered brief, choose the best headline from the given options. Prefer vivid, specific stories and natural newspaper rhythm. Vary the opening and sentence structure within the batch. For comedy, use a straight-faced delivery and put the ridiculous fact where it lands best. Keep every assigned company, industry and economic event intact. Output only NUMBER|HEADLINE, one line per brief. Copy the chosen wording exactly with its literal game slots.`;

export function buildPrompt(briefs: Brief[]): string {
  const first = briefs[0]!;
  return [
    first.sector ? `Industry: ${SECTOR_LABELS[first.sector]}. Scope: ${first.scope}.` : 'Scope: broad economy.',
    ...briefs.map((brief, index) => [
      `${index + 1}. ${brief.direction}/${brief.magnitude}${brief.category === 'absurd' ? ' COMEDY' : ''}:`,
      ...brief.choices.map((choice) => `- ${choice}`),
    ].join('\n')),
  ].join('\n');
}

/** Each row is one of the finite, complete headlines approved for that story. */
export function outputGrammar(briefs: Brief[]): string {
  const rows = briefs.map((brief, index) =>
    `row${index} ::= "${index + 1}|" (${brief.choices.map((choice) => JSON.stringify(choice)).join(' | ')}) "."`);
  return [`root ::= ${briefs.map((_, index) => `row${index}`).join(' "\\n" ')}`, ...rows].join('\n');
}

export function parseLines(reply: string, count: number): Map<number, string> {
  const parsed = new Map<number, string>();
  const duplicates = new Set<number>();
  for (const line of reply.replace(/<think>[\s\S]*?<\/think>/g, '').split(/\r?\n/)) {
    const match = /^\s*(\d+)\s*\|\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= count || duplicates.has(index)) continue;
    if (parsed.has(index)) {
      parsed.delete(index);
      duplicates.add(index);
    } else {
      parsed.set(index, match[2]!);
    }
  }
  return parsed;
}

export function cleanHeadline(line: string, brief: Brief): string | undefined {
  const text = line.slice(0, -1);
  return line.endsWith('.') && brief.choices.includes(text) ? text : undefined;
}
