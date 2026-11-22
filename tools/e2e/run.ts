/**
 * End-to-end check (`npm run e2e`). Self-contained:
 *   - picks two FREE random ports, spawns the game server and Vite as child processes with short phases
 *     (config override through PORT / TG_CLIENT_PORT / TG_CONFIG, see server/src/env.ts),
 *   - drives TWO player browser contexts plus a /floor projector context with playwright-core, using the
 *     installed browser (channel 'msedge', then 'chrome'; nothing is downloaded),
 *   - asserts the behaviour of the milestones so far and saves screenshots to <repo>/.e2e/,
 *   - ALWAYS tears its children down (Windows: taskkill /T /F) and checks the ports are free again.
 *
 * TG_E2E_HEADED=1 shows the browser windows. TG_E2E_EARNINGS=1 runs just the earnings flow.
 *
 * Milestone 1 (skeleton): join by name, lobby roster, duplicate name, start gating, phase loop with a
 * live countdown through every quarter to FINAL, reload = same player, late join refused, /floor as a
 * spectator that is not counted as a player, raw websocket join through the Vite proxy, no page overflow
 * at 1366x768, countdown cadence, a duplicated tab (old tab is blocked) and a lost tab (back in by name).
 * Milestone 2 (market): the `market` snapshot through the proxy, 37 symbols in 7 groups on both players,
 * on-screen prices equal one server tick and agree between the two windows, a candle chart that grows one
 * candle per second and really has candles painted (stock and index fund), a projector net-worth chart, prices frozen outside
 * TRADING and continuing next quarter with continuing day numbers, a mid-quarter refresh that restores
 * list + chart history, and main-thread health at 10 Hz.
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
import { FINAL_QUARTER_PHASES, QUARTER_PHASES, SECTORS, defaultConfig } from '@tg/shared';
import type { DeepPartial, EarningsMsg, GameConfig, LobbyState, MarketMsg, Phase, ServerMsg, TickMsg } from '@tg/shared';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = resolve(repo, '.e2e');
const earningsOnly = process.env.TG_E2E_EARNINGS === '1';

/** Short phases and two quarters to FINAL. */
const QUARTERS = 2;
/**
 * Trading days per quarter: long enough to click around, reload and watch candles appear. Every step up
 * to the headline checks must fit in Q1's trading phase, including reloads and browser scheduling delays.
 */
const DAYS = earningsOnly ? 8 : 55;
const TICKS_PER_DAY = defaultConfig.time.ticksPerCandle;
const DAY_MS = TICKS_PER_DAY * defaultConfig.time.tickMs;
const TRADING_MS = DAYS * DAY_MS;
// Leave time for the browser to check and capture each screen before the next phase starts.
const PHASE_MS = { BRIEFING: 1500, RESULTS: 3500, SHOP: 5000 };
/** The finale at a fifth of its speed (about 10 s); FINALE_WAIT_MS covers it. */
const FINALE_SCALE = 0.2;
const FINALE_WAIT_MS = 20_000;
const overrides: DeepPartial<GameConfig> = {
  time: { quarters: QUARTERS, daysPerQuarter: DAYS },
  phaseMs: PHASE_MS,
  lobby: { minPlayers: 2 },
  presentation: { finaleScale: FINALE_SCALE },
  ...(earningsOnly ? {
    news: { randomHeadlinesPerQuarter: 3, scheduledBeatsPerQuarter: 0, noiseShare: 1, quietDays: 0, maxGapMs: 0 },
    earnings: { leaksPerQuarter: 0 },
  } : {
    // Short quarters: a faster pace than the real one (2-6 s, 4 s on average), so the news checks never
    // wait long, yet every move settles before the close (none may carry into the next open).
    news: { minGapMs: 2_000, meanGapMs: 4_000, maxGapMs: 6_000 },
  }),
};
const GAME_MS = QUARTERS * (PHASE_MS.BRIEFING + TRADING_MS)
  + (QUARTERS - 1) * (PHASE_MS.RESULTS + PHASE_MS.SHOP);
const COMPANIES_PER_SECTOR = defaultConfig.market.companiesPerSector;
const SYMBOL_COUNT = 1 + SECTORS.length + SECTORS.length * COMPANIES_PER_SECTOR;
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
  const started = Date.now();
  try {
    const result = await fn();
    log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    return result;
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
  // POSIX: own process group, so killTree can take down the grandchildren too (tsx runs the real
  // server in a child of its own; killing only tsx orphaned it with the port still open).
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  const keep = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim() !== '') childOutput.push(`[${tag}] ${line}`);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  children.push(child);
  return child;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  // On POSIX the group can outlive its leader, so only Windows may skip an exited child.
  if (process.platform === 'win32' && child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL'); // the whole process group (see spawnNode)
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
  const wide =
    d.sw <= d.iw
      ? ''
      : ((await page.evaluate(
          `[...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
            .slice(0, 5).map((el) => (el.className || el.tagName) + '@' + Math.round(el.getBoundingClientRect().right)).join(', ')`,
        )) as string);
  check(d.sw <= d.iw && d.sh <= d.ih, `${label} fits the viewport (${d.sw}x${d.sh} in ${d.iw}x${d.ih})${wide ? `; too wide: ${wide}` : ''}`);
  // No element shows a scrollbar: every scroll box hides its bar (it still scrolls).
  const bars = (await page.evaluate(
    `[...document.querySelectorAll('*')].filter((el) => {
      const s = getComputedStyle(el);
      const scrolls = /auto|scroll/.test(s.overflowX + s.overflowY);
      return scrolls && s.scrollbarWidth !== 'none';
    }).length`,
  )) as number;
  check(bars === 0, `${label} shows no scrollbars (${bars} scroll boxes with a visible bar)`);
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
    if (!samePhase && from === 1 && prev.phase !== 'SHOP') flips.push(cur.at - prev.at);
  }
  const worst = steps.reduce((m, ms) => (Number.isNaN(ms) ? Infinity : Math.max(m, Math.abs(ms - 1000))), 0);
  check(steps.length >= 6 && worst <= CADENCE_TOLERANCE_MS,
    `${label} countdown stepped 1 s at a time, ${steps.length} steps, worst off by ${Math.round(worst)} ms (limit ${CADENCE_TOLERANCE_MS})`);
  const flipMax = Math.max(...flips);
  const flipMin = Math.min(...flips);
  const expectedFlips = (QUARTERS - 1) * (QUARTER_PHASES.length - 1) + FINAL_QUARTER_PHASES.length;
  check(flips.length >= expectedFlips && flipMax <= 1000 + CADENCE_TOLERANCE_MS && flipMin >= 500,
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

/** Collects the first `count` server messages of a bare websocket session. */
function wsCollect(url: string, join: object, count: number): Promise<ServerMsg[]> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    const got: ServerMsg[] = [];
    const timer = setTimeout(() => {
      ws.close();
      rej(new Error(`only ${got.length} of ${count} messages from ${url}`));
    }, WAIT_MS);
    ws.onopen = () => ws.send(JSON.stringify(join));
    ws.onerror = () => {
      clearTimeout(timer);
      rej(new Error(`websocket error on ${url}`));
    };
    ws.onmessage = (ev) => {
      got.push(JSON.parse(String(ev.data)) as ServerMsg);
      if (got.length !== count) return;
      clearTimeout(timer);
      ws.close();
      res(got);
    };
  });
}

// --- market helpers (milestone 2) ------------------------------------------------

/** Every server frame a page received, in order (all its websockets, so it survives reloads). */
const wire = new Map<string, ServerMsg[]>();
/** The symbol of A's quick bet, which must still be open at RESULTS. */
let quickBetSymbol = '';
const framesOf = (label: string): ServerMsg[] => wire.get(label) ?? [];
const ticksOf = (label: string): TickMsg[] => framesOf(label).filter((m): m is TickMsg => m.t === 'tick');
const snapshotsOf = (label: string): MarketMsg[] => framesOf(label).filter((m): m is MarketMsg => m.t === 'market');
const tickId = (tick: { day: number; tickOfDay: number }) => tick.day * TICKS_PER_DAY + tick.tickOfDay;

interface BoardRow {
  symbol: string;
  kind: string;
  group: string;
  price: string;
  change: string;
}

/** The symbol list as it is on screen at ONE instant (a single synchronous read of the DOM). */
const BOARD = `Array.from(document.querySelectorAll('[data-testid=symbol-row]')).map((row) => ({
  symbol: row.dataset.symbol ?? '',
  kind: row.dataset.kind ?? '',
  group: row.closest('[data-testid=symbol-group]')?.dataset.group ?? '',
  price: row.querySelector('[data-testid=symbol-price]')?.textContent ?? '',
  change: row.querySelector('[data-testid=symbol-change]')?.textContent ?? '',
}))`;
const boardOf = (page: Page) => page.evaluate(BOARD) as Promise<BoardRow[]>;
const shownPrice = (text: string) => Number(text.replace(/,/g, ''));
const boardKey = (board: BoardRow[]) => board.map((r) => `${r.symbol}=${r.price}`).join(' ');

/** The most recent tick of `label`'s own stream whose prices are exactly what the board shows. */
/**
 * The list repaints a random tenth of its rows per tick (quotePaintQueue), so each row shows its price
 * from some recent tick, not all rows from the same one. Returns the newest tick any row matches, or
 * undefined if some row matches none of the last RECENT_TICKS ticks received.
 */
