/** Filesystem boundary for the offline headline catalog. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HeadlineTemplate } from '../../shared/types.ts';
import { parseHeadlineFile } from './headlineBuild.ts';

export const HEADLINE_SEED = fileURLToPath(new URL('../../shared/data/headlines.seed.json', import.meta.url));
export const GENERATED_HEADLINES = fileURLToPath(new URL('../../shared/data/headlines.generated.json', import.meta.url));
/**
 * Hand-written absurd headlines (aliens, dinosaurs, portals, time travelers, affairs, spies...). Like
 * the seed they carry no sector: each fits every sector.
 */
export const ABSURD_HEADLINES = fileURLToPath(new URL('../../shared/data/headlines.absurd.json', import.meta.url));
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
  return parseHeadlineFile(JSON.parse(data), path);
}

export function generatedHeadlinePath(path?: string): string {
  return path === undefined ? GENERATED_HEADLINES : resolve(path);
}
