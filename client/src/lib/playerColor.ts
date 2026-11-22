import { PLAYER_COLORS } from '@tg/shared';
import type { LobbyPlayer, PlayerColor, PlayerId } from '@tg/shared';
import { theme } from '../theme.ts';

export const PLAYER_COLOR_APPEARANCE: Record<PlayerColor, { label: string; hex: string }> = {
  gold: { label: 'Gold', hex: theme.color.accent },
  'light-blue': { label: 'Light blue', hex: theme.color.info },
  green: { label: 'Green', hex: theme.color.up },
  pink: { label: 'Pink', hex: theme.color.sectorHealth },
  purple: { label: 'Purple', hex: theme.color.sectorFinance },
  orange: { label: 'Orange', hex: theme.color.warn },
  blue: { label: 'Blue', hex: theme.color.playerBlue },
  red: { label: 'Red', hex: theme.color.down },
  teal: { label: 'Teal', hex: theme.color.playerTeal },
  lime: { label: 'Lime', hex: theme.color.playerLime },
  mint: { label: 'Mint', hex: theme.color.playerMint },
  fuchsia: { label: 'Fuchsia', hex: theme.color.playerFuchsia },
  coral: { label: 'Coral', hex: theme.color.playerCoral },
  cyan: { label: 'Cyan', hex: theme.color.playerCyan },
  indigo: { label: 'Indigo', hex: theme.color.playerIndigo },
  lemon: { label: 'Lemon', hex: theme.color.playerLemon },
};

export function playerColor(index: number, color?: PlayerColor): string {
  return PLAYER_COLOR_APPEARANCE[color ?? PLAYER_COLORS[index % PLAYER_COLORS.length]!].hex;
}

export function rosterPlayerColor(players: readonly LobbyPlayer[], id: PlayerId, fallbackIndex: number): string {
  const index = players.findIndex((player) => player.id === id);
  return index < 0 ? playerColor(fallbackIndex) : playerColor(index, players[index]?.color);
}
