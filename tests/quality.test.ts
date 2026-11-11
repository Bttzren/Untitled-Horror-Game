// Tests for the quality pass after the first playable version.
import { expect, test } from 'vitest';
import { generateDream } from '../src/dream/generator';
import { DT, createWorld } from '../src/rules/world';
import { promptFor } from '../src/view/ui/hud';
import { hallMap } from './fixtures/maps';
import { input, startedNight } from './net/helpers';
import { seconds, step, worldWith } from './rules/helpers';

function atOpenDoor(players = 1) {
  const w = worldWith(hallMap(), players);
  w.round.banked = w.round.quota;
  step(w);
  w.players[0]!.pos = { x: 12, z: 13 };
  const view = () => ({ localId: 0, cameraId: 0, players: w.players, entities: w.entities, memories: w.memories, round: w.round });
  return { w, view };
}

test('leaving takes two presses of E, so one stray press cannot end your night', () => {
  const { w, view } = atOpenDoor();
  expect(promptFor(view(), w.map)).toBe('E — leave the dream');
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.status).toBe('active');
  expect(promptFor(view(), w.map)).toBe('E again — leave for good');
  step(w, {}, seconds(1));
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.status).toBe('left');
});

test('the second press must come within 3 seconds', () => {
  const { w, view } = atOpenDoor();
  step(w, { 0: { interact: true } });
  step(w, {}, seconds(3.2));
  expect(promptFor(view(), w.map)).toBe('E — leave the dream');
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.status).toBe('active'); // that press only armed it again
});

test('walking away from the Door cancels a half-made decision to leave', () => {
  const { w } = atOpenDoor();
  step(w, { 0: { interact: true } });
  w.players[0]!.pos = { x: 12, z: 20 };
  step(w);
  w.players[0]!.pos = { x: 12, z: 13 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.status).toBe('active');
});

test('a player whose inputs stop arriving stops moving after half a second', () => {
  const { host, lb, peers } = startedNight(2);
  peers[1]!.send({ t: 'input', cmd: input(1, { moveX: 1, sprint: true }) });
  lb.deliver();
  for (let i = 0; i < 20; i++) host.tick(DT);
  const at = { ...host.world!.players[1]!.pos };
  for (let i = 0; i < 30; i++) host.tick(DT);
  expect(host.world!.players[1]!.pos).toEqual(at);
  expect(host.world!.players[1]!.sprinting).toBe(false);
});

test('an entity that wakes at phase 2 is visible for 3 seconds before it acts', () => {
  const map = generateDream(3, 1);
  const w = createWorld(map, [{ id: 0, name: 'a' }], 1);
  const sleeper = w.entities.find(e => !e.active)!;
  const awake = w.entities.find(e => e.active)!;
  awake.active = false; // keep the test about the sleeper only
  w.players[0]!.pos = { x: sleeper.pos.x + 0.5, z: sleeper.pos.z }; // standing right on top of it
  w.players[0]!.yaw = Math.PI; // facing away
  w.round.timeLeft = 240.01;
  const events = step(w, {}, 2);
  awake.active = false;
  expect(sleeper.active).toBe(true);
  expect(events).toContainEqual({ type: 'woke', entity: sleeper.type });
  step(w, {}, seconds(2.8));
  expect(w.players[0]!.status).toBe('active');
  awake.active = false;
  step(w, {}, seconds(0.5));
  expect(w.players[0]!.status).toBe('caught');
});
