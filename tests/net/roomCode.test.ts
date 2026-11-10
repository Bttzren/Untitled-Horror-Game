import { expect, test } from 'vitest';
import { CODE_ALPHABET, PEER_PREFIX, makeRoomCode, normalizeCode } from '../../src/net/roomCode';

test('codes are 5 characters from the alphabet', () => {
  for (let i = 0; i < 500; i++) expect(makeRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
});
test('the alphabet has no look-alike characters', () => {
  for (const ch of '01OI') expect(CODE_ALPHABET).not.toContain(ch);
  expect(CODE_ALPHABET).toHaveLength(32);
});
test('codes use the random source they are given', () => {
  expect(makeRoomCode(() => 0)).toBe('AAAAA');
  expect(makeRoomCode(() => 0.999)).toBe('99999');
});
test('normalizeCode', () => {
  expect(normalizeCode('  abcde ')).toBe('ABCDE');
  expect(normalizeCode('ab cd-e')).toBe('ABCDE');
  expect(normalizeCode('ABC')).toBeNull();
  expect(normalizeCode('ABCD0')).toBeNull();
  expect(normalizeCode('ABCDEF')).toBeNull();
  expect(normalizeCode('')).toBeNull();
});
test('the peer prefix is fixed', () => expect(PEER_PREFIX).toBe('uhg-dream-'));
