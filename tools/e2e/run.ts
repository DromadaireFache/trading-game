/**
 * End-to-end check (`npm run e2e`). Self-contained:
 *   - picks two FREE random ports, spawns the game server and Vite as child processes with short phases
 *     (config override through PORT / TG_CLIENT_PORT / TG_CONFIG, see server/src/env.ts),
 *   - drives TWO player browser contexts plus a /floor projector context with playwright-core, using the
 *     installed browser (channel 'msedge', then 'chrome'; nothing is downloaded),
 *   - asserts the behaviour of the milestones so far and saves screenshots to <repo>/.e2e/,
 *   - ALWAYS tears its children down (Windows: taskkill /T /F) and checks the ports are free again.
 *
 * Flags (env): TG_E2E_HEADED=1 shows the browser windows.
 *
 * Milestone 1 (skeleton): join by name, lobby roster, duplicate name, start gating, phase loop with a
 * live countdown through every quarter to FINAL, reload = same player, late join refused, /floor as a
 * spectator that is not counted as a player, raw websocket join through the Vite proxy, no page overflow
 * at 1366x768, countdown cadence, a duplicated tab (old tab is blocked) and a lost tab (back in by name).
 * Later milestones: add a `step(...)` block in main() after the ones that are there.
 */
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { QUARTER_PHASES, defaultConfig } from '@tg/shared';
import type { DeepPartial, GameConfig, LobbyState, Phase } from '@tg/shared';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = resolve(repo, '.e2e');

/** Short phases: one quarter = 1.5 + 6 + 0.8 + 1.5 + 1.5 = 11.3 s, two quarters to FINAL. */
const QUARTERS = 2;
const overrides: DeepPartial<GameConfig> = {
  time: { quarters: QUARTERS, daysPerQuarter: 6 },
  phaseMs: { BRIEFING: 1500, EARNINGS: 800, RESULTS: 1500, SHOP: 1500 },
  lobby: { minPlayers: 2 },
};
const GAME_MS = QUARTERS * (1500 + 6000 + 800 + 1500 + 1500);
const WAIT_MS = 15_000;
/** The countdown display is re-rendered every countdownRefreshMs, so a second can show that much late. */
const CADENCE_TOLERANCE_MS = defaultConfig.presentation.countdownRefreshMs + 100;

// --- small helpers -------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const log = (line: string) => console.log(`[e2e] ${line}`);

