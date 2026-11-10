import type { DreamMap } from '../dream/types';
import type { Vec2 } from '../shared/vec';

export type PlayerId = number; // 0..3

/** One simulation step of player input. */
export interface InputCmd {
  /** Increases by one per step; lets the host acknowledge inputs. */
  seq: number;
  /** -1..1. +X strafes right, +Z walks forward. */
  moveX: number;
  moveZ: number;
  /** Radians. Yaw 0 faces -Z; positive yaw turns left. */
  yaw: number;
  pitch: number;
  sprint: boolean;
  crouch: boolean;
  /** These four are true only on the step the key went down. */
  interact: boolean;
  drop: boolean;
  throwIt: boolean;
  flashlight: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  pos: Vec2;
  yaw: number;
  pitch: number;
  /** Seconds of sprint left, 0..CONFIG.staminaSeconds. */
  stamina: number;
  /** Ran out of stamina; cannot sprint again until some has refilled. */
  winded: boolean;
  crouching: boolean;
  sprinting: boolean;
  flashlight: boolean;
  /** Memory id being carried. */
  carrying: number | null;
  /** Hiding spot id the player is inside. */
  hiddenIn: number | null;
  /** Entity ids that saw this player hide, and so can still find them. */
  exposedTo: number[];
  status: 'active' | 'caught' | 'left';
  /** Seconds of movement since the last footstep noise. */
  stepTimer: number;
}

export interface MemoryState {
  id: number;
  kind: string;
  value: number;
  pos: Vec2;
  state: 'ground' | 'carried' | 'thrown' | 'banked';
  carrier: PlayerId | null;
  vel: Vec2;
  /** Seconds of flight left while thrown. */
  air: number;
  noiseTimer: number;
}

export type EntityTypeId = 'usher' | 'listener';

export interface EntityState {
  id: number;
  type: EntityTypeId;
  pos: Vec2;
  yaw: number;
  active: boolean;
  mode: 'idle' | 'chase' | 'wander' | 'hunt' | 'search';
  target: Vec2 | null;
  path: Vec2[];
  timer: number;
  ignore: { memoryId: number; until: number }[];
}

export type NoiseSource = { kind: 'player'; id: PlayerId } | { kind: 'memory'; id: number };
export interface NoiseEvent { pos: Vec2; radius: number; tick: number; source: NoiseSource }

export interface RoundState {
  night: number;
  quota: number;
  banked: number;
  /** Seconds until the dream collapses. */
  timeLeft: number;
  phase2: boolean;
  doorOpen: boolean;
  result: null | 'success' | 'fail';
}

export type GameEvent =
  | { type: 'caught'; player: PlayerId; by: EntityTypeId | 'collapse' }
  | { type: 'banked'; player: PlayerId; value: number }
  | { type: 'left'; player: PlayerId }
  | { type: 'noise'; pos: Vec2; radius: number }
  | { type: 'phase2' }
  | { type: 'doorOpen' };

export interface World {
  tick: number;
  map: DreamMap;
  players: PlayerState[];
  memories: MemoryState[];
  entities: EntityState[];
  /** Noise from the last CONFIG.noiseMemorySeconds. */
  noises: NoiseEvent[];
  round: RoundState;
  /** Things that happened during the latest step. */
  events: GameEvent[];
}

/** What one player's screen needs in order to draw a frame. */
export interface ViewState {
  localId: PlayerId;
  /** Whose eyes the camera uses: the local player, or the one they spectate. */
  cameraId: PlayerId;
  players: PlayerState[];
  entities: EntityState[];
  memories: MemoryState[];
  round: RoundState;
}
