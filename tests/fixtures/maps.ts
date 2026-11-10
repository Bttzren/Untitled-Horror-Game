import { cellOf, edgeKey, isOpen } from '../../src/dream/grid';
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

/**
 * A tiny hand-built map, 3 cells wide and 2 tall (cells are 4 m):
 *   room 0: (0,0) (1,0)     room 1: (2,0) (2,1)     room 2: (1,1), sealed
 *   one doorway between (1,0) and (2,0); cell (0,1) is solid.
 */
export function twoRoomsMap(): DreamMap {
  const map: DreamMap = {
    seed: 0, night: 1, width: 3, height: 2,
    roomAt: [0, 0, 1, -1, 2, 1],
    doorways: [],
    rooms: [
      { id: 0, template: 'door', cells: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }] },
      { id: 1, template: 'hallway', cells: [{ cx: 2, cz: 0 }, { cx: 2, cz: 1 }] },
      { id: 2, template: 'stairwell', cells: [{ cx: 1, cz: 1 }] },
    ],
    door: { x: 2, z: 2 },
    spawns: [{ x: 2, z: 2 }, { x: 3, z: 2 }, { x: 2, z: 1 }, { x: 3, z: 1 }],
    memories: [], hidingSpots: [], entitySpawns: [{ x: 10, z: 6 }], lights: [],
  };
  map.doorways = [edgeKey(map, { cx: 1, cz: 0 }, { cx: 2, cz: 0 })];
  return map;
}
