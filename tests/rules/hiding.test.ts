import { expect, test } from 'vitest';
import { detectable } from '../../src/rules/entities';
import { catchPlayer } from '../../src/rules/round';
import { hallMap, twoRoomsMap } from '../fixtures/maps';
import { addEntity, noises, seconds, step, worldWith } from './helpers';

// hallMap has a locker (spot 0) at (2, 0.5) and a curtain (spot 1) at (22, 0.5).
const drawing = (x: number, z: number) => ({ kind: 'drawing', value: 20, pos: { x, z } });

test('interact within 1.5 m of a hiding spot hides the player and silently drops what they carry', () => {
  const w = worldWith(hallMap(), 1, [drawing(2, 2.5)]);
  w.players[0]!.pos = { x: 2, z: 1.9 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.carrying).toBe(0);
  const events = step(w, { 0: { interact: true } });
  expect(w.players[0]!.hiddenIn).toBe(0);
  expect(w.players[0]!.carrying).toBeNull();
  expect(w.memories[0]).toMatchObject({ state: 'ground', pos: { x: 2, z: 1.9 } });
  expect(noises(events)).toEqual([]);
  expect(w.players[0]!.pos).toEqual({ x: 2, z: 0.5 }); // inside the locker
});

test('a hiding spot is out of reach at 1.6 m', () => {
  const w = worldWith(hallMap(), 1);
  w.players[0]!.pos = { x: 2, z: 2.1 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.hiddenIn).toBeNull();
});

test('a hidden player cannot move and makes no footstep noise; interact leaves the spot', () => {
  const w = worldWith(hallMap(), 1);
  w.players[0]!.pos = { x: 2, z: 1.5 };
  step(w, { 0: { interact: true } });
  const events = step(w, { 0: { moveZ: -1, sprint: true } }, seconds(2));
  expect(w.players[0]!.pos).toEqual({ x: 2, z: 0.5 });
  expect(noises(events)).toEqual([]);
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.hiddenIn).toBeNull();
  expect(w.players[0]!.pos.z).toBeGreaterThan(1); // stepped out, clear of the wall
  step(w, { 0: { moveZ: -1 } }, seconds(1));
  expect(w.players[0]!.pos.z).toBeGreaterThan(3); // and can walk again
});

test('one hiding spot holds one player', () => {
  const w = worldWith(hallMap(), 2);
  w.players[0]!.pos = { x: 2, z: 1.5 };
  w.players[1]!.pos = { x: 2.5, z: 1.5 };
  step(w, { 0: { interact: true }, 1: { interact: true } });
  expect(w.players[0]!.hiddenIn).toBe(0);
  expect(w.players[1]!.hiddenIn).toBeNull();
});

test('an usher with line of sight at the moment of hiding is recorded in exposedTo', () => {
  const seen = worldWith(hallMap(), 1);
  const watcher = addEntity(seen, 'usher', { x: 10, z: 10 });
  seen.players[0]!.pos = { x: 2, z: 1.5 };
  seen.players[0]!.yaw = Math.atan2(-(10 - 2), -(10 - 1.5)); // stare at it so it stays put
  step(seen, { 0: { interact: true } });
  expect(seen.players[0]!.exposedTo).toEqual([watcher.id]);
  expect(detectable(seen, watcher).map(p => p.id)).toEqual([0]);

  const unseen = worldWith(twoRoomsMap(), 1);
  unseen.map.hidingSpots.push({ id: 0, kind: 'locker', pos: { x: 2, z: 0.5 } });
  const blocked = addEntity(unseen, 'usher', { x: 6, z: 6 }); // in the sealed room, behind a wall
  unseen.players[0]!.pos = { x: 2, z: 1.5 };
  step(unseen, { 0: { interact: true } });
  expect(unseen.players[0]!.hiddenIn).toBe(0);
  expect(unseen.players[0]!.exposedTo).toEqual([]);
  expect(detectable(unseen, blocked)).toEqual([]);
});

test('a listener never notices a player hiding, even beside them', () => {
  const w = worldWith(hallMap(), 1);
  const l = addEntity(w, 'listener', { x: 5, z: 1.5 });
  w.players[0]!.pos = { x: 2, z: 1.5 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.exposedTo).toEqual([]);
  expect(detectable(w, l)).toEqual([]);
});

test('detectable excludes hidden players unless exposed, and all caught or left players', () => {
  const w = worldWith(hallMap(), 4);
  const e = addEntity(w, 'usher', { x: 20, z: 20 });
  w.players[1]!.hiddenIn = 0;
  w.players[2]!.status = 'left';
  catchPlayer(w, w.players[3]!, 'usher');
  expect(detectable(w, e).map(p => p.id)).toEqual([0]);
  w.players[1]!.exposedTo = [e.id];
  expect(detectable(w, e).map(p => p.id)).toEqual([0, 1]);
});

test('exposedTo is cleared on leaving the spot', () => {
  const w = worldWith(hallMap(), 1);
  w.players[0]!.pos = { x: 2, z: 1.5 };
  step(w, { 0: { interact: true } });
  w.players[0]!.exposedTo = [7];
  step(w, { 0: { interact: true } });
  expect(w.players[0]!).toMatchObject({ hiddenIn: null, exposedTo: [] });
});

test('a caught player leaves their hiding spot free', () => {
  const w = worldWith(hallMap(), 2);
  w.players[0]!.pos = { x: 2, z: 1.5 };
  step(w, { 0: { interact: true } });
  catchPlayer(w, w.players[0]!, 'usher');
  w.players[1]!.pos = { x: 2, z: 1.5 };
  step(w, { 1: { interact: true } });
  expect(w.players[1]!.hiddenIn).toBe(0);
});
