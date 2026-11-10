import { createRng } from '../../dream/rng';
import { CONFIG } from '../config';
import type { EntityTypeId, World } from '../types';
import type { EntityDef } from './helpers';
import { listenerDef } from './listener';
import { usherDef } from './usher';

export { detectable, moveAlong, tryCatch, type EntityDef } from './helpers';

/** Every kind of entity in the game. New entities are registered here. */
export const ENTITY_DEFS: Record<EntityTypeId, EntityDef> = {
  usher: usherDef,
  listener: listenerDef,
};

/**
 * Places the night's entities. On early nights one (picked by the seed) starts
 * awake and the other sleeps until phase 2; later, both start awake.
 */
export function spawnEntities(world: World): void {
  const spawns = world.map.entitySpawns;
  const usherFirst = createRng((world.map.seed ^ 0x51ed270b) >>> 0).chance(0.5);
  const order: EntityTypeId[] = usherFirst ? ['usher', 'listener'] : ['listener', 'usher'];
  const bothAwake = world.round.night >= CONFIG.bothEntitiesFromNight;
  world.entities = [];
  order.forEach((type, i) => {
    const pos = spawns[i];
    if (!pos) return;
    const e = ENTITY_DEFS[type].spawn(i, pos);
    e.active = i === 0 || bothAwake;
    world.entities.push(e);
  });
}

/** Wakes sleeping entities once phase 2 has begun, then lets every awake entity act. */
export function stepEntities(world: World, dt: number): void {
  for (const e of world.entities) {
    if (!e.active && world.round.phase2) e.active = true;
    if (e.active) ENTITY_DEFS[e.type].update(e, world, dt);
  }
}
