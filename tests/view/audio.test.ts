import { expect, test } from 'vitest';
import { gainAt, panFor } from '../../src/view/audio';

test('gainAt: full at the source, silent at one and a half times the radius, linear between', () => {
  expect(gainAt(0, 10)).toBe(1);
  expect(gainAt(15, 10)).toBe(0);
  expect(gainAt(7.5, 10)).toBeCloseTo(0.5);
  expect(gainAt(99, 10)).toBe(0);
  expect(gainAt(-1, 10)).toBe(1);
  expect(gainAt(1, 0)).toBe(0);
});

test('panFor: sounds to the right pan right, to the left pan left, ahead and behind are centred', () => {
  const me = { x: 0, z: 0 };
  // Yaw 0 faces -Z, so +X is to the right.
  expect(panFor(me, 0, { x: 5, z: 0 })).toBeCloseTo(1);
  expect(panFor(me, 0, { x: -5, z: 0 })).toBeCloseTo(-1);
  expect(panFor(me, 0, { x: 0, z: -5 })).toBeCloseTo(0);
  expect(panFor(me, 0, { x: 0, z: 5 })).toBeCloseTo(0);
  // Turned a quarter left (facing -X): what was ahead (-Z) is now on the right.
  expect(panFor(me, Math.PI / 2, { x: 0, z: -5 })).toBeCloseTo(1);
  expect(panFor(me, 0, me)).toBe(0);
});
