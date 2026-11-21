import { useState } from 'react';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Panel } from '../../components/Panel.tsx';
import { Roster } from '../../components/Roster.tsx';
import { formatMoney } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';

/** LOBBY phase on /play: roster and the Start button (any joined player may start). */
export function LobbyView() {
  const { lobby, me, connection, config } = useGame();
  const client = useGameClient();
  const [debugMode, setDebugMode] = useState(false);

  const count = lobby?.players.length ?? 0;
  const minPlayers = lobby?.minPlayers ?? config.lobby.minPlayers;
  const maxPlayers = lobby?.maxPlayers ?? config.lobby.maxPlayers;
  // The server starts with CONNECTED players only; a seat held by someone who dropped does not count.
  const online = lobby?.players.filter((p) => p.connected).length ?? 0;
  const missing = Math.max(0, minPlayers - online);
  const canStart = connection === 'open' && missing === 0;

  return (
    <div className="lobby">
      <Panel title="Lobby" aside={`${count}/${maxPlayers} players`} className="lobby__panel">
        <Roster lobby={lobby} meId={me?.playerId} showEmptySeats />

        <div className="lobby__actions">
          <button
            type="button"
            className="btn btn--primary btn--wide"
            data-testid="start-button"
            disabled={!canStart}
            onClick={() => client.startGame(debugMode)}
          >
            Start game
          </button>
          <label className="lobby__debug">
            <input type="checkbox" checked={debugMode} onChange={(event) => setDebugMode(event.target.checked)} />
            Debug mode (Ready Up in Trading)
          </label>
          <p className="lobby__note">
            {missing > 0
              ? `Waiting for ${missing} more player${missing === 1 ? '' : 's'}.`
              : 'Anyone can press Start once everybody is in.'}
          </p>
          <button type="button" className="btn btn--ghost" data-testid="leave-button" onClick={() => client.forget()}>
            Not {me?.name}? Change name
          </button>
        </div>

        <ErrorBanner />
      </Panel>

      <Panel title="How to play" className="lobby__panel">
        <ol className="rules">
          <li>
            You start with <strong>{formatMoney(config.economy.startingCash)}</strong>. Whoever has the most money after{' '}
            {config.time.quarters} quarters wins.
          </li>
          <li>
            Pick a stock and <strong>bet UP</strong> (you think it will rise) or <strong>bet DOWN</strong> (you think it will
            fall). Cash out whenever you like.
          </li>
          <li>
            <strong>Watch the news.</strong> Good news pushes a price up, bad news pushes it down. Be the first to react!
          </li>
          <li>
            You can bet up to {config.trading.leverageCap}× your money with borrowed cash. Bigger wins, bigger losses: if you
            lose too much the bank closes your bets, and below {formatMoney(config.economy.eliminationEquity)} you are out.
          </li>
          <li>
            Between quarters, buy <strong>cards</strong>: insider tips, fake news, world events. Illegal ones can get you
            arrested.
          </li>
        </ol>
      </Panel>
    </div>
  );
}
