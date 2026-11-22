import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FINALE_MAX_AWARDS, FINALE_MAX_HIGHLIGHTS, finaleSegmentAt, finaleTimeline } from '@tg/shared';
import type { Award, FinaleSegment, GameStatement, Highlight, LeaderboardEntry, NetWorthSample, ResultsMsg } from '@tg/shared';
import { formatMoneyShort } from '../../lib/format.ts';
import { fitWorthRange, playerColor } from '../../lib/netWorth.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { CountUp } from '../fx/CountUp.tsx';
import { anchorOf, fx } from '../fx/fx.ts';
import { SoundToggle } from '../fx/SoundToggle.tsx';
import { play } from '../fx/sound.ts';
import { BellIcon, CROWN_PATH, CrownIcon, HighlightIcon } from './icons.tsx';
import './finale.css';

type Final = Omit<ResultsMsg, 't'>;

interface Racer {
  playerId: string;
  name: string;
  color: string;
}

/**
 * FINAL: the end-of-game cutscene, full screen, on every player's desk and on the projector. It plays
 * from the server's `finaleStartsAt`, so every screen shows each reveal at the same moment (and a
 * reload picks it up where it is). See shared finale.ts for the timeline:
 * closing bell, the race (net worth from the first day to the last), highlights, awards one by one,
 * the podium, then the recap with the standings, everyone's awards and (for a player) their own game.
 */
export function Finale({ role }: { role: 'player' | 'spectator' }) {
  const { results, clockOffsetMs, lobby, config } = useGame();
  const final = results?.final ? results : null;
  const timeline = useMemo(
    () =>
      finaleTimeline(config, {
        highlights: final?.highlights?.length ?? 0,
        awards: final?.awards?.length ?? 0,
        players: final?.leaderboard.length ?? 0,
      }),
    [config, final],
  );
  const startsAt = final?.finaleStartsAt;
  const elapsed = useFinaleElapsed(startsAt, clockOffsetMs, timeline.totalMs);
  const segment: FinaleSegment = startsAt === undefined ? 'recap' : finaleSegmentAt(timeline, elapsed);
  useSegmentCues(segment);

  const racers = useMemo<Racer[]>(
    () =>
      (final?.leaderboard ?? []).map(({ playerId, name }, i) => {
        const rosterIndex = lobby?.players.findIndex((p) => p.id === playerId) ?? -1;
        return { playerId, name, color: playerColor(rosterIndex < 0 ? i : rosterIndex) };
      }),
    [final, lobby],
  );

  if (!final) {
    return (
      <div className="finale finale--waiting" data-testid="finale">
        <div className="finale__wait">Counting the money…</div>
      </div>
    );
  }
  const local = elapsed - timeline.starts[segment];
  return (
    <div className={`finale finale--${segment}`} data-testid="finale" data-segment={segment}>
      <div className="finale__sound">
        <SoundToggle />
      </div>
      {segment === 'bell' && <ClosingBell />}
      {segment === 'race' && <Race final={final} racers={racers} progress={Math.min(1, local / Math.max(1, timeline.raceDrawMs))} live />}
      {segment === 'highlights' && <Reel items={(final.highlights ?? []).slice(0, FINALE_MAX_HIGHLIGHTS)} index={Math.floor(local / Math.max(1, timeline.highlightMs))} />}
      {segment === 'awards' && <AwardReveal awards={(final.awards ?? []).slice(0, FINALE_MAX_AWARDS)} index={Math.floor(local / Math.max(1, timeline.awardMs))} />}
      {segment === 'podium' && <Podium board={final.leaderboard} racers={racers} shown={Math.floor(local / Math.max(1, timeline.podiumPlaceMs)) + 1} />}
      {segment === 'recap' && <Recap final={final} racers={racers} role={role} />}
    </div>
  );
}