const RECENT_TICKS = 100;
function tickShownBy(label: string, board: BoardRow[]): { day: number; tickOfDay: number } | undefined {
  const ticks = ticksOf(label).slice(-RECENT_TICKS);
  // A row not repainted since the page joined still shows the `market` snapshot's price.
  const snapshot = snapshotsOf(label).at(-1);
  let newest: { day: number; tickOfDay: number } | undefined;
  for (const row of board) {
    let hit: { day: number; tickOfDay: number } | undefined;
    for (let i = ticks.length - 1; i >= 0 && hit === undefined; i--) if (ticks[i]!.prices[row.symbol] === shownPrice(row.price)) hit = ticks[i];
    if (hit === undefined && snapshot !== undefined && snapshot.prices[row.symbol] === shownPrice(row.price)) hit = snapshot;
    if (hit === undefined) return undefined;
    if (newest === undefined || tickId(hit) > tickId(newest)) newest = hit;
  }
  return newest;
}

interface ChartSeen {
  symbol: string;
  /** Days the chart says it has drawn, including the live one. */
  candles: number;
  /** Pixels in the main pane that have the theme's up / down candle color. */
  upPixels: number;
  downPixels: number;
  /** Pixel columns of the main pane that contain candle color; every candle needs at least one. */
  candleColumns: number;
  width: number;
  height: number;
}

/** Reads the chart's canvas: are candles really painted, not just an empty frame? */
const CHART = `(() => {
  const el = document.querySelector('[data-testid=chart]');
  if (!el) return null;
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const rgb = (name) => {
    probe.style.color = 'var(--tg-color-' + name + ')';
    return (getComputedStyle(probe).color.match(/[0-9]+/g) ?? []).slice(0, 3).map(Number);
  };
  const [up, down] = [rgb('up'), rgb('down')];
  probe.remove();
  const near = (d, i, c) => Math.abs(d[i] - c[0]) <= 8 && Math.abs(d[i + 1] - c[1]) <= 8 && Math.abs(d[i + 2] - c[2]) <= 8 && d[i + 3] > 200;
  let main = null;
  for (const canvas of el.querySelectorAll('canvas')) if (!main || canvas.width * canvas.height > main.width * main.height) main = canvas;
  const out = { symbol: el.dataset.symbol ?? '', candles: Number(el.dataset.candles ?? 0), upPixels: 0, downPixels: 0, candleColumns: 0, width: 0, height: 0 };
  if (!main || main.width === 0 || main.height === 0) return out;
  out.width = main.width;
  out.height = main.height;
  const columns = new Uint8Array(main.width);
  for (const canvas of el.querySelectorAll('canvas')) {
    if (canvas.width !== main.width || canvas.height !== main.height) continue;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const isUp = near(data, i, up);
      const isDown = !isUp && near(data, i, down);
      if (isUp) out.upPixels++;
      if (isDown) out.downPixels++;
      if (isUp || isDown) columns[p % canvas.width] = 1;
    }
  }
  out.candleColumns = columns.reduce((n, v) => n + v, 0);
  return out;
})()`;
const chartOf = (page: Page) => page.evaluate(CHART) as Promise<ChartSeen | null>;

/** The chart must show `symbol` with at least `minCandles` days, and the canvas must really contain them. */
async function checkChartDrawn(page: Page, label: string, symbol: string, minCandles: number): Promise<ChartSeen> {
  let seen: ChartSeen | null = null;
  const painted = (c: ChartSeen | null): c is ChartSeen =>
    c !== null && c.symbol === symbol && c.candles >= minCandles && c.candleColumns >= c.candles && c.upPixels + c.downPixels >= 4 * c.candles;
  // The canvas is painted on the next animation frame after the data changes.
  await waitFor(`${label} chart of ${symbol} painted`, async () => painted((seen = await chartOf(page))), 3000).catch(() => {});
  const c = seen as ChartSeen | null;
  check(c !== null && c.symbol === symbol, `${label} chart shows ${symbol} (got ${c?.symbol})`);
  check(c.candles >= minCandles, `${label} chart of ${symbol} has ${c.candles} candles (at least ${minCandles})`);
  check(painted(c), `${label} chart of ${symbol} has candles painted: ${c.upPixels} up + ${c.downPixels} down pixels in ${c.candleColumns} columns of a ${c.width}x${c.height} canvas`);
  return c;
}

interface CandleSeen {
  symbol: string;
  candles: number;
  at: number;
}

/** Logs every change of the chart's symbol / candle count with a timestamp. */
const CANDLE_RECORDER = `(() => {
  const log = (window.__tgCandles = []);
  let last = '';
  setInterval(() => {
    const el = document.querySelector('[data-testid=chart]');
    if (!el || el.dataset.candles === undefined) return;
    const key = el.dataset.symbol + ' ' + el.dataset.candles;
    if (key !== last) { last = key; log.push({ symbol: el.dataset.symbol, candles: Number(el.dataset.candles), at: performance.now() }); }
  }, 20);
})()`;

interface PerfSeen {
  longMs: number;
  longCount: number;
  maxGapMs: number;
  elapsedMs: number;
}

/** Main-thread health, installed in every page before its scripts: long tasks and timer starvation. */
const PERF_MONITOR = `(() => {
  const perf = (window.__tgPerf = { longMs: 0, longCount: 0, maxGapMs: 0, since: performance.now() });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) { perf.longMs += entry.duration; perf.longCount += 1; }
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    perf.maxGapMs = Math.max(perf.maxGapMs, now - last - 50);
    last = now;
  }, 50);
})()`;
const perfReset = (page: Page) =>
  page.evaluate('void Object.assign(window.__tgPerf, { longMs: 0, longCount: 0, maxGapMs: 0, since: performance.now() })');
const perfOf = (page: Page) =>
  page.evaluate(
    '({ longMs: __tgPerf.longMs, longCount: __tgPerf.longCount, maxGapMs: __tgPerf.maxGapMs, elapsedMs: performance.now() - __tgPerf.since })',
  ) as Promise<PerfSeen>;

const rowOf = (symbol: string) => `${tid('symbol-row')}[data-symbol="${symbol}"]`;

async function checkEarningsReport(page: Page) {
  const companyCount = snapshotsOf('A')[0]!.universe.symbols.filter((s) => s.kind === 'stock').length;
  const q1Earnings = framesOf('A').find((m) => m.t === 'earnings' && m.quarter === 1);
  check(q1Earnings?.t === 'earnings' && q1Earnings.reports.length === companyCount, `A got the Q1 earnings of all ${companyCount} companies`);
  check(q1Earnings.reports.every((r) => Object.keys(r).length === 2 && Number.isFinite(r.surprise) && typeof r.symbol === 'string'),
    'Only the symbol and earnings surprise are sent for each company');
  const earningsPanel = page.locator('section.panel.earnings');
  check(await earningsPanel.getByRole('heading', { name: 'Q1 earnings', exact: true }).isVisible(), 'The Earnings panel is on screen');
  const report = await earningsPanel.innerText();
  check(/beat \+[\d.]+%/.test(report) && /miss -[\d.]+%/.test(report) && !/price|at open/i.test(report),
    'The report shows beats and misses without projected price moves');
  const companyEarnings = page.getByRole('region', { name: 'Company earnings' });
  check((await companyEarnings.locator('li').count()) === companyCount, 'The report lists every company');
  const symbols = await companyEarnings.getByRole('button').allTextContents();
  check(symbols.join(',') === q1Earnings.reports.map((r) => r.symbol).join(','), 'The report preserves the shuffled order');
  const surprises = q1Earnings.reports.map((r) => r.surprise).filter((s) => s !== 0);
  const switches = surprises.filter((s, i) => i > 0 && s * surprises[i - 1]! < 0).length;
  check(switches > 1 && surprises.some((s, i) => i > 0 && Math.abs(s) > Math.abs(surprises[i - 1]!)),
    'Beats and misses are mixed without ranking by surprise');
  // overflow: auto, so a list longer than the panel scrolls inside it.
  check(await companyEarnings.evaluate((el) => el.clientHeight > 0), 'The company list is on screen inside the Earnings panel');
  return q1Earnings;
}

async function checkEarningsAtOpen(page: Page) {
  check((await page.locator('section.panel.earnings').count()) === 0 && await page.locator(tid('chart')).isVisible(),
    'The Earnings panel closes and the chart shows when trading starts');
}

