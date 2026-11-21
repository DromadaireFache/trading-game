/**
 * Accounts, market orders, price impact, borrow fees, margin calls and elimination (DESIGN.md
 * sections 3 and 4). Pure (see ./types.ts): no randomness either, so orders never change the noise
 * path of a seed.
 *
 * Driven by createSim, once per tick:
 *   1. order()          for each queued order intent, in arrival order (TRADING only)
 *   2. stepInput()      -> symbolReturn for market.step(): impact of this tick's fills + decay
 *   3. market.step()
 *   4. afterStep()      borrow fees (when a day closed), elimination, margin calls, portfolio events
 *
 * Valuation (equity, buying power, margin calls, elimination) uses the FAIR price: the mid without the
 * temporary impact still in it (see fairPrice). Fills use the effective mid.
 *
 * Price impact of a fill of |q| shares at effective mid m, with x = notional / adv:
 *   fill price = m * (1 + sign(q) * min(maxSlippage, lambda * x))
 *   permanent  = sign(q) * min(maxPermanent, kPermanent * x)      log-return, applied once
 *   temporary  = sign(q) * min(maxTemporary, kTemporary * x)      log-return, decays by half every temporaryHalfLifeMs
 * Both go into the next market step. The effective mid of a later order on the same tick already
 * includes the impact of the earlier ones, so the first buyer gets the best price.
 * On a fund ticker the market moves only the fund's premium, never its members (DESIGN section 3).
 *
 * Leverage: an order that would take gross exposure above leverageCap * equity is CLIPPED to the
 * largest size that fits (rejected only when nothing fits). Orders that only reduce a position
 * always go through. Shares are whole numbers: qty is truncated toward zero.
 */
import { isMarginCall, valuePortfolio } from '@tg/shared';
import type { ForcedFillReason, GameConfig, PlayerId, Position, QuickBet, SymbolId } from '@tg/shared';
import type { SimEventOf, SimRejectCode } from './types.ts';

export interface TradingDeps {
  config: GameConfig;
  /** Current mid of a symbol (before this tick's step); undefined for an unknown ticker. */
  priceOf(symbol: SymbolId): number | undefined;
  /** Average daily dollar volume of a symbol; undefined for an unknown ticker. */
  advOf(symbol: SymbolId): number | undefined;
  /** Game time in fractional trading days (fill timestamps). */
  now(): number;
}

export type TradingEvent = SimEventOf<'fill'> | SimEventOf<'portfolio'> | SimEventOf<'bet_result'>;

export type OrderResult = { ok: true; events: TradingEvent[] } | { ok: false; code: SimRejectCode; message: string };

/** Per-symbol holding. Kept at qty 0 after a close so `realized` survives (best/worst trade later). */
export interface Holding {
  qty: number;
  avgPrice: number;
  realized: number;
}

export interface Account {
  id: PlayerId;
  cash: number;
  holdings: Map<SymbolId, Holding>;
  eliminated: boolean;
  /** Borrow fees paid so far this game. */
  borrowFees: number;
  /** Quick bets still running, oldest first. */
  bets: QuickBet[];
  /** Quick bets won in a row. */
  streak: number;
}

export interface Trading {
  addAccount(id: PlayerId): void;
  /** Lobby only: a player who left before the start. */
  removeAccount(id: PlayerId): void;
  getAccount(id: PlayerId): Account | undefined;
  /**
   * Market order. Assumes the caller checked the phase. closeAtDay = quick bet: the filled shares
   * cash out by themselves at the close of that game day.
   */
  order(id: PlayerId, symbol: SymbolId, qty: number, closeAtDay?: number): OrderResult;
  /** Impact to add to the coming market step (consumes this tick's fills and decays temporary impact). */
  stepInput(): Record<SymbolId, number> | undefined;
  /** After a market step. dayClosed = the step closed a daily candle. */
  afterStep(dayClosed: boolean): TradingEvent[];
  /** The player's portfolio at current prices. */
  portfolio(id: PlayerId): SimEventOf<'portfolio'> | undefined;
  /** Takes `amount` dollars out of the player's cash (card purchases, SEC fines). */
  charge(id: PlayerId, amount: number): void;
}

