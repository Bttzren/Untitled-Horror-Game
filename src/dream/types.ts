import type { Vec2 } from '../shared/vec';

/** A grid cell. Cell (cx, cz) covers x in [cx*4, cx*4+4) and z in [cz*4, cz*4+4). */
export type Cell = { cx: number; cz: number };

export type RoomTemplateId = 'door' | 'hallway' | 'corner' | 'pool' | 'office' | 'stairwell' | 'waiting';

export interface Room { id: number; template: RoomTemplateId; cells: Cell[] }
export interface MemorySpawn { id: number; kind: string; value: number; pos: Vec2 }
export interface HidingSpot { id: number; kind: 'locker' | 'curtain'; pos: Vec2 }

export interface DreamMap {
  seed: number;
  night: number;
  width: number;
  height: number;
  /** width*height entries: -1 is solid, anything else is a room id. */
  roomAt: number[];
  /** Sorted edge keys (see edgeKey) of openings between cells of different rooms. */
  doorways: number[];
  /** rooms[0] is the Door room. */
  rooms: Room[];
  /** Where players bank memories and leave. */
  door: Vec2;
  /** Exactly 4 player spawn points beside the Door. */
  spawns: Vec2[];
  memories: MemorySpawn[];
  hidingSpots: HidingSpot[];
  entitySpawns: Vec2[];
  lights: Vec2[];
}
