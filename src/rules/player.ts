import { cellOf, isOpen } from '../dream/grid';
import type { Cell, DreamMap } from '../dream/types';
import { CONFIG, type WeightClass } from './config';
import type { InputCmd, PlayerState } from './types';

const CELL = CONFIG.cell;
const R = CONFIG.playerRadius;
const HALF_PI = Math.PI / 2;
/** Stamina a winded player must regain before sprinting again. */
const WINDED_UNTIL = 1;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Turns an untrusted message into a usable input, or null when it is malformed
 * or not newer than the last one accepted.
 */
export function sanitizeInput(raw: unknown, lastSeq: number): InputCmd | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { seq, moveX, moveZ, yaw, pitch } = r;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= lastSeq) return null;
  for (const n of [moveX, moveZ, yaw, pitch]) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  }
  return {
    seq,
    moveX: clamp(moveX as number, -1, 1),
    moveZ: clamp(moveZ as number, -1, 1),
    yaw: Math.atan2(Math.sin(yaw as number), Math.cos(yaw as number)),
    pitch: clamp(pitch as number, -HALF_PI, HALF_PI),
    sprint: r.sprint === true,
    crouch: r.crouch === true,
    interact: r.interact === true,
    drop: r.drop === true,
    throwIt: r.throwIt === true,
    flashlight: r.flashlight === true,
  };
}

/**
 * Advances one player by one step: look direction, stamina, and movement with
 * wall collision. The host runs this for everyone; clients run it on their own
 * player to predict movement, so it must depend only on its arguments.
 */
export function movePlayer(p: PlayerState, cmd: InputCmd, map: DreamMap, carried: WeightClass | null, dt: number): void {
  if (p.status !== 'active') return;
  p.yaw = cmd.yaw;
  p.pitch = cmd.pitch;

  const hidden = p.hiddenIn !== null;
  let mx = hidden ? 0 : cmd.moveX, mz = hidden ? 0 : cmd.moveZ;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  const moving = mag > 0.01;

  p.crouching = cmd.crouch && !hidden;
  const refill = CONFIG.staminaSeconds / CONFIG.staminaRefillSeconds;
  if (p.winded && p.stamina >= WINDED_UNTIL) p.winded = false;
  p.sprinting = cmd.sprint && moving && !p.crouching && !p.winded && p.stamina > 0 && carried !== 'heavy';
  if (p.sprinting) {
    p.stamina = Math.max(0, p.stamina - dt);
    if (p.stamina === 0) p.winded = true;
  } else {
    p.stamina = Math.min(CONFIG.staminaSeconds, p.stamina + refill * dt);
  }
  if (!moving) return;

  const base = p.crouching ? CONFIG.crouch : p.sprinting ? CONFIG.sprint : CONFIG.walk;
  const speed = base * (carried ? CONFIG.carry[carried] : 1);
  // Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const vx = (-sin * mz + cos * mx) * speed;
  const vz = (-cos * mz - sin * mx) * speed;

  p.pos.x = slide(map, p.pos.x + vx * dt, cellOf(p.pos), 'x');
  p.pos.z = slide(map, p.pos.z + vz * dt, cellOf(p.pos), 'z');
  pushFromCorners(map, p);
}

/** Moves along one axis, stopping a body radius short of any closed edge of the current cell. */
function slide(map: DreamMap, want: number, cell: Cell, axis: 'x' | 'z'): number {
  const index = axis === 'x' ? cell.cx : cell.cz;
  const low = index * CELL, high = low + CELL;
  const toward = (step: number): Cell => axis === 'x' ? { cx: cell.cx + step, cz: cell.cz } : { cx: cell.cx, cz: cell.cz + step };
  if (want > high - R && !isOpen(map, cell, toward(1))) return high - R;
  if (want < low + R && !isOpen(map, cell, toward(-1))) return low + R;
  return want;
}

/** Keeps the body out of wall ends: any grid corner where at least one of the four meeting edges is a wall. */
function pushFromCorners(map: DreamMap, p: PlayerState): void {
  const c = cellOf(p.pos);
  for (const gx of [c.cx, c.cx + 1]) for (const gz of [c.cz, c.cz + 1]) {
    const px = gx * CELL, pz = gz * CELL;
    const dx = p.pos.x - px, dz = p.pos.z - pz;
    const d = Math.hypot(dx, dz);
    if (d >= R || d === 0) continue;
    const a = { cx: gx - 1, cz: gz - 1 }, b = { cx: gx, cz: gz - 1 }, e = { cx: gx - 1, cz: gz }, f = { cx: gx, cz: gz };
    const allOpen = isOpen(map, a, b) && isOpen(map, e, f) && isOpen(map, a, e) && isOpen(map, b, f);
    if (allOpen) continue;
    p.pos.x = px + (dx / d) * R;
    p.pos.z = pz + (dz / d) * R;
  }
}
