import { expect, test } from 'vitest';
import { catchPlayer } from '../../src/rules/round';
import { DT, removePlayer } from '../../src/rules/world';
import { hallMap } from '../fixtures/maps';
import { seconds, step, worldWith } from './helpers';

const drawing = (x: number, z: number, value = 20) => ({ kind: 'drawing', value, pos: { x, z } });
const types = (events: { type: string }[]): string[] => events.map(e => e.type).filter(t => t !== 'noise');

/** A world where the quota is already met and the Door is open. */
function openDoorWorld(players: number) {
  const w = worldWith(hallMap(), players);
  w.round.banked = w.round.quota;
  step(w);
  expect(w.round.doorOpen).toBe(true);
  return w;
}

test('the timer counts down from 480 s', () => {
  const w = worldWith(hallMap(), 1);
  expect(w.round.timeLeft).toBe(480);
  step(w, {}, seconds(10));
  expect(w.round.timeLeft).toBeCloseTo(470, 3);
  expect(w.round.result).toBeNull();
});

test('phase 2 starts at 240 s left and emits phase2 once', () => {
  const w = worldWith(hallMap(), 1);
  w.round.timeLeft = 240 + DT * 1.5;
  expect(types(step(w))).toEqual([]);
  expect(w.round.phase2).toBe(false);
  expect(types(step(w))).toEqual(['phase2']);
  expect(w.round.phase2).toBe(true);
  expect(types(step(w, {}, 30))).toEqual([]);
});

test('the Door opens when banked reaches the quota and emits doorOpen once', () => {
  const w = worldWith(hallMap(), 1, [drawing(12, 14, 150)]);
  w.players[0]!.pos = { x: 12, z: 13.5 };
  step(w, { 0: { interact: true } });
  expect(w.round.doorOpen).toBe(false);
  const events = step(w, { 0: { interact: true } }); // bank 150 of 150
  expect(types(events)).toEqual(['banked', 'doorOpen']);
  expect(w.round.doorOpen).toBe(true);
  expect(types(step(w, {}, 30))).toEqual([]);
});

test('interact at a closed Door without a memory does nothing', () => {
  const w = worldWith(hallMap(), 1);
  w.players[0]!.pos = { x: 12, z: 13 };
  expect(types(step(w, { 0: { interact: true } }))).toEqual([]);
  expect(w.players[0]!.status).toBe('active');
});

test('interact at the open Door without a memory leaves: status left, event left', () => {
  const w = openDoorWorld(2);
  w.players[0]!.pos = { x: 12, z: 13 };
  const events = step(w, { 0: { interact: true } });
  expect(w.players[0]!.status).toBe('left');
  expect(events).toContainEqual({ type: 'left', player: 0 });
  expect(w.round.result).toBeNull(); // player 1 is still inside
});

test('the open Door is out of reach at 2.6 m', () => {
  const w = openDoorWorld(1);
  w.players[0]!.pos = { x: 12, z: 14.6 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.status).toBe('active');
});

test('at the open Door a memory in reach is picked up before leaving', () => {
  const w = worldWith(hallMap(), 1, [drawing(12, 13.5)]);
  w.round.banked = w.round.quota;
  w.players[0]!.pos = { x: 12, z: 13 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!).toMatchObject({ status: 'active', carrying: 0 });
  step(w, { 0: { interact: true } });
  expect(w.round.banked).toBe(w.round.quota + 20);
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.status).toBe('left');
});

test('success when every uncaught player has left', () => {
  const w = openDoorWorld(2);
  catchPlayer(w, w.players[1]!, 'usher');
  step(w);
  expect(w.round.result).toBeNull();
  w.players[0]!.pos = { x: 12, z: 13 };
  step(w, { 0: { interact: true } });
  expect(w.round.result).toBe('success');
});

test('fail when every player is caught before anyone leaves', () => {
  const w = openDoorWorld(2);
  catchPlayer(w, w.players[0]!, 'usher');
  catchPlayer(w, w.players[1]!, 'listener');
  step(w);
  expect(w.round.result).toBe('fail');
});

test('catchPlayer drops what they carry, marks them caught and reports it', () => {
  const w = worldWith(hallMap(), 1, [drawing(4, 5)]);
  w.players[0]!.pos = { x: 4, z: 4 };
  step(w, { 0: { interact: true } });
  w.events = [];
  catchPlayer(w, w.players[0]!, 'listener');
  expect(w.players[0]!).toMatchObject({ status: 'caught', carrying: null });
  expect(w.memories[0]).toMatchObject({ state: 'ground', pos: { x: 4, z: 4 } });
  expect(w.events).toContainEqual({ type: 'caught', player: 0, by: 'listener' });
  catchPlayer(w, w.players[0]!, 'usher'); // already caught: nothing more happens
  expect(w.events.filter(e => e.type === 'caught')).toHaveLength(1);
});

test('at zero everyone still inside is caught by collapse', () => {
  const w = worldWith(hallMap(), 2);
  w.round.timeLeft = DT / 2;
  const events = step(w);
  expect(w.round.timeLeft).toBe(0);
  expect(w.players.map(p => p.status)).toEqual(['caught', 'caught']);
  expect(events).toContainEqual({ type: 'caught', player: 0, by: 'collapse' });
  expect(events).toContainEqual({ type: 'caught', player: 1, by: 'collapse' });
});

test('at zero: quota met and someone left is success; quota unmet is fail; quota met but nobody left is fail', () => {
  const left = openDoorWorld(2);
  left.players[0]!.pos = { x: 12, z: 13 };
  step(left, { 0: { interact: true } });
  left.round.timeLeft = DT / 2;
  step(left);
  expect(left.round.result).toBe('success');
  expect(left.players[1]!.status).toBe('caught');

  const unmet = worldWith(hallMap(), 1);
  unmet.round.timeLeft = DT / 2;
  step(unmet);
  expect(unmet.round.result).toBe('fail');

  const stayed = openDoorWorld(1);
  stayed.round.timeLeft = DT / 2;
  step(stayed);
  expect(stayed.round.result).toBe('fail');
});

test('once a result is set the world stops changing', () => {
  const w = worldWith(hallMap(), 1);
  w.round.timeLeft = DT / 2;
  step(w);
  expect(w.round.result).toBe('fail');
  const frozen = JSON.stringify({ ...w, map: null });
  step(w, { 0: { moveZ: 1, interact: true } }, 10);
  expect(JSON.stringify({ ...w, map: null })).toBe(frozen);
});

test('removing the last active player while another has left ends the night as success', () => {
  const w = openDoorWorld(2);
  w.players[0]!.pos = { x: 12, z: 13 };
  step(w, { 0: { interact: true } });
  removePlayer(w, 1);
  expect(w.round.result).toBe('success');
});

test('removing the last active player while the rest are caught ends the night as fail', () => {
  const w = worldWith(hallMap(), 2);
  catchPlayer(w, w.players[0]!, 'usher');
  removePlayer(w, 1);
  expect(w.round.result).toBe('fail');
});
