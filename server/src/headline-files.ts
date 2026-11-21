/** Filesystem boundary for the offline headline catalog. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHeadlineFile } from '../../shared/headlines.ts';
import { SECTORS } from '../../shared/types.ts';
import type { HeadlineTemplate } from '../../shared/types.ts';

export const HEADLINE_SEED = fileURLToPath(new URL('../../shared/data/headlines.seed.json', import.meta.url));
export const GENERATED_HEADLINES = fileURLToPath(new URL('../../shared/data/headlines.generated.json', import.meta.url));
/** Funnier headlines written by Claude Haiku (tools/generate-headlines/claude.ts); optional. */
export const CLAUDE_HEADLINES = fileURLToPath(new URL('../../shared/data/headlines.claude.json', import.meta.url));

export function readHeadlines(path: string, optional = false): HeadlineTemplate[] {
  let data: string;
  try {
    data = readFileSync(path, 'utf8');
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(data);
  // The catalog may still hold headlines for sectors the game no longer has: skip those, check the rest.
  const report = validateHeadlineFile(Array.isArray(parsed) ? parsed.filter(inGameSector) : parsed);
  const first = report.invalid[0];
  if (first) throw new Error(`${path}, entry ${first.id ?? first.index}: ${first.errors.join(', ')}`);
  if (report.duplicateIds.length) throw new Error(`${path}: duplicate id ${report.duplicateIds[0]}`);
  if (report.duplicateTexts.length) throw new Error(`${path}: duplicate headline ${report.duplicateTexts[0]}`);
  return report.valid;
}

export function generatedHeadlinePath(path?: string): string {
  return path === undefined ? GENERATED_HEADLINES : resolve(path);
}


function inGameSector(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return true;
  const sector = (entry as { sector?: unknown }).sector;
  return sector === undefined || (SECTORS as readonly unknown[]).includes(sector);
}
