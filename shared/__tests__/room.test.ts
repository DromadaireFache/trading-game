import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode, randomRoomCode } from '../room.ts';

describe('room codes', () => {
  it('has no look-alike characters', () => {
    for (const c of '0O1IL') expect(ROOM_CODE_ALPHABET).not.toContain(c);
  });

  it('normalizes case, spaces and dashes', () => {
    expect(normalizeRoomCode('ab2c')).toBe('AB2C');
    expect(normalizeRoomCode(' ab-2c ')).toBe('AB2C');
  });

  it('rejects wrong lengths, look-alikes and non-strings', () => {
    for (const bad of ['ABC', 'ABCDE', 'AB0C', 'ABIC', '', null, undefined]) expect(normalizeRoomCode(bad)).toBeNull();
  });

  it('generates valid codes from any random source', () => {
    for (const r of [() => 0, () => 0.999999, Math.random]) {
      const code = randomRoomCode(r);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });
});
