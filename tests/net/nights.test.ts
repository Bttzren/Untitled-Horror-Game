import { expect, test } from 'vitest';
import { catchPlayer } from '../../src/rules/round';
import { DT } from '../../src/rules/world';
import { last, startedNight } from './helpers';

/** Makes the running night end the given way on the next step. */
function finish(host: ReturnType<typeof startedNight>['host'], how: 'success' | 'fail'): void {
  const w = host.world!;
  if (how === 'success') {
    w.round.banked = w.round.quota;
    w.players[0]!.status = 'left';
    for (const p of w.players.slice(1)) catchPlayer(w, p, 'usher');
  } else {
    for (const p of w.players) catchPlayer(w, p, 'usher');
  }
  host.tick(DT);
}

test('success sends end with nextNight 2; the next start has quota 250 and 10 rooms', () => {
  const { host, lb, peers } = startedNight(2);
  finish(host, 'success');
  lb.deliver();
  expect(last(peers[1]!, 'end')).toEqual({ t: 'end', result: 'success', banked: 150, quota: 150, nextNight: 2 });
  expect(host.state).toBe('lobby');
  expect(last(peers[1]!, 'lobby').night).toBe(2);
  peers[0]!.send({ t: 'startRequest' }); lb.deliver();
  expect(last(peers[1]!, 'start')).toMatchObject({ night: 2, quota: 250 });
  expect(host.world!.map.rooms).toHaveLength(10);
});

test('fail sends end with nextNight 1', () => {
  const { host, lb, peers } = startedNight(2);
  finish(host, 'success'); lb.deliver();
  peers[0]!.send({ t: 'startRequest' }); lb.deliver();
  finish(host, 'fail'); lb.deliver();
  expect(last(peers[0]!, 'end')).toMatchObject({ result: 'fail', nextNight: 1 });
  expect(host.night).toBe(1);
});

test('the final snapshot before end shows the result', () => {
  const { host, lb, peers } = startedNight(1);
  finish(host, 'fail'); lb.deliver();
  expect(last(peers[0]!, 'snapshot').snap.round.result).toBe('fail');
});

test('caught players are active again on the next night', () => {
  const { host, lb, peers } = startedNight(2);
  finish(host, 'success'); lb.deliver();
  peers[0]!.send({ t: 'startRequest' }); lb.deliver();
  expect(host.world!.players.map(p => p.status)).toEqual(['active', 'active']);
});

test('a player leaving the room as the last one inside ends the night for the rest', () => {
  const { host, lb, peers } = startedNight(2);
  const w = host.world!;
  w.round.banked = w.round.quota;
  w.players[0]!.status = 'left';
  peers[1]!.t.close(); lb.deliver();
  expect(last(peers[0]!, 'end')).toMatchObject({ result: 'success', nextNight: 2 });
  expect(host.state).toBe('lobby');
});
