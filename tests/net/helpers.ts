import { GameHost } from '../../src/net/host';
import { createLoopback } from '../../src/net/loopbackTransport';
import type { ClientMsg, HostMsg } from '../../src/net/protocol';
import type { ClientTransport } from '../../src/net/transport';
import type { InputCmd } from '../../src/rules/types';

export interface TestPeer { t: ClientTransport; msgs: HostMsg[]; closed: boolean; send(m: ClientMsg): void; raw(m: unknown): void }
export type Loop = ReturnType<typeof createLoopback>;

export function setup(seed = 5): { host: GameHost; lb: Loop } {
  const lb = createLoopback();
  const host = new GameHost({ pickSeed: () => seed });
  host.attach(lb.host);
  return { host, lb };
}

export function join(lb: Loop, name: string): TestPeer {
  const t = lb.connect();
  const peer: TestPeer = {
    t, msgs: [], closed: false,
    send: m => t.send(m),
    raw: m => t.send(m as ClientMsg),
  };
  t.onMessage(m => peer.msgs.push(m));
  t.onClose(() => { peer.closed = true; });
  t.send({ t: 'hello', name });
  lb.deliver();
  return peer;
}

export const of = <K extends HostMsg['t']>(p: TestPeer, kind: K): Extract<HostMsg, { t: K }>[] =>
  p.msgs.filter((m): m is Extract<HostMsg, { t: K }> => m.t === kind);

export const last = <K extends HostMsg['t']>(p: TestPeer, kind: K): Extract<HostMsg, { t: K }> => {
  const all = of(p, kind);
  if (all.length === 0) throw new Error(`no ${kind} message received`);
  return all[all.length - 1]!;
};

export const input = (seq: number, over: Partial<InputCmd> = {}): InputCmd => ({
  seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, sprint: false, crouch: false,
  interact: false, drop: false, throwIt: false, flashlight: false, ...over,
});

/** Joins `count` players and starts night 1. */
export function startedNight(count: number, seed = 5): { host: GameHost; lb: Loop; peers: TestPeer[] } {
  const { host, lb } = setup(seed);
  const peers = Array.from({ length: count }, (_, i) => join(lb, `p${i}`));
  peers[0]!.send({ t: 'startRequest' });
  lb.deliver();
  return { host, lb, peers };
}
