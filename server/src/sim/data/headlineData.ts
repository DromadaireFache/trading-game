/**
 * The headline database and placeholder lists the sim uses by default. The CONTENT belongs to the
 * content team (shared/data/); this file only points at it. To switch to a generated database, point
 * DEFAULT_HEADLINES at it (same HeadlineTemplate shape) or pass `headlines` to createSim.
 */
import type { HeadlineTemplate } from '@tg/shared';
import headlinesJson from '@tg/shared/data/headlines.seed.json';
import placeholdersJson from '@tg/shared/data/placeholders.json';
import type { PlaceholderLists } from '../headlines.ts';

export const DEFAULT_HEADLINES = headlinesJson as HeadlineTemplate[];
export const DEFAULT_PLACEHOLDERS = placeholdersJson as PlaceholderLists;
