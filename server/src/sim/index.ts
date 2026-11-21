/**
 * Pure sim entry point. The game server and the balance harness both import from here
 * (`@tg/server/sim` from other workspaces).
 *
 * Milestone 1: the phase state machine and the lobby roster.
 *   LOBBY -> [BRIEFING -> TRADING -> EARNINGS -> RESULTS -> SHOP] x config.time.quarters -> FINAL
 * Milestone 2: the market (./universe.ts, ./market.ts). The universe is generated from the seed
 *   when the sim is created; prices step once per tick() while the phase is TRADING and are frozen
 *   otherwise, so every quarter has exactly daysPerQuarter candles and days count on across quarters.
 * Later milestones hang portfolios, headlines, cards and SEC off the same tick().
 * See ./types.ts for the contract and the purity rules.
 *
 * Tick accounting: a phase of N ticks whose `phase` event is returned by tick() call T ends on
 * call T + N, which returns the next `phase` event. The tick that processes `start` only enters
 * BRIEFING; it does not consume a BRIEFING tick. The N tick() calls after the one that announced
 * TRADING each step the market once; the last of them returns `tick`, `candle`, then the EARNINGS
 * `phase` event, in that order.
 *
 * RNG streams: forked from the root in a FIXED order (universe, market, then later subsystems at
 * the end), so adding a subsystem never changes the universe or the price path of a seed.
 */
import type { GameConfig, Phase } from '@tg/shared';
import { createMarket } from './market.ts';
import { nextPhase, phaseLength } from './phases.ts';
import { createRng } from './rng.ts';
import { createTrading } from './trading.ts';
import type { Sim, SimEvent, SimIntent, SimPlayer, SimRejectCode, SimState } from './types.ts';
import { generateUniverse } from './universe.ts';

export * from './types.ts';
export { createRng } from './rng.ts';
export type { Rng } from './rng.ts';
export { isQuarterPhase, nextPhase, phaseLength } from './phases.ts';
export type { PhasePosition } from './phases.ts';
export { generateUniverse, toUniverseInfo } from './universe.ts';
export type { GenerateUniverse, Universe } from './universe.ts';
export { createMarket } from './market.ts';
export type { CreateMarket, Market, MarketEvent, MarketStepInput } from './market.ts';
export { createTrading } from './trading.ts';
export type { Account, Holding, OrderResult, Trading, TradingDeps, TradingEvent } from './trading.ts';

