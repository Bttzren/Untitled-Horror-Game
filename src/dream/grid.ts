import { CONFIG } from '../rules/config';
import type { Vec2 } from '../shared/vec';
import type { Cell, DreamMap } from './types';

const CELL = CONFIG.cell;

export function cellOf(p: Vec2): Cell {
  return { cx: Math.floor(p.x / CELL), cz: Math.floor(p.z / CELL) };
}

export function cellCenter(c: Cell): Vec2 {
  return { x: (c.cx + 0.5) * CELL, z: (c.cz + 0.5) * CELL };
}

/** Room id at a cell; -1 when the cell is solid or outside the map. */
export function roomIdAt(map: DreamMap, c: Cell): number {
  if (c.cx < 0 || c.cz < 0 || c.cx >= map.width || c.cz >= map.height) return -1;
  return map.roomAt[c.cz * map.width + c.cx] ?? -1;
}

/** Identifies the edge between two orthogonally adjacent cells; the same for (a, b) and (b, a). */
export function edgeKey(map: DreamMap, a: Cell, b: Cell): number {
  const ia = a.cz * map.width + a.cx;
  const ib = b.cz * map.width + b.cx;
  const low = Math.min(ia, ib);
  return low * 2 + (a.cz === b.cz ? 0 : 1);
}

interface Derived { doorways: Set<number>; roomLinks: Map<number, Set<number>> }
const derivedCache = new WeakMap<DreamMap, Derived>();

function derived(map: DreamMap): Derived {
  let d = derivedCache.get(map);
  if (d) return d;
  const doorways = new Set(map.doorways);
  const roomLinks = new Map<number, Set<number>>();
  for (const k of doorways) {
    const low = Math.floor(k / 2);
    const a = { cx: low % map.width, cz: Math.floor(low / map.width) };
    const b = k % 2 === 0 ? { cx: a.cx + 1, cz: a.cz } : { cx: a.cx, cz: a.cz + 1 };
    const ra = roomIdAt(map, a), rb = roomIdAt(map, b);
    if (ra < 0 || rb < 0) continue;
    if (!roomLinks.has(ra)) roomLinks.set(ra, new Set());
    if (!roomLinks.has(rb)) roomLinks.set(rb, new Set());
    roomLinks.get(ra)!.add(rb);
    roomLinks.get(rb)!.add(ra);
  }
  d = { doorways, roomLinks };
  derivedCache.set(map, d);
  return d;
}

/** Can something pass between two adjacent cells? Both must be floor, and in one room or joined by a doorway. */
export function isOpen(map: DreamMap, a: Cell, b: Cell): boolean {
  const ra = roomIdAt(map, a);
  if (ra < 0) return false;
  const rb = roomIdAt(map, b);
  if (rb < 0) return false;
  if (Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz) !== 1) return false;
  if (ra === rb) return true;
  return derived(map).doorways.has(edgeKey(map, a, b));
}

/** Number of doorways crossed on the shortest route between two rooms; Infinity when unconnected. */
export function roomGraphDistance(map: DreamMap, fromRoom: number, toRoom: number): number {
  if (fromRoom === toRoom) return 0;
  const links = derived(map).roomLinks;
  const seen = new Map<number, number>([[fromRoom, 0]]);
  const queue = [fromRoom];
  for (let i = 0; i < queue.length; i++) {
    const r = queue[i]!;
    const d = seen.get(r)!;
    for (const n of links.get(r) ?? []) {
      if (seen.has(n)) continue;
      if (n === toRoom) return d + 1;
      seen.set(n, d + 1);
      queue.push(n);
    }
  }
  return Infinity;
}
