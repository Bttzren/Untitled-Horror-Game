import { expect, test } from 'vitest';
import { generateDream } from '../../src/dream/generator';
import { cellOf, roomIdAt } from '../../src/dream/grid';
import { emitNoise } from '../../src/rules/noise';
import type { World } from '../../src/rules/types';
import { DT, createWorld } from '../../src/rules/world';
import { dist, type Vec2 } from '../../src/shared/vec';
import { hallMap } from '../fixtures/maps';
import { addEntity, seconds, step, worldWith } from './helpers';

const noise = (w: World, pos: Vec2, radius: number): void => emitNoise(w, pos, radius, { kind: 'player', id: 0 });

/** A hall with one silent, crouching player parked in a far corner, and a listener in the middle. */
function scene(at: Vec2 = { x: 12, z: 12 }) {
  const w = worldWith(hallMap(), 1);
  w.players[0]!.pos = { x: 23, z: 23 };
  return { w, l: addEntity(w, 'listener', at) };
}

test('wanders between rooms at 2 m/s when it hears nothing', () => {
  const w = createWorld(generateDream(3, 3), [{ id: 0, name: 'a' }], 3);
  w.entities = [];
  w.memories = []; // no ringing phones to distract it
  w.players[0]!.status = 'left'; // nobody inside to hear or catch
  w.players.push({ ...w.players[0]!, id: 1, status: 'active', pos: { ...w.map.spawns[1]! }, hiddenIn: 0 }); // keeps the night running
  const l = addEntity(w, 'listener', w.map.entitySpawns[0]!);
  let travelled = 0;
  const rooms = new Set<number>();
  for (let i = 0; i < seconds(40); i++) {
    const before = { ...l.pos };
    step(w);
    const d = dist(before, l.pos);
    expect(d).toBeLessThanOrEqual(2 * DT + 1e-6);
    travelled += d;
    rooms.add(roomIdAt(w.map, cellOf(l.pos)));
    expect(roomIdAt(w.map, cellOf(l.pos))).toBeGreaterThanOrEqual(0);
  }
  expect(l.mode).toBe('wander');
  expect(travelled).toBeGreaterThan(60);
  expect(rooms.size).toBeGreaterThan(1);
});

test('a noise whose radius reaches it sends it there at 4.5 m/s', () => {
  const { w, l } = scene({ x: 12, z: 4 });
  noise(w, { x: 12, z: 20 }, 20);
  step(w, {}, seconds(1));
  expect(l.mode).toBe('hunt');
  expect(l.pos.z - 4).toBeCloseTo(4.5, 1);
  expect(l.pos.x).toBeCloseTo(12, 1);
});

test('a noise whose radius does not reach it is ignored', () => {
  const { w, l } = scene({ x: 12, z: 4 });
  noise(w, { x: 12, z: 20 }, 13); // 16 m away; even drifting toward it for a second leaves it out of earshot
  step(w, {}, seconds(1));
  expect(l.mode).toBe('wander');
});

test('of several noises it goes to the largest radius; ties go to the most recent', () => {
  const a = scene();
  noise(a.w, { x: 4, z: 12 }, 10);
  noise(a.w, { x: 20, z: 12 }, 14);
  noise(a.w, { x: 12, z: 4 }, 9);
  step(a.w, {}, seconds(1));
  expect(a.l.pos.x).toBeCloseTo(16.5, 1);

  const b = scene();
  noise(b.w, { x: 4, z: 12 }, 10);
  step(b.w, {}, 3);
  noise(b.w, { x: 20, z: 12 }, 10); // as loud, but newer
  step(b.w, {}, seconds(1));
  expect(b.l.pos.x).toBeGreaterThan(15);
});

test('a louder new noise replaces the current target; a quieter one does not', () => {
  const { w, l } = scene();
  noise(w, { x: 4, z: 12 }, 10);
  step(w, {}, seconds(0.5));
  expect(l.pos.x).toBeLessThan(11);
  noise(w, { x: 12, z: 20 }, 9); // quieter: ignored
  step(w, {}, seconds(0.5));
  expect(l.pos.z).toBeCloseTo(12, 1);
  expect(l.pos.x).toBeCloseTo(12 - 4.5, 1);
  noise(w, { x: 20, z: 12 }, 14); // louder: turn around
  step(w, {}, seconds(1));
  expect(l.pos.x).toBeCloseTo(12, 0);
  expect(l.mode).toBe('hunt');
});