export function createSim(seed: number, config: GameConfig): Sim {
  // One child stream per subsystem, forked in a fixed order. Append new forks at the END.
  const rng = createRng(seed);
  const universe = generateUniverse(rng.fork(), config);
  const market = createMarket(universe, rng.fork(), config);
  const advBySymbol = new Map<string, number>([
    ...universe.companies.map((c) => [c.symbol, c.adv] as const),
    ...universe.funds.map((f) => [f.symbol, f.adv] as const),
  ]);
  const trading = createTrading({
    config,
    priceOf: (symbol) => market.getPrice(symbol),
    advOf: (symbol) => advBySymbol.get(symbol),
    now: () => market.getDay() + market.getTickOfDay() / config.time.ticksPerCandle,
  });

  const queue: SimIntent[] = [];
  const players: SimPlayer[] = [];
  let phase: Phase = 'LOBBY';
  let quarter = 0;
  let tick = 0;
  let phaseTick = 0;
  let announced = false;

  let events: SimEvent[] = [];

  function enter(next: { phase: Phase; quarter: number }): void {
    phase = next.phase;
    quarter = next.quarter;
    phaseTick = 0;
    events.push({ e: 'phase', phase, quarter, durationTicks: phaseLength(config, phase) });
  }

  function reject(intent: SimIntent, code: SimRejectCode, message: string): void {
    events.push({ e: 'reject', playerId: intent.playerId, intent: intent.kind, code, message });
  }

  function hasPlayer(id: string): boolean {
    return players.some((p) => p.id === id);
  }

  /** Returns true when the intent moved the game into a new phase. */
  function process(intent: SimIntent): boolean {
    switch (intent.kind) {
      case 'add_player': {
        if (phase !== 'LOBBY') return reject(intent, 'wrong_phase', 'players can only join in the lobby'), false;
        if (hasPlayer(intent.playerId)) return reject(intent, 'invalid', 'player already joined'), false;
        if (intent.name.length === 0) return reject(intent, 'invalid', 'name is empty'), false;
        if (players.length >= config.lobby.maxPlayers) return reject(intent, 'game_full', 'the game is full'), false;
        players.push({ id: intent.playerId, name: intent.name });
        trading.addAccount(intent.playerId);
        return false;
      }
      case 'remove_player': {
        if (phase !== 'LOBBY') return reject(intent, 'wrong_phase', 'players can only leave in the lobby'), false;
        const index = players.findIndex((p) => p.id === intent.playerId);
        if (index < 0) return reject(intent, 'unknown_player', 'unknown player'), false;
        players.splice(index, 1);
        trading.removeAccount(intent.playerId);
        return false;
      }
      case 'start': {
        if (phase !== 'LOBBY') return reject(intent, 'wrong_phase', 'the game has already started'), false;
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        if (players.length < config.lobby.minPlayers) {
          return reject(intent, 'not_enough_players', `need at least ${config.lobby.minPlayers} player(s) to start`), false;
        }
        enter(nextPhase(config, { phase, quarter }));
        // Everybody learns their starting cash right away.
        for (const p of players) events.push(trading.portfolio(p.id)!);
        return true;
      }
      case 'order': {
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        if (phase !== 'TRADING') return reject(intent, 'wrong_phase', 'the market is closed'), false;
        const result = trading.order(intent.playerId, intent.symbol, intent.qty);
        if (!result.ok) return reject(intent, result.code, result.message), false;
        for (const event of result.events) events.push(event);
        return false;
      }
      case 'buy_card':
      case 'play_card': {
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        return reject(intent, 'not_implemented', `${intent.kind} is not implemented yet`), false;
      }
    }
  }

  return {
    seed,
    config,
    submit(intent) {
      queue.push(intent);
    },
    tick() {
      events = [];
      if (!announced) {
        announced = true;
        events.push({ e: 'phase', phase, quarter, durationTicks: phaseLength(config, phase) });
      }

      // 1. intents, in arrival order
      let enteredByIntent = false;
      for (const intent of queue.splice(0)) {
        if (process(intent)) enteredByIntent = true;
      }

      // 2. clock (does not run in LOBBY and FINAL)
      const length = phaseLength(config, phase);
      if (length !== null && !enteredByIntent) {
        // Prices move only in TRADING: one market step per tick of the phase.
        // Later milestones add regimes / news to the step input next to the price impact.
        if (phase === 'TRADING') {
          const symbolReturn = trading.stepInput();
          let dayClosed = false;
          for (const event of market.step(symbolReturn === undefined ? undefined : { symbolReturn })) {
            if (event.e === 'candle') dayClosed = true;
            events.push(event);
          }
          for (const event of trading.afterStep(dayClosed)) events.push(event);
        }
        phaseTick += 1;
        if (phaseTick >= length) enter(nextPhase(config, { phase, quarter }));
      }

      tick += 1;
      return events;
    },
    getState(): SimState {
      const length = phaseLength(config, phase);
      return {
        phase,
        quarter,
        tick,
        phaseTick,
        phaseTicks: length,
        ticksLeft: length === null ? null : length - phaseTick,
        players: players.map((p) => ({ ...p })),
      };
    },
    getUniverse: () => universe,
    getMarketSnapshot: () => market.getSnapshot(),
    getPortfolio: (playerId) => trading.portfolio(playerId),
  };
}
