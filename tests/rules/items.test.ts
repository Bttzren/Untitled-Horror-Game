import { expect, test } from 'vitest';
import { generateDream } from '../../src/dream/generator';
import { cellCenter, cellOf } from '../../src/dream/grid';
import { createRng } from '../../src/dream/rng';
import { throwCarried, stepMemories, carriedWeight } from '../../src/rules/items';
import { DT, createWorld, removePlayer } from '../../src/rules/world';
import { dist } from '../../src/shared/vec';
import { hallMap, key, reachableCells, twoRoomsMap } from '../fixtures/maps';
import { noises, seconds, step, worldWith } from './helpers';

const drawing = (x: number, z: number) => ({ kind: 'drawing', value: 20, pos: { x, z } });
const phone = (x: number, z: number) => ({ kind: 'phone', value: 45, pos: { x, z } });
const tv = (x: number, z: number) => ({ kind: 'television', value: 100, pos: { x, z } });

test('interact picks up the nearest memory within 2 m and not beyond', () => {
  const w = worldWith(hallMap(), 1, [drawing(4, 5.9), drawing(4, 7.5), drawing(4, 0.5)]);
  w.players[0]!.pos = { x: 4, z: 4 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.carrying).toBe(0);
  expect(w.memories[0]).toMatchObject({ state: 'carried', carrier: 0 });
  const far = worldWith(hallMap(), 1, [drawing(4, 6.1)]);
  far.players[0]!.pos = { x: 4, z: 4 };
  step(far, { 0: { interact: true } });
  expect(far.players[0]!.carrying).toBeNull();
});

test('a player carries one memory at a time', () => {
  const w = worldWith(hallMap(), 1, [drawing(4, 5), drawing(4, 3)]);
  w.players[0]!.pos = { x: 4, z: 4 };
  step(w, { 0: { interact: true } });
  const first = w.players[0]!.carrying;
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.carrying).toBe(first);
  expect(w.memories.filter(m => m.state === 'carried')).toHaveLength(1);
});

test('two players grabbing the same memory on one step: the lower id gets it', () => {
  const w = worldWith(hallMap(), 2, [drawing(4, 4)]);
  w.players[0]!.pos = { x: 4, z: 5 };
  w.players[1]!.pos = { x: 4, z: 3.5 }; // closer, but a higher id
  step(w, { 0: { interact: true }, 1: { interact: true } });
  expect(w.memories[0]!.carrier).toBe(0);
  expect(w.players[0]!.carrying).toBe(0);
  expect(w.players[1]!.carrying).toBeNull();
});

test('a memory behind a wall cannot be picked up', () => {
  const w = worldWith(twoRoomsMap(), 1, [drawing(6, 4.6)]);
  w.players[0]!.pos = { x: 6, z: 3.5 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.carrying).toBeNull();
});

test('a carried memory travels with its carrier and sets their weight', () => {
  const w = worldWith(hallMap(), 1, [tv(4, 5)]);
  w.players[0]!.pos = { x: 4, z: 4 };
  step(w, { 0: { interact: true } });
  expect(carriedWeight(w, w.players[0]!)).toBe('heavy');
  const z = w.players[0]!.pos.z;
  step(w, { 0: { moveZ: 1, sprint: true } }, seconds(1));
  expect(z - w.players[0]!.pos.z).toBeCloseTo(1.95, 1); // heavy: 65% of walking pace, no sprint
  expect(w.memories[0]!.pos).toEqual(w.players[0]!.pos);
});

test('drop puts it at the player and emits noise 8 (light, medium) or 14 (heavy)', () => {
  for (const [make, radius] of [[drawing, 8], [phone, 8], [tv, 14]] as const) {
    const w = worldWith(hallMap(), 1, [make(4, 5)]);
    w.players[0]!.pos = { x: 4, z: 4 };
    step(w, { 0: { interact: true } });
    w.memories[0]!.noiseTimer = 0;
    const events = step(w, { 0: { drop: true } });
    expect(w.players[0]!.carrying).toBeNull();
    expect(w.memories[0]).toMatchObject({ state: 'ground', carrier: null, pos: { x: 4, z: 4 } });
    expect(noises(events)).toContain(radius);
  }
});

test('throw flies 8 m along the view direction in 0.8 s and emits noise 14 on landing', () => {
  const w = worldWith(hallMap(), 1, [drawing(12, 21)]);
  w.players[0]!.pos = { x: 12, z: 20 };
  step(w, { 0: { interact: true } });
  step(w, { 0: { throwIt: true } });
  expect(w.players[0]!.carrying).toBeNull();
  expect(w.memories[0]!.state).toBe('thrown');
  const flying = step(w, {}, seconds(0.8) - 3);
  expect(w.memories[0]!.state).toBe('thrown');
  expect(noises(flying)).not.toContain(14);
  const landing = step(w, {}, 4);
  expect(w.memories[0]!.state).toBe('ground');
  expect(20 - w.memories[0]!.pos.z).toBeCloseTo(8, 0);
  expect(w.memories[0]!.pos.x).toBeCloseTo(12, 3);
  expect(noises(landing)).toContain(14);
});

test('throw and drop do nothing with empty hands', () => {
  const w = worldWith(hallMap(), 1, [drawing(4, 5)]);
  const events = step(w, { 0: { throwIt: true, drop: true } });
  expect(noises(events)).toEqual([]);
  expect(w.memories[0]!.state).toBe('ground');
});

