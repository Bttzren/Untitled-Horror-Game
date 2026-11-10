import { CONFIG } from './config';
import { dropCarried } from './items';
import type { EntityTypeId, PlayerState, World } from './types';

/** Takes a player out of the night. They drop what they carry and spectate until the next night. */
export function catchPlayer(world: World, p: PlayerState, by: EntityTypeId | 'collapse'): void {
  if (p.status !== 'active') return;
  dropCarried(world, p, true);
  p.status = 'caught';
  p.hiddenIn = null;
  p.exposedTo = [];
  p.sprinting = false;
  world.events.push({ type: 'caught', player: p.id, by });
}

/**
 * Decides whether the night is over. It ends once nobody is still inside:
 * a success if the quota was met and at least one player left through the Door.
 */
export function evaluateEnd(world: World): void {
  const round = world.round;
  if (round.result || world.players.length === 0) return;
  if (world.players.some(p => p.status === 'active')) return;
  const someoneLeft = world.players.some(p => p.status === 'left');
  round.result = someoneLeft && round.banked >= round.quota ? 'success' : 'fail';
}

/** Advances the timer and the night's phases, and ends the night when it is over. */
export function stepRound(world: World, dt: number): void {
  const round = world.round;
  round.timeLeft = Math.max(0, round.timeLeft - dt);
  if (!round.phase2 && round.timeLeft <= CONFIG.phase2At) {
    round.phase2 = true;
    world.events.push({ type: 'phase2' });
  }
  if (!round.doorOpen && round.banked >= round.quota) {
    round.doorOpen = true;
    world.events.push({ type: 'doorOpen' });
  }
  if (round.timeLeft <= 0) {
    // The dream collapses on anyone still inside.
    for (const p of world.players) catchPlayer(world, p, 'collapse');
  }
  evaluateEnd(world);
}
