// Regression tests for the findings of the final branch review.
import { expect, test } from 'vitest';
import { emitNoise } from '../src/rules/noise';
import { catchPlayer } from '../src/rules/round';
import { DT, removePlayer } from '../src/rules/world';
import { promptFor } from '../src/view/ui/hud';
import { hallMap, twoRoomsMap } from './fixtures/maps';
import { input, last, of, startedNight } from './net/helpers';
import { addEntity, seconds, step, worldWith } from './rules/helpers';

test('input lag from a burst drains away instead of lasting all night', () => {
  const { host, lb, peers } = startedNight(1);
  let seq = 0;
  for (let i = 0; i < 7; i++) peers[0]!.send({ t: 'input', cmd: input(++seq, { moveZ: 1 }) }); // one long frame
  for (let i = 0; i < 20; i++) {
    peers[0]!.send({ t: 'input', cmd: input(++seq) });
    lb.deliver();
    host.tick(DT);
  }
  lb.deliver();
  expect(seq - last(peers[0]!, 'snapshot').snap.ack[0]!).toBeLessThanOrEqual(2);
});

test('a one-shot action survives the queue catching up', () => {
  const { host, lb, peers } = startedNight(1);
  const lit = host.world!.players[0]!.flashlight;
  peers[0]!.send({ t: 'input', cmd: input(1, { flashlight: true }) });
  for (let s = 2; s <= 7; s++) peers[0]!.send({ t: 'input', cmd: input(s) });
  lb.deliver();
  for (let i = 0; i < 8; i++) host.tick(DT);
  expect(host.world!.players[0]!.flashlight).toBe(!lit);
});

test('a hiding spot cannot be used from the other side of a wall', () => {
  const w = worldWith(twoRoomsMap(), 1);
  w.map.hidingSpots.push({ id: 0, kind: 'locker', pos: { x: 6, z: 3.5 } }); // against the wall of the sealed room
  w.players[0]!.pos = { x: 6, z: 4.4 }; // inside the sealed room, 0.9 m away through the wall
  const view = { localId: 0, cameraId: 0, players: w.players, entities: w.entities, memories: w.memories, round: w.round };
  expect(promptFor(view, w.map)).toBeNull();
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.hiddenIn).toBeNull();
  expect(w.players[0]!.pos).toEqual({ x: 6, z: 4.4 });
});

test('a player who left through the Door and then disconnects still counts for the win', () => {
  const w = worldWith(hallMap(), 2);
  w.round.banked = w.round.quota;
  step(w);
  w.players[0]!.pos = { x: 12, z: 13 };
  step(w, { 0: { interact: true } });
  expect(w.players[0]!.status).toBe('left');
  removePlayer(w, 0); // closes the tab after getting out
  expect(w.round.result).toBeNull();
  catchPlayer(w, w.players[0]!, 'usher'); // the one still inside is caught
  step(w);
  expect(w.round.result).toBe('success');
});

test('the Listener still hears a ringing memory it has already visited once someone carries it', () => {
  const w = worldWith(hallMap(), 1, [{ kind: 'phone', value: 40, pos: { x: 12, z: 8 } }]);
  w.players[0]!.pos = { x: 23, z: 23 };
  const l = addEntity(w, 'listener', { x: 12, z: 4 });
  step(w, {}, seconds(8)); // goes to the phone, searches, loses interest
  expect(l.mode).toBe('wander');
  const phone = w.memories[0]!;
  phone.state = 'carried'; phone.carrier = 0; w.players[0]!.carrying = 0;
  w.players[0]!.pos = { x: l.pos.x, z: Math.min(23, l.pos.z + 6) };
  let hunted = false;
  for (let i = 0; i < seconds(2) && !hunted; i++) { step(w); hunted = l.mode === 'hunt'; }
  expect(hunted).toBe(true);
});

test('dropping a memory the Listener was ignoring is still heard', () => {
  const w = worldWith(hallMap(), 1, [{ kind: 'phone', value: 40, pos: { x: 12, z: 8 } }]);
  w.players[0]!.pos = { x: 23, z: 23 };
  const l = addEntity(w, 'listener', { x: 12, z: 4 });
  step(w, {}, seconds(8));
  w.memories[0]!.state = 'banked'; // stop it ringing; only the crash below should matter
  emitNoise(w, { x: l.pos.x, z: l.pos.z + 3 }, 14, { kind: 'memory', id: 0 });
  step(w);
  expect(l.mode).toBe('hunt');
});

test('snapshots stay small on deep nights, and never carry entity internals', () => {
  const { host, lb, peers } = startedNight(4);
  // Jump to night 20: the biggest dream there is.
  for (const p of host.world!.players) catchPlayer(host.world!, p, 'usher');
  host.tick(DT); lb.deliver();
  (host as unknown as { _night: number })._night = 20;
  peers[0]!.send({ t: 'startRequest' }); lb.deliver();
  expect(host.world!.map.rooms).toHaveLength(20);
  for (let i = 0; i < 4; i++) host.tick(DT);
  lb.deliver();
  const snaps = of(peers[1]!, 'snapshot').filter(m => m.snap.round.night === 20);
  expect(snaps.length).toBeGreaterThan(0);
  for (const m of snaps) {
    expect(JSON.stringify(m).length).toBeLessThan(8000); // PeerJS refuses messages near 16 KB
    for (const e of m.snap.entities) { expect(e.path).toEqual([]); expect(e.ignore).toEqual([]); }
  }
  expect(snaps[0]!.snap.memories).toEqual([]); // clients already build the opening memories from the seed
});