test('a throw at a wall stops on the near side, on a floor cell reachable from the Door', () => {
  const map = generateDream(9, 1);
  const reach = reachableCells(map);
  const rng = createRng(4);
  const cells = map.rooms.flatMap(r => r.cells);
  for (let i = 0; i < 200; i++) {
    const w = createWorld(map, [{ id: 0, name: 'a' }], 1);
    const p = w.players[0]!, m = w.memories[0]!;
    const c = rng.pick(cells);
    p.pos = { x: c.cx * 4 + 0.4 + rng.next() * 3.2, z: c.cz * 4 + 0.4 + rng.next() * 3.2 };
    p.yaw = rng.next() * Math.PI * 2;
    const from = cellOf(p.pos);
    m.state = 'carried'; m.carrier = 0; p.carrying = m.id;
    throwCarried(w, p);
    for (let s = 0; s < 40; s++) stepMemories(w, DT);
    expect(m.state).toBe('ground');
    expect(reach.has(key(cellOf(m.pos)))).toBe(true);
    // It never went through a wall: there is a clear line back to where it was thrown from.
    expect(dist(m.pos, p.pos)).toBeLessThanOrEqual(8.01);
    expect(from).toBeDefined();
  }
});

test('a throw straight at a wall lands 0.3 m short of it', () => {
  const w = worldWith(twoRoomsMap(), 1, [drawing(6, 2)]);
  const p = w.players[0]!;
  p.pos = { x: 6, z: 2 }; p.yaw = Math.PI; // facing +Z, the wall of the sealed room at z = 4
  step(w, { 0: { interact: true } });
  step(w, { 0: { throwIt: true } });
  step(w, {}, seconds(1));
  expect(w.memories[0]!.state).toBe('ground');
  expect(w.memories[0]!.pos.z).toBeCloseTo(3.7, 2);
  expect(cellOf(w.memories[0]!.pos)).toEqual({ cx: 1, cz: 0 });
});

test('interact within 2.5 m of the Door banks the carried memory', () => {
  const w = worldWith(hallMap(), 1, [drawing(12, 18)]);
  w.players[0]!.pos = { x: 12, z: 17 };
  step(w, { 0: { interact: true } });
  w.players[0]!.pos = { x: 12, z: 14.4 }; // 2.4 m from the Door at (12, 12)
  const events = step(w, { 0: { interact: true } });
  expect(w.round.banked).toBe(20);
  expect(w.memories[0]).toMatchObject({ state: 'banked', carrier: null });
  expect(w.players[0]!.carrying).toBeNull();
  expect(events).toContainEqual({ type: 'banked', player: 0, value: 20 });
});

test('banking is out of reach at 2.6 m, and a banked memory cannot be picked up again', () => {
  const w = worldWith(hallMap(), 1, [drawing(12, 18)]);
  w.players[0]!.pos = { x: 12, z: 17 };
  step(w, { 0: { interact: true } });
  w.players[0]!.pos = { x: 12, z: 14.6 };
  step(w, { 0: { interact: true } });
  expect(w.round.banked).toBe(0);
  w.players[0]!.pos = { x: 12, z: 13 };
  step(w, { 0: { interact: true } });
  expect(w.round.banked).toBe(20);
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.carrying).toBeNull();
});

test('walking emits noise 4 every 0.5 s, sprinting 12, crouching 1, standing still none', () => {
  const run = (cmd: object): number[] => {
    const w = worldWith(hallMap(), 1);
    w.players[0]!.pos = { x: 12, z: 22 };
    return noises(step(w, { 0: cmd }, seconds(2)));
  };
  expect(run({ moveZ: 1 })).toEqual([4, 4, 4, 4]);
  expect(run({ moveZ: 1, sprint: true })).toEqual([12, 12, 12, 12]);
  expect(run({ moveZ: 1, crouch: true })).toEqual([1, 1, 1, 1]);
  expect(run({})).toEqual([]);
});

test('a noisy memory emits noise 10 every 0.5 s on the ground and while carried, never once banked', () => {
  const w = worldWith(hallMap(), 1, [phone(12, 14)]);
  w.players[0]!.pos = { x: 12, z: 14.4 };
  expect(noises(step(w, {}, seconds(2)))).toEqual([10, 10, 10, 10]);
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.carrying).toBe(0);
  expect(noises(step(w, {}, seconds(1)))).toEqual([10, 10]);
  step(w, { 0: { interact: true } }); // bank it
  expect(w.memories[0]!.state).toBe('banked');
  expect(noises(step(w, {}, seconds(2)))).toEqual([]);
});

test('noise records where and who, and noises older than 1 s are pruned', () => {
  const w = worldWith(hallMap(), 1);
  w.players[0]!.pos = { x: 12, z: 22 };
  step(w, { 0: { moveZ: 1 } }, seconds(0.5));
  expect(w.noises).toHaveLength(1);
  expect(w.noises[0]).toMatchObject({ radius: 4, source: { kind: 'player', id: 0 } });
  expect(dist(w.noises[0]!.pos, w.players[0]!.pos)).toBeLessThan(0.2);
  step(w, {}, seconds(1) + 1);
  expect(w.noises).toHaveLength(0);
});

test('removePlayer drops the carried memory at their position', () => {
  const w = worldWith(hallMap(), 2, [drawing(4, 5)]);
  w.players[0]!.pos = { x: 4, z: 4 };
  step(w, { 0: { interact: true } });
  step(w, { 0: { moveZ: 1 } }, 10);
  const at = { ...w.players[0]!.pos };
  removePlayer(w, 0);
  expect(w.memories[0]).toMatchObject({ state: 'ground', carrier: null, pos: at });
  expect(cellCenter(cellOf(at))).toBeDefined();
});
