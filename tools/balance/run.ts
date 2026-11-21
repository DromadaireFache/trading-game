/**
 * `npm run balance [-- --games 50 --seed 1 --quarters 8 --bots a,b --config '{"impact":{"lambda":0.1}}' --json]`
 *
 * Plays `games` full games (seeds seed..seed+games-1) with one player per bot and prints the
 * distribution of final net worth, per bot and for the winner, against DESIGN's target of a median
 * winner of $1B-3B. See ./harness.ts for what is and is not simulated yet.
 */
import { defaultConfig, mergeConfig } from '@tg/shared';
import type { DeepPartial, GameConfig } from '@tg/shared';
import { ALL_BOTS, DEFAULT_BOTS, botByName } from './bots.ts';
import { playGame, summarize } from './harness.ts';
import type { BotFactory } from './harness.ts';

const TARGET_MIN = 1e9;
const TARGET_MAX = 3e9;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const games = Number(arg('games') ?? 50);
const firstSeed = Number(arg('seed') ?? 1);
let overrides: DeepPartial<GameConfig> = {};
if (arg('config')) overrides = JSON.parse(arg('config')!) as DeepPartial<GameConfig>;
if (arg('quarters')) overrides = { ...overrides, time: { ...overrides.time, quarters: Number(arg('quarters')) } };
const config = mergeConfig(defaultConfig, overrides);

let bots: readonly BotFactory[] = DEFAULT_BOTS;
if (arg('bots')) {
  bots = arg('bots')!.split(',').map((name) => {
    const bot = botByName(name.trim());
    if (!bot) throw new Error(`unknown bot "${name}"; known: ${ALL_BOTS.map((b) => b(undefined as never).name).join(', ')}`);
    return bot;
  });
}

const started = Date.now();
const results = Array.from({ length: games }, (_, i) => playGame(firstSeed + i, config, bots));
const summary = summarize(config, results);
const seconds = (Date.now() - started) / 1000;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const money = (v: number) => {
    const a = Math.abs(v);
    const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : `${(a / 1e3).toFixed(0)}k`;
    return `${v < 0 ? '-' : ''}$${s}`;
  };
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${games} games, ${config.time.quarters} quarters, start ${money(config.economy.startingCash)}, ${bots.length} bots per game (${seconds.toFixed(1)} s)`);
  console.log('Headlines, earnings, cards, regimes and the SEC all run in the sim. Card columns are per game.\n');
  console.log(
    `${pad('bot', 16)}${pad('p10', 11)}${pad('median', 11)}${pad('p90', 11)}${pad('elim', 6)}${pad('margin', 7)}${pad('wins', 6)}${pad('bought', 7)}${pad('played', 7)}${pad('spend', 10)}${pad('fines', 10)}${pad('arrests', 8)}jail d`,
  );
  for (const [name, b] of Object.entries(summary.bots)) {
    console.log(
      `${pad(name, 16)}${pad(money(b.p10), 11)}${pad(money(b.median), 11)}${pad(money(b.p90), 11)}${pad(`${Math.round(b.eliminated * 100)}%`, 6)}${pad(b.marginCalls.toFixed(1), 7)}${pad(String(summary.winner.byBot[name] ?? 0), 6)}` +
        `${pad(b.cardsBought.toFixed(1), 7)}${pad(b.cardsPlayed.toFixed(1), 7)}${pad(money(b.cardSpend), 10)}${pad(money(b.fines), 10)}${pad(b.arrests.toFixed(1), 8)}${b.jailDays.toFixed(0)}`,
    );
  }
  const w = summary.winner;
  const verdict = w.median < TARGET_MIN ? 'BELOW target' : w.median > TARGET_MAX ? 'ABOVE target' : 'within target';
  console.log(`\nwinner: p10 ${money(w.p10)}, median ${money(w.median)}, p90 ${money(w.p90)} -> ${verdict} (${money(TARGET_MIN)}-${money(TARGET_MAX)})`);
}
