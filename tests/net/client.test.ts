import { expect, test } from 'vitest';
import { generateDream } from '../../src/dream/generator';
import { GameClient } from '../../src/net/client';
import type { ClientMsg, HostMsg, Snapshot } from '../../src/net/protocol';
import type { ClientTransport } from '../../src/net/transport';
import { DT, createWorld } from '../../src/rules/world';
import { dist } from '../../src/shared/vec';
import { setup } from './helpers';

const SEED = 5;
const fwd = { moveX: 0, moveZ: 1, yaw: 0, pitch: 0, sprint: false, crouch: false, interact: false, drop: false, throwIt: false, flashlight: false };

/** A hand-driven connection: the test plays the host. */
function fake(): { t: ClientTransport; sent: ClientMsg[]; push(m: HostMsg): void; drop(): void } {
  let onMsg: (m: HostMsg) => void = () => {};
  let onClose: () => void = () => {};
  const sent: ClientMsg[] = [];
  return {
    sent,
    t: { onMessage: cb => { onMsg = cb; }, onClose: cb => { onClose = cb; }, send: m => { sent.push(m); }, close: () => {} },
    push: m => onMsg(JSON.parse(JSON.stringify(m)) as HostMsg),
    drop: () => onClose(),
  };
}

/** A client that has joined as player `id` of two and seen the night start. */
function inNight(id = 0): { f: ReturnType<typeof fake>; c: GameClient; clock: { now: number }; snap(tick: number, edit?: (s: Snapshot) => void): Snapshot } {
  const f = fake(), clock = { now: 0 };
  const c = new GameClient(f.t, 'me', () => clock.now);
  const players = [{ id: 0, name: 'a' }, { id: 1, name: 'b' }];
  f.push({ t: 'welcome', id, players, night: 1 });
  f.push({ t: 'start', seed: SEED, night: 1, quota: 150 });
  const base = createWorld(generateDream(SEED, 1), players, 1);
  const snap = (tick: number, edit?: (s: Snapshot) => void): Snapshot => {
    const s: Snapshot = JSON.parse(JSON.stringify({ tick, ack: {}, players: base.players, entities: [], memories: [], round: base.round }));
    edit?.(s);
    return s;
  };
  return { f, c, clock, snap };
}

test('says hello with its name on connecting', () => {
  const f = fake();
  const c = new GameClient(f.t, 'Ann', () => 0);
  expect(f.sent).toEqual([{ t: 'hello', name: 'Ann' }]);
  expect(c.status).toBe('connecting');
});

test('welcome moves it to the lobby and start to the night', () => {
  const f = fake();
  const c = new GameClient(f.t, 'Ann', () => 0);
  let changes = 0; c.onChange = () => { changes++; };
  f.push({ t: 'welcome', id: 1, players: [{ id: 0, name: 'x' }, { id: 1, name: 'Ann' }], night: 3 });
  expect([c.status, c.playerId, c.night, c.lobby.length]).toEqual(['lobby', 1, 3, 2]);
  expect(c.view(0)).toBeNull();
  f.push({ t: 'start', seed: SEED, night: 3, quota: 350 });
  expect(c.status).toBe('night');
  expect(c.map).toEqual(generateDream(SEED, 3));
  expect(c.view(0)!.players).toHaveLength(2);
  expect(changes).toBe(2);
});

