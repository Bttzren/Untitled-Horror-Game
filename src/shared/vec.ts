/** A point or direction on the ground plane, in metres. */
export type Vec2 = { x: number; z: number };

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, z: v.z * s });
export const len = (v: Vec2): number => Math.hypot(v.x, v.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Unit vector in the direction of v; the zero vector stays zero. */
export function normalize(v: Vec2): Vec2 {
  const l = len(v);
  return l === 0 ? { x: 0, z: 0 } : { x: v.x / l, z: v.z / l };
}
