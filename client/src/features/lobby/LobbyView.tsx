import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Panel } from '../../components/Panel.tsx';
import { Roster } from '../../components/Roster.tsx';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';

/** LOBBY phase on /play: roster and the Start button (any joined player may start). */
export function LobbyView() {
  const { lobby, me, connection, config } = useGame();
  const client = useGameClient();

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
            onClick={() => client.startGame()}
          >
            Start game
          </button>
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

      <Panel title="How it works" className="lobby__panel">
        <ul className="rules">
          <li>
            {config.time.quarters} quarters. Each quarter: briefing, {config.time.daysPerQuarter} trading days, earnings,
            results, shop.
          </li>
          <li>Go long or short, with up to {config.trading.leverageCap}x leverage. Big orders move the price.</li>
          <li>Headlines move markets. Cards let you make your own headlines.</li>
          <li>Highest net worth at the end wins. Getting caught by the SEC does not help.</li>
        </ul>
      </Panel>
    </div>
  );
}
