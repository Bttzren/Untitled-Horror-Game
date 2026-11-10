import { expect, test } from 'vitest';
import { generateDream } from '../../src/dream/generator';
import { cellOf, edgeKey, isOpen, roomGraphDistance, roomIdAt } from '../../src/dream/grid';
import { CONFIG, MEMORY_KINDS, quotaFor, roomsFor } from '../../src/rules/config';
import { dist } from '../../src/shared/vec';
import { key, reachableCells } from '../fixtures/maps';

test('same seed and night give an identical map', () => {
  expect(generateDream(123, 2)).toEqual(generateDream(123, 2));
});

test('different seeds give different layouts', () => {
  expect(generateDream(1, 1).roomAt).not.toEqual(generateDream(2, 1).roomAt);
});

test.each([1, 2, 3, 5, 7])('night %i invariants hold for seeds 1..60', (night) => {
  for (let seed = 1; seed <= 60; seed++) {
    const m = generateDream(seed, night);
    expect(m.rooms.length).toBe(roomsFor(night));
    expect(m.rooms[0]!.template).toBe('door');
    const reach = reachableCells(m);
    for (const r of m.rooms) for (const c of r.cells) expect(reach.has(key(c))).toBe(true);
    for (const s of m.memories) expect(reach.has(key(cellOf(s.pos)))).toBe(true);
    expect(m.memories.reduce((a, s) => a + s.value, 0)).toBeGreaterThanOrEqual(1.6 * quotaFor(night));
    for (const s of m.memories) expect(roomIdAt(m, cellOf(s.pos))).not.toBe(0);
    expect(m.spawns).toHaveLength(4);
    for (const s of m.spawns) {
      expect(dist(s, m.door)).toBeLessThanOrEqual(2);
      expect(roomIdAt(m, cellOf(s))).toBe(0);
    }
    expect(m.entitySpawns.length).toBeGreaterThanOrEqual(2);
    for (const e of m.entitySpawns) {
      expect(roomGraphDistance(m, 0, roomIdAt(m, cellOf(e)))).toBeGreaterThanOrEqual(CONFIG.entityMinRoomsFromDoor);
    }
    expect(m.hidingSpots.length).toBeGreaterThanOrEqual(3);
    for (const h of m.hidingSpots) {
      expect(reach.has(key(cellOf(h.pos)))).toBe(true);
      expect(roomIdAt(m, cellOf(h.pos))).not.toBe(0);
    }
    expect(m.lights.length).toBeGreaterThanOrEqual(m.rooms.length);
  }
});

test('memory values fall inside their kind range and sit clear of walls', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const s of generateDream(seed, 2).memories) {
      const kind = MEMORY_KINDS.find(k => k.id === s.kind);
      expect(kind).toBeDefined();
      expect(s.value).toBeGreaterThanOrEqual(kind!.min);
      expect(s.value).toBeLessThanOrEqual(kind!.max);
      for (const v of [s.pos.x, s.pos.z]) {
        const inCell = v - Math.floor(v / CONFIG.cell) * CONFIG.cell;
        expect(inCell).toBeGreaterThanOrEqual(0.6);
        expect(inCell).toBeLessThanOrEqual(CONFIG.cell - 0.6);
      }
    }
  }
});

test('isOpen is true inside a room and through doorways, false through walls and into solid', () => {
  let doorwaysSeen = 0, wallsSeen = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const m = generateDream(seed, 1);
    for (let cz = 0; cz < m.height; cz++) for (let cx = 0; cx < m.width; cx++) {
      const a = { cx, cz };
      for (const b of [{ cx: cx + 1, cz }, { cx, cz: cz + 1 }]) {
        const ra = roomIdAt(m, a), rb = roomIdAt(m, b);
        if (ra < 0 || rb < 0) { expect(isOpen(m, a, b)).toBe(false); continue; }
        expect(isOpen(m, a, b)).toBe(isOpen(m, b, a));
        if (ra === rb) { expect(isOpen(m, a, b)).toBe(true); continue; }
        const isDoorway = m.doorways.includes(edgeKey(m, a, b));
        expect(isOpen(m, a, b)).toBe(isDoorway);
        if (isDoorway) doorwaysSeen++; else wallsSeen++;
      }
    }
    expect(isOpen(m, { cx: -1, cz: 0 }, { cx: 0, cz: 0 })).toBe(false);
  }
  expect(doorwaysSeen).toBeGreaterThan(0);
  expect(wallsSeen).toBeGreaterThan(0);
});

test('some dreams contain loops: more doorways than a tree needs', () => {
  let loops = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const m = generateDream(seed, 2);
    if (m.doorways.length > m.rooms.length - 1) loops++;
  }
  expect(loops).toBeGreaterThan(5);
});
