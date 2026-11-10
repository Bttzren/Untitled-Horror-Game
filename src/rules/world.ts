import type { DreamMap } from '../dream/types';
import { CONFIG, quotaFor } from './config';
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

/** Advances the whole world by one step. Players without an input this step stand still. */
export function stepWorld(world: World, inputs: ReadonlyMap<PlayerId, InputCmd>, dt: number): void {
  world.tick++;
  world.events = [];
  for (const p of world.players) {
    const cmd = inputs.get(p.id);
    if (!cmd) continue;
    movePlayer(p, cmd, world.map, null, dt);
    if (cmd.flashlight && p.status === 'active') p.flashlight = !p.flashlight;
  }
}

export function removePlayer(world: World, id: PlayerId): void {
  world.players = world.players.filter(p => p.id !== id);
}
