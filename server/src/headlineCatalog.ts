/** The headline catalog for Node: headlineBuild.ts plus the files on disk. */
import type { HeadlineTemplate } from '@tg/shared';
import { ABSURD_HEADLINES, CLAUDE_HEADLINES, generatedHeadlinePath, HEADLINE_SEED, readHeadlines } from './headline-files.ts';
import { buildHeadlineTemplates } from './headlineBuild.ts';

export * from './headlineBuild.ts';

/** Reads the catalog files and builds the templates (see buildHeadlineTemplates). */
export function loadHeadlineTemplates(path?: string, claudePath: string = CLAUDE_HEADLINES, absurdPath: string = ABSURD_HEADLINES): HeadlineTemplate[] {
  const generatedPath = generatedHeadlinePath(path);
  return buildHeadlineTemplates({
    seed: readHeadlines(HEADLINE_SEED),
    absurd: readHeadlines(absurdPath, true),
    claude: readHeadlines(claudePath, true),
    generated: readHeadlines(generatedPath, path === undefined),
    generatedLabel: generatedPath,
    claudeLabel: claudePath,
  });
}
