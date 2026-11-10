import { expect, test } from 'vitest';
import { CONFIG, MEMORY_KINDS, quotaFor, roomsFor } from '../../src/rules/config';

test('quota and rooms follow the spec', () => {
  expect([1, 2, 3].map(quotaFor)).toEqual([150, 250, 350]);
  expect([1, 2, 7, 20].map(roomsFor)).toEqual([8, 10, 20, 20]);
});

test('memory kinds cover every weight class with the spec value ranges', () => {
  const range = { light: [10, 25], medium: [30, 60], heavy: [70, 120] } as const;
  for (const w of ['light', 'medium', 'heavy'] as const) {
    const kinds = MEMORY_KINDS.filter(k => k.weight === w);
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect([k.min, k.max]).toEqual(range[w]);
  }
  expect(MEMORY_KINDS.some(k => k.noisy)).toBe(true);
  expect(new Set(MEMORY_KINDS.map(k => k.id)).size).toBe(MEMORY_KINDS.length);
});

test('speeds match the spec', () => {
  expect([CONFIG.walk, CONFIG.sprint, CONFIG.crouch]).toEqual([3.0, 5.5, 1.5]);
  expect(CONFIG.nightSeconds).toBe(480);
  expect(CONFIG.phase2At).toBe(240);
});
