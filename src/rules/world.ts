import type { DreamMap } from '../dream/types';
import { CONFIG, quotaFor } from './config';
import { ENTITY_DEFS, spawnEntities, stepEntities } from './entities';
import { carriedWeight, dropCarried, handleInteract, stepMemories, throwCarried } from './items';
import { emitNoise, pruneNoise } from './noise';
import { movePlayer } from './player';
import { evaluateEnd, stepRound } from './round';
import type { InputCmd, PlayerId, World } from './types';

/** Length of one simulation step, in seconds. */
export const DT = 1 / CONFIG.tickRate;

export function createWorld(map: DreamMap, players: { id: PlayerId; name: string }[], night: number): World {
  const world: World = {
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
        status: 'active', stepTimer: 0, leaveArmedUntil: 0,
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
      phase2: false, doorOpen: false, someoneLeft: false, result: null,
    },
    events: [],
  };
  spawnEntities(world);
  return world;
}

/** Timers fire this much early so that rounding never skips a beat. */
const EPS = 1e-6;

/** Advances the whole world by one step. Players without an input this step stand still. */
export function stepWorld(world: World, inputs: ReadonlyMap<PlayerId, InputCmd>, dt: number): void {
  if (world.round.result) return; // the night is over; nothing changes any more
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
  // Walking away from the Door, or waiting too long, cancels a half-made decision to leave.
  for (const p of players) {
    if (p.leaveArmedUntil === 0) continue;
    const away = Math.hypot(p.pos.x - world.map.door.x, p.pos.z - world.map.door.z) > CONFIG.reach.door;
    if (away || world.tick > p.leaveArmedUntil) p.leaveArmedUntil = 0;
  }

  // 2. Actions, lowest player id first, so two players reaching for one thing resolve the same way every time.
  for (const p of players) {
    const cmd = inputs.get(p.id);
    if (!cmd || p.status !== 'active') continue;
    if (cmd.interact) handleInteract(world, p, (e, who) => ENTITY_DEFS[e.type].noticesHiding(e, world, who));
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

  // 5. Entities.
  stepEntities(world, dt);

  // 6. The night itself.
  stepRound(world, dt);
}

export function removePlayer(world: World, id: PlayerId): void {
  const p = world.players.find(x => x.id === id);
  if (!p) return;
  dropCarried(world, p, true);
  world.players = world.players.filter(x => x.id !== id);
  // Their leaving may mean nobody is still inside.
  evaluateEnd(world);
}
