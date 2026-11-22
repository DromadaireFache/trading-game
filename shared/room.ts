/**
 * Room codes of the online game: four characters from an alphabet without look-alikes (no 0/O, 1/I/L),
 * 31^4 = about 920 thousand codes. Pure, shared by the client (typing and creating codes) and the worker.
 */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** The code in canonical form (upper case, spaces and dashes dropped), or null when it is not a valid code. */
export function normalizeRoomCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const char of code) if (!ROOM_CODE_ALPHABET.includes(char)) return null;
  return code;
}

/** A random code. `random` returns a float in [0, 1); the default is Math.random (fine for a party game). */
export function randomRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  return code;
}
