import type { DreamMap } from '../../src/dream/types';
import type { GameEvent, InputCmd, PlayerId, World } from '../../src/rules/types';
import { DT, createWorld, stepWorld } from '../../src/rules/world';
import type { Vec2 } from '../../src/shared/vec';

export const idle: InputCmd = {
  seq: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, sprint: false, crouch: false,
  interact: false, drop: false, throwIt: false, flashlight: false,
};

/** A world on `map` with `players` players and the given memories lying on the ground. */
export function worldWith(map: DreamMap, players: number, memories: { kind: string; value: number; pos: Vec2 }[] = [], night = 1): World {
  const m: DreamMap = { ...map, memories: memories.map((x, id) => ({ id, ...x })) };
  return createWorld(m, Array.from({ length: players }, (_, id) => ({ id, name: `p${id}` })), night);
}

/** Steps the world; `inputs` maps player id to a partial command for this step. Returns every event seen. */
export function step(world: World, inputs: Record<PlayerId, Partial<InputCmd>> = {}, steps = 1): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < steps; i++) {
    const map = new Map<PlayerId, InputCmd>();
    for (const p of world.players) {
      const over = inputs[p.id];
      // Keep each player's facing unless the test says otherwise.
      map.set(p.id, { ...idle, yaw: p.yaw, pitch: p.pitch, ...(over ?? {}), seq: world.tick + 1 });
    }
    stepWorld(world, map, DT);
    events.push(...world.events);
  }
  return events;
}

export const seconds = (s: number): number => Math.round(s / DT);
export const noises = (events: GameEvent[]): number[] => events.flatMap(e => e.type === 'noise' ? [e.radius] : []);

import { ENTITY_DEFS } from '../../src/rules/entities';
import type { EntityState, EntityTypeId } from '../../src/rules/types';

/** Adds an awake entity to the world at a position. */
export function addEntity(world: World, type: EntityTypeId, pos: Vec2): EntityState {
  const e = ENTITY_DEFS[type].spawn(world.entities.length, { x: pos.x, z: pos.z });
  e.active = true;
  world.entities.push(e);
  return e;
}
