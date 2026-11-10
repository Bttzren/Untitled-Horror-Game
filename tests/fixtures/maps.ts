import { cellOf, isOpen } from '../../src/dream/grid';
import type { Cell, DreamMap } from '../../src/dream/types';

export const key = (c: Cell): string => `${c.cx},${c.cz}`;

/** Every cell reachable from the Door by crossing only open edges. */
export function reachableCells(map: DreamMap): Set<string> {
  const start = cellOf(map.door);
  const seen = new Set<string>([key(start)]);
  const queue: Cell[] = [start];
  while (queue.length) {
    const c = queue.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { cx: c.cx + dx, cz: c.cz + dz };
      if (!seen.has(key(n)) && isOpen(map, c, n)) { seen.add(key(n)); queue.push(n); }
    }
  }
  return seen;
}
