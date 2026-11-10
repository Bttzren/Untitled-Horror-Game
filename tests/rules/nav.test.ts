import { expect, test } from 'vitest';
import { generateDream } from '../../src/dream/generator';
import { cellCenter, cellOf, isOpen } from '../../src/dream/grid';
import { createRng } from '../../src/dream/rng';
import { findPath, lineOfSight } from '../../src/rules/nav';
import type { Vec2 } from '../../src/shared/vec';
import { twoRoomsMap } from '../fixtures/maps';

const m = twoRoomsMap();

test('sees across one room', () => expect(lineOfSight(m, { x: 1, z: 2 }, { x: 7, z: 2 })).toBe(true));
test('sees through a doorway', () => expect(lineOfSight(m, { x: 6, z: 2 }, { x: 10, z: 2 })).toBe(true));
test('blocked by a wall', () => expect(lineOfSight(m, { x: 6, z: 2 }, { x: 6, z: 6 })).toBe(false));
test('blocked diagonally around a wall corner', () => expect(lineOfSight(m, { x: 6, z: 2 }, { x: 10, z: 6.5 })).toBe(false));
test('sight is symmetric', () => {
  const pts: Vec2[] = [{ x: 1, z: 1 }, { x: 6, z: 3 }, { x: 9, z: 1 }, { x: 11, z: 7 }, { x: 6, z: 6 }];
  for (const a of pts) for (const b of pts) expect(lineOfSight(m, a, b)).toBe(lineOfSight(m, b, a));
});
test('a point sees itself, and nothing is seen from solid', () => {
  expect(lineOfSight(m, { x: 1, z: 1 }, { x: 1, z: 1 })).toBe(true);
  expect(lineOfSight(m, { x: 1, z: 6 }, { x: 1, z: 1 })).toBe(false);
});

function expectWalkable(map: typeof m, from: Vec2, path: Vec2[]): void {
  let prev = cellOf(from);
  for (const p of path) {
    const c = cellOf(p);
    if (c.cx !== prev.cx || c.cz !== prev.cz) expect(isOpen(map, prev, c)).toBe(true);
    prev = c;
  }
}

test('path goes through the doorway', () => {
  const from = { x: 2, z: 2 };
  const p = findPath(m, from, { x: 10, z: 6 })!;
  expect(p.at(-1)).toEqual({ x: 10, z: 6 });
  expect(p).toEqual([cellCenter({ cx: 1, cz: 0 }), cellCenter({ cx: 2, cz: 0 }), { x: 10, z: 6 }]);
  expectWalkable(m, from, p);
});
test('a path inside one cell is just the target', () => {
  expect(findPath(m, { x: 1, z: 1 }, { x: 3, z: 3 })).toEqual([{ x: 3, z: 3 }]);
});
test('no path into a sealed room', () => expect(findPath(m, { x: 2, z: 2 }, { x: 6, z: 6 })).toBeNull());
test('no path from or to solid', () => {
  expect(findPath(m, { x: 1, z: 6 }, { x: 2, z: 2 })).toBeNull();
  expect(findPath(m, { x: 2, z: 2 }, { x: 1, z: 6 })).toBeNull();
});
test('finds a walkable path between random room cells on generated maps', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = generateDream(seed, 2);
    const rng = createRng(seed);
    const cells = map.rooms.flatMap(r => r.cells);
    for (let i = 0; i < 10; i++) {
      const from = cellCenter(rng.pick(cells)), to = cellCenter(rng.pick(cells));
      const p = findPath(map, from, to);
      expect(p).not.toBeNull();
      expect(p!.at(-1)).toEqual(to);
      expectWalkable(map, from, p!);
    }
  }
});
