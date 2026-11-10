import { cellOf, isOpen } from '../dream/grid';
import type { Cell } from '../dream/types';
import { dist } from '../shared/vec';
import { CONFIG, MEMORY_KINDS, type MemoryKind, type WeightClass } from './config';
import { lineOfSight } from './nav';
import { emitNoise } from './noise';
import type { MemoryState, PlayerState, World } from './types';

const CELL = CONFIG.cell;
/** How far from a wall a thrown memory comes to rest. */
const WALL_GAP = 0.3;
/** Timers fire this much early so that rounding never skips a beat. */
const EPS = 1e-6;

const FALLBACK_KIND: MemoryKind = MEMORY_KINDS[0]!;

export function kindOf(m: MemoryState): MemoryKind {
  return MEMORY_KINDS.find(k => k.id === m.kind) ?? FALLBACK_KIND;
}

export function carriedWeight(world: World, p: PlayerState): WeightClass | null {
  if (p.carrying === null) return null;
  const m = world.memories.find(x => x.id === p.carrying);
  return m ? kindOf(m).weight : null;
}

function carried(world: World, p: PlayerState): MemoryState | null {
  if (p.carrying === null) return null;
  return world.memories.find(m => m.id === p.carrying) ?? null;
}

/** Puts down what the player carries, where they stand. Silent drops make no noise. */
export function dropCarried(world: World, p: PlayerState, silent: boolean): void {
  const m = carried(world, p);
  p.carrying = null;
  if (!m) return;
  m.state = 'ground';
  m.carrier = null;
  m.pos = { x: p.pos.x, z: p.pos.z };
  if (!silent) {
    const radius = kindOf(m).weight === 'heavy' ? CONFIG.noise.dropHeavy : CONFIG.noise.drop;
    emitNoise(world, m.pos, radius, { kind: 'memory', id: m.id });
  }
}

/** Throws what the player carries along their view direction. */
export function throwCarried(world: World, p: PlayerState): void {
  const m = carried(world, p);
  if (!m) return;
  p.carrying = null;
  m.state = 'thrown';
  m.carrier = null;
  m.pos = { x: p.pos.x, z: p.pos.z };
  m.vel = { x: -Math.sin(p.yaw) * CONFIG.throwSpeed, z: -Math.cos(p.yaw) * CONFIG.throwSpeed };
  m.air = CONFIG.throwSeconds;
}

function bank(world: World, p: PlayerState, m: MemoryState): void {
  p.carrying = null;
  m.state = 'banked';
  m.carrier = null;
  world.round.banked += m.value;
  world.events.push({ type: 'banked', player: p.id, value: m.value });
}

/**
 * What the interact key does, in priority order: bank at the Door, then pick
 * up the nearest memory in reach. (Hiding and leaving are added to this list
 * by the hiding and round rules.)
 */
export function handleInteract(world: World, p: PlayerState): void {
  if (p.status !== 'active') return;
  const nearDoor = dist(p.pos, world.map.door) <= CONFIG.reach.door;
  const held = carried(world, p);
  if (nearDoor && held) { bank(world, p, held); return; }
  if (!held) {
    let best: MemoryState | null = null, bestD = Infinity;
    for (const m of world.memories) {
      if (m.state !== 'ground') continue;
      const d = dist(p.pos, m.pos);
      if (d <= CONFIG.reach.memory && d < bestD && lineOfSight(world.map, p.pos, m.pos)) { best = m; bestD = d; }
    }
    if (best) {
      best.state = 'carried';
      best.carrier = p.id;
      p.carrying = best.id;
      return;
    }
  }
}

/** Moves a thrown memory along one axis; true if a wall stopped it. */
function fly(world: World, m: MemoryState, axis: 'x' | 'z', delta: number): boolean {
  const cell = cellOf(m.pos);
  const index = axis === 'x' ? cell.cx : cell.cz;
  const low = index * CELL, high = low + CELL;
  const toward = (s: number): Cell => axis === 'x' ? { cx: cell.cx + s, cz: cell.cz } : { cx: cell.cx, cz: cell.cz + s };
  const want = m.pos[axis] + delta;
  if (want > high - WALL_GAP && !isOpen(world.map, cell, toward(1))) { m.pos[axis] = Math.max(m.pos[axis], high - WALL_GAP); return true; }
  if (want < low + WALL_GAP && !isOpen(world.map, cell, toward(-1))) { m.pos[axis] = Math.min(m.pos[axis], low + WALL_GAP); return true; }
  m.pos[axis] = want;
  return false;
}

/** Advances memories: carried ones follow their carrier, thrown ones fly and land, noisy ones make noise. */
export function stepMemories(world: World, dt: number): void {
  for (const m of world.memories) {
    if (m.state === 'banked') continue;
    if (m.state === 'carried') {
      const carrier = world.players.find(p => p.id === m.carrier);
      if (carrier) m.pos = { x: carrier.pos.x, z: carrier.pos.z };
    } else if (m.state === 'thrown') {
      // Sub-steps keep a fast throw from skipping across a cell corner.
      const hit = fly(world, m, 'x', m.vel.x * dt) || fly(world, m, 'z', m.vel.z * dt);
      m.air -= dt;
      if (hit || m.air <= EPS) {
        m.state = 'ground';
        m.vel = { x: 0, z: 0 };
        m.air = 0;
        emitNoise(world, m.pos, CONFIG.noise.thrown, { kind: 'memory', id: m.id });
      }
    }
    if (kindOf(m).noisy) {
      m.noiseTimer += dt;
      if (m.noiseTimer >= CONFIG.footstepInterval - EPS) {
        m.noiseTimer = 0;
        emitNoise(world, m.pos, CONFIG.noise.noisyMemory, { kind: 'memory', id: m.id });
      }
    }
  }
}
