import type { ClientMsg, HostMsg } from './protocol';
import type { ClientTransport, HostTransport, PeerId } from './transport';

/** Copies a message the way a real connection would: through JSON. */
function overWire(msg: unknown): unknown {
  const text = JSON.stringify(msg);
  return text === undefined ? undefined : JSON.parse(text);
}

/**
 * An in-memory connection between a host and any number of clients in the same
 * page. Used for solo play, for the host's own player, and for tests.
 * With `auto`, messages are delivered on a microtask; otherwise they wait for deliver().
 */
export function createLoopback(opts: { auto?: boolean } = {}): { host: HostTransport; connect(): ClientTransport; deliver(): void } {
  const queue: (() => void)[] = [];
  let scheduled = false;
  let hostClosed = false;
  let nextId = 0;
  const hostCb = {
    connect: [] as ((p: PeerId) => void)[],
    message: [] as ((p: PeerId, m: unknown) => void)[],
    disconnect: [] as ((p: PeerId) => void)[],
  };
  const clients = new Map<PeerId, { message: ((m: HostMsg) => void)[]; close: (() => void)[]; open: boolean }>();

  const deliver = (): void => {
    scheduled = false;
    // Messages sent while delivering are delivered in the same pass.
    for (let i = 0; i < queue.length; i++) queue[i]!();
    queue.length = 0;
  };
  const enqueue = (job: () => void): void => {
    queue.push(job);
    if (opts.auto && !scheduled) { scheduled = true; queueMicrotask(deliver); }
  };

  const host: HostTransport = {
    onConnect: cb => { hostCb.connect.push(cb); },
    onMessage: cb => { hostCb.message.push(cb); },
    onDisconnect: cb => { hostCb.disconnect.push(cb); },
    send(peer, msg) {
      const copy = overWire(msg) as HostMsg;
      enqueue(() => {
        const c = clients.get(peer);
        if (c?.open) for (const cb of c.message) cb(copy);
      });
    },
    close() {
      if (hostClosed) return;
      hostClosed = true;
      enqueue(() => {
        for (const c of clients.values()) {
          if (!c.open) continue;
          c.open = false;
          for (const cb of c.close) cb();
        }
      });
    },
  };

  const connect = (): ClientTransport => {
    const id: PeerId = `local-${nextId++}`;
    const me = { message: [] as ((m: HostMsg) => void)[], close: [] as (() => void)[], open: true };
    clients.set(id, me);
    enqueue(() => { if (!hostClosed) for (const cb of hostCb.connect) cb(id); });
    return {
      onMessage: cb => { me.message.push(cb); },
      onClose: cb => { me.close.push(cb); },
      send(msg: ClientMsg) {
        if (!me.open) return;
        const copy = overWire(msg);
        enqueue(() => { if (!hostClosed) for (const cb of hostCb.message) cb(id, copy); });
      },
      close() {
        if (!me.open) return;
        me.open = false;
        enqueue(() => { if (!hostClosed) for (const cb of hostCb.disconnect) cb(id); });
      },
    };
  };

  return { host, connect, deliver };
}
