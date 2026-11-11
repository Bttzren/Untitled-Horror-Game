// Every tunable gameplay number lives here. This file imports nothing.

export const CONFIG = {
  tickRate: 30,
  snapshotEvery: 2,
  interpDelayMs: 100,
  maxPlayers: 4,
  maxStepsPerTick: 10,

  nightSeconds: 480,
  phase2At: 240,

  quotaBase: 150,
  quotaStep: 100,
  valueFactor: 1.6,
  /** Share of placed memories in each weight class. */
  memoryMix: { light: 0.5, medium: 0.35, heavy: 0.15 },

  roomsBase: 8,
  roomsStep: 2,
  roomsMax: 20,
  gridSize: 24,
  cell: 4,
  loopChance: 0.25,

  walk: 3.0,
  sprint: 5.5,
  crouch: 1.5,
  staminaSeconds: 5,
  staminaRefillSeconds: 10,
  carry: { light: 1.0, medium: 0.85, heavy: 0.65 },
  playerRadius: 0.35,
  eyeHeight: 1.6,
  crouchEyeHeight: 1.0,

  reach: { memory: 2.0, door: 2.5, hide: 1.5 },
  throwSpeed: 10,
  throwSeconds: 0.8,

  noise: { crouch: 1, walk: 4, sprint: 12, noisyMemory: 10, drop: 8, dropHeavy: 14, thrown: 14 },
  noiseMemorySeconds: 1,
  footstepInterval: 0.5,

  /** startDelay: seconds it must go unwatched before it moves, so a quick glance away is survivable. */
  usher: { speed: 6, catchRange: 1.0, viewHalfAngleDeg: 50, viewRange: 30, startDelay: 0.4 },
  listener: { wander: 2, hunt: 4.5, catchRange: 1.2, searchSeconds: 5, ignoreSeconds: 20 },
  /** Seconds within which a second press of E at the open Door leaves the dream. */
  leaveConfirmSeconds: 3,
  /** Seconds at the start of a night before any entity acts: time to get your bearings. */
  entityStartDelay: 25,
  /** Seconds an entity woken at phase 2 stands visible before it acts. */
  wakeGraceSeconds: 3,
  entityMinRoomsFromDoor: 3,
  bothEntitiesFromNight: 3,
} as const;

export type WeightClass = 'light' | 'medium' | 'heavy';

export interface MemoryKind {
  id: string;
  name: string;
  weight: WeightClass;
  min: number;
  max: number;
  /** Emits noise continuously until banked. */
  noisy: boolean;
}

export const MEMORY_KINDS: readonly MemoryKind[] = [
  { id: 'drawing', name: "Child's drawing", weight: 'light', min: 10, max: 25, noisy: false },
  { id: 'photograph', name: 'Photograph', weight: 'light', min: 10, max: 25, noisy: false },
  { id: 'toyCar', name: 'Toy car', weight: 'light', min: 10, max: 25, noisy: false },
  { id: 'teacup', name: 'Teacup', weight: 'light', min: 10, max: 25, noisy: false },
  { id: 'musicBox', name: 'Music box', weight: 'medium', min: 30, max: 60, noisy: true },
  { id: 'phone', name: 'Rotary phone', weight: 'medium', min: 30, max: 60, noisy: true },
  { id: 'lantern', name: 'Lantern', weight: 'medium', min: 30, max: 60, noisy: false },
  { id: 'boomBox', name: 'Boom box', weight: 'medium', min: 30, max: 60, noisy: true },
  { id: 'clockFace', name: 'Grandfather clock face', weight: 'heavy', min: 70, max: 120, noisy: false },
  { id: 'television', name: 'Television', weight: 'heavy', min: 70, max: 120, noisy: false },
];

export function quotaFor(night: number): number {
  return CONFIG.quotaBase + CONFIG.quotaStep * (Math.max(1, night) - 1);
}

export function roomsFor(night: number): number {
  return Math.min(CONFIG.roomsMax, CONFIG.roomsBase + CONFIG.roomsStep * (Math.max(1, night) - 1));
}
