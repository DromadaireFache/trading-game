import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useGame, useHoldings } from '../../net/GameProvider.tsx';
import { anchorOf, fx } from '../fx/fx.ts';
import { play } from '../fx/sound.ts';

type Level = 'calm' | 'warm' | 'hot' | 'critical';

/** Catch chance at which each level starts (calm below WARM). */
const WARM = 0.1;
const HOT = 0.3;
const CRITICAL = 0.6;

const levelOf = (chance: number): Level => (chance >= CRITICAL ? 'critical' : chance >= HOT ? 'hot' : chance >= WARM ? 'warm' : 'calm');
const RANK: Record<Level, number> = { calm: 0, warm: 1, hot: 2, critical: 3 };

/**
 * The SEC meter: the chance of being caught at the end of the quarter, as the server rolls it
 * (sec.ts catchProbability: heat x catchProbabilityPerHeat x the rank multiplier for how rich the
 * player is among those still in, capped at maxCatchProbability). The SEC only rolls for a player who
 * played an illegal card that quarter, so this is the risk the next illegal card runs.
 * Calm is green; warm amber; hot red and pulsing; critical flashes like police lights and shakes.
 * Climbing into hot or critical also pops a warning on the table.
 */
export function SecMeter({ heat, equity }: { heat: number; equity: number }) {
  const { config, lobby, me } = useGame();
  const holdings = useHoldings();
  const sec = config.sec;
  // Rank 0 = richest of the players still in (ties go to the player: the SEC watches them closer).
  const richer = (lobby?.players ?? []).filter((p) => p.id !== me?.playerId && holdings[p.id] && !holdings[p.id]!.eliminated && holdings[p.id]!.equity > equity).length;
  const multiplier = sec.rankMultiplier[Math.min(richer, sec.rankMultiplier.length - 1)] ?? 1;
  const chance = Math.min(sec.maxCatchProbability, Math.max(0, heat) * sec.catchProbabilityPerHeat * multiplier);
  const level = levelOf(chance);
  const percent = Math.round(chance * 100);

  // Climbing a level: a warning on the table (never on the way down, never on the first render).
  const before = useRef<Level | null>(null);
  useEffect(() => {
    const was = before.current;
    before.current = level;
    if (was === null || RANK[level] <= RANK[was]) return;
    const at = anchorOf('[data-testid=heat]');
    if (level === 'critical') {
      play('siren');
      fx.shake(2);
      fx.popup({ text: 'SEC IS COMING!', tone: 'down', ...at, size: 1.6 });
      fx.burst({ ...at, tone: 'down', count: 30, power: 6 });
    } else if (level === 'hot') {
      play('thump');
      fx.shake(1);
      fx.popup({ text: 'SEC IS WATCHING', tone: 'down', ...at, size: 1.2 });
    } else if (level === 'warm') {
      fx.popup({ text: 'ON THE RADAR', tone: 'warn', ...at, size: 0.9 });
    }
  }, [level]);

  return (
    <span
      className={`sec-meter sec-meter--${level}`}
      style={{ '--sec-fill': (chance / Math.max(0.01, sec.maxCatchProbability)).toFixed(3) } as CSSProperties}
      data-testid="heat"
      data-level={level}
      data-chance={chance.toFixed(3)}
    >
      <span className="sec-meter__label">SEC</span>
      <span className="sec-meter__bar" aria-hidden="true">
        <span className="sec-meter__fill" />
      </span>
      <span className="sec-meter__pct">{percent}%</span>
    </span>
  );
}