test('the local player moves immediately, before any snapshot returns', () => {
  const { f, c } = inNight();
  const start = { ...c.view(0)!.players[0]!.pos };
  for (let i = 0; i < 30; i++) c.sendInput(fwd);
  const now = c.view(0)!.players[0]!.pos;
  expect(start.z - now.z).toBeCloseTo(3, 1);
  const inputs = f.sent.filter(m => m.t === 'input');
  expect(inputs.map(m => m.t === 'input' && m.cmd.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
});

test('a snapshot replays only the inputs the host has not yet applied', () => {
  const { f, c, snap } = inNight();
  for (let i = 0; i < 10; i++) c.sendInput(fwd);
  f.push({ t: 'snapshot', snap: snap(8, s => { s.ack[0] = 8; s.players[0]!.pos = { x: 50, z: 50 }; }) });
  const p = c.view(0)!.players[0]!.pos;
  expect(p.x).toBeCloseTo(50, 5);
  expect(50 - p.z).toBeCloseTo(2 * 3 * DT, 5); // two unacknowledged steps forward
});

test('a host correction snaps the prediction', () => {
  const { f, c, snap } = inNight();
  for (let i = 0; i < 10; i++) c.sendInput(fwd);
  f.push({ t: 'snapshot', snap: snap(10, s => { s.ack[0] = 10; s.players[0]!.pos = { x: 44, z: 46 }; }) });
  expect(c.view(0)!.players[0]!.pos).toEqual({ x: 44, z: 46 });
});

test('prediction matches the host through latency, with no rubber-banding', () => {
  const { host, lb } = setup(SEED);
  const clock = { now: 0 };
  const c = new GameClient(lb.connect(), 'me', () => clock.now);
  lb.deliver();
  c.requestStart();
  lb.deliver();
  expect(c.status).toBe('night');
  const start = { ...c.view(0)!.players[0]!.pos };
  const walked = (): number => start.z - c.view(clock.now)!.players[0]!.pos.z;
  for (let i = 1; i <= 30; i++) { // 3 m: the Door room wall is 3.65 m ahead
    c.sendInput(fwd);
    if (i > 5) { lb.deliver(); host.tick(DT); } // the host is five steps behind
    clock.now += DT * 1000;
    expect(walked()).toBeCloseTo(i * 3 * DT, 2);
  }
  c.sendInput({ ...fwd, moveZ: 0 }); // let go of the key
  for (let i = 0; i < 12; i++) { lb.deliver(); host.tick(DT); }
  lb.deliver();
  expect(dist(c.view(clock.now)!.players[0]!.pos, host.world!.players[0]!.pos)).toBeLessThan(0.01);
  expect(walked()).toBeCloseTo(3, 2);
});

test('other players are drawn 100 ms in the past, blended between snapshots', () => {
  const { f, c, clock, snap } = inNight(0);
  const base = snap(0).players[1]!.pos;
  clock.now = 0;
  f.push({ t: 'snapshot', snap: snap(2, s => { s.players[1]!.pos = { x: base.x, z: base.z }; s.players[1]!.yaw = 3.1; }) });
  clock.now = 66;
  f.push({ t: 'snapshot', snap: snap(4, s => { s.players[1]!.pos = { x: base.x + 1, z: base.z }; s.players[1]!.yaw = -3.1; }) });
  const other = (t: number) => c.view(t)!.players.find(p => p.id === 1)!;
  expect(other(116).pos.x - base.x).toBeCloseTo(16 / 66, 2);
  expect(other(133).pos.x - base.x).toBeCloseTo(0.5, 2);
  expect(Math.abs(other(133).yaw)).toBeGreaterThan(3.1); // turned the short way, through pi
  expect(other(1000).pos.x - base.x).toBeCloseTo(1, 5);
  expect(other(50).pos.x - base.x).toBeCloseTo(0, 5);
});

test('memories accumulate from partial snapshot lists', () => {
  const { f, c, snap } = inNight();
  const mem = (id: number, x: number) => ({ id, kind: 'drawing', value: 12, pos: { x, z: 1 }, state: 'ground' as const, carrier: null, vel: { x: 0, z: 0 }, air: 0, noiseTimer: 0 });
  f.push({ t: 'snapshot', snap: snap(2, s => { s.memories = [mem(0, 1), mem(1, 2)]; }) });
  f.push({ t: 'snapshot', snap: snap(4, s => { s.memories = [mem(1, 9)]; }) });
  const all = c.view(0)!.memories;
  expect(all.slice(0, 2).map(m => [m.id, m.pos.x])).toEqual([[0, 1], [1, 9]]);
  expect(all).toHaveLength(generateDream(SEED, 1).memories.length); // the rest keep their opening state
});

test('round state and events come through', () => {
  const { f, c, snap } = inNight();
  const seen: string[] = [];
  c.onEvent = ev => seen.push(ev.type);
  f.push({ t: 'event', ev: { type: 'phase2' } });
  f.push({ t: 'snapshot', snap: snap(2, s => { s.round.banked = 40; }) });
  expect(seen).toEqual(['phase2']);
  expect(c.view(0)!.round.banked).toBe(40);
});

test('end returns to the lobby and keeps the result', () => {
  const { f, c } = inNight();
  f.push({ t: 'end', result: 'success', banked: 160, quota: 150, nextNight: 2 });
  expect(c.status).toBe('lobby');
  expect(c.night).toBe(2);
  expect(c.lastEnd).toMatchObject({ result: 'success', banked: 160 });
  expect(c.view(0)).toBeNull();
});

test('refused and closed transports set status', () => {
  const a = fake(), ca = new GameClient(a.t, 'x', () => 0);
  a.push({ t: 'refused', reason: 'full' });
  expect([ca.status, ca.refusedReason]).toEqual(['refused', 'full']);
  const b = fake(), cb = new GameClient(b.t, 'x', () => 0);
  b.drop();
  expect(cb.status).toBe('closed');
});

test('inputs are not sent outside a night', () => {
  const f = fake(), c = new GameClient(f.t, 'x', () => 0);
  c.sendInput(fwd);
  expect(f.sent.filter(m => m.t === 'input')).toHaveLength(0);
});

test('both sides build the same map from start', () => {
  const { host, lb } = setup(SEED);
  const c = new GameClient(lb.connect(), 'me', () => 0);
  lb.deliver(); c.requestStart(); lb.deliver();
  expect(c.map).toEqual(host.world!.map);
});
