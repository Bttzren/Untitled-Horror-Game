import { cellCenter, cellOf, isOpen, roomIdAt } from '../dream/grid';
import type { Cell, DreamMap } from '../dream/types';
import { CONFIG } from './config';
import type { Vec2 } from '../shared/vec';

const CELL = CONFIG.cell;

/** True when the straight segment from a to b crosses only open cell edges. */
export function lineOfSight(map: DreamMap, a: Vec2, b: Vec2): boolean {
  let cur = cellOf(a);
  const end = cellOf(b);
  if (roomIdAt(map, cur) < 0 || roomIdAt(map, end) < 0) return false;
  const dx = b.x - a.x, dz = b.z - a.z;
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  // Parametric distance (0..1 along the segment) to the next vertical / horizontal grid line.
  const nextX = (cx: number): number => dx === 0 ? Infinity : ((cx + (dx > 0 ? 1 : 0)) * CELL - a.x) / dx;
  const nextZ = (cz: number): number => dz === 0 ? Infinity : ((cz + (dz > 0 ? 1 : 0)) * CELL - a.z) / dz;
  let guard = map.width + map.height + 4;
  while ((cur.cx !== end.cx || cur.cz !== end.cz) && guard-- > 0) {
    const tx = nextX(cur.cx), tz = nextZ(cur.cz);
    const next: Cell = tx <= tz ? { cx: cur.cx + stepX, cz: cur.cz } : { cx: cur.cx, cz: cur.cz + stepZ };
    if (!isOpen(map, cur, next)) return false;
    cur = next;
  }
  return cur.cx === end.cx && cur.cz === end.cz;
}

const NEIGHBOURS: readonly Cell[] = [{ cx: 1, cz: 0 }, { cx: -1, cz: 0 }, { cx: 0, cz: 1 }, { cx: 0, cz: -1 }];

/**
 * Shortest walkable route from one point to another: the centres of the cells
 * between the two, then the target itself. Null when there is no route.
 */
export function findPath(map: DreamMap, from: Vec2, to: Vec2): Vec2[] | null {
  const start = cellOf(from), goal = cellOf(to);
  if (roomIdAt(map, start) < 0 || roomIdAt(map, goal) < 0) return null;
  const idx = (c: Cell): number => c.cz * map.width + c.cx;
  const cameFrom = new Map<number, number>([[idx(start), -1]]);
  const queue: Cell[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    if (c.cx === goal.cx && c.cz === goal.cz) break;
    for (const d of NEIGHBOURS) {
      const n = { cx: c.cx + d.cx, cz: c.cz + d.cz };
      if (cameFrom.has(idx(n)) || !isOpen(map, c, n)) continue;
      cameFrom.set(idx(n), idx(c));
      queue.push(n);
    }
  }
  if (!cameFrom.has(idx(goal))) return null;
  const path: Vec2[] = [{ x: to.x, z: to.z }];
  let at = cameFrom.get(idx(goal))!;
  while (at !== -1 && at !== idx(start)) {
    path.unshift(cellCenter({ cx: at % map.width, cz: Math.floor(at / map.width) }));
    at = cameFrom.get(at)!;
  }
  return path;
}
