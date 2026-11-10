import { CONFIG, MEMORY_KINDS, quotaFor, roomsFor, type WeightClass } from '../rules/config';
import type { Vec2 } from '../shared/vec';
import { cellCenter, edgeKey, isOpen, roomGraphDistance, roomIdAt } from './grid';
import { createRng, type Rng } from './rng';
import { PLACEABLE, rotated } from './rooms';
import type { Cell, DreamMap, HidingSpot, MemorySpawn, Room } from './types';

const DIRS: readonly Cell[] = [{ cx: 1, cz: 0 }, { cx: -1, cz: 0 }, { cx: 0, cz: 1 }, { cx: 0, cz: -1 }];
const MAX_LAYOUT_ATTEMPTS = 50;
const MAX_PLACEMENT_TRIES = 600;

/** Builds the dream for a seed and night. The same inputs always give the same map. */
export function generateDream(seed: number, night: number): DreamMap {
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
    const sub = ((seed >>> 0) ^ Math.imul(night, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;
    const map = tryLayout(seed, night, createRng(sub));
    if (map) return map;
  }
  throw new Error(`could not build a dream for seed ${seed}, night ${night}`);
}

function tryLayout(seed: number, night: number, rng: Rng): DreamMap | null {
  const size = CONFIG.gridSize;
  const map: DreamMap = {
    seed, night, width: size, height: size,
    roomAt: new Array<number>(size * size).fill(-1),
    doorways: [], rooms: [],
    door: { x: 0, z: 0 }, spawns: [], memories: [], hidingSpots: [], entitySpawns: [], lights: [],
  };
  const doorways = new Set<number>();

  const place = (template: Room['template'], cells: Cell[]): Room => {
    const room: Room = { id: map.rooms.length, template, cells };
    for (const c of cells) map.roomAt[c.cz * size + c.cx] = room.id;
    map.rooms.push(room);
    return room;
  };

  // The Door room sits at the centre of the grid.
  const mid = size / 2 - 1;
  place('door', rotated('door', 0).map(c => ({ cx: c.cx + mid, cz: c.cz + mid })));

  // Grow outward: attach each new room across a free edge of an existing one.
  const target = roomsFor(night);
  let tries = 0;
  while (map.rooms.length < target) {
    if (++tries > MAX_PLACEMENT_TRIES) return null;
    const from = rng.pick(rng.pick(map.rooms).cells);
    const dir = rng.pick(DIRS);
    const entry = { cx: from.cx + dir.cx, cz: from.cz + dir.cz };
    if (!inBounds(entry, size) || roomIdAt(map, entry) !== -1) continue;
    const template = rng.pick(PLACEABLE);
    const shape = rotated(template, rng.int(0, 3));
    const anchor = rng.pick(shape);
    const cells = shape.map(c => ({ cx: entry.cx + c.cx - anchor.cx, cz: entry.cz + c.cz - anchor.cz }));
    if (!cells.every(c => inBounds(c, size) && roomIdAt(map, c) === -1)) continue;
    place(template, cells);
    doorways.add(edgeKey(map, from, entry));
  }

  // Loops: some neighbouring rooms that are not yet joined get one extra doorway.
  const joined = new Set<string>();
  const shared = new Map<string, [Cell, Cell][]>();
  for (let cz = 0; cz < size; cz++) for (let cx = 0; cx < size; cx++) {
    const a = { cx, cz };
    const ra = roomIdAt(map, a);
    if (ra < 0) continue;
    for (const b of [{ cx: cx + 1, cz }, { cx, cz: cz + 1 }]) {
      const rb = roomIdAt(map, b);
      if (rb < 0 || rb === ra) continue;
      const pair = ra < rb ? `${ra}-${rb}` : `${rb}-${ra}`;
      if (doorways.has(edgeKey(map, a, b))) joined.add(pair);
      if (!shared.has(pair)) shared.set(pair, []);
      shared.get(pair)!.push([a, b]);
    }
  }
  for (const [pair, edges] of shared) {
    if (joined.has(pair)) continue;
    if (!rng.chance(CONFIG.loopChance)) continue;
    const [a, b] = rng.pick(edges);
    doorways.add(edgeKey(map, a, b));
  }
  map.doorways = [...doorways].sort((x, y) => x - y);

  // Entities start far from the Door; a layout without two such rooms is rejected.
  const far = map.rooms
    .map(r => ({ r, d: roomGraphDistance(map, 0, r.id) }))
    .filter(x => x.d >= CONFIG.entityMinRoomsFromDoor && Number.isFinite(x.d))
    .sort((x, y) => y.d - x.d || x.r.id - y.r.id);
  if (far.length < 2) return null;
  map.entitySpawns = far.slice(0, 2).map(x => cellCenter(x.r.cells[0]!));

  const cell = CONFIG.cell;
  map.door = { x: (mid + 1) * cell, z: (mid + 1) * cell };
  map.spawns = DIRS.map(d => ({ x: map.door.x + d.cx * 1.2, z: map.door.z + d.cz * 1.2 }));

  const outside: Cell[] = map.rooms.slice(1).flatMap(r => r.cells);
  map.memories = placeMemories(rng, outside, quotaFor(night));
  map.hidingSpots = placeHidingSpots(rng, map, outside);

  for (const room of map.rooms) {
    const lit = room.cells.filter(c => (c.cx + c.cz) % 2 === 0);
    for (const c of lit.length ? lit : [room.cells[0]!]) map.lights.push(cellCenter(c));
  }
  return map;
}

function inBounds(c: Cell, size: number): boolean {
  return c.cx >= 0 && c.cz >= 0 && c.cx < size && c.cz < size;
}

function pickWeight(rng: Rng): WeightClass {
  const roll = rng.next();
  const mix = CONFIG.memoryMix;
  if (roll < mix.light) return 'light';
  return roll < mix.light + mix.medium ? 'medium' : 'heavy';
}

function placeMemories(rng: Rng, cells: Cell[], quota: number): MemorySpawn[] {
  const need = Math.ceil(quota * CONFIG.valueFactor);
  const margin = 0.6;
  const span = CONFIG.cell - margin * 2;
  const out: MemorySpawn[] = [];
  let total = 0;
  while (total < need) {
    const weight = pickWeight(rng);
    const kind = rng.pick(MEMORY_KINDS.filter(k => k.weight === weight));
    const c = rng.pick(cells);
    const pos: Vec2 = {
      x: c.cx * CONFIG.cell + margin + rng.next() * span,
      z: c.cz * CONFIG.cell + margin + rng.next() * span,
    };
    const value = rng.int(kind.min, kind.max);
    out.push({ id: out.length, kind: kind.id, value, pos });
    total += value;
  }
  return out;
}

function placeHidingSpots(rng: Rng, map: DreamMap, cells: Cell[]): HidingSpot[] {
  const want = Math.max(3, Math.ceil(map.rooms.length / 2));
  // Every (cell, side) where the side is a wall: a spot stands 0.5 m in front of it.
  const sites: { c: Cell; d: Cell }[] = [];
  for (const c of cells) for (const d of DIRS) {
    if (!isOpen(map, c, { cx: c.cx + d.cx, cz: c.cz + d.cz })) sites.push({ c, d });
  }
  const out: HidingSpot[] = [];
  const usedCells = new Set<string>();
  const inset = CONFIG.cell / 2 - 0.5;
  while (out.length < want && sites.length > 0) {
    const i = rng.int(0, sites.length - 1);
    const { c, d } = sites.splice(i, 1)[0]!;
    const k = `${c.cx},${c.cz}`;
    if (usedCells.has(k)) continue;
    usedCells.add(k);
    const centre = cellCenter(c);
    out.push({
      id: out.length,
      kind: out.length % 2 === 0 ? 'locker' : 'curtain',
      pos: { x: centre.x + d.cx * inset, z: centre.z + d.cz * inset },
    });
  }
  return out;
}
