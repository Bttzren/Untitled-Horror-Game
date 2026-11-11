import { cellCenter } from '../../dream/grid';
import { createRng } from '../../dream/rng';
import { dist } from '../../shared/vec';
import { CONFIG } from '../config';
import type { EntityState, NoiseEvent, World } from '../types';
import { baseEntity, moveAlong, tryCatch, type EntityDef } from './helpers';

const L = CONFIG.listener;

/** The loudest noise it has not yet acted on that reaches it; ties go to the most recent. */
function loudestNews(e: EntityState, world: World): NoiseEvent | null {
  let best: NoiseEvent | null = null;
  for (const n of world.noises) {
    if (n.tick <= e.heardTick) continue;
    if (dist(n.pos, e.pos) > n.radius) continue;
    if (isIgnored(e, world, n)) continue;
    if (!best || n.radius > best.radius || (n.radius === best.radius && n.tick >= best.tick)) best = n;
  }
  return best;
}

/**
 * Is this the ringing of a memory it has already investigated? Only the ring of
 * a memory still lying on the ground is tuned out: once someone picks it up,
 * drops it or throws it, the Listener hears it again.
 */
function isIgnored(e: EntityState, world: World, n: NoiseEvent): boolean {
  if (n.source.kind !== 'memory' || n.radius !== CONFIG.noise.noisyMemory) return false;
  const id = n.source.id;
  if (!e.ignore.some(i => i.memoryId === id)) return false;
  return world.memories.find(m => m.id === id)?.state === 'ground';
}

/** Picks somewhere new to drift toward. Seeded, so every run of the same night behaves the same. */
function pickWanderGoal(e: EntityState, world: World): void {
  const rng = createRng((world.map.seed ^ Math.imul(world.tick + 1, 0x9e3779b1) ^ Math.imul(e.id + 1, 0x85ebca6b)) >>> 0);
  const room = rng.pick(world.map.rooms);
  e.target = cellCenter(rng.pick(room.cells));
  e.path = [];
  e.mode = 'wander';
}

/**
 * The Listener: blind. It drifts from room to room until it hears something,
 * then goes to the loudest thing it heard. It catches whoever it bumps into.
 */
export const listenerDef: EntityDef = {
  type: 'listener',
  spawn: (id, pos) => baseEntity(id, 'listener', pos),
  // Blind: it never sees anyone hide.
  noticesHiding: () => false,
  update(e, world, dt) {
    if (e.ignore.length > 0) e.ignore = e.ignore.filter(i => i.until > world.tick);

    const news = loudestNews(e, world);
    if (news && news.radius >= e.loud) {
      e.loud = news.radius;
      e.heardTick = news.tick;
      e.huntMemory = news.source.kind === 'memory' ? news.source.id : null;
      e.target = { x: news.pos.x, z: news.pos.z };
      e.path = [];
      e.mode = 'hunt';
    }

    if (e.mode === 'hunt' && e.target) {
      const arrived = moveAlong(e, e.target, L.hunt, world, dt);
      if (arrived || e.path.length === 0) {
        e.mode = 'search';
        e.timer = L.searchSeconds;
        // A memory lying here making noise is not worth coming back to for a while.
        const m = e.huntMemory === null ? undefined : world.memories.find(x => x.id === e.huntMemory);
        if (m && m.state === 'ground' && dist(m.pos, e.pos) < 1.5) {
          e.ignore.push({ memoryId: m.id, until: world.tick + (L.searchSeconds + L.ignoreSeconds) * CONFIG.tickRate });
        }
      }
    } else if (e.mode === 'search') {
      e.timer -= dt;
      e.yaw += dt * 1.5; // turning its head, listening
      if (e.timer <= 0) { e.loud = 0; e.huntMemory = null; pickWanderGoal(e, world); }
    } else {
      if (e.mode !== 'wander' || !e.target) pickWanderGoal(e, world);
      const arrived = moveAlong(e, e.target!, L.wander, world, dt);
      if (arrived || e.path.length === 0) pickWanderGoal(e, world);
    }

    tryCatch(world, e, L.catchRange);
  },
};
