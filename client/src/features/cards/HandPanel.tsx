import { SECTOR_LABELS, dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { Card, CardDirection, Sector } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useLastDay, useMarketStore, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { CardFace } from './CardFace.tsx';
import './cards.css';

/**
 * The player's cards (limit config.cards.handLimit), heat and jail. A card is played in TRADING on
 * the symbol selected in the market list: a stock card needs a stock, a sector card takes the sector
 * of the selected stock or sector fund.
 */
export function HandPanel({ className }: { className?: string }) {
  const { config, phase } = useGame();
  const live = useLivePortfolio();
  const lastDay = useLastDay();

  if (live === null) {
    return (
      <Panel title="Hand" aside={`max ${config.cards.handLimit} cards`} className={className}>
        <Placeholder>Buy cards in the SHOP phase, play them while the market is open.</Placeholder>
      </Panel>
    );
  }

  const { hand = [], heat, jailedUntil, eliminated } = live.portfolio;
  const jailed = jailedUntil !== undefined && Math.max(0, lastDay) < jailedUntil;
  const open = phase?.phase === 'TRADING' && !jailed && !eliminated;
  const heatLevel = heat >= config.sec.longJailHeat ? 'high' : heat > 0 ? 'some' : 'none';

  return (
    <Panel
      title="Hand"
      aside={
        <span className={`hand__heat hand__heat--${heatLevel}`} data-testid="heat" title="Heat from illegal acts: the SEC rolls at the end of each quarter">
          heat {Math.round(heat)}
        </span>
      }
      className={`hand${className ? ` ${className}` : ''}`}
    >
      {jailed && (
        <div className="hand__jail" data-testid="jailed">
          IN JAIL until Q{dayToQuarter(config, jailedUntil!)} D{dayOfQuarter(config, jailedUntil!)}: no trading, no cards. Your positions stay open.
        </div>
      )}
      {hand.length === 0 ? (
        <div className="hand__empty">No cards. Buy some in the SHOP phase.</div>
      ) : (
        <div className="hand__list" data-testid="hand">
          {hand.map((c) => (
            <HandCard key={c.cardId} card={c} open={open} />
          ))}
        </div>
      )}
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
  const missing = def.targetKind !== 'none' && target === undefined;
  const why = !open ? 'Cards can be played while the market is open' : missing ? `Select a ${def.targetKind} in the market list first` : undefined;
  const play = (direction?: CardDirection) =>
    client.send({ t: 'play_card', cardId: card.cardId, ...(target === undefined ? {} : { target }), ...(direction ? { direction } : {}) });

  return (
    <CardFace card={def} testId="hand-card">
      {def.needsDirection ? (
        <>
          <button type="button" className="card__btn card__btn--up" disabled={!open || missing} title={why} onClick={() => play('up')} data-testid="play-up">
            Up{label}
          </button>
          <button type="button" className="card__btn card__btn--down" disabled={!open || missing} title={why} onClick={() => play('down')} data-testid="play-down">
            Down{label}
          </button>
        </>
      ) : (
        <button type="button" className="card__btn" disabled={!open || missing} title={why} onClick={() => play()} data-testid="play">
          Play{label}
        </button>
      )}
    </CardFace>
  );
}
