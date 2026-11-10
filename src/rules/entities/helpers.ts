import { cellOf } from '../../dream/grid';
import { dist, type Vec2 } from '../../shared/vec';
import { findPath, lineOfSight } from '../nav';
import { catchPlayer } from '../round';
import type { EntityState, EntityTypeId, PlayerState, World } from '../types';

/**
 * One kind of entity. To add a new one: write a file exporting an EntityDef,
 * add its id to EntityTypeId, and register it in ENTITY_DEFS (index.ts).
 */
export interface EntityDef {
  type: EntityTypeId;
  spawn(id: number, pos: Vec2): EntityState;
  /** Called every step while the entity is awake. */
  update(e: EntityState, world: World, dt: number): void;
  /** Did this entity notice a player getting into a hiding spot? Such a player stays findable. */
  noticesHiding(e: EntityState, world: World, p: PlayerState): boolean;
}

export function baseEntity(id: number, type: EntityTypeId, pos: Vec2): EntityState {
  return { id, type, pos: { x: pos.x, z: pos.z }, yaw: 0, active: false, mode: 'idle', target: null, path: [], timer: 0, ignore: [], loud: 0, heardTick: -1, huntMemory: null };
}

/** Sight-based entities notice a player hiding when they can see them do it. */
export function seesHiding(e: EntityState, world: World, p: PlayerState): boolean {
  return lineOfSight(world.map, e.pos, p.pos);
}

/** Players this entity is able to find: inside the dream, and not hidden (unless it saw them hide). */
export function detectable(world: World, e: EntityState): PlayerState[] {
  return world.players.filter(p => p.status === 'active' && (p.hiddenIn === null || p.exposedTo.includes(e.id)));
}

/**
 * Moves an entity toward a target along walkable cells, turning it to face the
 * way it travels. Returns true once it has arrived; false while on the way or
 * when there is no route.
 */
export function moveAlong(e: EntityState, target: Vec2, speed: number, world: World, dt: number): boolean {
  const sameGoal = e.target !== null && e.target.x === target.x && e.target.z === target.z;
  if (!sameGoal || e.path.length === 0) {
    const path = findPath(world.map, e.pos, target);
    e.target = { x: target.x, z: target.z };
    if (!path) { e.path = []; return false; }
    e.path = path;
  }
  let budget = speed * dt;
  while (budget > 0 && e.path.length > 0) {
    // Cut corners: head straight for the furthest waypoint that is in plain view.
    while (e.path.length > 1 && wideOpen(world, e.pos, e.path[1]!)) e.path.shift();
    const next = e.path[0]!;
    const dx = next.x - e.pos.x, dz = next.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) e.yaw = Math.atan2(-dx, -dz);
    if (d <= budget) {
      e.pos = { x: next.x, z: next.z };
      e.path.shift();
      budget -= d;
    } else {
      e.pos = { x: e.pos.x + (dx / d) * budget, z: e.pos.z + (dz / d) * budget };
      budget = 0;
    }
  }
  return e.path.length === 0 && dist(e.pos, target) < 1e-6;
}

/** Body half-width used when deciding whether a shortcut is safe. */
const SHOULDER = 0.3;

/** Is there room to walk straight from a to b without brushing a wall end? */
function wideOpen(world: World, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const ox = (-dz / d) * SHOULDER, oz = (dx / d) * SHOULDER;
  return lineOfSight(world.map, a, b)
    && lineOfSight(world.map, { x: a.x + ox, z: a.z + oz }, { x: b.x + ox, z: b.z + oz })
    && lineOfSight(world.map, { x: a.x - ox, z: a.z - oz }, { x: b.x - ox, z: b.z - oz });
}

/** Catches every findable player within range (and in the same or an adjoining open space). */
export function tryCatch(world: World, e: EntityState, range: number): void {
  for (const p of detectable(world, e)) {
    if (dist(p.pos, e.pos) <= range && lineOfSight(world.map, e.pos, p.pos)) catchPlayer(world, p, e.type);
  }
}

/** The cell an entity stands in, as a string key. */
export const cellKey = (pos: Vec2): string => { const c = cellOf(pos); return `${c.cx},${c.cz}`; };