/** ms since the finale started (server clock), re-rendered every frame until it is over. */
function useFinaleElapsed(startsAt: number | undefined, clockOffsetMs: number, totalMs: number): number {
  const now = () => (startsAt === undefined ? Infinity : Date.now() + clockOffsetMs - startsAt);
  const [elapsed, setElapsed] = useState(now);
  useEffect(() => {
    if (startsAt === undefined) return;
    let frame = 0;
    const loop = () => {
      const e = Date.now() + clockOffsetMs - startsAt;
      setElapsed(e);
      if (e <= totalMs + 100) frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [startsAt, clockOffsetMs, totalMs]);
  return elapsed;
}

/** A sound and a shake when a segment starts live (not when a reload lands in the middle of one). */
function useSegmentCues(segment: FinaleSegment): void {
  const last = useRef<FinaleSegment | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = segment;
    if (before === null || before === segment) return;
    if (segment === 'race') play('whoosh');
    if (segment === 'recap') play('final');
  }, [segment]);
  // The bell rings on mount when the finale opens at its very start.
  useEffect(() => {
    if (segment === 'bell') {
      play('closingBell');
      fx.shake(3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function ClosingBell() {
  return (
    <div className="finale__bell" data-testid="finale-bell">
      <div className="finale__bell-icon">
        <BellIcon size={96} />
      </div>
      <div className="finale__bell-title">Market closed</div>
      <div className="finale__bell-sub">The books are final. Who made it?</div>
    </div>
  );
}

// ---------------------------------------------------------------------------- race

const W = 1000;
const H = 420;

/**
 * Everyone's net worth from the first day to the last, drawn left to right. A lead change flashes the
 * new leader's color (no text). At the end the winner's line lights up and the rest fade.
 */
function Race({ final, racers, progress, live }: { final: Final; racers: Racer[]; progress: number; live: boolean }) {
  const { config } = useGame();
  const clipId = useId();
  const samples: readonly NetWorthSample[] = final.gameNetWorth ?? [];
  const range = useMemo(() => fitWorthRange(samples), [samples]);
  const first = samples[0];
  const lastSample = samples.at(-1);
  const span = first && lastSample ? Math.max(1, lastSample.tick - first.tick) : 1;
  const xOf = (tick: number) => ((tick - (first?.tick ?? 0)) / span) * W;
  const yOf = (v: number) => (range ? ((range.to - v) / (range.to - range.from)) * H : H / 2);
  const paths = useMemo(
    () =>
      racers.map((r) =>
        samples
          .map((s, i) => `${i === 0 ? 'M' : 'L'}${xOf(s.tick).toFixed(1)} ${yOf(s.equity[r.playerId] ?? 0).toFixed(1)}`)
          .join(' '),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [samples, racers, range],
  );
  // Slows down toward the end, where it matters.
  const eased = 1 - Math.pow(1 - progress, 1.7);
  const index = samples.length === 0 ? 0 : Math.min(samples.length - 1, Math.floor(eased * (samples.length - 1)));
  const at = samples[index];
  const leader = at ? racers.reduce<Racer | undefined>((a, r) => (!a || (at.equity[r.playerId] ?? -Infinity) > (at.equity[a.playerId] ?? -Infinity) ? r : a), undefined) : undefined;
  const done = progress >= 1;
  const winner = racers[0];

  // Lead changes: a flash in the new leader's color and a blip; a drumroll that speeds up.
  const [flash, setFlash] = useState<{ key: number; color: string } | null>(null);
  const lastLeader = useRef<string | undefined>(undefined);
  const hits = useRef(0);
  const crowned = useRef(false);
  useEffect(() => {
    if (!live || !leader) return;
    if (lastLeader.current !== undefined && lastLeader.current !== leader.playerId && !done) {
      setFlash({ key: Date.now(), color: leader.color });
      play('lead');
      fx.shake(1, 0.6);
    }
    lastLeader.current = leader.playerId;
  }, [leader, live, done]);
  useEffect(() => {
    if (!live || done || progress < 0.35) return;
    const seconds = progress * 12;
    const n = Math.floor(seconds * (3 + 14 * progress * progress));
    if (n > hits.current) {
      hits.current = n;
      play('snare', 1 + 3 * progress);
    }
  }, [progress, live, done]);
  useEffect(() => {
    if (!live || !done || crowned.current) return;
    crowned.current = true;
    play('final');
    fx.shake(3);
    fx.flash({ tone: 'accent', strength: 0.8 });
    const head = document.querySelector('[data-testid=race-winner-head]');
    const r = head?.getBoundingClientRect();
    const point = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : anchorOf('.finale');
    fx.burst({ ...point, tone: 'accent', count: 120, power: 11 });
  }, [done, live]);

  const quarters = config.time.quarters;
  const quarterTicks = config.time.daysPerQuarter * config.time.ticksPerCandle;
  const clipX = at ? xOf(at.tick) : 0;

  return (
    <div className={`race${live ? ' race--live' : ''}${done ? ' race--done' : ''}`} data-testid="race">
      {live && <div className="race__title">The race</div>}
      <div className="race__plot">
        {flash && <div key={flash.key} className="race__flash" style={{ '--race-flash': flash.color } as React.CSSProperties} aria-hidden="true" />}
        <svg viewBox={`-10 -20 ${W + 140} ${H + 50}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Net worth of every player over the whole game">
          {Array.from({ length: quarters + 1 }, (_, q) => {
            const x = xOf(q * quarterTicks);
            return (
              <g key={q}>
                <line className="race__q-line" x1={x} x2={x} y1={0} y2={H} />
                {q < quarters && quarters <= 8 && (
                  <text className="race__q-label" x={xOf((q + 0.5) * quarterTicks)} y={H + 24}>
                    Q{q + 1}
                  </text>
                )}
              </g>
            );
          })}
          {range && (
            <line className="race__start-line" x1={0} x2={W} y1={yOf(config.economy.startingCash)} y2={yOf(config.economy.startingCash)} />
          )}
          <defs>
            <clipPath id={clipId}>
              <rect x={-10} y={-20} width={clipX + 10} height={H + 40} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {racers.map((r, i) => (
              <path
                key={r.playerId}
                d={paths[i]}
                className={`race__line${done && r.playerId === winner?.playerId ? ' race__line--winner' : ''}${done && r.playerId !== winner?.playerId ? ' race__line--faded' : ''}`}
                stroke={r.color}
              />
            ))}
          </g>
          {at &&
            racers.map((r) => {
              const v = at.equity[r.playerId] ?? 0;
              const isLeader = r.playerId === leader?.playerId;
              const isWinner = done && r.playerId === winner?.playerId;
              return (
                <g
                  key={r.playerId}
                  className={`race__head${isLeader ? ' race__head--leader' : ''}${done && !isWinner ? ' race__head--faded' : ''}`}
                  transform={`translate(${clipX} ${yOf(v)})`}
                  data-testid={isWinner ? 'race-winner-head' : undefined}
                >
                  <circle r={isLeader ? 9 : 6} fill={r.color} />
                  {isWinner && (
                    <g transform="translate(0 -22)">
                      <path className="race__crown" d={CROWN_PATH} />
                    </g>
                  )}
                  <text className="race__name" x={14} y={5} fill={r.color}>
                    {r.name}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>
      {live && done && winner && (
        <div className="race__winner" data-testid="race-winner">
          <span style={{ color: winner.color }}>{winner.name}</span> wins
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- highlights


function Reel({ items, index }: { items: Highlight[]; index: number }) {
  const item = items[Math.min(index, items.length - 1)];
  useEffect(() => {
    if (item) play('card');
  }, [item]);
  if (!item) return null;
  return (
    <div className="reel" data-testid="finale-highlights">
      <div className="finale__kicker">
        Highlights <span className="finale__count">{Math.min(index, items.length - 1) + 1}/{items.length}</span>
      </div>
      <article key={index} className={`reel__card reel__card--${item.kind}`} data-testid="highlight">
        <div className={`reel__icon reel__icon--${item.kind}`}>
          <HighlightIcon kind={item.kind} size={56} />
        </div>
        <div className="reel__title">{item.title}</div>
        <div className={`reel__value reel__value--${item.kind}`}>{item.value}</div>
        {item.name && <div className="reel__name">{item.name}</div>}
        <div className="reel__detail">{item.detail}</div>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------- awards

function AwardReveal({ awards, index }: { awards: Award[]; index: number }) {
  const { me } = useGame();
  const i = Math.min(index, awards.length - 1);
  const award = awards[i];
  useEffect(() => {
    if (!award) return;
    play('card');
    if (award.playerId === me?.playerId) {
      play('cash');
      fx.burst({ ...anchorOf('.award-reveal__card'), tone: 'accent', count: 50, power: 8 });
    }
  }, [award, me]);
  if (!award) return null;
  return (
    <div className="award-reveal" data-testid="finale-awards">
      <div className="finale__kicker">
        Awards <span className="finale__count">{i + 1}/{awards.length}</span>
      </div>
      <article key={i} className={`award-reveal__card${award.playerId === me?.playerId ? ' award-reveal__card--me' : ''}`}>
        <div className="award-reveal__title">{award.title}</div>
        <div className="award-reveal__name">{award.name}</div>
        <div className="award-reveal__detail">{award.detail}</div>
      </article>
      <ul className="award-reveal__past" aria-label="Awards so far">
        {awards.slice(0, i).map((a) => (
          <li key={a.title}>
            <strong>{a.title}</strong> {a.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------- podium

/** 3rd, then 2nd, then 1st rise onto the podium (`shown` = how many places are up). */
function Podium({ board, racers, shown, still = false }: { board: LeaderboardEntry[]; racers: Racer[]; shown: number; still?: boolean }) {
  const { config } = useGame();
  const places = board.slice(0, 3);
  // Reveal order: last place first.
  const revealRank = (rank: number) => places.length - rank;
  const visible = (rank: number) => still || revealRank(rank) < shown;
  const order = [1, 0, 2].filter((i) => i < places.length);
  const top = visible(0) ? places[0] : undefined;
  const crowned = useRef(false);
  const seen = useRef(0);
  useEffect(() => {
    if (still) return;
    const count = Math.min(shown, places.length);
    if (count <= seen.current) return;
    seen.current = count;
    if (top && !crowned.current) {
      crowned.current = true;
      play('cash');
      fx.shake(3);
      fx.flash({ tone: 'accent', strength: 0.9 });
      fx.punch(1);
      fx.burst({ ...anchorOf('.podium__step--1'), tone: 'accent', count: 140, power: 12 });
    } else {
      play('thump');
      fx.shake(2);
    }
  }, [shown, places.length, top, still]);
  const colorOf = (id: string) => racers.find((r) => r.playerId === id)?.color;
  return (
    <div className={`podium${still ? ' podium--still' : ''}`} data-testid="podium">
      {!still && <div className="finale__kicker">The podium</div>}
      <div className="podium__stage">
        {order.map((i) => {
          const p = places[i]!;
          const rank = i + 1;
          const up = visible(i);
          return (
            <div key={p.playerId} className={`podium__step podium__step--${rank}${up ? ' podium__step--up' : ''}`} data-testid="podium-place" data-rank={rank}>
              <div className="podium__who">
                {up && (
                  <>
                    {rank === 1 && (
                      <div className="podium__crown">
                        <CrownIcon size={still ? 22 : 52} />
                      </div>
                    )}
                    <div className="podium__name" style={{ color: colorOf(p.playerId) }}>
                      {p.name}
                    </div>
                    <div className="podium__worth">
                      {still ? (
                        formatMoneyShort(p.netWorth)
                      ) : (
                        <CountUp value={p.netWorth} from={config.economy.startingCash} format={formatMoneyShort} durationMs={900} sound={rank === 1} />
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="podium__block">
                <span className="podium__rank">{rank}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- recap

function Recap({ final, racers, role }: { final: Final; racers: Racer[]; role: 'player' | 'spectator' }) {
  const { me, config } = useGame();
  const client = useGameClient();
  const winner = final.leaderboard[0];
  const multiple = winner ? winner.netWorth / config.economy.startingCash : 0;
  const mine = final.leaderboard.find((r) => r.playerId === me?.playerId);
  const myGame = (final.gameStatements ?? []).find((s) => s.playerId === me?.playerId);
  return (
    <div className="recap" data-testid="finale-recap">
      <header className="recap__top">
        {winner && (
          <div className="recap__winner" data-testid={role === 'player' ? 'winner' : 'floor-winner'}>
            <CrownIcon className="recap__crown" size={28} />
            <span className="recap__winner-name">{winner.name}</span> wins with <strong>{formatMoneyShort(winner.netWorth)}</strong>{' '}
            <span className="recap__dim">({multiple >= 10 ? multiple.toFixed(0) : multiple.toFixed(1)}× the start)</span>
          </div>
        )}
        {role === 'player' && (
          <button type="button" className="btn btn--primary recap__again" data-testid="new-game" onClick={() => client.newGame()}>
            Play again
          </button>
        )}
      </header>
      <div className={`recap__grid${role === 'player' && mine ? '' : ' recap__grid--floor'}`}>
        {role === 'player' && mine && (
          <section className="recap__block recap__mine" data-testid="my-game">
            <h3 className="recap__heading">Your game</h3>
            <MyGame entry={mine} game={myGame} />
          </section>
        )}
        <section className="recap__block recap__board">
          <h3 className="recap__heading">Final standings</h3>
          <Podium board={final.leaderboard} racers={racers} shown={3} still />
          <Standings rows={final.leaderboard} meId={me?.playerId} racers={racers} />
        </section>
        <section className="recap__block recap__chart">
          <h3 className="recap__heading">The whole game</h3>
          <Race final={final} racers={racers} progress={1} live={false} />
        </section>
        <section className="recap__block recap__awards">
          <h3 className="recap__heading">Awards</h3>
          {(final.awards ?? []).length === 0 ? (
            <div className="recap__dim">No awards this time.</div>
          ) : (
            <ul className="recap__award-list" data-testid="awards">
              {final.awards!.map((a) => (
                <li key={a.title} className={`recap__award${a.playerId === me?.playerId ? ' recap__award--me' : ''}`} data-testid="award">
                  <span className="recap__award-title">{a.title}</span>
                  <span className="recap__award-name">{a.name}</span>
                  <span className="recap__dim">{a.detail}</span>
                </li>
              ))}
            </ul>
          )}
          {(final.highlights ?? []).length > 0 && (
            <>
              <h3 className="recap__heading">Highlights</h3>
              <ul className="recap__award-list">
                {final.highlights!.map((h) => (
                  <li key={h.title} className="recap__award">
                    <span className="recap__award-title">
                      <HighlightIcon kind={h.kind} size={14} className="recap__icon" /> {h.title}
                    </span>
                    <span className="recap__award-name">{h.value}</span>
                    <span className="recap__dim">
                      {h.name ? `${h.name}: ` : ''}
                      {h.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Standings({ rows, meId, racers }: { rows: LeaderboardEntry[]; meId: string | undefined; racers: Racer[] }) {
  return (
    <table className="recap__table" data-testid="leaderboard">
      <tbody>
        {rows.map((r) => (
          <tr key={r.playerId} className={r.playerId === meId ? 'recap__row--me' : undefined} data-testid="leaderboard-row" data-player={r.playerId}>
            <td className="recap__rank">{r.rank}</td>
            <td>
              <span className="recap__dot" style={{ background: racers.find((x) => x.playerId === r.playerId)?.color }} />
              {r.name}
              {r.eliminated && <span className="recap__tag">OUT</span>}
            </td>
            <td className="recap__num">{formatMoneyShort(r.netWorth)}</td>
            <td className={`recap__num ${r.pnl >= 0 ? 'recap__up' : 'recap__down'}`}>{formatMoneyShort(r.pnl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MyGame({ entry, game }: { entry: LeaderboardEntry; game: GameStatement | undefined }) {
  const { config } = useGame();
  const change = entry.netWorth / config.economy.startingCash - 1;
  const ordinal = ['1st', '2nd', '3rd'][entry.rank - 1] ?? `${entry.rank}th`;
  return (
    <div className="my-game">
      <div className="my-game__rank">{ordinal}</div>
      <div className="my-game__worth">
        {formatMoneyShort(entry.netWorth)}{' '}
        <span className={change >= 0 ? 'recap__up' : 'recap__down'}>
          {change >= 0 ? '+' : ''}
          {(change * 100).toFixed(0)}%
        </span>
      </div>
      <dl className="my-game__facts">
        <Fact label="Best trade" value={game?.bestTrade ? `${game.bestTrade.symbol} ${signedShort(game.bestTrade.pnl)} (Q${game.bestTrade.quarter})` : '—'} tone="up" />
        <Fact label="Worst trade" value={game?.worstTrade ? `${game.worstTrade.symbol} ${signedShort(game.worstTrade.pnl)} (Q${game.worstTrade.quarter})` : '—'} tone="down" />
        <Fact label="Trades" value={String(game?.trades ?? 0)} />
        <Fact label="Headlines planted" value={String(game?.headlinesPlanted ?? 0)} />
        {(game?.cardSpend ?? 0) > 0 && <Fact label="Spent on cards" value={formatMoneyShort(game!.cardSpend)} />}
        {(game?.fines ?? 0) > 0 && <Fact label="Fines" value={formatMoneyShort(game!.fines)} tone="down" />}
        {(game?.marginCalls ?? 0) > 0 && <Fact label="Margin calls" value={String(game!.marginCalls)} tone="down" />}
      </dl>
    </div>
  );
}

const signedShort = (v: number) => `${v > 0 ? '+' : ''}${formatMoneyShort(v)}`;

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone && value !== '—' ? `recap__${tone}` : undefined}>{value}</dd>
    </div>
  );
}