/** Clicks a row and waits until header and chart follow; returns how long that took. */
async function selectSymbol(page: Page, symbol: string): Promise<number> {
  const started = Date.now();
  await page.click(rowOf(symbol));
  await page.waitForSelector(`${tid('selected-symbol')}[data-symbol="${symbol}"]`);
  await page.waitForSelector(`${tid('chart')}[data-symbol="${symbol}"]`);
  return Date.now() - started;
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
      await context.addInitScript(PERF_MONITOR);
      const page = await context.newPage();
      const frames: ServerMsg[] = [];
      wire.set(label, frames);
      page.on('websocket', (ws) => {
        ws.on('framereceived', (frame) => {
          if (typeof frame.payload !== 'string') return;
          try {
            const message = JSON.parse(frame.payload) as ServerMsg;
            if (typeof message.t === 'string') frames.push(message);
          } catch {
            // Vite's own HMR socket also passes by; anything that is not JSON is not ours.
          }
        });
      });
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

    if (earningsOnly) {
      await step('earnings are available before the open and clear during trading', async () => {
        await a.click(tid('start-button'));
        // No earnings phase: the report comes out as trading closes and shows at the next briefing.
        await waitForPhase(a, 'RESULTS', TRADING_MS + WAIT_MS);
        await waitFor('the Q1 earnings report', async () => framesOf('A').some((m) => m.t === 'earnings' && m.quarter === 1));
        check(true, 'The report is released as trading closes');
        for (const phase of ['RESULTS', 'SHOP'] as const) {
          await waitForPhase(a, phase);
          check((await a.locator(tid('earnings')).count()) === 0, `The report is hidden during ${phase}`);
        }
        await waitForPhase(a, 'BRIEFING');
        const report = await checkEarningsReport(a);
        const briefingBox = await a.locator('section.panel.earnings').boundingBox();
        check(briefingBox !== null && briefingBox.height >= 120, `The report has ${Math.round(briefingBox?.height ?? 0)}px over the chart in Briefing`);
        const pick = report.reports.at(-1)!;
        await a.getByRole('region', { name: 'Company earnings' }).getByRole('button', { name: pick.symbol, exact: true }).click();
        check((await a.getAttribute(tid('selected-symbol'), 'data-symbol')) === pick.symbol, 'A player can select a stock from earnings during briefing');
        await shot(a, 'earnings-briefing-q2');

        await waitFor('first tick of Q2', async () => ticksOf('A').some((t) => t.day === DAYS));
        await checkEarningsAtOpen(a);
        check((await a.getAttribute(tid('selected-symbol'), 'data-symbol')) === pick.symbol, 'The prepared stock stays selected when trading starts');

        const beforeReload = framesOf('A').length;
        await a.reload();
        await waitFor('replayed earnings', async () => framesOf('A').slice(beforeReload).some((m) => m.t === 'earnings' && m.quarter === 1));
        const replay = framesOf('A').slice(beforeReload).find((m) => m.t === 'earnings');
        check(JSON.stringify(replay) === JSON.stringify(report), 'Reconnect replays the same public report');
        check((await a.locator(tid('earnings')).count()) === 0, 'Reconnecting during trading keeps the report hidden');
        check(problems.length === 0, `Clean browser logs: ${problems.join(', ')}`);
        await shot(a, 'news-trading-q2');

        await waitForPhase(a, 'FINAL', TRADING_MS + WAIT_MS);
        await a.waitForSelector(tid('finale'));
        check(true, 'The finale takes over the desk in FINAL');
        await checkNoOverflow(a, 'Final desk at 1366x768');
        await shot(a, 'news-final');
      });
      log(`PASS: ${checks} checks. Screenshots: ${outDir}`);
      return;
    }

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

      const [first, second] = await wsCollect(wsUrl, { t: 'join', role: 'spectator' }, 2);
      check(first?.t === 'welcome' && second?.t === 'market', `welcome is followed by market through the proxy (got ${first?.t}, ${second?.t})`);
      const market = second as MarketMsg;
      const kinds = market.universe.symbols.map((s) => s.kind);
      check(market.universe.symbols.length === SYMBOL_COUNT, `the lobby snapshot lists ${SYMBOL_COUNT} symbols (got ${market.universe.symbols.length})`);
      check(
        kinds.filter((k) => k === 'index').length === 1 &&
          kinds.filter((k) => k === 'sector').length === SECTORS.length &&
          kinds.filter((k) => k === 'stock').length === SECTORS.length * COMPANIES_PER_SECTOR,
        `1 index fund, ${SECTORS.length} sector funds, ${SECTORS.length * COMPANIES_PER_SECTOR} stocks`,
      );
      check(market.day === 0 && market.tickOfDay === 0 && market.current === null && Object.keys(market.prices).length === SYMBOL_COUNT,
        'the lobby snapshot is at day 0 with a start price for every symbol and no candle in progress');
      const hidden = ['betaM', 'betaS', 'sigmaI', 'rateSensitivity', 'adv', 'fundamentals', 'weights', 'units'];
      check(market.universe.symbols.every((s) => hidden.every((k) => !(k in s))), 'no hidden company parameters on the wire');
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
      // Order on the wire, not timing: BRIEFING is short and a screenshot can outlast it.
      const framesA = framesOf('A');
      const firstMarket = framesA.findIndex((m) => m.t === 'tick' || m.t === 'candle');
      const tradingAt = framesA.findIndex((m) => m.t === 'phase' && m.phase === 'TRADING');
      check(tradingAt >= 0 && (firstMarket === -1 || firstMarket > tradingAt), 'no tick or candle in LOBBY or the first BRIEFING');
      await Promise.all([perfReset(a), perfReset(b), perfReset(floor)]);
      await a.evaluate(CANDLE_RECORDER);
      await shot(a, '11-play-TRADING');
      await shot(floor, '12-floor-TRADING');
      await checkNoOverflow(a, 'desk in TRADING at 1366x768');
      await checkNoOverflow(floor, 'floor in TRADING');
    });

    await step('countdown counts down and agrees between views', async () => {
      const first = countdownSeconds(await textOf(a, 'countdown'));
      const floorFirst = countdownSeconds(await textOf(floor, 'countdown'));
      const bFirst = countdownSeconds(await textOf(b, 'countdown'));
      const tradingS = TRADING_MS / 1000;
      check(first !== null && first >= tradingS - 2 && first <= tradingS, `A countdown starts near ${tradingS} s in TRADING (got ${first})`);
      check(floorFirst !== null && Math.abs(floorFirst - first) <= 1, `floor countdown agrees with A (${floorFirst} vs ${first})`);
      check(bFirst !== null && Math.abs(bFirst - first) <= 1, `B countdown agrees with A (${bFirst} vs ${first})`);
      await sleep(2000);
      const second = countdownSeconds(await textOf(a, 'countdown'));
      check(second !== null && first - second >= 1 && first - second <= 3, `A countdown went down by about 2 s (${first} -> ${second})`);
    });

    // Public universe as player A received it; the tickers depend on the seed, so nothing is hard-coded.
    const universe = snapshotsOf('A')[0]!.universe.symbols;
    const indexSymbol = universe.find((s) => s.kind === 'index')!.symbol;
    const sectorFund = universe.find((s) => s.kind === 'sector')!.symbol;
    const stocks = universe.filter((s) => s.kind === 'stock');
    const stockA = stocks[0]!.symbol;
    const stockB = stocks[COMPANIES_PER_SECTOR + 2]!.symbol;

    await step(`market: ${SYMBOL_COUNT} symbols in ${SECTORS.length + 1} groups with live prices on both players`, async () => {
      for (const [label, page] of [['A', a], ['B', b]] as const) {
        const board = await boardOf(page);
        check(board.length === SYMBOL_COUNT, `${label} lists ${SYMBOL_COUNT} symbols (got ${board.length})`);
        const groups = [...new Set(board.map((r) => r.group))];
        check(groups.join(',') === ['index', ...SECTORS].join(','), `${label} shows the market index above the ${SECTORS.length} sectors`);
        check(board[0]?.symbol === indexSymbol, `${label} shows ${indexSymbol} as its first row`);
        for (const sector of SECTORS) {
          const fund = universe.find((s) => s.kind === 'sector' && s.sector === sector);
          const expected = [fund?.symbol, ...stocks.filter((s) => s.sector === sector).map((s) => s.symbol)];
          check(board.filter((r) => r.group === sector).map((r) => r.symbol).join(',') === expected.join(','),
            `${label} lists the ${sector} fund above its companies`);
        }
        const indexBox = await page.locator(rowOf(indexSymbol)).boundingBox();
        const listBox = await page.locator(tid('symbol-list')).boundingBox();
        const stockBox = await page.locator(rowOf(stockA)).boundingBox();
        check(indexBox && listBox && stockBox && Math.abs(indexBox.width - listBox.width) < 1 &&
          Math.abs(indexBox.x - listBox.x) < 1 && indexBox.height > stockBox.height,
          `${label} shows the index in a taller, full-width row`);
        check(board.every((r) => /^[\d,]+\.\d\d$/.test(r.price) && shownPrice(r.price) > 0), `${label} shows a price with 2 decimals on every row`);
        check(board.every((r) => /^[+-]?\d+\.\d+%$/.test(r.change)), `${label} shows a change % on every row`);
        check((await page.locator(tid('symbol-list')).isVisible()) && (await page.locator(rowOf(universe.at(-1)!.symbol)).isVisible()),
          `${label} has the list on screen down to the last row`);
      }
      const before = await boardOf(a);
      // The list repaints a tenth of its rows per tick: give it two seconds.
      await sleep(2 * DAY_MS);
      const after = await boardOf(a);
      const moved = after.filter((r, i) => r.price !== before[i]!.price).length;
      check(moved >= SYMBOL_COUNT * 0.8, `prices move: ${moved} of ${SYMBOL_COUNT} changed within two seconds`);
    });

    await step('market: both windows show the same server tick', async () => {
      const SAMPLES = 6;
      let worstLag = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const [boardA, boardB] = await Promise.all([boardOf(a), boardOf(b)]);
        // The frame log on our side can lag the page by a moment.
        await sleep(130);
        const [tickA, tickB] = [tickShownBy('A', boardA), tickShownBy('B', boardB)];
        if (!tickA || !tickB) throw new Error(`CHECK FAILED: sample ${i}: a row in the list of ${tickA ? 'B' : 'A'} shows no price of its last ${RECENT_TICKS} ticks`);
        worstLag = Math.max(worstLag, Math.abs(tickId(tickA) - tickId(tickB)));
      }
      check(true, `in ${SAMPLES} samples every row of each window showed a price from a tick it had received`);
      check(worstLag <= 3, `the newest prices on the two windows were never more than ${worstLag} tick(s) apart (limit 3)`);
      const fromB = new Map(ticksOf('B').map((t) => [tickId(t), JSON.stringify(t.prices)]));
      const common = ticksOf('A').filter((t) => fromB.has(tickId(t)));
      check(common.length >= 10 && common.every((t) => fromB.get(tickId(t)) === JSON.stringify(t.prices)),
        `A and B received identical prices for all ${common.length} ticks both saw`);
    });

    await step('market: a clicked stock gets a candle chart that grows one candle per second', async () => {
      check((await a.getAttribute(tid('selected-symbol'), 'data-symbol')) === indexSymbol, `the index fund ${indexSymbol} is selected by default`);
      const indexChart = await checkChartDrawn(a, 'A', indexSymbol, 2);
      await selectSymbol(a, sectorFund);
      // Responsiveness under 10 Hz ticks, measured inside the page: click -> header and chart have switched and a frame was painted.
      const took = (await a.evaluate(`(async () => {
        const started = performance.now();
        document.querySelector('${rowOf(stockA)}').click();
        const done = () => ['selected-symbol', 'chart'].every((id) => document.querySelector('[data-testid=' + id + ']')?.dataset.symbol === '${stockA}');
        do await new Promise((r) => requestAnimationFrame(r)); while (!done());
        return performance.now() - started;
      })()`)) as number;
      check(took < 250, `clicking ${stockA} switched header and chart within ${Math.round(took)} ms (limit 250)`);
      check((await textOf(a, 'selected-ticker')) === stockA, `the header shows ${stockA}`);
      check((await textOf(a, 'selected-name')) === stocks[0]!.name, `the header shows its company name (${stocks[0]!.name})`);
      const eps = await textOf(a, 'selected-eps');
      check(/^\$\d+\.\d{2}$/.test(eps), `the header shows the stock's earnings consensus (EPS est. ${eps})`);
      check((await a.getAttribute(rowOf(stockA), 'aria-pressed')) === 'true' && (await a.getAttribute(rowOf(indexSymbol), 'aria-pressed')) === 'false',
        'the clicked row is the selected one');
      // B picks another stock: selections are per player, and B's must survive its reload below.
      await selectSymbol(b, stockB);
      check((await a.getAttribute(tid('selected-symbol'), 'data-symbol')) === stockA, "B's selection does not change A's");
      await sleep(3 * DAY_MS + 300);
      const stockChart = await checkChartDrawn(a, 'A', stockA, indexChart.candles + 2);
      // Compare with the tick of the same moment: a screenshot below can take a game day or more.
      const tickAtChart = ticksOf('A').at(-1)!;
      const headPrice = shownPrice(await textOf(a, 'selected-price'));
      await sleep(130);
      check(ticksOf('A').slice(-8).some((t) => t.prices[stockA] === headPrice), `the header price ${headPrice} is a recent tick price of ${stockA}`);
      await shot(a, '15-play-chart-stock');

      const grown = ((await a.evaluate('window.__tgCandles')) as CandleSeen[]).filter((e) => e.candles > 0);
      const gaps: number[] = [];
      let stepsOfOne = true;
      for (let i = 2; i < grown.length; i++) {
        const [prev, cur] = [grown[i - 1]!, grown[i]!];
        if (cur.candles === prev.candles) continue; // only the symbol changed
        if (cur.candles !== prev.candles + 1) stepsOfOne = false;
        // A gap that starts at a symbol switch is shorter than a day.
        if (cur.symbol === prev.symbol && grown[i - 2]!.symbol === prev.symbol) gaps.push(cur.at - prev.at);
      }
      const worst = Math.max(...gaps.map((g) => Math.abs(g - DAY_MS)));
      log(`  candle count on A: ${grown.map((e) => `${e.symbol}:${e.candles}`).join(' ')}`);
      check(stepsOfOne && gaps.length >= 3, `the chart grew by exactly one candle at a time (${gaps.length} timed steps)`);
      check(worst <= 300, `one new candle per second: each step took ${DAY_MS} ms, worst off by ${Math.round(worst)} ms (limit 300)`);
      check(Math.abs(stockChart.candles - (tickAtChart.day + 1)) <= 1, `the chart has one candle per game day (${stockChart.candles} candles, day ${tickAtChart.day})`);

      await selectSymbol(a, indexSymbol);
      await checkChartDrawn(a, 'A', indexSymbol, stockChart.candles);
      await shot(a, '16-play-chart-index');
      await selectSymbol(a, sectorFund);
      await checkChartDrawn(a, 'A', sectorFund, stockChart.candles);
      await selectSymbol(a, stockA);
    });

    await step('projector: net worth chart and current standings', async () => {
      const chart = floor.locator(tid('net-worth-chart'));
      await waitFor('projector net worth by trading day', async () => Number(await chart.getAttribute('data-day')) >= 5);
      const floorChart = await chart.boundingBox();
      check(floorChart !== null, 'the floor shows the net-worth chart');
      check(floorChart.width >= 900 && floorChart.height >= 400, `the floor chart is large (${floorChart.width}x${floorChart.height})`);
      check(await chart.locator('canvas').count() > 0, 'the projector chart is drawn');
      const values = await floor.locator(tid('net-worth-value')).allTextContents();
      check(values.length === 2 && values.every((value) => Number(value.replace(/[$,]/g, '')) === defaultConfig.economy.startingCash),
        'the projector shows the starting net worth for both players');
      await shot(floor, '17-floor-chart');
      await checkNoOverflow(floor, 'floor with the chart');
      await checkNoOverflow(a, 'desk with list and chart at 1366x768');
    });

    await step('browser health with ticks at 10 Hz', async () => {
      for (const [label, page] of [['A', a], ['B', b], ['floor', floor]] as const) {
        const perf = await perfOf(page);
        const share = perf.longMs / perf.elapsedMs;
        log(`  ${label}: ${Math.round(perf.elapsedMs)} ms of TRADING, ${perf.longCount} long tasks = ${Math.round(perf.longMs)} ms (${(share * 100).toFixed(1)}%), worst timer delay ${Math.round(perf.maxGapMs)} ms`);
        check(share < 0.15, `${label} main thread spent ${(share * 100).toFixed(1)}% of TRADING in long tasks (limit 15%)`);
        check(perf.maxGapMs < 400, `${label} worst timer delay ${Math.round(perf.maxGapMs)} ms (limit 400)`);
        const perSecond = ticksOf(label).length / (perf.elapsedMs / 1000);
        check(perSecond > 8 && perSecond < 12, `${label} received about 10 ticks per second (${perSecond.toFixed(1)})`);
      }
    });

    await step('trading: six bet buttons, fills, positions and P&L show, cash out works', async () => {
      const money = (text: string) => Number(text.replace(/[^0-9.-]/g, ''));
      const startCash = defaultConfig.economy.startingCash;
      const cap = defaultConfig.trading.leverageCap;
      const stakes = defaultConfig.trading.quickBetStakes;
      const fillsOf = (label: string) => framesOf(label).filter((m) => m.t === 'fill') as Array<{ symbol: string; qty: number; price: number }>;
      const positionRow = (symbol: string) => `${tid('position-row')}[data-symbol="${symbol}"]`;
      check((await phaseOf(a)) === 'TRADING', 'still in TRADING for the trading checks');
      check(money(await textOf(a, 'equity')) === startCash, `A starts with ${startCash} equity`);

      // Six buttons: a green ▲ row and a red ▼ row, one amount each (a share of the money A can bet).
      const ups = a.locator('[data-testid^=bet-up-]');
      const downs = a.locator('[data-testid^=bet-down-]');
      check((await ups.count()) === stakes.length && (await downs.count()) === stakes.length, `the bet panel has ${2 * stakes.length} buttons`);
      const upText = (await ups.first().textContent())?.trim() ?? '';
      const downText = (await downs.first().textContent())?.trim() ?? '';
      check(upText.startsWith('▲') && downText.startsWith('▼') && /\$[\d.]+[KMB]?/.test(upText), `buttons show an arrow and an amount ("${upText}", "${downText}")`);
      const colors = (await a.evaluate(`[...document.querySelectorAll('[data-testid^=bet-]')].map((el) => el.dataset.testid + '=' + getComputedStyle(el).backgroundColor)`)) as string[];
      const upColor = colors.find((c) => c.startsWith('bet-up-0='))!.split('=')[1];
      const downColor = colors.find((c) => c.startsWith('bet-down-0='))!.split('=')[1];
      check(upColor !== downColor && colors.filter((c) => c.startsWith('bet-up-')).every((c) => c.endsWith(upColor!)), `up buttons share one color (${upColor}), down another (${downColor})`);
      check((await a.locator('[data-testid^=stake-], [data-testid^=side-], [data-testid^=size-], [data-testid^=mode-]').count()) === 0,
        'no stake picker, no up/down switch, no size rows and no mode switch');

      // A bets the first amount UP on stockA.
      await a.click(tid('bet-up-0'));
      await a.waitForSelector(positionRow(stockA));
      const qtyA = Number(await a.locator(`${positionRow(stockA)} ${tid('position-qty')}`).getAttribute('data-qty'));
      const fillA = fillsOf('A').at(-1)!;
      check(fillA?.symbol === stockA && fillA.qty === qtyA && qtyA > 0, `A bought ${qtyA} ${stockA} @ ${fillA?.price}`);
      const wantA = stakes[0]! * cap * startCash;
      check(Math.abs(qtyA * fillA.price - wantA) < 0.03 * wantA, `about ${Math.round(wantA)} worth (${Math.round(qtyA * fillA.price)})`);
      check(!framesOf('B').some((m) => m.t === 'fill') && !framesOf('floor').some((m) => m.t === 'fill' || m.t === 'portfolio'),
        "B and the floor do not see A's fill or portfolio");

      // B bets the second amount DOWN on stockB: a short.
      await b.click(tid('bet-down-1'));
      await b.waitForSelector(positionRow(stockB));
      const qtyB = Number(await b.locator(`${positionRow(stockB)} ${tid('position-qty')}`).getAttribute('data-qty'));
      check(qtyB < 0, `B is short ${qtyB} ${stockB}`);
      // From the server portfolio sent with the fill: the live value moves with every tick.
      const portfolioAfterFill = (label: string) => {
        const frames = framesOf(label);
        const at = frames.lastIndexOf(frames.filter((m) => m.t === 'fill').at(-1)!);
        return frames.slice(at).find((m) => m.t === 'portfolio') as { buyingPower?: number; cash: number; equity: number; positions: unknown[] } | undefined;
      };
      await waitFor('B portfolio after its fill', async () => portfolioAfterFill('B') !== undefined);
      const bpB = portfolioAfterFill('B')!.buyingPower ?? NaN;
      const leftB = 1 - stakes[1]!;
      check(bpB > (leftB - 0.05) * cap * startCash && bpB < (leftB + 0.05) * cap * startCash, `B has about ${Math.round(leftB * 100)}% of its buying power left at the fill (${Math.round(bpB)})`);
      await shot(b, '19-play-trading-B');
      await shot(a, '19-play-trading-A');
      await checkNoOverflow(a, 'desk with positions at 1366x768');

      // Cash out the whole position from the positions table.
      await a.click(`${positionRow(stockA)} ${tid('position-close')}`);
      await a.waitForSelector(positionRow(stockA), { state: 'detached' });
      check(fillsOf('A').at(-1)!.qty < 0, 'cashing out sold the position');
      const pnl = await textOf(a, 'total-pnl');
      check(/^\([+-]?\d+\.\d{1,2}%\)$/.test(pnl), `A shows the return percentage after cashing out: ${pnl}`);
      // Flat again: equity is exactly the cash (a 4x round trip can move it by any amount, so no range check).
      await waitFor('A portfolio after cashing out', async () => portfolioAfterFill('A')?.positions.length === 0);
      const flat = portfolioAfterFill('A')!;
      check(flat.equity === flat.cash && flat.equity > 0, `A is flat: equity ${flat.equity} = cash ${flat.cash}`);
    });

    await step('reload mid-game resumes the same player; a late joiner is refused', async () => {
      await b.reload();
      await b.waitForSelector(`${tid('phase')}[data-phase=TRADING]`);
      check((await textOf(b, 'me-name')) === 'Bud', 'B is still Bud after a mid-game reload');
      await b.waitForSelector(rowOf(stockB));
      const board = await boardOf(b);
      check(board.length === SYMBOL_COUNT && board.every((r) => shownPrice(r.price) > 0), `the reloaded tab lists ${SYMBOL_COUNT} symbols with prices`);
      check((await b.getAttribute(tid('selected-symbol'), 'data-symbol')) === stockB, `the reloaded tab still has ${stockB} selected`);
      await b.waitForSelector(`${tid('position-row')}[data-symbol="${stockB}"]`);
      check(true, `the reloaded tab still shows B's short in ${stockB}`);
      // Only headlines from the last few seconds (NewsPile FRESH_MS = 4 s, plus a day of rounding) land on a fresh page.
      const reloadedPapers = (await b.evaluate(`[...document.querySelectorAll('[data-testid=headline]')].map((el) => el.dataset.id)`)) as string[];
      const tsOf = new Map((framesOf('B').filter((m) => m.t === 'headline') as Array<{ id: string; ts: number }>).map((h) => [h.id, h.ts]));
      const reloadDay = snapshotsOf('B').at(-1)!.day;
      const ages = reloadedPapers.map((id) => (reloadDay - (tsOf.get(id) ?? -Infinity)) * DAY_MS);
      check(ages.every((age) => age <= 4_000 + DAY_MS),
        `the reloaded tab does not pile up old replayed headlines (papers ${reloadedPapers.join(', ') || 'none'}, ages ${ages.map((x) => Math.round(x)).join(', ')} ms)`);
      const snapshot = snapshotsOf('B').at(-1)!;
      check(snapshot.day >= 5 && (snapshot.candles[stockB]?.length ?? 0) === snapshot.day * 4,
        `the reload got a snapshot with ${snapshot.day} closed candles of history`);
      const restored = await checkChartDrawn(b, 'B after reload', stockB, snapshot.day);
      const onA = await chartOf(a);
      check(onA !== null && Math.abs(onA.candles - restored.candles) <= 1, `B's restored chart has as many candles as A's (${restored.candles} vs ${onA?.candles})`);
      // The list repaints a tenth of its rows per tick: within a second, rows show prices of ticks after the snapshot.
      await sleep(DAY_MS);
      const live = await boardOf(b);
      await sleep(130);
      const newer = ticksOf('B').filter((t) => tickId(t) > tickId(snapshot));
      const fresh = live.filter((r) => shownPrice(r.price) !== snapshot.prices[r.symbol] && newer.some((t) => t.prices[r.symbol] === shownPrice(r.price)));
      check(fresh.length > 0, `the reloaded list is live again: ${fresh.length} rows show prices of ticks newer than the snapshot`);
      await shot(b, '18-play-after-reload');
      const [cdA, cdB] = [countdownSeconds(await textOf(a, 'countdown')), countdownSeconds(await textOf(b, 'countdown'))];
      check(cdA !== null && cdB !== null && Math.abs(cdA - cdB) <= 1, `B countdown after reload agrees with A (${cdB} vs ${cdA})`);
      check((await b.locator(tid('rival')).count()) === 1, 'B still sees the other player in its rivals panel');

      const late = await newPage('late', 1366, 768);
      await late.goto(`${base}/play`);
      await late.fill(tid('name-input'), 'Late');
      await late.click(tid('join-button'));
      await late.waitForSelector(tid('error'));
      check((await late.getAttribute(tid('error'), 'data-code')) === 'game_in_progress', 'late joiner gets game_in_progress');
      await shot(late, '13-late-join');
      await late.context().close();
    });

    await step('headlines: both players get the same news, 2-10 s apart, in one fixed slot that opens the stock', async () => {
      const headlineFrames = (label: string) => framesOf(label).filter((m) => m.t === 'headline') as Array<{ id: string; text: string; ts: number; symbol?: string; early?: boolean }>;
      await waitFor('a first headline', async () => headlineFrames('A').length >= 1);
      const onA = headlineFrames('A');
      check(onA.every((h) => !/\{[A-Z_]+\}/.test(h.text)), `every headline has its slots filled (${onA.length} so far)`);
      check(new Set(onA.map((h) => h.id)).size === onA.length, 'no headline id repeats on the wire');
      const idsB = new Set(headlineFrames('B').map((h) => h.id));
      check(onA.filter((h) => !h.early).slice(-3).every((h) => idsB.has(h.id)), 'B received the same latest headlines as A');
      check(!headlineFrames('floor').some((h) => h.early), 'no early (insider) headline reached the floor');

      // Headlines land as papers on a messy pile over the cards; the newest is on top.
      const top = `${tid('headline')}[data-depth="0"]`;
      const seenBefore = headlineFrames('A').length;
      await waitFor('a new headline', async () => headlineFrames('A').length > seenBefore);
      const latest = headlineFrames('A').at(-1)!;
      await waitFor('the newest paper on top of the pile', async () => (await a.getAttribute(top, 'data-id')) === latest.id);
      check((await a.locator(top).locator(tid('headline-text')).textContent())?.trim() === latest.text, `the top paper shows the latest headline: "${latest.text}"`);
      const ticker = ((await a.locator(top).locator(tid('headline-ticker')).textContent()) ?? '').trim();
      check(ticker.length > 0 && (latest.symbol === undefined || ticker === latest.symbol), `the paper names its stock (${ticker})`);
      const style = async (selector: string, prop: string) => (await a.evaluate(`getComputedStyle(document.querySelector('${selector}')).${prop}`)) as string;
      const tickerBg = await style(`${top} ${tid('headline-ticker')}`, 'backgroundColor');
      const paperBg = await style(top, 'backgroundColor');
      check(tickerBg !== paperBg && !/rgba\(0, 0, 0, 0\)/.test(tickerBg), `the ticker wears a color of its own (${tickerBg})`);
      // In the tray at the bottom right, under the cards, angled (measured after the 380 ms drop-in).
      await sleep(450);
      const [paperBox, handBox, trayBox] = [await a.locator(top).boundingBox(), await a.locator('.desk__hand').boundingBox(), await a.locator('.desk__news').boundingBox()];
      check(paperBox !== null && handBox !== null && trayBox !== null && paperBox.y >= handBox.y + handBox.height - 6 &&
        paperBox.y + paperBox.height <= trayBox.y + trayBox.height + 1,
        `the paper lies in the tray under the cards (paper ${JSON.stringify(paperBox)}, cards ${JSON.stringify(handBox)}, tray ${JSON.stringify(trayBox)})`);
      // The news tray starts below the cards, and the positions panels share their top and bottom.
      const [positionsBox, rivalsBox] = [await a.locator('.desk__positions').boundingBox(), await a.locator('.desk__rivals').boundingBox()];
      check(Math.abs(handBox!.y + handBox!.height + 8 - trayBox!.y) < 1.5,
        `the bottom row lines up with the bottom of the cards (cards end ${Math.round(handBox!.y + handBox!.height)}, row starts ${Math.round(trayBox!.y)})`);
      const listBox = (await a.locator('.desk__list').boundingBox())!;
      check(positionsBox !== null && rivalsBox !== null && Math.abs(positionsBox.y - rivalsBox.y) < 1 &&
        Math.abs(positionsBox.height - rivalsBox.height) < 1 &&
        Math.abs(listBox.y + listBox.height + 8 - rivalsBox.y) < 1.5,
        'both positions panels have the same height and start just below the stock list');
      // The stock list fits its panel exactly: nothing to scroll.
      const listScroll = (await a.evaluate(`(() => { const b = document.querySelector('.desk__list .panel__body'); return [b.scrollHeight, b.clientHeight]; })()`)) as [number, number];
      check(listScroll[0] <= listScroll[1] + 1, `the stock list does not scroll (content ${listScroll[0]} px, room ${listScroll[1]} px)`);
      check((await style(top, 'transform')) !== 'none', 'the paper is angled');
      // Inside its column: never over the positions or the chart.
      const sideBox = trayBox!;
      check(paperBox!.x >= sideBox.x - 1 && paperBox!.x + paperBox!.width <= sideBox.x + sideBox.width + 1,
        `the paper stays inside its column (paper x ${Math.round(paperBox!.x)}..${Math.round(paperBox!.x + paperBox!.width)}, column ${Math.round(sideBox.x)}..${Math.round(sideBox.x + sideBox.width)})`);
      check((await a.locator(`${top} button`).count()) === 2 && (await a.locator(`${top} ${tid('headline-close')}`).count()) === 1 &&
        (await a.locator(`${top} button${tid('headline-ticker')}`).count()) === 1,
        'a paper has two buttons: its x and its ticker');
      // A headline arriving mid-check drops in for a moment: read the box once it holds still.
      const stillBox = async (selector: string) => {
        let box = await a.locator(selector).boundingBox();
        for (let i = 0; i < 20; i++) {
          await sleep(120);
          const again = await a.locator(selector).boundingBox();
          if (box !== null && again !== null && again.x === box.x && again.y === box.y) return again;
          box = again;
        }
        return box;
      };
      // Dragging moves a paper (and selects nothing).
      const pinned = `${tid('headline')}[data-id="${await a.getAttribute(top, 'data-id')}"]`;
      const selectedBefore = await a.getAttribute(tid('selected-symbol'), 'data-symbol');
      const before = await stillBox(pinned);
      await a.mouse.move(before!.x + before!.width / 2, before!.y + 30);
      await a.mouse.down();
      await a.mouse.move(before!.x + before!.width / 2 - 80, before!.y - 90, { steps: 8 });
      await a.mouse.up();
      const after = await stillBox(pinned);
      check(after !== null && before!.x - after.x > 60 && before!.y - after.y > 70, `dragging moves the paper (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
      check((await a.getAttribute(tid('selected-symbol'), 'data-symbol')) === selectedBefore, 'a drag does not open the stock');
      // Nothing moves on hover, and a plain click does nothing.
      const resting = await stillBox(pinned);
      await a.mouse.move(resting!.x + 60, resting!.y + 60);
      await sleep(300);
      const hovered = await a.locator(pinned).boundingBox();
      check(hovered !== null && Math.abs(hovered.x - resting!.x) < 1 && Math.abs(hovered.y - resting!.y) < 1, 'hovering a paper does not move it');
      const hand = (await a.locator('.desk__hand').boundingBox())!;
      const pileBefore = (await a.locator(tid('news-pile')).boundingBox())!;
      await a.mouse.move(hand.x + 20, hand.y + 12);
      await sleep(300);
      const pileAfter = (await a.locator(tid('news-pile')).boundingBox())!;
      check(Math.abs(pileAfter.y - pileBefore.y) < 1, 'hovering the cards does not move the pile');
      await shot(a, '20-play-headline');
      // A click on a paper does nothing: it does not open the stock, and the paper stays.
      const openId = await a.getAttribute(top, 'data-id');
      const selectedNow = await a.getAttribute(tid('selected-symbol'), 'data-symbol');
      await a.click(top, { position: { x: 60, y: 70 } });
      await sleep(200);
      check((await a.getAttribute(tid('selected-symbol'), 'data-symbol')) === selectedNow, 'clicking a paper does not open its stock');
      check((await a.locator(`${tid('headline')}[data-id="${openId}"]`).count()) === 1, 'the paper stays after a click');
      // Its ticker opens the stock (start from another one, so the change shows).
      // (The paper on top right now: a new headline may have landed on the one above.)
      const tickerId = (await a.getAttribute(top, 'data-id'))!;
      const tickerOfPaper = (await a.getAttribute(`${tid('headline')}[data-id="${tickerId}"]`, 'data-ticker'))!;
      await selectSymbol(a, tickerOfPaper === stockA ? indexSymbol : stockA);
      // A human click: press near the ticker's edge, wobble a pixel, release.
      const tickerBox = (await a.locator(`${tid('headline')}[data-id="${tickerId}"] ${tid('headline-ticker')}`).boundingBox())!;
      const paperBefore = (await a.locator(`${tid('headline')}[data-id="${tickerId}"]`).boundingBox())!;
      await a.mouse.move(tickerBox.x + 6, tickerBox.y + tickerBox.height - 5);
      await a.mouse.down();
      await a.mouse.move(tickerBox.x + 7, tickerBox.y + tickerBox.height - 4);
      await a.mouse.up();
      await a.waitForSelector(`${tid('selected-symbol')}[data-symbol="${tickerOfPaper}"]`);
      const paperAfter = (await a.locator(`${tid('headline')}[data-id="${tickerId}"]`).boundingBox())!;
      check(Math.abs(paperAfter.x - paperBefore.x) < 1 && Math.abs(paperAfter.y - paperBefore.y) < 1,
        `clicking the ticker opened ${tickerOfPaper} without dragging the paper, and the paper stays`);
      // It stays until later headlines bury it: the next one lands on top, the old one under it.
      const seenNow = headlineFrames('A').length;
      await waitFor('the next headline', async () => headlineFrames('A').length > seenNow);
      const next = headlineFrames('A').at(-1)!;
      await waitFor('the next paper on top', async () => (await a.getAttribute(top, 'data-id')) === next.id);
      const buried = await a.getAttribute(`${tid('headline')}[data-id="${openId}"]`, 'data-depth').catch(() => null);
      check(buried !== null && Number(buried) >= 1, `the old paper is buried under the new one (depth ${buried})`);
      const tilts = (await a.evaluate(`[...document.querySelectorAll('${tid('headline')}')].map((el) => getComputedStyle(el).transform)`)) as string[];
      check(new Set(tilts).size === tilts.length && tilts.length >= 2, `the pile has ${tilts.length} papers, each at its own angle`);
      // Right click throws a paper off screen.
      const thrownId = await a.getAttribute(top, 'data-id');
      await a.click(top, { button: 'right' });
      await waitFor('the thrown paper to leave', async () => (await a.locator(`${tid('headline')}[data-id="${thrownId}"]`).count()) === 0);
      check(true, `right click threw paper ${thrownId} off the screen`);
      // The x throws a paper away too.
      const closedId = await a.getAttribute(top, 'data-id');
      await a.click(`${top} ${tid('headline-close')}`);
      await waitFor('the closed paper to leave', async () => (await a.locator(`${tid('headline')}[data-id="${closedId}"]`).count()) === 0);
      check(true, `the x threw paper ${closedId} away`);
      await a.mouse.move(5, 5);
      // Pace (this run's faster setting): 2 to 6 s of game time between two public headlines.
      const pub = headlineFrames('A').filter((h) => !h.early);
      const gaps = pub.slice(1).map((h, i) => (h.ts - pub[i]!.ts) * DAY_MS);
      const minGap = 2_000;
      const maxGap = 6_000;
      check(gaps.length > 0 && gaps.every((g) => g >= minGap - 1 && g <= maxGap + 2 * minGap),
        `headlines come ${minGap / 1000}-${maxGap / 1000} s apart (gaps ${gaps.map((g) => (g / 1000).toFixed(1)).join(', ')} s)`);

      // A quick bet is a plain position (checked again at RESULTS).
      await selectSymbol(a, stockA); // later steps expect A's own pick
      const fillsBefore = framesOf('A').filter((m) => m.t === 'fill').length;
      await a.click(tid('bet-up-0'));
      await waitFor('a bet fill', async () => framesOf('A').filter((m) => m.t === 'fill').length > fillsBefore);
      quickBetSymbol = (framesOf('A').filter((m) => m.t === 'fill').at(-1) as { symbol: string }).symbol;
      await shot(a, '20-play-desk');
      await checkNoOverflow(a, 'desk with the headline slot');
    });

    await step('every phase of every quarter, then FINAL', async () => {
      // The checks below are about Q1's phases: if the earlier steps overran Q1, say so instead of
      // failing later on a confusing count.
      check((await textOf(a, 'quarter')).startsWith('Q1') && (await phaseOf(a)) === 'TRADING',
        `the earlier steps finished inside Q1's trading (now ${await textOf(a, 'quarter')} ${await phaseOf(a)}); raise DAYS if not`);
      for (const phase of ['RESULTS', 'SHOP'] as const) {
        // The earlier steps can finish with most of Q1's trading still to go, so RESULTS may be up to a
        // whole TRADING phase away. A plain WAIT_MS made this step pass or fail with the speed of the run.
        await waitForPhase(a, phase, phase === 'RESULTS' ? TRADING_MS + WAIT_MS : WAIT_MS);
        if (phase === 'SHOP') {
          // Milestone 5: A buys every card it can (hand limit) in the Q1 shop.
          await a.waitForSelector(tid('offer'));
          const offers = await a.locator(tid('offer')).count();
          check(offers === defaultConfig.cards.offersPerShop, `the shop offers ${offers} cards`);
          const want = Math.min(offers, defaultConfig.cards.handLimit);
          for (let i = 0; i < want; i++) await a.locator(tid('buy')).nth(i).click();
          await waitFor('cards in A hand', async () => (await a.locator(tid('hand-card')).count()) === want);
          check(true, `A bought ${want} cards and holds them`);
          check(await a.locator(tid('buy')).nth(want).isDisabled(), 'with a full hand the last offer cannot be bought');
          // Each player draws their own shop (the sim test checks they differ over a game).
          const shopB = framesOf('B').filter((m) => m.t === 'shop').at(-1) as { offers: Array<{ offerId: string }> } | undefined;
          const shopA = framesOf('A').filter((m) => m.t === 'shop').at(-1) as { offers: Array<{ offerId: string }> } | undefined;
          check(shopA?.offers.length === defaultConfig.cards.offersPerShop && shopB?.offers.length === defaultConfig.cards.offersPerShop,
            'A and B each got a full shop of their own');
          check((await a.evaluate('getComputedStyle(document.body).userSelect')) === 'none', 'text on the desk cannot be highlighted');
          check(!framesOf('floor').some((m) => m.t === 'shop'), 'the floor gets no shop');
        }
        await shot(a, `14-play-${phase}`);
        await checkNoOverflow(a, `desk in ${phase} at 1366x768`);
        check(await a.locator(tid('bet-up-0')).isDisabled(), `bet buttons are disabled in ${phase}`);
        check((await a.locator(tid('earnings')).count()) === 0, `The report is hidden during ${phase}`);
        if (phase === 'RESULTS') {
          // Milestone 6: the quarter's results on the desk and on the projector.
          await a.waitForSelector(tid('leaderboard'));
          const rows = await a.locator(tid('leaderboard-row')).count();
          check(rows === 2, `A shows the Q1 standings (${rows} players)`);
          for (const [label, page] of [['A', a], ['the projector', floor]] as const) {
            const replay = page.locator(tid('quarter-net-worth'));
            await replay.waitFor({ state: 'visible' });
            check(await replay.locator('path[data-player]').count() === rows && (await replay.textContent())?.includes(`Day ${DAYS}`),
              `${label} shows both net-worth paths through the last day of the quarter`);
          }
          check(await a.locator(tid('my-statement')).isVisible(), 'A sees its own quarter statement');
          await floor.waitForSelector(tid('floor-results'));
          check((await floor.locator(tid('leaderboard-row')).count()) === 2, 'the floor shows the standings in RESULTS');
          const q1Results = framesOf('A').filter((m) => m.t === 'results');
          check(q1Results.length === 1 && !(q1Results[0] as { final?: boolean }).final,
            `A got one Q1 results message (got ${q1Results.length}: ${q1Results.map((r) => JSON.stringify((r as { recap?: { quarter?: number } }).recap?.quarter)).join(',')})`);
          const lastPortfolio = framesOf('A').filter((m) => m.t === 'portfolio').at(-1) as { positions: Array<{ symbol: string }> } | undefined;
          check(!framesOf('A').some((m) => m.t === 'bet_result') && lastPortfolio?.positions.some((p) => p.symbol === quickBetSymbol) === true,
            `A's quick bet on ${quickBetSymbol} is still open at RESULTS (nothing cashed out by itself)`);
          await shot(a, '14-play-RESULTS-board');
          check((await floor.locator(tid('floor-tape')).count()) === 0, 'the projector hides the headline ticker in Results');
          await shot(floor, '14-floor-RESULTS');
        }
      }

      // Frozen between quarters: the last tick of Q1 stays on screen until Q2 trades.
      const q1Ticks = ticksOf('A');
      const q1Last = q1Ticks.at(-1)!;
      check(q1Last.day === DAYS - 1 && q1Last.tickOfDay === TICKS_PER_DAY, `Q1 ended on day ${q1Last.day}, tick ${q1Last.tickOfDay}`);
      check(q1Ticks.length === DAYS * TICKS_PER_DAY, `A received all ${DAYS * TICKS_PER_DAY} ticks of Q1 (got ${q1Ticks.length})`);
      check(Number(await floor.locator(tid('net-worth-chart')).getAttribute('data-day')) === DAYS, 'the floor net-worth chart stays on the Q1 close during SHOP');
      await shot(floor, '14-floor-SHOP');
      await a.locator(tid('ready-up')).click();
      await waitFor('the shop shows one player ready', async () => (await textOf(b, 'ready-count')).trim() === '1/2');
      // A's own screen shows it from the same broadcast, a moment later or sooner than B's.
      await waitFor('A to show itself ready', async () => a.locator(tid('ready-up')).isDisabled());
      check(true, 'A is marked ready while B is still in the shop');
      await b.locator(tid('ready-up')).click();
      await waitForPhase(a, 'BRIEFING');
      await checkEarningsReport(a);
      await a.waitForSelector(rowOf(stockA));
      const frozen1 = await boardOf(a);
      await sleep(700);
      const frozen2 = await boardOf(a);
      check(frozen1.length === SYMBOL_COUNT && boardKey(frozen1) === boardKey(frozen2), 'prices on screen do not move during BRIEFING');
      check(frozen1.every((r) => shownPrice(r.price) === q1Last.prices[r.symbol]), 'they are the closing prices of Q1');
      check(ticksOf('A').length === q1Ticks.length, 'no tick arrived between the quarters');
      const frozenChart = await checkChartDrawn(a, 'A in BRIEFING of Q2', stockA, DAYS);
      check(frozenChart.candles === DAYS, `the chart holds the ${DAYS} candles of Q1 while the market is closed`);
      await shot(a, '19-play-BRIEFING-q2');

      // Q2: same price level, day numbers keep counting.
      await waitForPhase(a, 'TRADING');
      await waitFor('first ticks of Q2', async () => ticksOf('A').length >= q1Ticks.length + 3);
      const q2First = ticksOf('A')[q1Ticks.length]!;
      check(q2First.day === DAYS && q2First.tickOfDay === 1, `the first tick of Q2 is day ${q2First.day}, tick ${q2First.tickOfDay} (days continue)`);
      await checkEarningsAtOpen(a);
      await sleep(4 * DAY_MS);
      const q2Chart = await checkChartDrawn(a, 'A in Q2', stockA, DAYS + 4);
      const q2Open = framesOf('A').flatMap((m) => (m.t === 'candle' && m.day === DAYS ? [m.ohlc[stockA]!.o] : []))[0];
      // Price and change must be read in the same instant: a tick later both have moved.
      const [change, priceText] = (await a.evaluate(
        `['selected-change', 'selected-price'].map((id) => document.querySelector('[data-testid=' + id + ']')?.textContent ?? '')`,
      )) as [string, string];
      const nowPrice = shownPrice(priceText);
      check(q2Open !== undefined && Math.abs(Number.parseFloat(change) - (nowPrice / q2Open - 1) * 100) < 0.011,
        `the change % restarted from the Q2 open ("${change}" shown, price ${nowPrice}, Q2 open ${q2Open})`);
      await shot(a, '19-play-TRADING-q2');

      // Refresh mid-quarter in Q2 (early, while plenty of the quarter is left): the list and the chart history of BOTH quarters come back.
      await b.reload();
      await b.waitForSelector(rowOf(stockB));
      const q2Snapshot = snapshotsOf('B').at(-1)!;
      check(q2Snapshot.day > DAYS, `the Q2 reload got a snapshot at day ${q2Snapshot.day}`);
      const q2Restored = await checkChartDrawn(b, 'B after a Q2 reload', stockB, q2Snapshot.day);
      const aNow = await chartOf(a);
      check(aNow !== null && Math.abs(aNow.candles - q2Restored.candles) <= 1 && q2Restored.candles >= q2Chart.candles,
        `B's chart has both quarters again (${q2Restored.candles} candles, A has ${aNow?.candles})`);
      check((await boardOf(b)).length === SYMBOL_COUNT, `B lists ${SYMBOL_COUNT} symbols again`);
      await shot(b, '19-play-after-reload-q2');

      // Milestone 5: A plays its cards on the selected stock (cards with a direction go "up").
      const handBefore = await a.locator(tid('hand-card')).count();
      check(handBefore > 0, `A still holds ${handBefore} cards in Q2`);
      for (let i = 0; i < handBefore; i++) {
        if ((await a.locator(tid('hand-card')).count()) === 0) break;
        const cardEl = a.locator(tid('hand-card')).first();
        // The headline papers lie over the cards: throw them away first, as a player would.
        // (A thrown paper flies off with pointer-events off, so it no longer blocks the cards.)
        // A new paper can land between clearing and clicking: clear and try again.
        const resting = a.locator(`${tid('headline')}:not(.paper--thrown) ${tid('headline-close')}`);
        const button = cardEl.locator(`${tid('play')}, ${tid('play-up')}`).first();
        let played = false;
        for (let attempt = 0; attempt < 8 && !played; attempt++) {
          while ((await resting.count()) > 0) {
            await resting.last().click().catch(() => undefined);
            await sleep(50);
          }
          // The hand can empty under us (a stolen card, an arrest) and a card can lack a play button: stop, don't hang.
          if ((await button.count()) === 0) break;
          if (await button.isDisabled({ timeout: 1_500 }).catch(() => true)) break; // e.g. a sector card with the index fund selected
          played = await button.click({ timeout: 1_500 }).then(() => true, () => false);
        }
        if (!played) break;
        await sleep(300);
      }
      await sleep(500);
      const handAfter = await a.locator(tid('hand-card')).count();
      const cardErrors = framesOf('A').filter((m) => m.t === 'error' && m.code === 'rejected').map((m) => (m as { message: string }).message);
      log(`  A played cards: hand ${handBefore} -> ${handAfter}${cardErrors.length ? `; refused: ${cardErrors.join(' | ')}` : ''}`);
      check(handAfter < handBefore, 'playing a card takes it out of the hand');
      const heatText = await textOf(a, 'heat');
      check(/^SEC\s*\d+%$/.test(heatText.replace(/\s+/g, ' ').trim()), `A sees its SEC catch chance: "${heatText}"`);
      await shot(a, '19-play-cards-q2');
      // Q2 is the last quarter: nobody sees the standings until the finale. (Playing the cards can take long
      // enough for Q2's trading to end: then the finale has taken over and there is nothing to check here.)
      if ((await phaseOf(floor)) === 'TRADING') {
        check((await floor.locator(tid('floor-sealed')).count()) === 1 && (await floor.locator(tid('net-worth-chart')).count()) === 0,
          'the projector seals the standings in the last quarter (no live net-worth chart)');
        const rivalWorth = (await a.locator('.rival__worth').allTextContents()).join('|');
        check(rivalWorth.includes('???') && !/\$\d/.test(rivalWorth), `A sees no rival net worth in the last quarter ("${rivalWorth}")`);
      }
      await shot(floor, '19-floor-TRADING-q2');


      await Promise.all([waitForPhase(a, 'FINAL', GAME_MS + WAIT_MS), waitForPhase(floor, 'FINAL', GAME_MS + WAIT_MS), waitForPhase(b, 'FINAL', GAME_MS + WAIT_MS)]);
      // The live net worth reached the last trading tick before the final standings replaced the chart.
      const lastWorthTick = (framesOf('floor').filter((m) => m.t === 'net_worth') as Array<{ samples: Array<{ tick: number }> }>)
        .flatMap((m) => m.samples).reduce((max, sample) => Math.max(max, sample.tick), 0);
      check(lastWorthTick === QUARTERS * DAYS * TICKS_PER_DAY, `the floor net worth reaches the last trading tick (${lastWorthTick})`);
      // The finale: one cutscene from one server time on every screen, then the recap.
      const finaleStart = (framesOf('A').filter((m) => m.t === 'results').at(-1) as { finaleStartsAt?: number } | undefined)?.finaleStartsAt;
      check(typeof finaleStart === 'number' &&
        finaleStart === (framesOf('floor').filter((m) => m.t === 'results').at(-1) as { finaleStartsAt?: number }).finaleStartsAt,
        'A and the projector got the same finale start time');
      await Promise.all([a.waitForSelector(tid('race'), { timeout: FINALE_WAIT_MS }), floor.waitForSelector(tid('race'), { timeout: FINALE_WAIT_MS })]);
      check(true, 'the race chart plays on the desk and on the projector');
      await shot(a, '20-play-FINAL-race');
      await a.waitForSelector(tid('podium-place'), { timeout: FINALE_WAIT_MS });
      check(true, 'the podium comes up');
      // Milestone 6: the final standings and awards, on the desk and on the projector.
      await a.waitForSelector(tid('winner'), { timeout: FINALE_WAIT_MS });
      check((await a.locator(tid('leaderboard-row')).count()) === 2, 'A shows the final standings');
      const finalMsg = framesOf('A').filter((m) => m.t === 'results').at(-1) as { final?: boolean; awards?: unknown[] } | undefined;
      check(finalMsg?.final === true && Array.isArray(finalMsg.awards), `A got the final results with ${finalMsg?.awards?.length ?? 0} awards`);
      check((await a.locator(tid('award')).count()) === (finalMsg?.awards?.length ?? -1), 'every award is on screen');
      await floor.waitForSelector(tid('floor-winner'), { timeout: FINALE_WAIT_MS });
      check((await a.locator(tid('my-game')).count()) === 1, 'A sees its own game in the recap');
      check(true, 'the floor shows the winner in FINAL');
      check((await floor.locator(tid('floor-tape')).count()) === 0, 'the projector hides the headline ticker in Final Standings');
      await sleep(200);
      await shot(a, '20-play-FINAL');
      check((await a.locator(tid('hand-card')).count()) === 0, 'in FINAL the hand is empty');
      await shot(floor, '21-floor-FINAL');
      await checkNoOverflow(a, 'desk in FINAL at 1366x768');
      await checkNoOverflow(floor, 'floor in FINAL');

      const expected: string[] = [];
      for (let q = 1; q <= QUARTERS; q++) {
        const phases = q < QUARTERS ? QUARTER_PHASES : FINAL_QUARTER_PHASES;
        for (const phase of phases) expected.push(`${phase} Q${q}/${QUARTERS}`);
      }
      expected.push(`FINAL Q${QUARTERS}/${QUARTERS}`);
      for (const [label, page] of [['A', a], ['floor', floor]] as const) {
        const seen = await seenOn(page);
        const got = seen.map((s) => `${s.phase} ${s.quarter}`);
        log(`  ${label} saw: ${seen.map((s) => `${s.phase}(${s.quarter} ${s.countdown})`).join(' > ')}`);
        // The player's lobby has no top bar, so only the floor shows a quarter there.
        const all = [label === 'A' ? 'LOBBY ' : `LOBBY Q-/${QUARTERS}`, ...expected];
        check(got.join(' > ') === all.join(' > '), `${label} saw all ${all.length} phases in order`);
        const timed = seen.filter((s) => s.phase !== 'LOBBY' && s.phase !== 'FINAL');
        check(timed.every((s) => countdownSeconds(s.countdown) !== null), `${label} showed a countdown at the start of every timed phase`);
        checkCadence(label, await ticksOn(page));
      }
      check(countdownSeconds(await textOf(a, 'countdown')) === null, 'no countdown in FINAL');

      // The whole game as A and the floor received it.
      for (const label of ['A', 'floor']) {
        let trading = false;
        let outside = 0;
        for (const m of framesOf(label)) {
          if (m.t === 'phase') trading = m.phase === 'TRADING';
          else if ((m.t === 'tick' || m.t === 'candle') && !trading) outside += 1;
        }
        check(outside === 0, `${label}: no tick or candle outside TRADING in the whole game`);
        const days = framesOf(label).flatMap((m) => (m.t === 'candle' ? [m.day] : []));
        check(days.length === QUARTERS * DAYS && days.every((d, i) => d === i), `${label}: candle days run 0..${QUARTERS * DAYS - 1} across the quarters`);
        const total = QUARTERS * DAYS * TICKS_PER_DAY;
        check(ticksOf(label).length === total, `${label}: ${total} ticks in the whole game (got ${ticksOf(label).length})`);
      }
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
      // In FINAL the desk shows the standings, not the roster: read the roster A received.
      const budOnline = () => (framesOf('A').filter((m) => m.t === 'lobby').at(-1) as { players: Array<{ name: string; connected: boolean }> } | undefined)?.players.find((p) => p.name === 'Bud')?.connected;
      await waitFor('A sees Bud offline', async () => budOnline() === false);
      const before = JSON.parse((await b.evaluate(`sessionStorage.getItem('tg.session.player')`)) as string) as { token: string };
      const lost = await newPage('lost', 1366, 768);
      await lost.goto(`${base}/play`);
      await lost.fill(tid('name-input'), 'bud');
      await lost.click(tid('join-button'));
      await waitForPhase(lost, 'FINAL');
      check((await textOf(lost, 'me-name')) === 'Bud', 'a fresh tab that types "bud" is Bud again');
      const after = await sessionToken(lost);
      check(typeof after === 'string' && after !== before.token, 'the seat got a fresh token');
      await waitFor('A sees everybody online', async () => budOnline() === true);
      const names = (framesOf('A').filter((m) => m.t === 'lobby').at(-1) as { players: Array<{ name: string }> }).players.map((p) => p.name);
      check(names.join(',') === 'Gordon,Bud', 'roster is still Gordon, Bud');
      await lost.context().close();
    });

    await step('play again: a new game from FINAL, back to the lobby, and it plays', async () => {
      const oldSymbols = (await boardOf(a)).map((r) => r.symbol).join();
      await a.click(tid('new-game'));
      await Promise.all([waitForPhase(a, 'LOBBY'), waitForPhase(floor, 'LOBBY')]);
      // Bud's tab is closed, so only Gordon (still connected) keeps a seat.
      await waitFor('A sees only Gordon in the new lobby', async () => (await rosterNames(a)).join(',') === 'Gordon');
      check(true, 'A and the floor are back in the lobby, with Gordon kept and the absent Bud dropped');
      check((await textOf(a, 'me-name')) === 'Gordon', 'A is still Gordon, no name entry');
      const again = await newPage('again', 1366, 768);
      await again.goto(`${base}/play`);
      await again.fill(tid('name-input'), 'Bud');
      await again.click(tid('join-button'));
      await waitFor('A sees Gordon and Bud', async () => (await rosterNames(a)).join(',') === 'Gordon,Bud');
      await a.click(tid('start-button'));
      await Promise.all([waitForPhase(a, 'BRIEFING'), waitForPhase(again, 'BRIEFING'), waitForPhase(floor, 'BRIEFING')]);
      check((await textOf(a, 'quarter')).startsWith('Q1'), 'the new game starts at Q1');
      await a.waitForSelector(rowOf((await boardOf(a))[0]?.symbol ?? ''));
      const newSymbols = (await boardOf(a)).map((r) => r.symbol).join();
      check(newSymbols !== oldSymbols && (await boardOf(a)).length === SYMBOL_COUNT, 'a new universe (next seed) is on screen');
      check((await a.locator(tid('headline')).count()) === 0, 'no headline of the old game is on A\'s desk');
      check((await a.locator(tid('positions')).count()) === 0, 'A starts the new game with no positions');
      const health = (await (await fetch(`http://127.0.0.1:${serverPort}/health`)).json()) as { game: number; phase: string };
      check(health.game === 2 && health.phase === 'BRIEFING', `the server runs game ${health.game}`);
      await shot(a, '23-play-again');
      await again.context().close();
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
