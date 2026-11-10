import type { Cell, RoomTemplateId } from './types';

const rect = (w: number, h: number): Cell[] => {
  const cells: Cell[] = [];
  for (let cz = 0; cz < h; cz++) for (let cx = 0; cx < w; cx++) cells.push({ cx, cz });
  return cells;
};

/** Room footprints at rotation 0, as cell offsets. */
export const ROOM_TEMPLATES: Record<RoomTemplateId, Cell[]> = {
  door: rect(2, 2),
  hallway: rect(1, 4),
  corner: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }, { cx: 1, cz: 1 }],
  pool: rect(3, 3),
  office: rect(3, 2),
  stairwell: rect(2, 1),
  waiting: rect(2, 2),
};

/** Templates the generator may attach; the Door room is placed once, first. */
export const PLACEABLE: readonly RoomTemplateId[] = ['hallway', 'hallway', 'corner', 'pool', 'office', 'stairwell', 'waiting'];

/** Footprint rotated by quarter turns (0..3). */
export function rotated(template: RoomTemplateId, quarterTurns: number): Cell[] {
  let cells = ROOM_TEMPLATES[template];
  for (let i = 0; i < (quarterTurns & 3); i++) cells = cells.map(c => ({ cx: -c.cz, cz: c.cx }));
  return cells;
}
