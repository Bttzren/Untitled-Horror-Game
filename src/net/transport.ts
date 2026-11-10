import type { ClientMsg, HostMsg } from './protocol';

export type PeerId = string;

/** The host's end: many peers. Incoming messages are untrusted and arrive as `unknown`. */
export interface HostTransport {
  onConnect(cb: (peer: PeerId) => void): void;
  onMessage(cb: (peer: PeerId, msg: unknown) => void): void;
  onDisconnect(cb: (peer: PeerId) => void): void;
  send(peer: PeerId, msg: HostMsg): void;
  close(): void;
}

/** A player's end: one connection to the host. */
export interface ClientTransport {
  onMessage(cb: (msg: HostMsg) => void): void;
  onClose(cb: () => void): void;
  send(msg: ClientMsg): void;
  close(): void;
}
