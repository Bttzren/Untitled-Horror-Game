import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import type { ClientMsg, HostMsg } from './protocol';
import { PEER_PREFIX } from './roomCode';
import type { ClientTransport, HostTransport, PeerId } from './transport';

export type JoinFailure = 'no-room' | 'blocked' | 'signalling';

export class JoinError extends Error {
  constructor(public readonly reason: JoinFailure) {
    super(`could not connect: ${reason}`);
  }
}

/** Where to find the matchmaking (signalling) server. Omit for the public PeerJS one. */
export interface SignalOptions { host?: string; port?: number; path?: string; secure?: boolean }

const CONNECT_TIMEOUT_MS = 15_000;
/** PeerJS error types that mean the matchmaking server could not be used. */
const SIGNALLING_ERRORS = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'unavailable-id', 'ssl-unavailable']);

function options(signal?: SignalOptions): PeerOptions {
  return signal?.host ? { host: signal.host, port: signal.port, path: signal.path ?? '/', secure: signal.secure ?? false } : {};
}

/** Opens a room that friends can join with `code`. Rejects with JoinError('signalling'). */
export function hostPeer(code: string, signal?: SignalOptions): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_PREFIX + code, options(signal));
    const conns = new Map<PeerId, DataConnection>();
    const cb = {
      connect: [] as ((p: PeerId) => void)[],
      message: [] as ((p: PeerId, m: unknown) => void)[],
      disconnect: [] as ((p: PeerId) => void)[],
    };
    let opened = false, closed = false;
    const fail = (): void => {
      if (opened) return;
      peer.destroy();
      reject(new JoinError('signalling'));
    };
    const timer = setTimeout(fail, CONNECT_TIMEOUT_MS);

    peer.on('open', () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        onConnect: f => { cb.connect.push(f); },
        onMessage: f => { cb.message.push(f); },
        onDisconnect: f => { cb.disconnect.push(f); },
        send: (id, msg: HostMsg) => { const c = conns.get(id); if (c?.open) void c.send(msg); },
        close: () => { closed = true; peer.destroy(); },
      });
    });
    peer.on('error', () => { clearTimeout(timer); fail(); });
    // If the matchmaking link drops mid-session, friends already connected are unaffected; reconnect so new ones can join.
    peer.on('disconnected', () => { if (opened && !closed && !peer.destroyed) peer.reconnect(); });
    peer.on('connection', conn => {
      const id: PeerId = conn.connectionId;
      conn.on('open', () => { conns.set(id, conn); for (const f of cb.connect) f(id); });
      conn.on('data', data => { for (const f of cb.message) f(id, data); });
      const gone = (): void => { if (conns.delete(id)) for (const f of cb.disconnect) f(id); };
      conn.on('close', gone);
      conn.on('error', gone);
    });
  });
}

/** Joins the room with `code`. Rejects with a JoinError saying why it could not. */
export function joinPeer(code: string, signal?: SignalOptions): Promise<ClientTransport> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(options(signal));
    let settled = false, reachedServer = false;
    const fail = (reason: JoinFailure): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(new JoinError(reason));
    };
    // Reached the server but never got a direct link: the network is in the way.
    const timer = setTimeout(() => fail(reachedServer ? 'blocked' : 'signalling'), CONNECT_TIMEOUT_MS);

    peer.on('error', err => {
      if (err.type === 'peer-unavailable') fail('no-room');
      else if (SIGNALLING_ERRORS.has(err.type)) fail('signalling');
      else fail('blocked');
    });
    peer.on('open', () => {
      reachedServer = true;
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      const cb = { message: [] as ((m: HostMsg) => void)[], close: [] as (() => void)[] };
      let open = false;
      const closed = (): void => {
        if (!open) return;
        open = false;
        for (const f of cb.close) f();
        peer.destroy();
      };
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        open = true;
        clearTimeout(timer);
        resolve({
          onMessage: f => { cb.message.push(f); },
          onClose: f => { cb.close.push(f); },
          send: (msg: ClientMsg) => { if (open) void conn.send(msg); },
          close: () => { open = false; conn.close(); peer.destroy(); },
        });
      });
      conn.on('data', data => { for (const f of cb.message) f(data as HostMsg); });
      conn.on('close', closed);
      conn.on('error', closed);
    });
  });
}
