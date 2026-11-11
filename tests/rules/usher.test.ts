import { expect, test } from 'vitest';
import { isObserved } from '../../src/rules/entities/usher';
import type { PlayerState } from '../../src/rules/types';
import { dist, type Vec2 } from '../../src/shared/vec';
import { hallMap, twoRoomsMap } from '../fixtures/maps';
import { addEntity, seconds, step, worldWith } from './helpers';

/** Turns a player to look at a point, optionally off by some degrees. */
function face(p: PlayerState, at: Vec2, offDeg = 0): void {
  p.yaw = Math.atan2(-(at.x - p.pos.x), -(at.z - p.pos.z)) + (offDeg * Math.PI) / 180;
}

function scene(players = 1) {
  const w = worldWith(hallMap(), players);
  const usher = addEntity(w, 'usher', { x: 12, z: 4 });
  w.players[0]!.pos = { x: 12, z: 16 }; // 12 m away
  return { w, usher };
}

test('observed when a player faces it within 50 degrees and 30 m with line of sight', () => {
  const { w, usher } = scene();
  face(w.players[0]!, usher.pos);
  expect(isObserved(w, usher)).toBe(true);
  face(w.players[0]!, usher.pos, 49);
  expect(isObserved(w, usher)).toBe(true);
  face(w.players[0]!, usher.pos, -49);
  expect(isObserved(w, usher)).toBe(true);
});

test('not observed at 51 degrees off the view direction, or with the player facing away', () => {
  const { w, usher } = scene();
  face(w.players[0]!, usher.pos, 51);
  expect(isObserved(w, usher)).toBe(false);
  face(w.players[0]!, usher.pos, 180);
  expect(isObserved(w, usher)).toBe(false);
});

test('not observed beyond 30 m or behind a wall', () => {
  const far = worldWith({ ...hallMap(), width: 6 }, 1);
  const u = addEntity(far, 'usher', { x: 1, z: 1 });
  far.players[0]!.pos = { x: 23, z: 23 }; // 31.1 m away across the hall
  face(far.players[0]!, u.pos);
  expect(isObserved(far, u)).toBe(false);
  far.players[0]!.pos = { x: 21, z: 21 }; // 28.3 m
  face(far.players[0]!, u.pos);
  expect(isObserved(far, u)).toBe(true);

  const walled = worldWith(twoRoomsMap(), 1);
  const hiddenUsher = addEntity(walled, 'usher', { x: 6, z: 6 }); // sealed room
  walled.players[0]!.pos = { x: 6, z: 2 };
  face(walled.players[0]!, hiddenUsher.pos);
  expect(isObserved(walled, hiddenUsher)).toBe(false);
});

test('hidden, caught and left players do not observe', () => {
  for (const change of [(p: PlayerState) => { p.hiddenIn = 0; }, (p: PlayerState) => { p.status = 'caught'; }, (p: PlayerState) => { p.status = 'left'; }]) {
    const { w, usher } = scene();
    face(w.players[0]!, usher.pos);
    change(w.players[0]!);
    expect(isObserved(w, usher)).toBe(false);
  }
});

test('frozen while observed: position unchanged over 5 s', () => {
  const { w, usher } = scene();
  face(w.players[0]!, usher.pos);
  step(w, {}, seconds(5));
  expect(usher.pos).toEqual({ x: 12, z: 4 });
  expect(w.players[0]!.status).toBe('active');
});

test('unobserved it closes on the nearest detectable player at 6 m/s', () => {
  const { w, usher } = scene();
  face(w.players[0]!, usher.pos, 180);
  step(w, {}, seconds(1.4)); // 0.4 s before it stirs, then 1 s of movement
  expect(dist(usher.pos, w.players[0]!.pos)).toBeCloseTo(6, 1);
  expect(usher.mode).toBe('chase');
});

test('it picks the nearest player', () => {
  const { w, usher } = scene(2);
  w.players[1]!.pos = { x: 4, z: 4 }; // 8 m away; player 0 is 12 m away
  face(w.players[0]!, usher.pos, 180);
  w.players[1]!.yaw = Math.PI / 2; // facing -X, away from it
  step(w, {}, seconds(0.9));
  expect(usher.pos.x).toBeLessThan(10);
  expect(usher.pos.z).toBeCloseTo(4, 1);
});

test('catches at 1.0 m only while unobserved', () => {
  const { w, usher } = scene();
  usher.pos = { x: 12, z: 15.5 }; // 0.5 m in front of the player
  face(w.players[0]!, usher.pos);
  step(w, {}, seconds(1));
  expect(w.players[0]!.status).toBe('active');
  face(w.players[0]!, usher.pos, 180); // look away
  expect(step(w, {}, 6).some(e => e.type === 'caught')).toBe(false); // not at once
  const events = step(w, {}, 8);
  expect(w.players[0]!.status).toBe('caught');
  expect(events).toContainEqual({ type: 'caught', player: 0, by: 'usher' });
});

test('it does not catch from more than 1.0 m', () => {
  const { w, usher } = scene();
  usher.pos = { x: 12, z: 13.5 }; // 2.5 m behind the player's back
  face(w.players[0]!, usher.pos, 180);
  step(w, {}, 12 + 4); // 0.4 s before it stirs, then 4 steps at 6 m/s: now about 1.7 m away
  expect(w.players[0]!.status).toBe('active');
  step(w, {}, 6);
  expect(w.players[0]!.status).toBe('caught');
});

test('one watcher is enough to hold it while another player works', () => {
  const { w, usher } = scene(2);
  face(w.players[0]!, usher.pos);
  w.players[1]!.pos = { x: 13, z: 5 }; // right beside it, back turned
  w.players[1]!.yaw = Math.PI; // facing +Z, away
  step(w, {}, seconds(3));
  expect(usher.pos).toEqual({ x: 12, z: 4 });
  expect(w.players[1]!.status).toBe('active');
});

test('with no detectable player it stays put', () => {
  const { w, usher } = scene();
  w.players[0]!.pos = { x: 2, z: 0.5 };
  w.players[0]!.hiddenIn = 0; // hidden, and it did not see them hide
  step(w, {}, seconds(2));
  expect(usher.pos).toEqual({ x: 12, z: 4 });
  expect(usher.mode).toBe('idle');
});

test('it still finds a player it watched hide', () => {
  const { w, usher } = scene();
  w.players[0]!.pos = { x: 2, z: 1.5 };
  face(w.players[0]!, usher.pos, 180);
  step(w, { 0: { interact: true } }); // hides in plain view of it
  expect(w.players[0]!.hiddenIn).toBe(0);
  step(w, {}, seconds(3));
  expect(w.players[0]!.status).toBe('caught');
});
