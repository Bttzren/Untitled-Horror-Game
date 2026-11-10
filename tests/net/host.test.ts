import { expect, test } from 'vitest';
import { cleanName } from '../../src/net/protocol';
import { DT } from '../../src/rules/world';
import { input, join, last, of, setup, startedNight } from './helpers';

test('hello gets welcome with the lowest free id, and everyone gets lobby', () => {
  const { lb } = setup();
  const a = join(lb, 'Ann'), b = join(lb, 'Bo');
  expect(last(a, 'welcome')).toMatchObject({ id: 0, night: 1 });
  expect(last(b, 'welcome')).toMatchObject({ id: 1, players: [{ id: 0, name: 'Ann' }, { id: 1, name: 'Bo' }] });
  expect(last(a, 'lobby').players).toEqual([{ id: 0, name: 'Ann' }, { id: 1, name: 'Bo' }]);
  b.t.close(); lb.deliver();
  const c = join(lb, 'Cy');
  expect(last(c, 'welcome').id).toBe(1);
});

test('a fifth player is refused as full', () => {
  const { lb } = setup();
  const four = ['a', 'b', 'c', 'd'].map(n => join(lb, n));
  const fifth = join(lb, 'e');
  expect(fifth.msgs).toEqual([{ t: 'refused', reason: 'full' }]);
  expect(last(four[0]!, 'lobby').players).toHaveLength(4);
});

test('names are cleaned', () => {
  expect(cleanName('  ' + 'x'.repeat(500))).toHaveLength(16);
  expect(cleanName('  Mo  ')).toBe('Mo');
  expect(cleanName('')).toBe('Dreamer');
  expect(cleanName('   ')).toBe('Dreamer');
  expect(cleanName(42)).toBe('Dreamer');
  const { lb } = setup();
  expect(last(join(lb, 'y'.repeat(99)), 'welcome').players[0]!.name).toHaveLength(16);
});

test('only player 0 can start; start carries seed, night 1 and quota 150', () => {
  const { host, lb } = setup(77);
  const a = join(lb, 'a'), b = join(lb, 'b');
  b.send({ t: 'startRequest' }); lb.deliver();
  expect(host.state).toBe('lobby');
  expect(of(a, 'start')).toHaveLength(0);
  a.send({ t: 'startRequest' }); lb.deliver();
  expect(host.state).toBe('night');
  for (const p of [a, b]) expect(last(p, 'start')).toEqual({ t: 'start', seed: 77, night: 1, quota: 150 });
  expect(host.world!.players.map(p => p.id)).toEqual([0, 1]);
});

test('joining during a night is refused as in-progress', () => {
  const { lb } = startedNight(1);
  expect(join(lb, 'late').msgs).toEqual([{ t: 'refused', reason: 'in-progress' }]);
});

test('inputs move the player and snapshots arrive every 2 steps with acks', () => {
  const { host, lb, peers } = startedNight(2);
  const start = { ...host.world!.players[1]!.pos };
  for (let i = 1; i <= 30; i++) {
    peers[1]!.send({ t: 'input', cmd: input(i, { moveZ: 1 }) });
    lb.deliver();
    host.tick(DT);
  }
  lb.deliver();
  const snaps = of(peers[0]!, 'snapshot');
  expect(snaps).toHaveLength(15);
  const snap = snaps.at(-1)!.snap;
  expect(snap.tick).toBe(30);
  expect(snap.ack[1]).toBe(30);
  expect(start.z - snap.players.find(p => p.id === 1)!.pos.z).toBeCloseTo(3, 1);
  expect(snap.players.find(p => p.id === 0)!.pos).toEqual(host.world!.players[0]!.pos);
});

test('an input keeps applying until replaced, but one-shot actions apply once', () => {
  const { host, lb, peers } = startedNight(1);
  const lit = host.world!.players[0]!.flashlight;
  peers[0]!.send({ t: 'input', cmd: input(1, { moveZ: 1, flashlight: true }) });
  lb.deliver();
  const z = host.world!.players[0]!.pos.z;
  for (let i = 0; i < 5; i++) host.tick(DT);
  expect(z - host.world!.players[0]!.pos.z).toBeCloseTo(0.5, 2);
  expect(host.world!.players[0]!.flashlight).toBe(!lit);
});

