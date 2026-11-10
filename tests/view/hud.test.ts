import { expect, test } from 'vitest';
import type { ViewState } from '../../src/rules/types';
import { formatTime, nextSpectateTarget, promptFor } from '../../src/view/ui/hud';
import { hallMap } from '../fixtures/maps';
import { worldWith } from '../rules/helpers';

// hallMap: Door at (12, 12); locker (spot 0) at (2, 0.5).
function scene(players = 1) {
  const w = worldWith(hallMap(), players, [{ kind: 'musicBox', value: 45, pos: { x: 6, z: 6 } }]);
  const view = (): ViewState => ({ localId: 0, cameraId: 0, players: w.players, entities: w.entities, memories: w.memories, round: w.round });
  return { w, view, me: w.players[0]! };
}

test('formatTime', () => {
  expect(formatTime(480)).toBe('8:00');
  expect(formatTime(59.2)).toBe('1:00');
  expect(formatTime(61)).toBe('1:01');
  expect(formatTime(9.5)).toBe('0:10');
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(-3)).toBe('0:00');
});

test('prompt: take a memory in reach', () => {
  const { w, view, me } = scene();
  me.pos = { x: 6, z: 7 };
  expect(promptFor(view(), w.map)).toBe('E — take Music box');
  me.pos = { x: 6, z: 8.5 };
  expect(promptFor(view(), w.map)).toBeNull();
});

test('prompt: bank at the Door while carrying', () => {
  const { w, view, me } = scene();
  me.pos = { x: 12, z: 13 };
  me.carrying = 0; w.memories[0]!.state = 'carried'; w.memories[0]!.carrier = 0;
  expect(promptFor(view(), w.map)).toBe('E — bank (+45)');
});

test('prompt: the Door, open and closed, with empty hands', () => {
  const { w, view, me } = scene();
  me.pos = { x: 12, z: 13 };
  w.round.banked = 90;
  expect(promptFor(view(), w.map)).toBe('Door is closed — 60 more needed');
  w.round.banked = 150; w.round.doorOpen = true;
  expect(promptFor(view(), w.map)).toBe('E — leave the dream');
});

test('prompt: hiding and coming out', () => {
  const { w, view, me } = scene(2);
  me.pos = { x: 2, z: 1.5 };
  expect(promptFor(view(), w.map)).toBe('E — hide');
  w.players[1]!.hiddenIn = 0; // someone is already in there
  expect(promptFor(view(), w.map)).toBeNull();
  w.players[1]!.hiddenIn = null;
  me.hiddenIn = 0;
  expect(promptFor(view(), w.map)).toBe('E — come out');
});

test('prompt: nothing for a caught player', () => {
  const { w, view, me } = scene();
  me.pos = { x: 6, z: 7 };
  me.status = 'caught';
  expect(promptFor(view(), w.map)).toBeNull();
});

test('nextSpectateTarget cycles through active players and returns null when none remain', () => {
  const { w, view } = scene(4);
  w.players[0]!.status = 'caught';
  expect(nextSpectateTarget(view(), 0)).toBe(1);
  expect(nextSpectateTarget(view(), 1)).toBe(2);
  expect(nextSpectateTarget(view(), 3)).toBe(1);
  w.players[2]!.status = 'left';
  expect(nextSpectateTarget(view(), 1)).toBe(3);
  for (const p of w.players) p.status = 'caught';
  expect(nextSpectateTarget(view(), 1)).toBeNull();
});
