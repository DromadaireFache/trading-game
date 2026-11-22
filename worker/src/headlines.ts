/**
 * The headline catalog, bundled into the worker (there is no disk here). Built on first use and kept for
 * the life of the isolate, so a second room on the same isolate does not pay for it again.
 * headlines.claude.json is optional in the repo and left out of the online game.
 */
import { buildHeadlineTemplates, parseHeadlineFile } from '@tg/server/headlines';
import type { HeadlineTemplate } from '@tg/shared';
import absurd from '../../shared/data/headlines.absurd.json';
import generated from '../../shared/data/headlines.generated.json';
import seed from '../../shared/data/headlines.seed.json';

let catalog: HeadlineTemplate[] | undefined;

export function headlineTemplates(): HeadlineTemplate[] {
  catalog ??= buildHeadlineTemplates({
    seed: parseHeadlineFile(seed, 'headlines.seed.json'),
    absurd: parseHeadlineFile(absurd, 'headlines.absurd.json'),
    claude: [],
    generated: parseHeadlineFile(generated, 'headlines.generated.json'),
    generatedLabel: 'headlines.generated.json',
  });
  return catalog;
}