test('a one-shot action is not lost when two inputs arrive between steps', () => {
  const { host, lb, peers } = startedNight(1);
  const lit = host.world!.players[0]!.flashlight;
  peers[0]!.send({ t: 'input', cmd: input(1, { flashlight: true }) });
  peers[0]!.send({ t: 'input', cmd: input(2) });
  lb.deliver();
  host.tick(DT);
  expect(host.world!.players[0]!.flashlight).toBe(!lit);
});

test('junk never throws and is ignored', () => {
  const { host, lb, peers } = startedNight(1);
  const stranger = lb.connect();
  stranger.send({ t: 'input', cmd: input(1, { moveZ: 1 }) }); // input before hello
  const before = JSON.stringify(host.world!.players);
  const junk: unknown[] = [undefined, null, 'x', 7, [], {}, { t: 'nope' }, { t: 'input' }, { t: 'input', cmd: null },
    { t: 'input', cmd: { ...input(1), moveX: NaN } }, { t: 'input', cmd: { seq: 'a' } }, { t: 'hello' }, { t: 'startRequest', extra: 1 }];
  for (const j of junk) peers[0]!.raw(j);
  expect(() => { lb.deliver(); host.tick(DT); }).not.toThrow();
  expect(JSON.stringify(host.world!.players)).toBe(before);
  expect(host.world!.tick).toBe(1);
});

test('a long stall advances at most 10 steps', () => {
  const { host } = startedNight(1);
  const t0 = host.world!.tick;
  host.tick(5);
  expect(host.world!.tick - t0).toBe(10);
  host.tick(DT);
  expect(host.world!.tick - t0).toBe(11); // the backlog was dropped, not replayed
});

test('fractions of a step carry over', () => {
  const { host } = startedNight(1);
  host.tick(DT * 0.6); expect(host.world!.tick).toBe(0);
  host.tick(DT * 0.6); expect(host.world!.tick).toBe(1);
});

test('a client that disconnects in the lobby leaves the player list', () => {
  const { lb } = setup();
  const a = join(lb, 'a'), b = join(lb, 'b');
  b.t.close(); lb.deliver();
  expect(last(a, 'lobby').players).toEqual([{ id: 0, name: 'a' }]);
});

test('a client that disconnects mid-night is removed from the world and the night continues', () => {
  const { host, lb, peers } = startedNight(2);
  peers[1]!.t.close(); lb.deliver();
  expect(host.state).toBe('night');
  expect(host.world!.players.map(p => p.id)).toEqual([0]);
  expect(last(peers[0]!, 'lobby').players).toEqual([{ id: 0, name: 'p0' }]);
  expect(() => host.tick(DT)).not.toThrow();
});

test('when the last player disconnects mid-night the host returns to the lobby at night 1', () => {
  const { host, lb, peers } = startedNight(1);
  peers[0]!.t.close(); lb.deliver();
  expect(host.state).toBe('lobby');
  expect(host.night).toBe(1);
  expect(host.world).toBeNull();
});

test('the first snapshot of a night carries every memory; later ones only changed memories', () => {
  const { host, lb, peers } = startedNight(1);
  host.tick(DT); host.tick(DT); lb.deliver();
  const first = last(peers[0]!, 'snapshot').snap;
  expect(first.memories).toHaveLength(host.world!.memories.length);
  expect(first.memories.length).toBeGreaterThan(0);
  host.tick(DT); host.tick(DT); lb.deliver();
  expect(last(peers[0]!, 'snapshot').snap.memories).toHaveLength(0);
  host.world!.memories[0]!.pos.x += 1;
  host.tick(DT); host.tick(DT); lb.deliver();
  expect(last(peers[0]!, 'snapshot').snap.memories.map(m => m.id)).toEqual([host.world!.memories[0]!.id]);
});

test('closing the host closes its clients', () => {
  const { host, lb } = setup();
  const a = join(lb, 'a');
  host.close(); lb.deliver();
  expect(a.closed).toBe(true);
});
