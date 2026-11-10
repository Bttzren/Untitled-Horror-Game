import { dist } from '../../shared/vec';
import { CONFIG } from '../config';
import { lineOfSight } from '../nav';
import type { EntityState, World } from '../types';
import { baseEntity, detectable, moveAlong, seesHiding, tryCatch, type EntityDef } from './helpers';

const COS_VIEW = Math.cos((CONFIG.usher.viewHalfAngleDeg * Math.PI) / 180);

/**
 * Is anyone looking at it? A player observes the Usher when it is within their
 * field of view (judged by which way they face, not how high they look),
 * within range, and nothing is in the way. Hidden players see nothing.
 */
export function isObserved(world: World, e: EntityState): boolean {
  for (const p of world.players) {
    if (p.status !== 'active' || p.hiddenIn !== null) continue;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > CONFIG.usher.viewRange) continue;
    if (d > 1e-6) {
      const facing = (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / d;
      if (facing < COS_VIEW) continue;
    }
    if (lineOfSight(world.map, p.pos, e.pos)) return true;
  }
  return false;
}

/**
 * The Usher: it moves only when nobody is looking at it. Watched, it is a
 * statue. Unwatched, it comes for the nearest player faster than they can run.
 */
export const usherDef: EntityDef = {
  type: 'usher',
  spawn: (id, pos) => baseEntity(id, 'usher', pos),
  noticesHiding: seesHiding,
  update(e, world, dt) {
    if (isObserved(world, e)) { e.mode = 'idle'; return; }
    let prey = null, best = Infinity;
    for (const p of detectable(world, e)) {
      const d = dist(p.pos, e.pos);
      if (d < best) { prey = p; best = d; }
    }
    if (!prey) { e.mode = 'idle'; return; }
    e.mode = 'chase';
    moveAlong(e, prey.pos, CONFIG.usher.speed, world, dt);
    tryCatch(world, e, CONFIG.usher.catchRange);
  },
};
