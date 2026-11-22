import { useState } from 'react';
import { PLAYER_COLORS, QUARTER_OPTIONS, QUARTER_SECONDS_OPTIONS, quarterSeconds } from '@tg/shared';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { GameLogo } from '../../components/GameLogo.tsx';
import { Panel } from '../../components/Panel.tsx';
import { Roster } from '../../components/Roster.tsx';
import { formatMoney } from '../../lib/format.ts';
import { PLAYER_COLOR_APPEARANCE } from '../../lib/playerColor.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { CreditButton } from './CreditButton.tsx';

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
      <h1 className="lobby__hero"><GameLogo variant="full" /></h1>
      <Panel title="Lobby" aside={`${count}/${maxPlayers} players`} className="lobby__panel">
        <Roster lobby={lobby} meId={me?.playerId} showEmptySeats />

        <GameSettingsPicker />

        <div className="lobby__actions">
          <button
            type="button"
            className="bet-btn bet-btn--up lobby__start"
            data-testid="start-button"
            disabled={!canStart}
            onClick={() => client.startGame(debugMode)}
          >
            Start game
          </button>
          <label className="lobby__debug">
            <input type="checkbox" checked={debugMode} onChange={(event) => setDebugMode(event.target.checked)} />
            Debug mode (allow skipping phases)
          </label>
          {missing > 0 && <p className="lobby__note">Waiting for {missing} more player{missing === 1 ? '' : 's'}.</p>}
          <div className="lobby__secondary-actions">
            <button type="button" className="btn btn--ghost" data-testid="leave-button" onClick={() => client.forget()}>
              Not {me?.name}? Change name
            </button>
            <CreditButton />
          </div>
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

/**
 * The game's length, shared by the whole lobby: any player can change it and everyone sees the
 * change. A quarter is always the same number of days; its length sets how long a day lasts. A server
 * started with another length (dev, tests) shows that value as an extra choice.
 */
function GameSettingsPicker() {
  const { lobby, config, connection, me } = useGame();
  const client = useGameClient();
  const quarters = lobby?.settings.quarters ?? config.time.quarters;
  const seconds = lobby?.settings.quarterSeconds ?? quarterSeconds(config);
  const editable = connection === 'open' && me?.role === 'player';
  const withCurrent = (options: readonly number[], value: number) => (options.includes(value) ? [...options] : [...options, value].sort((a, b) => a - b));

  return (
    <div className="lobby__settings" data-testid="game-settings">
      <SettingRow
        label="Quarters"
        testId="setting-quarters"
        options={withCurrent(QUARTER_OPTIONS, quarters)}
        value={quarters}
        disabled={!editable}
        format={(n) => String(n)}
        onPick={(n) => client.setSettings({ quarters: n })}
      />
      <SettingRow
        label="Quarter length"
        testId="setting-length"
        options={withCurrent(QUARTER_SECONDS_OPTIONS, seconds)}
        value={seconds}
        disabled={!editable}
        format={(n) => (n >= 120 && n % 60 === 0 ? `${n / 60} min` : `${n} s`)}
        onPick={(n) => client.setSettings({ quarterSeconds: n })}
      />
      <PlayerColorPicker />
    </div>
  );
}

function PlayerColorPicker() {
  const { lobby, me, connection, join } = useGame();
  const client = useGameClient();
  const players = lobby?.players ?? [];
  const player = players.find((entry) => entry.id === me?.playerId);
  if (!player) return null;

  return (
    <div className="lobby__setting" role="radiogroup" aria-label="Your color">
      <span className="lobby__setting-label">
        Your color
        {player.color && <small className="lobby__color-name">{PLAYER_COLOR_APPEARANCE[player.color].label}</small>}
      </span>
      <div className="lobby__setting-options lobby__color-options">
        {PLAYER_COLORS.map((color) => {
          const { label, hex } = PLAYER_COLOR_APPEARANCE[color];
          const owners = players.flatMap((entry, index) => entry.color === color ? [{ entry, seat: index + 1 }] : []);
          const first = owners[0];
          const taken = players.length <= PLAYER_COLORS.length && owners.some(({ entry }) => entry.id !== player.id);
          const ownerNames = owners.map(({ entry, seat }) => `P${seat} ${entry.name}`).join(', ');
          const title = first ? `${label} (taken by ${ownerNames})` : label;
          return (
            <label className="lobby__color" key={color}>
              <input
                type="radio"
                name="player-color"
                value={color}
                aria-label={title}
                checked={player.color === color}
                disabled={connection !== 'open' || join !== 'joined' || taken}
                onChange={() => client.setColor(color)}
              />
              <span className="lobby__color-swatch" style={{ backgroundColor: hex }} aria-hidden="true">
                {first && (owners.length === 1 ? `P${first.seat}` : `${first.seat}+`)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SettingRow(props: {
  label: string;
  testId: string;
  options: number[];
  value: number;
  disabled: boolean;
  format: (n: number) => string;
  onPick: (n: number) => void;
}) {
  return (
    <div className="lobby__setting" role="radiogroup" aria-label={props.label} data-testid={props.testId}>
      <span className="lobby__setting-label">{props.label}</span>
      <div className="lobby__setting-options">
        {props.options.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === props.value}
            className="game-button lobby__option"
            disabled={props.disabled}
            data-value={n}
            onClick={() => {
              if (n !== props.value) props.onPick(n);
            }}
          >
            {props.format(n)}
          </button>
        ))}
      </div>
    </div>
  );
}
