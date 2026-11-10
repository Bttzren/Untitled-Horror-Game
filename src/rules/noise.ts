import { CONFIG } from './config';
import type { NoiseSource, World } from './types';
import type { Vec2 } from '../shared/vec';

/** Records a sound that entities can hear, and reports it so clients can play it. */
export function emitNoise(world: World, pos: Vec2, radius: number, source: NoiseSource): void {
  const at = { x: pos.x, z: pos.z };
  world.noises.push({ pos: at, radius, tick: world.tick, source });
  world.events.push({ type: 'noise', pos: at, radius });
}

/** Forgets noises older than CONFIG.noiseMemorySeconds. */
export function pruneNoise(world: World): void {
  const oldest = world.tick - CONFIG.noiseMemorySeconds * CONFIG.tickRate;
  if (world.noises.length > 0 && world.noises[0]!.tick < oldest) {
    world.noises = world.noises.filter(n => n.tick >= oldest);
  }
}
