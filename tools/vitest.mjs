/**
 * Starts vitest from the repo root with a canonical working directory.
 *
 * Git Bash on Windows hands Node a lowercase drive letter (`c:\...`), and vitest then loads its own
 * modules twice (once per spelling) and fails every file with "Cannot read properties of undefined
 * (reading 'config')". realpath gives the on-disk spelling, so `npm test` works from any shell.
 * Arguments are passed through: `npm test -- server/src/sim`.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const cli = resolve(root, 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
