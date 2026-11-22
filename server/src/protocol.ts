/**
 * Validation of incoming frames. Nothing a client sends is trusted: every field is checked and
 * a clean ClientMsg is rebuilt from scratch (unknown fields are dropped). Never throws.
 */
import { PLAYER_COLORS } from '@tg/shared';
import type { CardDirection, ClientMsg, GameConfig, Role } from '@tg/shared';

export type ParseResult = { ok: true; msg: ClientMsg } | { ok: false; message: string };

const bad = (message: string): ParseResult => ({ ok: false, message });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isRole(v: unknown): v is Role {
  return v === 'player' || v === 'spectator';
}

function isDirection(v: unknown): v is CardDirection {
  return v === 'up' || v === 'down';
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function parseClientMsg(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad('not valid JSON');
  }
  if (!isRecord(raw)) return bad('message must be a JSON object');

  switch (raw.t) {
    case 'join': {
      if (!isRole(raw.role)) return bad('join.role must be "player" or "spectator"');
      if (raw.name !== undefined && typeof raw.name !== 'string') return bad('join.name must be a string');
      if (raw.token !== undefined && typeof raw.token !== 'string') return bad('join.token must be a string');
      return { ok: true, msg: { t: 'join', role: raw.role, name: raw.name, token: raw.token } };
    }
    case 'start': {
      if (raw.debugMode !== undefined && typeof raw.debugMode !== 'boolean') return bad('start.debugMode must be a boolean');
      return { ok: true, msg: { t: 'start', ...(raw.debugMode === undefined ? {} : { debugMode: raw.debugMode }) } };
    }
    case 'set_settings': {
      const whole = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1);
      if (!whole(raw.quarters)) return bad('set_settings.quarters must be a positive whole number');
      if (!whole(raw.quarterSeconds)) return bad('set_settings.quarterSeconds must be a positive whole number');
      return {
        ok: true,
        msg: {
          t: 'set_settings',
          ...(raw.quarters === undefined ? {} : { quarters: raw.quarters as number }),
          ...(raw.quarterSeconds === undefined ? {} : { quarterSeconds: raw.quarterSeconds as number }),
        },
      };
    }
    case 'new_game':
      return { ok: true, msg: { t: 'new_game' } };
    case 'set_color': {
      const color = PLAYER_COLORS.find((option) => option === raw.color);
      return color ? { ok: true, msg: { t: 'set_color', color } } : bad('set_color.color must be a player color');
    }
    case 'kick_player':
      if (!isNonEmptyString(raw.playerId)) return bad('kick_player.playerId must be a non-empty string');
      return { ok: true, msg: { t: 'kick_player', playerId: raw.playerId } };
    case 'end_game':
      if (typeof raw.game !== 'number' || !Number.isSafeInteger(raw.game) || raw.game < 1) {
        return bad('end_game.game must be a positive whole number');
      }
      return { ok: true, msg: { t: 'end_game', game: raw.game } };
    case 'order': {
      if (!isNonEmptyString(raw.symbol)) return bad('order.symbol must be a non-empty string');
      if (typeof raw.qty !== 'number' || !Number.isFinite(raw.qty) || raw.qty === 0) {
        return bad('order.qty must be a finite, non-zero number');
      }
      if (raw.holdDays !== undefined && (typeof raw.holdDays !== 'number' || !Number.isInteger(raw.holdDays) || raw.holdDays < 1 || raw.holdDays > 365)) {
        return bad('order.holdDays must be a whole number of days, 1 or more');
      }
      if (raw.requestId !== undefined && (typeof raw.requestId !== 'number' || !Number.isSafeInteger(raw.requestId) || raw.requestId < 1)) {
        return bad('order.requestId must be a positive safe integer');
      }
      return { ok: true, msg: { t: 'order', symbol: raw.symbol, qty: raw.qty, ...(raw.holdDays === undefined ? {} : { holdDays: raw.holdDays }), ...(raw.requestId === undefined ? {} : { requestId: raw.requestId }) } };
    }
    case 'buy_card': {
      if (!isNonEmptyString(raw.offerId)) return bad('buy_card.offerId must be a non-empty string');
      return { ok: true, msg: { t: 'buy_card', offerId: raw.offerId } };
    }
    case 'ready_up': {
      if (typeof raw.quarter !== 'number' || !Number.isSafeInteger(raw.quarter) || raw.quarter < 1) {
        return bad('ready_up.quarter must be a positive whole number');
      }
      const phase = raw.phase === undefined ? 'SHOP' : raw.phase;
      if (phase !== 'TRADING' && phase !== 'RESULTS' && phase !== 'SHOP') {
        return bad('ready_up.phase must be TRADING, RESULTS or SHOP');
      }
      return { ok: true, msg: { t: 'ready_up', quarter: raw.quarter, phase } };
    }
    case 'solve_challenge':
      if (!isNonEmptyString(raw.challengeId)) return bad('solve_challenge.challengeId must be a non-empty string');
      return { ok: true, msg: { t: 'solve_challenge', challengeId: raw.challengeId } };
    case 'play_card': {
      if (!isNonEmptyString(raw.cardId)) return bad('play_card.cardId must be a non-empty string');
      if (raw.target !== undefined && !isNonEmptyString(raw.target)) return bad('play_card.target must be a non-empty string');
      if (raw.direction !== undefined && !isDirection(raw.direction)) return bad('play_card.direction must be "up" or "down"');
      return { ok: true, msg: { t: 'play_card', cardId: raw.cardId, target: raw.target, direction: raw.direction } };
    }
    default:
      return bad(typeof raw.t === 'string' ? `unknown message type "${raw.t.slice(0, 32)}"` : 'message has no type "t"');
  }
}

/**
 * Player names: control characters removed, whitespace collapsed and trimmed.
 * Returns null when the result does not fit config.lobby.nameMinLength..nameMaxLength.
 */
export function cleanName(raw: string | undefined, config: GameConfig): string | null {
  if (raw === undefined) return null;
  const name = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const length = [...name].length;
  if (length < config.lobby.nameMinLength || length > config.lobby.nameMaxLength) return null;
  return name;
}

/** Names are unique ignoring case. */
export function nameKey(name: string): string {
  return name.toLocaleLowerCase();
}
