import type { EntityState, GameEvent, InputCmd, MemoryState, PlayerId, PlayerState, RoundState } from '../rules/types';

export interface LobbyPlayer { id: PlayerId; name: string }

/** The state of the night as the host sees it, sent 15 times a second. */
export interface Snapshot {
  tick: number;
  /** Per player id: the sequence number of the last input the host has applied. */
  ack: Record<number, number>;
  players: PlayerState[];
  entities: EntityState[];
  /** Only memories that changed since the previous snapshot; all of them in a night's first. */
  memories: MemoryState[];
  round: RoundState;
}

export type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'startRequest' }
  | { t: 'input'; cmd: InputCmd };

export type HostMsg =
  | { t: 'welcome'; id: PlayerId; players: LobbyPlayer[]; night: number }
  | { t: 'refused'; reason: 'full' | 'in-progress' }
  | { t: 'lobby'; players: LobbyPlayer[]; night: number }
  | { t: 'start'; seed: number; night: number; quota: number }
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'event'; ev: GameEvent }
  | { t: 'end'; result: 'success' | 'fail'; banked: number; quota: number; nextNight: number };

const MAX_NAME = 16;

/** A display name safe to show: trimmed, at most 16 characters, never empty. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Dreamer';
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  return name.length > 0 ? name : 'Dreamer';
}
