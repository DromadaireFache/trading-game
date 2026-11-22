import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { normalizeRoomCode, randomRoomCode } from '@tg/shared';
import type { Role } from '@tg/shared';
import { RoomEntry } from '../features/lobby/RoomEntry.tsx';
import '../features/lobby/room.css';
import { GameProvider } from '../net/GameProvider.tsx';
import { NetTargetContext } from '../net/NetTarget.tsx';
import type { NetTarget } from '../net/NetTarget.tsx';
import { browserSessionStorage } from '../net/session.ts';
import { loadMode, ONLINE_ONLY, onlineWsUrl, saveMode } from '../net/target.ts';
import type { NetMode } from '../net/target.ts';

/** How many fresh codes a host tries when the server says one is taken (a 1 in a million event). */
const MAX_HOST_TRIES = 5;

/**
 * Decides where /play and /floor connect, and holds the game's connection while it is there:
 *  - LAN (default build): the page's own server, no code.
 *  - Online: a room picked by the code in the URL (/play/ABCD, /floor/ABCD). Without a code the room
 *    screen asks for one, or lets a player host a new room.
 * A different room is a different provider (the `key`), so nothing of one game leaks into the next.
 */
export function ConnectGate({ role, path, children }: { role: Role; path: '/play' | '/floor'; children: ReactNode }) {
  const params = useParams();
  const navigate = useNavigate();
  const storage = useMemo(() => browserSessionStorage(), []);
  const [chosen, setChosen] = useState<NetMode>(() => loadMode(storage));
  const [notice, setNotice] = useState<string | null>(null);
  /** The code this tab is creating (set by Host, read when its provider opens the socket). */
  const hosting = useRef<{ code: string; tries: number } | null>(null);

  const urlRoom = normalizeRoomCode(params.room);
  const online = ONLINE_ONLY || params.room !== undefined || chosen === 'online';
  const room = online ? urlRoom : null;

  const host = useCallback((tries = 0) => {
    const code = randomRoomCode();
    hosting.current = { code, tries };
    setNotice(null);
    navigate(`${path}/${code}`, { replace: tries > 0 });
  }, [navigate, path]);

  const join = useCallback((code: string) => {
    hosting.current = null;
    setNotice(null);
    navigate(`${path}/${code}`);
  }, [navigate, path]);

  const setMode = useCallback((mode: NetMode) => {
    if (ONLINE_ONLY) return;
    saveMode(storage, mode);
    setChosen(mode);
    setNotice(null);
    // A room code in the address is an online address: leaving it is what going LAN means.
    if (mode === 'lan' && params.room !== undefined) navigate(path, { replace: true });
  }, [storage, params.room, navigate, path]);

  const leaveRoom = useCallback(() => {
    hosting.current = null;
    setNotice(null);
    navigate(path);
  }, [navigate, path]);

  const onRoomError = useCallback((kind: 'no_room' | 'code_in_use') => {
    const attempt = hosting.current;
    if (kind === 'code_in_use' && attempt !== null && attempt.code === room && attempt.tries + 1 < MAX_HOST_TRIES) {
      host(attempt.tries + 1);
      return;
    }
    hosting.current = null;
    setNotice(kind === 'no_room'
      ? `There is no game with the code ${room ?? ''}. Check the code, or host a new game.`
      : 'Could not create a game. Try again.');
    navigate(path, { replace: true });
  }, [room, host, navigate, path]);

  // Asked at every (re)connect; only the first socket of a hosting tab may ask the server to create the room.
  const url = useMemo(() => {
    if (room === null) return undefined;
    let first = hosting.current?.code === room;
    return () => {
      const create = first;
      first = false;
      return onlineWsUrl(room, create);
    };
  }, [room]);

  const target: NetTarget = useMemo(
    () => ({ mode: online ? 'online' : 'lan', room, canSwitch: !ONLINE_ONLY, setMode, leaveRoom }),
    [online, room, setMode, leaveRoom],
  );

  if (online && room === null) {
    const typed = params.room;
    const message = notice ?? (typed === undefined ? null : `"${typed}" is not a room code. Codes have four letters or digits.`);
    return (
      <NetTargetContext.Provider value={target}>
        <RoomEntry role={role} notice={message} onJoin={join} onHost={role === 'player' ? () => host() : undefined} />
      </NetTargetContext.Provider>
    );
  }

  return (
    <NetTargetContext.Provider value={target}>
      <GameProvider key={`${online ? 'online' : 'lan'}:${room ?? ''}`} role={role} url={url} scope={room ?? undefined} onRoomError={onRoomError}>
        {children}
      </GameProvider>
    </NetTargetContext.Provider>
  );
}
