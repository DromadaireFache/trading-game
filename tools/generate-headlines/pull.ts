/** Fetch a complete, atomically published snapshot from the home server. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GENERATED_HEADLINES, readHeadlines } from '../../server/src/headline-files.ts';

const host = process.env.HEADLINES_SSH_HOST || 'sbb-server-01';
const remotePath = '.local/share/trading-game-headlines/app/shared/data/headlines.generated.json';
const scratch = mkdtempSync(join(dirname(GENERATED_HEADLINES), '.headlines-pull-'));
const snapshot = join(scratch, 'catalog.json');
try {
  execFileSync('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', `${host}:${remotePath}`, snapshot],
    { stdio: 'inherit', timeout: 60_000 });
  const catalog = readHeadlines(snapshot);
  if (!catalog.length || catalog.some((headline) => headline.scope !== 'market' && !headline.sector)) {
    throw new Error('Downloaded catalog is empty or missing sectors');
  }
  renameSync(snapshot, GENERATED_HEADLINES);
  console.log(`Published ${catalog.length} generated headlines locally from ${host}.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
