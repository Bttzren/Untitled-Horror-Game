import type { DreamMap } from '../dream/types';
import { CONFIG, quotaFor } from './config';
import { carriedWeight, dropCarried, handleInteract, stepMemories, throwCarried } from './items';
import { emitNoise, pruneNoise } from './noise';
import { movePlayer } from './player';
import type { InputCmd, PlayerId, World } from './types';

/** Length of one simulation step, in seconds. */
export const DT = 1 / CONFIG.tickRate;

export function createWorld(map: DreamMap, players: { id: PlayerId; name: string }[], night: number): World {
  return {
    tick: 0,
    map,
    players: players.map(({ id, name }) => {
      const spawn = map.spawns[id % map.spawns.length]!;
      return {
        id, name,
        pos: { x: spawn.x, z: spawn.z },
        yaw: 0, pitch: 0,
        stamina: CONFIG.staminaSeconds, winded: false,
        crouching: false, sprinting: false, flashlight: true,
        carrying: null, hiddenIn: null, exposedTo: [],
        status: 'active', stepTimer: 0,
      };
    }),
    memories: map.memories.map(m => ({
      id: m.id, kind: m.kind, value: m.value, pos: { x: m.pos.x, z: m.pos.z },
      state: 'ground', carrier: null, vel: { x: 0, z: 0 }, air: 0, noiseTimer: 0,
    })),
    entities: [],
    noises: [],
    round: {
      night, quota: quotaFor(night), banked: 0, timeLeft: CONFIG.nightSeconds,
      phase2: false, doorOpen: false, result: null,
    },
    events: [],
  };
}

/** Timers fire this much early so that rounding never skips a beat. */
const EPS = 1e-6;

/** Advances the whole world by one step. Players without an input this step stand still. */
export function stepWorld(world: World, inputs: ReadonlyMap<PlayerId, InputCmd>, dt: number): void {
  world.tick++;
  world.events = [];
  const players = [...world.players].sort((a, b) => a.id - b.id);

  // 1. Movement.
  const before = new Map(players.map(p => [p.id, { x: p.pos.x, z: p.pos.z }]));
  for (const p of players) {
    const cmd = inputs.get(p.id);
    if (!cmd) continue;
    movePlayer(p, cmd, world.map, carriedWeight(world, p), dt);
    if (cmd.flashlight && p.status === 'active') p.flashlight = !p.flashlight;
  }

  // 2. Actions, lowest player id first, so two players reaching for one thing resolve the same way every time.
  for (const p of players) {
    const cmd = inputs.get(p.id);
    if (!cmd || p.status !== 'active') continue;
    if (cmd.interact) handleInteract(world, p);
    if (cmd.throwIt && p.carrying !== null) throwCarried(world, p);
    else if (cmd.drop && p.carrying !== null) dropCarried(world, p, false);
  }

  // 3. Memories.
  stepMemories(world, dt);

  // 4. Footsteps.
  for (const p of players) {
    const was = before.get(p.id)!;
    const movedNow = Math.hypot(p.pos.x - was.x, p.pos.z - was.z) > 1e-4;
    if (!movedNow || p.status !== 'active' || p.hiddenIn !== null) continue;
    p.stepTimer += dt;
    if (p.stepTimer >= CONFIG.footstepInterval - EPS) {
      p.stepTimer = 0;
      const radius = p.crouching ? CONFIG.noise.crouch : p.sprinting ? CONFIG.noise.sprint : CONFIG.noise.walk;
      emitNoise(world, p.pos, radius, { kind: 'player', id: p.id });
    }
  }
  pruneNoise(world);
}

export function removePlayer(world: World, id: PlayerId): void {
  const p = world.players.find(x => x.id === id);
  if (!p) return;
  dropCarried(world, p, true);
  world.players = world.players.filter(x => x.id !== id);
}
