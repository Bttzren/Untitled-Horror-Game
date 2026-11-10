import { expect, test } from 'vitest';
import { generateDream } from '../../src/dream/generator';
import { cellOf, isOpen } from '../../src/dream/grid';
import { moveAlong, tryCatch } from '../../src/rules/entities';
import { DT, createWorld } from '../../src/rules/world';
import { dist } from '../../src/shared/vec';
import { hallMap, twoRoomsMap } from '../fixtures/maps';
import { addEntity, step, worldWith } from './helpers';

const night = (seed: number, n: number) => createWorld(generateDream(seed, n), [{ id: 0, name: 'a' }], n);

test('nights 1 and 2: one entity is active at the start, the other wakes at phase 2', () => {
  for (const n of [1, 2]) {
    const w = night(3, n);
    expect(w.entities.map(e => e.type).sort()).toEqual(['listener', 'usher']);
    expect(w.entities.filter(e => e.active)).toHaveLength(1);
    w.round.timeLeft = 240.01;
    step(w);
    expect(w.round.phase2).toBe(true);
    step(w);
    expect(w.entities.every(e => e.active)).toBe(true);
  }
});

test('night 3: both are active from the start', () => {
  expect(night(3, 3).entities.every(e => e.active)).toBe(true);
});

test('the starting entity is decided by the seed, and differs across seeds', () => {
  const first = (seed: number) => night(seed, 1).entities.find(e => e.active)!.type;
  expect(first(11)).toBe(first(11));
  expect(new Set(Array.from({ length: 30 }, (_, s) => first(s + 1))).size).toBe(2);
});

test('entities spawn on map.entitySpawns, and a map without spawns has none', () => {
  const w = night(3, 1);
  expect(w.entities.map(e => e.pos)).toEqual(w.map.entitySpawns.slice(0, 2));
  expect(worldWith(hallMap(), 1).entities).toEqual([]);
});

test('moveAlong follows doorways and reports arrival', () => {
  const w = worldWith(twoRoomsMap(), 1);
  const e = addEntity(w, 'listener', { x: 2, z: 2 });
  const target = { x: 10, z: 6 };
  let arrived = false, steps = 0;
  while (!arrived && steps < 600) {
    const before = cellOf(e.pos);
    arrived = moveAlong(e, target, 4, w, DT);
    const after = cellOf(e.pos);
    if (before.cx !== after.cx || before.cz !== after.cz) expect(isOpen(w.map, before, after)).toBe(true);
    steps++;
  }
  expect(arrived).toBe(true);
  expect(dist(e.pos, target)).toBeLessThan(0.01);
  // 12 m of path at 4 m/s is about 3 s.
  expect(steps * DT).toBeGreaterThan(2.2); // never faster than the straight line (8.9 m at 4 m/s)
  expect(steps * DT).toBeLessThan(4);
});

test('moveAlong moves at the given speed and turns to face its direction of travel', () => {
  const w = worldWith(hallMap(), 1);
  const e = addEntity(w, 'usher', { x: 12, z: 20 });
  for (let i = 0; i < 30; i++) moveAlong(e, { x: 12, z: 2 }, 6, w, DT);
  expect(20 - e.pos.z).toBeCloseTo(6, 1);
  expect(Math.cos(e.yaw)).toBeCloseTo(1, 3); // yaw 0 faces -Z
});

test('moveAlong stays put when there is no route', () => {
  const w = worldWith(twoRoomsMap(), 1);
  const e = addEntity(w, 'usher', { x: 2, z: 2 });
  expect(moveAlong(e, { x: 6, z: 6 }, 6, w, DT)).toBe(false);
  expect(e.pos).toEqual({ x: 2, z: 2 });
});

test('tryCatch catches within range and not beyond; the caught player drops their memory', () => {
  const w = worldWith(hallMap(), 2, [{ kind: 'drawing', value: 20, pos: { x: 12, z: 12.5 } }]);
  const e = addEntity(w, 'listener', { x: 12, z: 10 });
  w.players[0]!.pos = { x: 12, z: 11.1 };
  w.players[1]!.pos = { x: 12, z: 11.3 };
  w.players[0]!.carrying = 0; w.memories[0]!.state = 'carried'; w.memories[0]!.carrier = 0;
  tryCatch(w, e, 1.2);
  expect(w.players.map(p => p.status)).toEqual(['caught', 'active']);
  expect(w.memories[0]).toMatchObject({ state: 'ground', carrier: null });
  expect(w.events).toContainEqual({ type: 'caught', player: 0, by: 'listener' });
});

test('tryCatch ignores hidden players', () => {
  const w = worldWith(hallMap(), 1);
  const e = addEntity(w, 'listener', { x: 2, z: 1 });
  w.players[0]!.pos = { x: 2, z: 0.5 };
  w.players[0]!.hiddenIn = 0;
  tryCatch(w, e, 1.2);
  expect(w.players[0]!.status).toBe('active');
});