export function createTrading(deps: TradingDeps): Trading {
  const { config } = deps;
  const t = config.trading;
  const im = config.impact;
  /** Per-tick decay factor of the temporary impact. */
  const keep = Math.pow(0.5, config.time.tickMs / im.temporaryHalfLifeMs);

  const accounts = new Map<PlayerId, Account>();
  /** Log-return waiting for the next market step, per symbol (fills of this tick). */
  let pending = new Map<SymbolId, number>();
  /** Temporary impact still in the price, per symbol (log). */
  const temporary = new Map<SymbolId, number>();

  /** Mid including the impact of fills earlier on this tick. */
  function effectivePrice(symbol: SymbolId): number | undefined {
    const mid = deps.priceOf(symbol);
    if (mid === undefined) return undefined;
    const extra = pending.get(symbol);
    return extra === undefined ? mid : mid * Math.exp(extra);
  }

  function positionsOf(account: Account): Position[] {
    const out: Position[] = [];
    for (const [symbol, h] of account.holdings) {
      if (h.qty !== 0) out.push({ symbol, qty: h.qty, avgPrice: h.avgPrice, realized: h.realized });
    }
    return out;
  }

  /**
   * Price used to VALUE positions (equity, buying power, margin, elimination, net worth): the mid
   * without the temporary impact still decaying in it. Fills still happen at effectivePrice. Otherwise
   * a big order marks its own position up by its temporary impact, which made buying a thin stock
   * at the cap on the last tick of the game a free net-worth boost.
   */
  function fairPrice(symbol: SymbolId): number | undefined {
    const price = effectivePrice(symbol);
    if (price === undefined) return undefined;
    const temp = temporary.get(symbol);
    return temp === undefined ? price : price * Math.exp(-temp);
  }

  function value(account: Account) {
    return valuePortfolio(config, account.cash, positionsOf(account), fairPrice);
  }

  /** Books a fill: cash, average price, realized P&L. */
  function book(account: Account, symbol: SymbolId, q: number, price: number): void {
    let h = account.holdings.get(symbol);
    if (h === undefined) {
      h = { qty: 0, avgPrice: 0, realized: 0 };
      account.holdings.set(symbol, h);
    }
    account.cash -= q * price;
    const next = h.qty + q;
    if (h.qty === 0 || Math.sign(h.qty) === Math.sign(q)) {
      // Opening or adding: volume-weighted average.
      h.avgPrice = (Math.abs(h.qty) * h.avgPrice + Math.abs(q) * price) / Math.abs(next);
    } else {
      // Reducing, closing or flipping.
      const closed = Math.min(Math.abs(q), Math.abs(h.qty));
      h.realized += closed * (price - h.avgPrice) * Math.sign(h.qty);
      if (next !== 0 && Math.sign(next) !== Math.sign(h.qty)) h.avgPrice = price;
    }
    h.qty = next;
  }

  /** Fills q shares at the effective mid plus slippage and records the impact. */
  function execute(account: Account, symbol: SymbolId, q: number, reason?: ForcedFillReason): SimEventOf<'fill'> {
    const mid = effectivePrice(symbol)!;
    const adv = deps.advOf(symbol)!;
    const x = adv > 0 ? (Math.abs(q) * mid) / adv : Infinity;
    const side = Math.sign(q);
    const price = mid * (1 + side * Math.min(im.maxSlippage, im.lambda * x));
    const temp = side * Math.min(im.maxTemporary, im.kTemporary * x);
    const perm = side * Math.min(im.maxPermanent, im.kPermanent * x);
    pending.set(symbol, (pending.get(symbol) ?? 0) + perm + temp);
    temporary.set(symbol, (temporary.get(symbol) ?? 0) + temp);
    book(account, symbol, q, price);
    const fill: SimEventOf<'fill'> = { e: 'fill', playerId: account.id, symbol, qty: q, price, ts: deps.now() };
    if (reason !== undefined) fill.reason = reason;
    return fill;
  }

  function portfolio(account: Account): SimEventOf<'portfolio'> {
    const v = value(account);
    return {
      e: 'portfolio',
      playerId: account.id,
      cash: account.cash,
      positions: positionsOf(account),
      equity: v.equity,
      heat: 0,
      buyingPower: v.buyingPower,
      eliminated: account.eliminated,
      bets: account.bets.map((b) => ({ ...b })),
      streak: account.streak,
    };
  }

  /** Settles the quick bets due at the close of `day` (what is left of each in the position). */
  function settleBets(account: Account, day: number, events: TradingEvent[]): boolean {
    let settled = false;
    const keep: QuickBet[] = [];
    for (const bet of account.bets) {
      if (bet.closeAtDay > day) {
        keep.push(bet);
        continue;
      }
      settled = true;
      const held = account.holdings.get(bet.symbol)?.qty ?? 0;
      // The player may have cashed out (part of) it already, or a margin call did.
      const qty = Math.sign(held) === Math.sign(bet.qty) ? Math.sign(bet.qty) * Math.min(Math.abs(held), Math.abs(bet.qty)) : 0;
      if (qty === 0) continue;
      const fill = execute(account, bet.symbol, -qty, 'timed');
      events.push(fill);
      const pnl = qty * (fill.price - bet.entryPrice);
      account.streak = pnl > 0 ? account.streak + 1 : 0;
      events.push({
        e: 'bet_result',
        playerId: account.id,
        symbol: bet.symbol,
        qty,
        entryPrice: bet.entryPrice,
        exitPrice: fill.price,
        pnl,
        streak: account.streak,
      });
    }
    account.bets = keep;
    return settled;
  }

  /** Close every open position (largest first) on the player's behalf. */
  function liquidateAll(account: Account, reason: ForcedFillReason, events: TradingEvent[]): void {
    for (const p of largestFirst(account)) events.push(execute(account, p.symbol, -p.qty, reason));
  }

  function largestFirst(account: Account): Position[] {
    return positionsOf(account).sort(
      (a, b) => Math.abs(b.qty) * (fairPrice(b.symbol) ?? 0) - Math.abs(a.qty) * (fairPrice(a.symbol) ?? 0),
    );
  }

  return {
    addAccount(id) {
      if (accounts.has(id)) return;
      accounts.set(id, { id, cash: config.economy.startingCash, holdings: new Map(), eliminated: false, borrowFees: 0, bets: [], streak: 0 });
    },

    removeAccount(id) {
      accounts.delete(id);
    },

    getAccount: (id) => accounts.get(id),

    order(id, symbol, qty, closeAtDay) {
      const account = accounts.get(id);
      if (account === undefined) return { ok: false, code: 'unknown_player', message: 'unknown player' };
      if (account.eliminated) return { ok: false, code: 'eliminated', message: 'you have been eliminated' };
      const mid = effectivePrice(symbol);
      const adv = deps.advOf(symbol);
      if (mid === undefined || adv === undefined) return { ok: false, code: 'unknown_symbol', message: `unknown symbol "${symbol}"` };
      let q = Math.trunc(qty);
      if (!Number.isFinite(q) || q === 0) return { ok: false, code: 'invalid', message: 'order size must be at least 1 share' };

      const cur = account.holdings.get(symbol)?.qty ?? 0;
      let next = cur + q;
      const reducesOnly = Math.sign(next) === Math.sign(cur) && Math.abs(next) <= Math.abs(cur);
      if (!reducesOnly && next !== 0) {
        const v = value(account);
        const fair = fairPrice(symbol)!;
        const grossOthers = v.gross - Math.abs(cur) * fair;
        const side = Math.sign(next);
        const sameSide = side === Math.sign(cur);
        // Largest |next| with gross <= leverageCap * equity AFTER the fill, valued at the fair price:
        // the equity lost is what the fill pays over (or gets under) the fair price, slippage included.
        // Ignoring it let a big order into a small cap land at ~10x.
        const fits = (n: number): boolean => {
          const delta = side * n - cur;
          const traded = Math.abs(delta);
          if (traded === 0) return grossOthers + n * fair <= t.leverageCap * v.equity;
          const slip = Math.min(im.maxSlippage, adv > 0 ? (im.lambda * traded * mid) / adv : Infinity);
          const fill = mid * (1 + Math.sign(delta) * slip);
          const cost = delta * (fill - fair);
          return grossOthers + n * fair <= t.leverageCap * (v.equity - cost);
        };
        let lo = sameSide ? Math.abs(cur) : 0;
        let hi = Math.max(lo, Math.floor((t.leverageCap * v.equity - grossOthers) / fair));
        while (lo < hi) {
          const probe = Math.ceil((lo + hi) / 2);
          if (fits(probe)) lo = probe;
          else hi = probe - 1;
        }
        if (Math.abs(next) > lo) {
          // Same side: never forces a reduction of what is held (lo starts at |cur|). Other side: up to lo, at worst a close.
          next = side * lo;
          const clipped = next - cur;
          if (clipped === 0 || Math.sign(clipped) !== Math.sign(q)) {
            return { ok: false, code: 'insufficient_buying_power', message: `not enough buying power for ${symbol}` };
          }
          q = clipped;
        }
      }
      const fill = execute(account, symbol, q);
      if (closeAtDay !== undefined) account.bets.push({ symbol, qty: q, entryPrice: fill.price, closeAtDay });
      const events: TradingEvent[] = [fill];
      events.push(portfolio(account));
      return { ok: true, events };
    },

    stepInput() {
      if (pending.size === 0 && temporary.size === 0) return undefined;
      const out: Record<SymbolId, number> = {};
      for (const [symbol, r] of pending) out[symbol] = r;
      pending = new Map();
      for (const [symbol, level] of temporary) {
        const decay = level * (1 - keep);
        const rest = level - decay;
        out[symbol] = (out[symbol] ?? 0) - decay;
        if (Math.abs(rest) < 1e-9) temporary.delete(symbol);
        else temporary.set(symbol, rest);
      }
      return out;
    },

    afterStep(dayClosed) {
      const events: TradingEvent[] = [];
      for (const account of accounts.values()) {
        if (account.eliminated) continue;
        let changed = false;

        // The candle of day (now - 1) just closed: its quick bets cash out first.
        if (dayClosed && account.bets.length > 0 && settleBets(account, Math.floor(deps.now()) - 1, events)) changed = true;

        if (dayClosed) {
          for (const [symbol, h] of account.holdings) {
            if (h.qty >= 0) continue;
            const fee = t.shortBorrowFeePerDay * -h.qty * (deps.priceOf(symbol) ?? h.avgPrice);
            account.cash -= fee;
            account.borrowFees += fee;
            changed = true;
          }
        }

        let v = value(account);
        if (v.equity < config.economy.eliminationEquity) {
          liquidateAll(account, 'elimination', events);
          account.eliminated = true;
          changed = true;
        } else {
          for (let n = 0; n < t.liquidationsPerTick && isMarginCall(config, v); n++) {
            const largest = largestFirst(account)[0];
            if (largest === undefined) break;
            events.push(execute(account, largest.symbol, -largest.qty, 'margin_call'));
            changed = true;
            v = value(account);
          }
        }

        if (changed || dayClosed) events.push(portfolio(account));
      }
      return events;
    },

    portfolio(id) {
      const account = accounts.get(id);
      return account === undefined ? undefined : portfolio(account);
    },

    charge(id, amount) {
      const account = accounts.get(id);
      if (account !== undefined && Number.isFinite(amount) && amount > 0) account.cash -= amount;
    },
  };
}
