import { useId } from 'react';
import type { ResultsMsg } from '@tg/shared';
import { formatMoney } from '../../lib/format.ts';
import { fitWorthRange, playerColor } from '../../lib/netWorth.ts';
import { useGame } from '../../net/GameProvider.tsx';

const WIDTH = 1000;
const HEIGHT = 300;
const GRID_LINES = [0, 0.25, 0.5, 0.75, 1];

export function QuarterNetWorth({ results, paused = false }: { results: Omit<ResultsMsg, 't'>; paused?: boolean }) {
  const { lobby, config } = useGame();
  const clipId = useId();
  const headingId = useId();
  const samples = results.netWorthHistory ?? [];
  const range = fitWorthRange(samples);
  const opening = samples[0];
  const closing = samples.at(-1);
  if (!range || !opening || !closing || opening.tick === closing.tick) return null;

  const players = results.leaderboard.map(({ playerId, name }, index) => {
    const rosterIndex = lobby?.players.findIndex(({ id }) => id === playerId) ?? -1;
    return { playerId, name, color: playerColor(rosterIndex < 0 ? index : rosterIndex) };
  });
  const ticks = closing.tick - opening.tick;
  const days = config.time.daysPerQuarter;
  const dayMarks = [...new Set(GRID_LINES.map((fraction) => Math.round(fraction * days)))];
  const priceAt = (fraction: number) => range.to - (range.to - range.from) * fraction;

  return (
    <section className="quarter-worth" aria-labelledby={headingId} data-testid="quarter-net-worth">
      <h3 className="results__heading" id={headingId}>Player net worth</h3>
      <ul className="quarter-worth__legend" aria-label="Player colors">
        {players.map(({ playerId, name, color }) => (
          <li key={playerId}><span style={{ backgroundColor: color }} aria-hidden="true" />{name}</li>
        ))}
      </ul>
      <div className="quarter-worth__plot">
        <div className="quarter-worth__prices">
          {GRID_LINES.map((fraction) => <span key={fraction}>{formatMoney(priceAt(fraction))}</span>)}
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`Player net worth from the start to the end of quarter ${results.recap.quarter}`}>
          <defs>
            <clipPath id={clipId}>
              <rect className="quarter-worth__reveal" width={WIDTH} height={HEIGHT} style={{ animationPlayState: paused ? 'paused' : 'running' }} />
            </clipPath>
          </defs>
          {GRID_LINES.map((fraction) => (
            <line key={fraction} x1={0} x2={WIDTH} y1={fraction * HEIGHT} y2={fraction * HEIGHT} vectorEffect="non-scaling-stroke" />
          ))}
          <g clipPath={`url(#${clipId})`}>
            {players.map(({ playerId, color }) => {
              const path = samples.map(({ tick, equity }, index) => {
                const x = (tick - opening.tick) / ticks * WIDTH;
                const y = (range.to - equity[playerId]!) / (range.to - range.from) * HEIGHT;
                return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
              }).join(' ');
              return <path key={playerId} d={path} stroke={color} fill="none" vectorEffect="non-scaling-stroke" data-player={playerId} />;
            })}
          </g>
        </svg>
        <div className="quarter-worth__days">
          {dayMarks.map((day) => <span key={day} style={{ left: `${day / days * 100}%` }}>{day === 0 ? 'Start' : `Day ${day}`}</span>)}
        </div>
      </div>
    </section>
  );
}
