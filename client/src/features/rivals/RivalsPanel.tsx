import { dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { LobbyPlayer, Position } from '@tg/shared';
import { Panel } from '../../components/Panel.tsx';
import { formatMoneyShort } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useLastDay, useMarketStore, useQuote } from '../../net/marketHooks.ts';
import type { Holdings } from '../../net/state.ts';
import './rivals.css';

/** One column per other seat (maxPlayers - 1), so the layout does not jump when people join. */
export function RivalsPanel({ className }: { className?: string }) {
  const { lobby, me, holdings, config } = useGame();
  const others = (lobby?.players ?? []).filter((p) => p.id !== me?.playerId);
  const seats = Math.max(1, config.lobby.maxPlayers - 1);
  return (
    <Panel title="The other players" aside="what they hold right now" className={`rivals${className ? ` ${className}` : ''}`}>
      <div className="rivals__cols" style={{ gridTemplateColumns: `repeat(${seats}, minmax(0, 1fr))` }} data-testid="rivals">
        {Array.from({ length: seats }, (_, i) => {
          const player = others[i];
          return player === undefined ? (
            <div key={`empty-${i}`} className="rival rival--empty">
              <div className="rival__head">
                <span className="rival__name">Empty seat</span>
              </div>
            </div>
          ) : (
            <Rival key={player.id} player={player} held={holdings[player.id]} />
          );
        })}
      </div>
    </Panel>
  );
}

function Rival({ player, held }: { player: LobbyPlayer; held: Holdings | undefined }) {
  const { config } = useGame();
  const lastDay = useLastDay();
  const positions = [...(held?.positions ?? [])].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const jailed = held?.jailedUntil !== undefined && Math.max(0, lastDay) < held.jailedUntil;
  return (
    <div className={`rival${player.connected ? '' : ' rival--offline'}`} data-testid="rival" data-player={player.id}>
      <div className="rival__head">
        <span className="rival__name">{player.name}</span>
        {held && <span className="rival__worth">{formatMoneyShort(held.equity)}</span>}
      </div>
      {(jailed || held?.eliminated || !player.connected) && (
        <div className="rival__tags">
          {jailed && (
            <span className="rival__tag rival__tag--jail" title={`Until Q${dayToQuarter(config, held!.jailedUntil!)} day ${dayOfQuarter(config, held!.jailedUntil!)}`}>
              in jail
            </span>
          )}
          {held?.eliminated && <span className="rival__tag">out</span>}
          {!player.connected && <span className="rival__tag">offline</span>}
        </div>
      )}
      {positions.length === 0 ? (
        <div className="rival__none">No positions</div>
      ) : (
        <ul className="rival__list">
          {positions.map((p) => (
            <RivalPosition key={p.symbol} position={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ticker and what the bet is worth now; green = long (betting up), red = short (betting down). */
function RivalPosition({ position }: { position: Position }) {
  const market = useMarketStore();
  const quote = useQuote(position.symbol);
  const long = position.qty > 0;
  const worth = Math.abs(position.qty) * (quote?.price ?? position.avgPrice);
  return (
    <li
      className={`rival__pos rival__pos--${long ? 'long' : 'short'}`}
      data-testid="rival-position"
      data-symbol={position.symbol}
      title={`${long ? 'Long (betting it goes up)' : 'Short (betting it goes down)'}: click to look at ${position.symbol}`}
      onClick={() => market.select(position.symbol)}
    >
      <span className="rival__dir">{long ? '▲' : '▼'}</span>
      <span className="rival__ticker">{position.symbol}</span>
      <span className="rival__amount">{formatMoneyShort(worth)}</span>
    </li>
  );
}
