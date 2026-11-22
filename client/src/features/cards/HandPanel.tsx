import { SECTOR_LABELS, dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { Card, CardDirection, Sector } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { useGame, useGameClient, useHoldings } from '../../net/GameProvider.tsx';
import { useLastDay, useMarketStore, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { CardFace } from './CardFace.tsx';
import './cards.css';

/**
 * The player's cards as real cards, side by side (config.cards.handLimit slots, empty ones dashed),
 * plus heat and jail. A card is played in TRADING on the symbol selected in the market list: a stock
 * card needs a stock, a sector card takes the sector of the selected stock or sector fund. Aim them at
 * the other players' bets: a card on something you hold yourself draws the SEC's attention.
 */
export function HandPanel({ className }: { className?: string }) {
  const { config, phase } = useGame();
  const live = useLivePortfolio();
  const lastDay = useLastDay();

  if (live === null) {
    return (
      <Panel title="Your cards" className={className}>
        <Placeholder>{null}</Placeholder>
      </Panel>
    );
  }

  const { hand = [], heat, jailedUntil, eliminated } = live.portfolio;
  const jailed = jailedUntil !== undefined && Math.max(0, lastDay) < jailedUntil;
  const open = phase?.phase === 'TRADING' && !jailed && !eliminated;
  // High = a 30%+ chance of being caught at the end of the quarter (before the rank multiplier).
  const heatLevel = heat * config.sec.catchProbabilityPerHeat >= 0.3 ? 'high' : heat > 0 ? 'some' : 'none';

  return (
    <Panel
      title="Your cards"
      aside={
        <span title="Heat comes from illegal cards and from cards played on a stock you hold yourself (legal cards bring less). Only a quarter in which you play an illegal card can end in jail: then the more heat (and the richer you are), the likelier the SEC fines and jails you.">
          SEC{' '}
          <span className={`hand__heat hand__heat--${heatLevel}`} data-testid="heat">
            heat {Math.round(heat)}
          </span>
        </span>
      }
      className={`hand${className ? ` ${className}` : ''}`}
    >
      {jailed && (
        <div className="hand__jail" data-testid="jailed">
          IN JAIL {jailedUntil! >= config.time.quarters * config.time.daysPerQuarter ? 'for the rest of the game' : `until Q${dayToQuarter(config, jailedUntil!)} day ${dayOfQuarter(config, jailedUntil!)}`}: no cards, and your orders go through {config.sec.jailOrderDelayMs / 1000}s late.
        </div>
      )}
      <div className="hand__list" data-testid="hand">
        {hand.map((c) => (
          <HandCard key={c.cardId} card={c} open={open} />
        ))}
        {Array.from({ length: Math.max(0, config.cards.handLimit - hand.length) }, (_, i) => (
          <div key={`slot-${i}`} className="hand__slot" data-testid={hand.length === 0 && i === 0 ? 'hand-empty' : undefined}>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function HandCard({ card, open }: { card: Card; open: boolean }) {
  const client = useGameClient();
  const market = useMarketStore();
  const selected = useSelectedSymbol();
  const info = selected === null ? undefined : market.getInfo(selected);
  const def = card.card;

  let target: string | undefined;
  let label = '';
  if (def.targetKind === 'stock') {
    if (info?.kind === 'stock') {
      target = info.symbol;
      label = ` on ${info.symbol}`;
    }
  } else if (def.targetKind === 'sector') {
    const sector: Sector | undefined = info?.kind === 'index' ? undefined : info?.sector;
    if (sector) {
      target = sector;
      label = ` on ${SECTOR_LABELS[sector]}`;
    }
  }
  // A card aimed at a player: one button per rival still in the game.
  const { lobby, me } = useGame();
  const holdings = useHoldings();
  const rivals = (lobby?.players ?? []).filter((p) => p.id !== me?.playerId && holdings[p.id]?.eliminated !== true);
  if (def.targetKind === 'player') {
    const whyRival = !open ? 'Cards can be played while the market is open' : rivals.length === 0 ? 'Nobody left to aim at' : undefined;
    return (
      <CardFace card={def} testId="hand-card">
        <div className="card__target">Pick a rival</div>
        <div className="card__rivals">
          {rivals.map((r) => (
            <button
              key={r.id}
              type="button"
              className="card__btn card__btn--rival"
              disabled={!open}
              title={whyRival ?? `${def.name} on ${r.name}`}
              onClick={() => client.send({ t: 'play_card', cardId: card.cardId, target: r.id })}
              data-testid="play"
            >
              {r.name}
            </button>
          ))}
        </div>
      </CardFace>
    );
  }
  const missing = def.targetKind !== 'none' && target === undefined;
  const why = !open ? 'Cards can be played while the market is open' : missing ? `Select a ${def.targetKind} in the market list first` : undefined;
  const play = (direction?: CardDirection) =>
    client.send({ t: 'play_card', cardId: card.cardId, ...(target === undefined ? {} : { target }), ...(direction ? { direction } : {}) });

  return (
    <CardFace card={def} testId="hand-card">
      <div className="card__target">{def.targetKind === 'none' ? 'No target needed' : label ? label.trim() : `Pick a ${def.targetKind}`}</div>
      {def.needsDirection ? (
        <>
          <button type="button" className="card__btn card__btn--up" disabled={!open || missing} title={why} onClick={() => play('up')} data-testid="play-up">
            ▲ Up
          </button>
          <button type="button" className="card__btn card__btn--down" disabled={!open || missing} title={why} onClick={() => play('down')} data-testid="play-down">
            ▼ Down
          </button>
        </>
      ) : (
        <button type="button" className="card__btn" disabled={!open || missing} title={why} onClick={() => play()} data-testid="play">
          Play
        </button>
      )}
    </CardFace>
  );
}