let checks = 0;
function check(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Error(`CHECK FAILED: ${what}`);
  checks += 1;
  log(`  ok  ${what}`);
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  log(name);
  try {
    return await fn();
  } catch (error) {
    throw new Error(`step "${name}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '0.0.0.0', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      srv.close(() => res(port));
    });
  });
}

/** True when nothing is listening on the port (we can bind it ourselves). */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const srv = createServer();
    srv.once('error', () => res(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => res(true)));
  });
}

async function waitFor(what: string, probe: () => Promise<boolean>, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await probe()) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

// --- child processes -----------------------------------------------------------

const children: ChildProcess[] = [];
const childOutput: string[] = [];

function spawnNode(tag: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const keep = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim() !== '') childOutput.push(`[${tag}] ${line}`);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  children.push(child);
  return child;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

// --- page helpers --------------------------------------------------------------

const tid = (id: string) => `[data-testid=${id}]`;

interface PhaseSeen {
  phase: string;
  quarter: string;
  countdown: string;
  /** performance.now() of the page when this was first on screen. */
  at: number;
}

/**
 * In-page recorder. __tgSeen: one entry per phase/quarter change, so even a sub-second phase is not
 * missed. __tgTicks: one timestamped entry per change of phase, quarter OR countdown text.
 */
const RECORDER = `(() => {
  const seen = (window.__tgSeen = []);
  const ticks = (window.__tgTicks = []);
  let last = '';
  let lastTick = '';
  setInterval(() => {
    const phase = document.querySelector('[data-testid=phase]')?.getAttribute('data-phase');
    const quarter = document.querySelector('[data-testid=quarter]')?.textContent?.trim() ?? '';
    const countdown = document.querySelector('[data-testid=countdown]')?.textContent?.trim() ?? '';
    if (!phase) return;
    const key = phase + ' ' + quarter;
    const at = performance.now();
    if (key !== last) { last = key; seen.push({ phase, quarter, countdown, at }); }
    if (key + ' ' + countdown !== lastTick) { lastTick = key + ' ' + countdown; ticks.push({ phase, quarter, countdown, at }); }
  }, 20);
})()`;

const seenOn = (page: Page) => page.evaluate('window.__tgSeen') as Promise<PhaseSeen[]>;
const ticksOn = (page: Page) => page.evaluate('window.__tgTicks') as Promise<PhaseSeen[]>;
const phaseOf = (page: Page) => page.locator(tid('phase')).first().getAttribute('data-phase');
const textOf = async (page: Page, id: string) => ((await page.locator(tid(id)).first().textContent()) ?? '').trim();
const rosterNames = (page: Page) => page.locator(`${tid('roster-player')} .roster__name`).allTextContents();
const sessionToken = (page: Page) =>
  page.evaluate(`JSON.parse(sessionStorage.getItem('tg.session.player') ?? 'null')?.token ?? null`) as Promise<string | null>;

/** "0:07" -> 7; null for "--:--". */
function countdownSeconds(text: string): number | null {
  const m = /^(\d+):(\d\d)$/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The page must fit its viewport: no scrollbars on a 1366x768 laptop or on the projector. */
async function checkNoOverflow(page: Page, label: string): Promise<void> {
  const d = (await page.evaluate(
    '({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: window.innerWidth, ih: window.innerHeight })',
  )) as { sw: number; sh: number; iw: number; ih: number };
  check(d.sw <= d.iw && d.sh <= d.ih, `${label} fits the viewport (${d.sw}x${d.sh} in ${d.iw}x${d.ih})`);
}

/**
 * Countdown cadence from the recorder's timestamps: within a phase the display steps down by one
 * every second, and the phase flips about one second after it showed 0:01. The first step of a phase
 * is skipped: a phase that is not a whole number of seconds long shows its first value for less.
 */
function checkCadence(label: string, ticks: PhaseSeen[]): void {
  const steps: number[] = [];
  const flips: number[] = [];
  for (let i = 1; i < ticks.length; i++) {
    const [prev, cur] = [ticks[i - 1]!, ticks[i]!];
    const before = ticks[i - 2];
    const prevOpensPhase = before === undefined || before.phase !== prev.phase || before.quarter !== prev.quarter;
    const [from, to] = [countdownSeconds(prev.countdown), countdownSeconds(cur.countdown)];
    const samePhase = prev.phase === cur.phase && prev.quarter === cur.quarter;
    if (samePhase && !prevOpensPhase && from !== null && to !== null && to > 0) steps.push(from - to === 1 ? cur.at - prev.at : Number.NaN);
    if (!samePhase && from === 1) flips.push(cur.at - prev.at);
  }
  const worst = steps.reduce((m, ms) => (Number.isNaN(ms) ? Infinity : Math.max(m, Math.abs(ms - 1000))), 0);
  check(steps.length >= 6 && worst <= CADENCE_TOLERANCE_MS,
    `${label} countdown stepped 1 s at a time, ${steps.length} steps, worst off by ${Math.round(worst)} ms (limit ${CADENCE_TOLERANCE_MS})`);
  const flipMax = Math.max(...flips);
  const flipMin = Math.min(...flips);
  check(flips.length >= 8 && flipMax <= 1000 + CADENCE_TOLERANCE_MS && flipMin >= 500,
    `${label} phases flipped ${Math.round(flipMin)}-${Math.round(flipMax)} ms after the display reached 0:01 (${flips.length} flips)`);
}

async function waitForPhase(page: Page, phase: Phase, timeoutMs = WAIT_MS): Promise<void> {
  await page.waitForSelector(`${tid('phase')}[data-phase=${phase}]`, { timeout: timeoutMs });
}

async function waitForRoster(page: Page, count: number): Promise<void> {
  await waitFor(`${count} roster rows`, async () => (await page.locator(tid('roster-player')).count()) === count);
}

/** A bare websocket client (Node's built-in), to check the protocol through the Vite proxy. */
function wsJoin(url: string, join: object): Promise<{ t: string; [k: string]: unknown }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      rej(new Error(`no answer from ${url}`));
    }, WAIT_MS);
    ws.onopen = () => ws.send(JSON.stringify(join));
    ws.onerror = () => {
      clearTimeout(timer);
      rej(new Error(`websocket error on ${url}`));
    };
    ws.onmessage = (ev) => {
      clearTimeout(timer);
      ws.close();
      res(JSON.parse(String(ev.data)) as { t: string });
    };
  });
}

// --- the run -------------------------------------------------------------------

async function main(): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const shot = (page: Page, name: string) => page.screenshot({ path: resolve(outDir, `${name}.png`) });

  const serverPort = await freePort();
  let clientPort = await freePort();
  while (clientPort === serverPort) clientPort = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(serverPort),
    TG_CLIENT_PORT: String(clientPort),
    TG_SEED: '1',
    TG_PHASE_SCALE: '',
    TG_CONFIG: JSON.stringify(overrides),
  };
  const base = `http://127.0.0.1:${clientPort}`;
  log(`game server on ${serverPort}, vite on ${clientPort}, screenshots in ${outDir}`);

  let browser: Browser | undefined;
  const problems: string[] = [];

  try {
    await step('start game server and vite', async () => {
      spawnNode('server', [resolve(repo, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], resolve(repo, 'server'), env);
      spawnNode('vite', [resolve(repo, 'node_modules/vite/bin/vite.js')], resolve(repo, 'client'), env);
      await waitFor('game server /health', async () => (await fetch(`http://127.0.0.1:${serverPort}/health`)).ok, 30_000);
      await waitFor('vite /play', async () => (await fetch(`${base}/play`)).ok, 30_000);
      check(childOutput.some((l) => /LAN players:\s+http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/play/.test(l)) ||
        childOutput.some((l) => l.includes('no LAN network interface')), 'server printed the LAN URLs (or said there is no LAN)');
    });

    browser = await step('launch browser', async () => {
      const headless = process.env.TG_E2E_HEADED !== '1';
      try {
        return await chromium.launch({ channel: 'msedge', headless });
      } catch {
        return await chromium.launch({ channel: 'chrome', headless });
      }
    });

    const newPage = async (label: string, width: number, height: number): Promise<Page> => {
      const context = await browser!.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      page.on('console', (m) => {
        // The browser logs refused/failed connections itself; those are expected only after we kill the server.
        if (m.type() === 'error') problems.push(`[${label}] console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`[${label}] page error: ${e.message}`));
      page.on('request', (r) => {
        const u = r.url();
        if (!u.startsWith(base) && !u.startsWith(`ws://127.0.0.1:${clientPort}`) && !u.startsWith('data:')) {
          problems.push(`[${label}] external request: ${u}`);
        }
      });
      return page;
    };

    const a = await newPage('A', 1366, 768);
    const b = await newPage('B', 1366, 768);
    const floor = await newPage('floor', 1920, 1080);

    await step('player A: name entry and join', async () => {
      await a.goto(`${base}/`);
      await a.waitForSelector(tid('name-input'));
      check(new URL(a.url()).pathname === '/play', '/ redirects to /play');
      await a.waitForSelector(`${tid('connection')}[data-status=open]`);
      await shot(a, '01-join');
      await a.fill(tid('name-input'), 'Gordon');
      await a.click(tid('join-button'));
      await a.waitForSelector(tid('start-button'));
      check((await textOf(a, 'me-name')) === 'Gordon', 'A is in the lobby as Gordon');
      check((await phaseOf(a)) === 'LOBBY', 'A sees phase LOBBY');
      check(await a.locator(tid('start-button')).isDisabled(), 'Start is disabled with 1 of 2 required players');
    });

    await step('player B: duplicate name is refused, then joins', async () => {
      await b.goto(`${base}/play`);
      await b.fill(tid('name-input'), 'gordon');
      await b.click(tid('join-button'));
      await b.waitForSelector(tid('error'));
      check((await b.getAttribute(tid('error'), 'data-code')) === 'name_taken', 'duplicate name shows a name_taken error');
      check(await b.locator(tid('error')).isVisible(), 'the error is visible');
      check((await b.locator(tid('name-input')).count()) === 1, 'B is still on name entry');
      await shot(b, '02-duplicate-name');
      await b.fill(tid('name-input'), 'Bud');
      await b.click(tid('join-button'));
      await b.waitForSelector(tid('start-button'));
    });

    await step('lobby: both players see each other', async () => {
      await waitForRoster(a, 2);
      await waitForRoster(b, 2);
      check((await rosterNames(a)).join(',') === 'Gordon,Bud', 'A sees Gordon and Bud');
      check((await rosterNames(b)).join(',') === 'Gordon,Bud', 'B sees Gordon and Bud');
      await waitFor('start enabled', async () => a.locator(tid('start-button')).isEnabled());
      check(true, 'Start is enabled with 2 players');
      await shot(a, '03-lobby-a');
      await shot(b, '03-lobby-b');
      await checkNoOverflow(a, 'lobby at 1366x768');
    });

    await step('/floor joins as a spectator and is not a player', async () => {
      await floor.goto(`${base}/floor`);
      await floor.waitForSelector(tid('floor'));
      await waitForRoster(floor, 2);
      check((await phaseOf(floor)) === 'LOBBY', 'floor shows phase LOBBY');
      check((await floor.locator(tid('name-input')).count()) === 0, 'floor has no name entry');
      const hint = ((await floor.locator('.floor__url').textContent()) ?? '').trim();
      const lanLine = childOutput.find((l) => l.includes('LAN players:'));
      const lanPlay = lanLine === undefined ? null : (/http:\/\/[\d.]+:\d+\/play/.exec(lanLine)?.[0] ?? null);
      check(lanPlay === null ? hint.endsWith('/play') : hint === lanPlay, `floor shows where to join: ${hint}`);
      await sleep(300);
      check((await a.locator(tid('roster-player')).count()) === 2, 'players still see 2 players after the floor joined');
      const health = (await (await fetch(`http://127.0.0.1:${serverPort}/health`)).json()) as { players: number; phase: string };
      check(health.players === 2 && health.phase === 'LOBBY', `server counts 2 players in LOBBY (got ${health.players}, ${health.phase})`);
      await shot(floor, '04-floor-lobby');
      await checkNoOverflow(floor, 'floor lobby');
    });

    await step('raw websocket through the Vite proxy', async () => {
      const wsUrl = `ws://127.0.0.1:${clientPort}/ws`;
      const welcome = await wsJoin(wsUrl, { t: 'join', role: 'spectator' });
      check(welcome.t === 'welcome' && welcome.role === 'spectator', 'a spectator gets welcome through the proxy');
      const lobby = welcome.lobby as LobbyState;
      check(lobby.players.length === 2 && lobby.spectators === 2, `lobby: 2 players, 2 spectators (got ${lobby.players.length}, ${lobby.spectators})`);
      const garbage = await wsJoin(wsUrl, { nonsense: true });
      check(garbage.t === 'error' && garbage.code === 'bad_message', 'a garbage frame gets error bad_message');
    });

    await step('reload in the lobby keeps the same player', async () => {
      const before = await sessionToken(b);
      check(typeof before === 'string' && before.length > 0, 'B has a session token in sessionStorage');
      await b.reload();
      await b.waitForSelector(tid('start-button'));
      check((await textOf(b, 'me-name')) === 'Bud', 'B is still Bud after reload (no name entry)');
      check((await sessionToken(b)) === before, 'B kept the same token');
      await waitForRoster(a, 2);
      check((await rosterNames(a)).join(',') === 'Gordon,Bud', 'roster is still Gordon, Bud (no duplicate seat)');
    });

    await step('start: phases advance on both players and the floor', async () => {
      await a.evaluate(RECORDER);
      await floor.evaluate(RECORDER);
      await b.click(tid('start-button'));
      await Promise.all([waitForPhase(a, 'BRIEFING'), waitForPhase(b, 'BRIEFING'), waitForPhase(floor, 'BRIEFING')]);
      check(true, 'A, B and floor all entered BRIEFING');
      check((await textOf(a, 'quarter')) === `Q1/${QUARTERS}`, `quarter reads Q1/${QUARTERS}`);
      await shot(a, '10-play-BRIEFING');
      await Promise.all([waitForPhase(a, 'TRADING'), waitForPhase(b, 'TRADING'), waitForPhase(floor, 'TRADING')]);
      await shot(a, '11-play-TRADING');
      await shot(floor, '12-floor-TRADING');
      await checkNoOverflow(a, 'desk in TRADING at 1366x768');
      await checkNoOverflow(floor, 'floor in TRADING');
    });

    await step('countdown counts down and agrees between views', async () => {
      const first = countdownSeconds(await textOf(a, 'countdown'));
      const floorFirst = countdownSeconds(await textOf(floor, 'countdown'));
      const bFirst = countdownSeconds(await textOf(b, 'countdown'));
      check(first !== null && first >= 4 && first <= 6, `A countdown starts near 6 s in TRADING (got ${first})`);
      check(floorFirst !== null && Math.abs(floorFirst - first) <= 1, `floor countdown agrees with A (${floorFirst} vs ${first})`);
      check(bFirst !== null && Math.abs(bFirst - first) <= 1, `B countdown agrees with A (${bFirst} vs ${first})`);
      await sleep(2000);
      const second = countdownSeconds(await textOf(a, 'countdown'));
      check(second !== null && first - second >= 1 && first - second <= 3, `A countdown went down by about 2 s (${first} -> ${second})`);
    });

    await step('reload mid-game resumes the same player; a late joiner is refused', async () => {
      await b.reload();
      await b.waitForSelector(`${tid('phase')}[data-phase=TRADING]`);
      check((await textOf(b, 'me-name')) === 'Bud', 'B is still Bud after a mid-game reload');
      const [cdA, cdB] = [countdownSeconds(await textOf(a, 'countdown')), countdownSeconds(await textOf(b, 'countdown'))];
      check(cdA !== null && cdB !== null && Math.abs(cdA - cdB) <= 1, `B countdown after reload agrees with A (${cdB} vs ${cdA})`);
      check((await b.locator(tid('roster-player')).count()) === 2, 'B still sees 2 players');

      const late = await newPage('late', 1366, 768);
      await late.goto(`${base}/play`);
      await late.fill(tid('name-input'), 'Late');
      await late.click(tid('join-button'));
      await late.waitForSelector(tid('error'));
      check((await late.getAttribute(tid('error'), 'data-code')) === 'game_in_progress', 'late joiner gets game_in_progress');
      await shot(late, '13-late-join');
      await late.context().close();
    });

    await step('every phase of every quarter, then FINAL', async () => {
      for (const phase of ['EARNINGS', 'RESULTS', 'SHOP'] as const) {
        await waitForPhase(a, phase);
        await shot(a, `14-play-${phase}`);
        await checkNoOverflow(a, `desk in ${phase} at 1366x768`);
      }
      await Promise.all([waitForPhase(a, 'FINAL', GAME_MS + WAIT_MS), waitForPhase(floor, 'FINAL', GAME_MS + WAIT_MS), waitForPhase(b, 'FINAL', GAME_MS + WAIT_MS)]);
      await sleep(200);
      await shot(a, '20-play-FINAL');
      await shot(floor, '21-floor-FINAL');
      await checkNoOverflow(a, 'desk in FINAL at 1366x768');
      await checkNoOverflow(floor, 'floor in FINAL');

      const expected: string[] = [`LOBBY Q-/${QUARTERS}`];
      for (let q = 1; q <= QUARTERS; q++) for (const phase of QUARTER_PHASES) expected.push(`${phase} Q${q}/${QUARTERS}`);
      expected.push(`FINAL Q${QUARTERS}/${QUARTERS}`);
      for (const [label, page] of [['A', a], ['floor', floor]] as const) {
        const seen = await seenOn(page);
        const got = seen.map((s) => `${s.phase} ${s.quarter}`);
        log(`  ${label} saw: ${seen.map((s) => `${s.phase}(${s.quarter} ${s.countdown})`).join(' > ')}`);
        check(got.join(' > ') === expected.join(' > '), `${label} saw all ${expected.length} phases in order`);
        const timed = seen.filter((s) => s.phase !== 'LOBBY' && s.phase !== 'FINAL');
        check(timed.every((s) => countdownSeconds(s.countdown) !== null), `${label} showed a countdown at the start of every timed phase`);
        checkCadence(label, await ticksOn(page));
      }
      check(countdownSeconds(await textOf(a, 'countdown')) === null, 'no countdown in FINAL');
      const health = (await (await fetch(`http://127.0.0.1:${serverPort}/health`)).json()) as { players: number; phase: string };
      check(health.phase === 'FINAL' && health.players === 2, 'server is in FINAL with 2 players');
    });

    await step('duplicated tab: the new tab takes the seat, the old one is blocked', async () => {
      const stored = (await b.evaluate(`sessionStorage.getItem('tg.session.player')`)) as string;
      const twin = await newPage('twin', 1366, 768);
      await twin.addInitScript(`sessionStorage.setItem('tg.session.player', ${JSON.stringify(stored)})`);
      await twin.goto(`${base}/play`);
      await waitForPhase(twin, 'FINAL');
      check((await textOf(twin, 'me-name')) === 'Bud', 'the duplicated tab is Bud');
      await b.waitForSelector(tid('seat-taken'));
      check((await b.locator(tid('play')).count()) === 0 && (await b.locator(tid('countdown')).count()) === 0,
        'the old tab shows only the "seat taken" screen, no live-looking desk');
      check(await b.locator(tid('reload-button')).isVisible(), 'the old tab offers Reload');
      check((await b.getAttribute(tid('connection'), 'data-status')) === 'closed', 'the old tab does not reconnect');
      await shot(b, '22-seat-taken');
      await checkNoOverflow(b, 'seat-taken screen');
      await twin.context().close();
    });

    await step('lost tab: the same name takes the disconnected seat back mid-game', async () => {
      await waitFor('A sees Bud offline', async () => (await a.locator(`${tid('roster-player')}.roster__row--offline`).count()) === 1);
      const before = JSON.parse((await b.evaluate(`sessionStorage.getItem('tg.session.player')`)) as string) as { token: string };
      const lost = await newPage('lost', 1366, 768);
      await lost.goto(`${base}/play`);
      await lost.fill(tid('name-input'), 'bud');
      await lost.click(tid('join-button'));
      await waitForPhase(lost, 'FINAL');
      check((await textOf(lost, 'me-name')) === 'Bud', 'a fresh tab that types "bud" is Bud again');
      const after = await sessionToken(lost);
      check(typeof after === 'string' && after !== before.token, 'the seat got a fresh token');
      await waitFor('A sees everybody online', async () => (await a.locator(`${tid('roster-player')}.roster__row--offline`).count()) === 0);
      check((await rosterNames(a)).join(',') === 'Gordon,Bud', 'roster is still Gordon, Bud');
      await lost.context().close();
    });

    await step('no page errors, no external requests', async () => {
      check(problems.length === 0, `clean browser logs${problems.length ? `:\n    ${problems.join('\n    ')}` : ''}`);
    });

    await step('server loss shows on the client', async () => {
      killTree(children[0]!);
      await a.waitForSelector(`${tid('connection')}[data-status=reconnecting]`);
      check(true, 'A shows "reconnecting" after the server died');
      await shot(a, '30-reconnecting');
    });
  } catch (error) {
    if (browser) {
      // Whatever is on screen at the moment of failure is the best clue.
      let i = 0;
      for (const context of browser.contexts()) {
        for (const page of context.pages()) await page.screenshot({ path: resolve(outDir, `failure-${i++}.png`) }).catch(() => {});
      }
    }
    console.error(childOutput.slice(-40).join('\n'));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    for (const child of children) killTree(child);
    await waitFor(`ports ${serverPort} and ${clientPort} to be free`, async () => (await portIsFree(serverPort)) && (await portIsFree(clientPort)), 10_000).catch(
      (e: unknown) => {
        console.error(`[e2e] ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
      },
    );
  }

  log(`PASS: ${checks} checks. Screenshots: ${outDir}`);
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: unknown) => {
    console.error(`[e2e] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    for (const child of children) killTree(child);
    process.exit(1);
  },
);