test('on arrival it searches 5 s, then wanders', () => {
  const { w, l } = scene();
  noise(w, { x: 12, z: 14 }, 6);
  step(w, {}, seconds(0.6));
  expect(l.mode).toBe('search');
  expect(l.pos).toEqual({ x: 12, z: 14 });
  step(w, {}, seconds(4.3));
  expect(l.mode).toBe('search');
  expect(l.pos).toEqual({ x: 12, z: 14 });
  step(w, {}, seconds(0.7));
  expect(l.mode).toBe('wander');
});

test('after searching a noisy memory it ignores that memory for 20 s', () => {
  const w = worldWith(hallMap(), 1, [{ kind: 'phone', value: 40, pos: { x: 12, z: 8 } }]);
  w.players[0]!.pos = { x: 23, z: 23 };
  const l = addEntity(w, 'listener', { x: 12, z: 4 });
  step(w, {}, seconds(2));
  expect(l.mode).toBe('search');
  expect(dist(l.pos, { x: 12, z: 8 })).toBeLessThan(0.01);
  step(w, {}, seconds(5));
  const modes = new Set<string>();
  for (let i = 0; i < seconds(19); i++) { step(w); modes.add(l.mode); }
  expect([...modes]).toEqual(['wander']); // the phone is still ringing, and it does not care
  for (let i = 0; i < seconds(40); i++) { step(w); modes.add(l.mode); }
  expect(modes.has('hunt')).toBe(true); // once the 20 s are up it is drawn back
});

test('catches any unhidden player within 1.2 m, even a silent one', () => {
  const { w, l } = scene();
  w.players[0]!.pos = { x: 12, z: 13.1 };
  const events = step(w, { 0: { crouch: true } });
  expect(w.players[0]!.status).toBe('caught');
  expect(events).toContainEqual({ type: 'caught', player: 0, by: 'listener' });
  expect(l.type).toBe('listener');
});

test('does not react to a silent crouching player 3 m away, or to flashlights', () => {
  const { w, l } = scene();
  w.players[0]!.pos = { x: 12, z: 15 };
  w.players[0]!.yaw = 0; // facing it, torch on
  w.players[0]!.flashlight = true;
  for (let i = 0; i < seconds(1); i++) {
    step(w, { 0: { crouch: true } });
    expect(l.mode).toBe('wander');
  }
});

test('creeping past at a crouch is not heard from 2 m; walking is', () => {
  const crouch = scene();
  crouch.w.players[0]!.pos = { x: 14, z: 20 };
  crouch.l.pos = { x: 12, z: 14 };
  let hunted = false;
  for (let i = 0; i < seconds(3); i++) { step(crouch.w, { 0: { moveZ: 1, crouch: true } }); hunted ||= crouch.l.mode === 'hunt'; if (crouch.w.players[0]!.status !== 'active') break; }
  expect(hunted).toBe(false);

  const walk = scene();
  walk.w.players[0]!.pos = { x: 14, z: 16 };
  walk.l.pos = { x: 12, z: 14 };
  hunted = false;
  for (let i = 0; i < seconds(1); i++) { step(walk.w, { 0: { moveZ: 1 } }); hunted ||= walk.l.mode === 'hunt'; }
  expect(hunted).toBe(true);
});

test('a hidden player next to it is safe', () => {
  const w = worldWith(hallMap(), 1);
  w.players[0]!.pos = { x: 2, z: 1.5 };
  const l = addEntity(w, 'listener', { x: 2.5, z: 1.6 });
  step(w, { 0: { interact: true } }); // into the locker, right under its nose
  expect(w.players[0]!.hiddenIn).toBe(0);
  step(w, {}, seconds(8));
  expect(w.players[0]!.status).toBe('active');
  expect(l.active).toBe(true);
});
