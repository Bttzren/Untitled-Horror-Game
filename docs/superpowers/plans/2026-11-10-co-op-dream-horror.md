# Co-op Dream Horror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build version 1 of a 1–4 player browser co-op horror game: retrieve memories from a generated liminal dream, bank them at the Door to meet a quota, and survive two rule-based entities.

**Architecture:** A deterministic rules simulation (`src/rules`) runs at 30 steps/s on the host's browser only, over a map produced from a seed by `src/dream`. `src/net` carries inputs to the host and snapshots back over a `Transport` interface (PeerJS for real play, in-memory loopback for solo and tests); clients predict their own movement and interpolate everything else. `src/view` draws state with Three.js and DOM overlays.

**Tech Stack:** TypeScript 7 (strict), Vite 8, Three.js 0.187, PeerJS 1.5.5, Vitest 5, `@playwright/test` 1.63.0, `peer` 1.0.2 (dev-only local signalling server), Web Audio API.

**Spec:** `docs/superpowers/specs/2026-11-10-co-op-dream-horror-design.md`

## Global Constraints

- Desktop browsers only. No mobile or gamepad controls.
- The build is static files with a relative base path (`base: './'`) so it runs from an itch.io upload.
- `src/rules` and `src/dream` contain no rendering, networking or browser APIs and import nothing from `src/net`, `src/view` or `src/input`.
- Every tunable number lives in `src/rules/config.ts`. No gameplay numbers elsewhere.
- Simulation step is exactly 1/30 s. Snapshots go out every 2nd step (15/s). Remote things are drawn 100 ms in the past.
- Maximum 4 players. Messages are JSON.
- No accounts, no stored data. Display name is chosen per session.
- Third-party assets: only CC0 / public domain and CC-BY. Every file in `public/assets/` has an entry in `src/view/credits.ts`.
- All names, entities, art and audio are original. No names, characters or assets from existing games.
- Playwright: pin `@playwright/test` to exactly `1.63.0` (matches the pre-installed browser); launch with `executablePath: process.env.PW_CHROMIUM_PATH` when that variable is set; always run with `--trace off`.

## Review Focus

1. **Two players interact with the same memory on the same step** — exactly one ends up carrying it (lowest player id), the other carries nothing. Test in Task 9.
2. **A player disconnects while carrying, while hidden, or as the last uncaught player** — the memory drops where they stood, and the night's end conditions are re-evaluated instead of hanging. Tests in Tasks 6 and 10.
3. **Malformed or hostile input** — `NaN` or out-of-range movement, unknown message types, a 500-character name, a lowercase or padded room code. Movement is clamped, junk is ignored, the host never throws, names are trimmed, codes are normalised. Tests in Tasks 6 and 8.
4. **The host's tab is in the background or stalls** — browsers throttle timers in hidden tabs, which would slow the night for everyone. The host ticks from a Web Worker timer, and a long stall advances at most 10 steps instead of spiralling. Test in Task 6.
5. **A memory is thrown or dropped against a wall or map edge** — it always comes to rest on a floor cell reachable from the Door. Test in Task 9.

## File Map

```
index.html, package.json, tsconfig.json, vite.config.ts, playwright.config.ts
src/shared/vec.ts             Vec2 and vector helpers
src/rules/config.ts           CONFIG, MEMORY_KINDS, quotaFor, roomsFor (imports nothing)
src/rules/types.ts            World and state types, InputCmd, GameEvent
src/rules/nav.ts              lineOfSight, findPath
src/rules/player.ts           movePlayer, stamina, hiding
src/rules/items.ts            pick up, drop, throw, bank
src/rules/noise.ts            emitNoise, pruneNoise
src/rules/round.ts            timer, phases, results
src/rules/world.ts            createWorld, stepWorld, removePlayer
src/rules/entities/index.ts   EntityDef, ENTITY_DEFS, shared helpers, spawn schedule
src/rules/entities/usher.ts, listener.ts
src/dream/rng.ts, types.ts, grid.ts, rooms.ts, generator.ts
src/net/protocol.ts, transport.ts, loopbackTransport.ts, peerTransport.ts
src/net/host.ts, client.ts, ticker.ts, roomCode.ts
src/view/renderer.ts, assets.ts, audio.ts, credits.ts
src/view/ui/menu.ts, lobby.ts, hud.ts, credits.ts, messages.ts, ui.css
src/input/input.ts
src/main.ts
tests/**            Vitest (mirrors src/)
e2e/**              Playwright
scripts/package.mjs zip for itch.io
```

Additions to the spec's layout, decided here: `src/shared/vec.ts`, `src/dream/types.ts` and `grid.ts`, `src/net/ticker.ts` and `roomCode.ts`, `src/view/ui/messages.ts`.

---

## Milestone 1 — Walk around a generated dream, solo

### Task 1: Project scaffold and seeded random numbers

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.ts`, `src/shared/vec.ts`, `src/dream/rng.ts`
- Test: `tests/dream/rng.test.ts`, `tests/architecture.test.ts`

**Interfaces:**
- Produces:
  - `type Vec2 = { x: number; z: number }`; `dist(a, b): number`; `add`, `sub`, `scale(v, s)`, `len(v)`, `normalize(v)` (zero vector stays zero)
  - `createRng(seed: number): Rng` where `Rng = { next(): number /* [0,1) */; int(min: number, max: number): number /* inclusive */; pick<T>(items: readonly T[]): T; chance(p: number): boolean }`
  - npm scripts: `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`), `e2e` (`playwright test`)

- [ ] **Step 1: Scaffold.** `package.json` (`"type": "module"`, private) with dependencies `three@^0.187.0`, `peerjs@^1.5.5`; devDependencies `typescript@^7.0.2`, `vite@^8.3.7`, `vitest@^5.1.0`, `@types/three@^0.187.0`, `@playwright/test@1.63.0`, `peer@^1.0.2`. `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2022`, `module ESNext`, `moduleResolution bundler`, include `src`, `tests`, `e2e`. `vite.config.ts`: `base: './'`. `index.html`: a full-window `<canvas id="game">`, `<div id="ui">`, loads `/src/main.ts`. `.gitignore`: `node_modules`, `dist`, `release`, `test-results`. Run `npm install`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/dream/rng.test.ts
test('same seed gives the same sequence', () => {
  const a = createRng(42), b = createRng(42);
  expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
});
test('different seeds differ', () => { expect(createRng(1).next()).not.toBe(createRng(2).next()); });
test('next is in [0,1) and int is inclusive', () => {
  const r = createRng(7); const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) { const n = r.next(); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(1); seen.add(r.int(1, 3)); }
  expect([...seen].sort()).toEqual([1, 2, 3]);
});
```

```ts
// tests/architecture.test.ts — reads every .ts file under src/rules and src/dream
test('rules and dream stay free of view, net, input and browser APIs', () => {
  // for each file: expect no match of /from ['"].*\/(net|view|input)\//
  // and no match of /\b(window|document|navigator|performance)\b/
});
```

- [ ] **Step 3: Run** `npm test` — expected FAIL: cannot find `src/dream/rng`.
- [ ] **Step 4: Implement** `src/shared/vec.ts` and `src/dream/rng.ts` (mulberry32). `src/main.ts` is an empty module for now.
- [ ] **Step 5: Run** `npm test` and `npm run build` — expected PASS, and `dist/index.html` exists.
- [ ] **Step 6: Commit** — `chore: scaffold project with seeded rng`

### Task 2: Config and dream generator

**Files:**
- Create: `src/rules/config.ts`, `src/dream/types.ts`, `src/dream/grid.ts`, `src/dream/rooms.ts`, `src/dream/generator.ts`
- Test: `tests/rules/config.test.ts`, `tests/dream/generator.test.ts`

**Interfaces:**
- Consumes: `createRng`, `Vec2`
- Produces:

```ts
// src/rules/config.ts (imports nothing)
export const CONFIG = {
  tickRate: 30, snapshotEvery: 2, interpDelayMs: 100, maxPlayers: 4, maxStepsPerTick: 10,
  nightSeconds: 480, phase2At: 240,
  quotaBase: 150, quotaStep: 100, valueFactor: 1.6,
  roomsBase: 8, roomsStep: 2, roomsMax: 20, gridSize: 24, cell: 4, loopChance: 0.25,
  walk: 3.0, sprint: 5.5, crouch: 1.5, staminaSeconds: 5, staminaRefillSeconds: 10,
  carry: { light: 1.0, medium: 0.85, heavy: 0.65 },
  playerRadius: 0.35, eyeHeight: 1.6, crouchEyeHeight: 1.0,
  reach: { memory: 2.0, door: 2.5, hide: 1.5 },
  throwSpeed: 10, throwSeconds: 0.8,
  noise: { crouch: 1, walk: 4, sprint: 12, noisyMemory: 10, drop: 8, dropHeavy: 14, thrown: 14 },
  noiseMemorySeconds: 1, footstepInterval: 0.5,
  usher: { speed: 6, catchRange: 1.0, viewHalfAngleDeg: 50, viewRange: 30 },
  listener: { wander: 2, hunt: 4.5, catchRange: 1.2, searchSeconds: 5, ignoreSeconds: 20 },
  entityMinRoomsFromDoor: 3, bothEntitiesFromNight: 3,
} as const;
export type WeightClass = 'light' | 'medium' | 'heavy';
export interface MemoryKind { id: string; name: string; weight: WeightClass; min: number; max: number; noisy: boolean }
export const MEMORY_KINDS: readonly MemoryKind[]; // drawing, photograph: light 10–25; musicBox, phone: medium 30–60, noisy; clockFace, television: heavy 70–120
export function quotaFor(night: number): number;  // 150, 250, 350 …
export function roomsFor(night: number): number;  // 8, 10 … capped at 20
```

```ts
// src/dream/types.ts
export type Cell = { cx: number; cz: number };
export type RoomTemplateId = 'door' | 'hallway' | 'corner' | 'pool' | 'office' | 'stairwell' | 'waiting';
export interface Room { id: number; template: RoomTemplateId; cells: Cell[] }
export interface MemorySpawn { id: number; kind: string; value: number; pos: Vec2 }
export interface HidingSpot { id: number; kind: 'locker' | 'curtain'; pos: Vec2 }
export interface DreamMap {
  seed: number; night: number; width: number; height: number;
  roomAt: number[];        // width*height, -1 = solid, else room id (plain array so it serialises)
  doorways: number[];      // sorted edge keys between cells of different rooms
  rooms: Room[];           // rooms[0] is the Door room
  door: Vec2; spawns: Vec2[];   // exactly 4 spawns, each within 2 m of the Door
  memories: MemorySpawn[]; hidingSpots: HidingSpot[]; entitySpawns: Vec2[]; lights: Vec2[];
}
// src/dream/grid.ts
export function cellOf(p: Vec2): Cell;                 // floor(p / 4)
export function cellCenter(c: Cell): Vec2;
export function roomIdAt(map: DreamMap, c: Cell): number;   // -1 when solid or out of bounds
export function edgeKey(map: DreamMap, a: Cell, b: Cell): number; // same key for (a,b) and (b,a); a and b must be orthogonal neighbours
export function isOpen(map: DreamMap, a: Cell, b: Cell): boolean; // both floor AND (same room OR doorway)
export function roomGraphDistance(map: DreamMap, fromRoom: number, toRoom: number): number; // doorways crossed
// src/dream/generator.ts
export function generateDream(seed: number, night: number): DreamMap;
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/rules/config.test.ts
test('quota and rooms follow the spec', () => {
  expect([1, 2, 3].map(quotaFor)).toEqual([150, 250, 350]);
  expect([1, 2, 7, 20].map(roomsFor)).toEqual([8, 10, 20, 20]);
});
```

```ts
// tests/dream/generator.test.ts — helper reachableCells(map) floods from cellOf(map.door) via isOpen
test('same seed and night give an identical map', () => {
  expect(generateDream(123, 2)).toEqual(generateDream(123, 2));
});
test.each([1, 2, 3, 5, 7])('night %i invariants hold for seeds 1..60', (night) => {
  for (let seed = 1; seed <= 60; seed++) {
    const m = generateDream(seed, night);
    expect(m.rooms.length).toBe(roomsFor(night));
    expect(m.rooms[0]!.template).toBe('door');
    const reach = reachableCells(m);
    for (const r of m.rooms) for (const c of r.cells) expect(reach.has(`${c.cx},${c.cz}`)).toBe(true);
    for (const s of m.memories) expect(reach.has(key(cellOf(s.pos)))).toBe(true);
    expect(m.memories.reduce((a, s) => a + s.value, 0)).toBeGreaterThanOrEqual(1.6 * quotaFor(night));
    for (const s of m.memories) expect(roomIdAt(m, cellOf(s.pos))).not.toBe(0);
    expect(m.spawns).toHaveLength(4);
    for (const s of m.spawns) expect(dist(s, m.door)).toBeLessThanOrEqual(2);
    expect(m.entitySpawns.length).toBeGreaterThanOrEqual(2);
    for (const e of m.entitySpawns) expect(roomGraphDistance(m, 0, roomIdAt(m, cellOf(e)))).toBeGreaterThanOrEqual(3);
    expect(m.hidingSpots.length).toBeGreaterThanOrEqual(3);
    expect(m.lights.length).toBeGreaterThanOrEqual(m.rooms.length);
  }
});
test('memory values fall inside their kind range', () => { /* every spawn: kind exists, min <= value <= max */ });
test('isOpen is false through walls and true through doorways', () => { /* pick a doorway edge and a same-cell-pair of different rooms without one */ });
```

- [ ] **Step 2: Run** `npm test` — expected FAIL: modules missing.
- [ ] **Step 3: Implement.** Decisions the tests do not fix:
  - `rooms.ts` templates as cell footprints at rotation 0: `door` 2×2, `hallway` 1×4, `corner` L of 3 cells, `pool` 3×3, `office` 3×2, `stairwell` 2×1, `waiting` 2×2. Rotations of 0/90/180/270° are allowed.
  - Layout: place `door` at the grid centre. Repeat until `roomsFor(night)` rooms exist: pick a random perimeter edge of a random placed room, a random non-`door` template and rotation, and place it so one of its cells sits across that edge with no overlap and inside the 24×24 grid; the shared edge becomes a doorway. Then for every other pair of adjacent cells in different rooms, add a doorway with probability `loopChance`.
  - Retry: derive attempt `k = 0, 1, 2…` from the seed; accept the first layout where placement finished and at least 2 rooms are ≥ 3 doorways from room 0; throw after 50 attempts.
  - Memories: random cells outside room 0, position at least 0.6 m from every cell edge; keep adding random kinds until total value ≥ `1.6 × quotaFor(night)`.
  - Hiding spots: `max(3, ceil(rooms / 2))`, outside room 0, 0.5 m from a closed edge; kind alternates locker / curtain.
  - Entity spawns: centres of cells in the 2 farthest qualifying rooms. Lights: centre of each room cell where `(cx + cz)` is even, and at least one per room.
  - `door` is the centre of room 0; `spawns` are 1.2 m from it on four sides.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: seeded dream generator and config`

### Task 3: Line of sight and pathfinding

**Files:**
- Create: `src/rules/nav.ts`
- Test: `tests/rules/nav.test.ts`

**Interfaces:**
- Consumes: `DreamMap`, `isOpen`, `cellOf`, `cellCenter`
- Produces:
  - `lineOfSight(map: DreamMap, a: Vec2, b: Vec2): boolean` — true when the segment crosses only open edges
  - `findPath(map: DreamMap, from: Vec2, to: Vec2): Vec2[] | null` — cell centres from the cell after `from` up to the target's cell, then `to` itself; `[to]` when both are in one cell; `null` when unreachable

- [ ] **Step 1: Write the failing tests** using a hand-built `DreamMap` fixture `tests/fixtures/maps.ts` exporting `twoRoomsMap()`: room 0 = cells (0,0),(1,0); room 1 = cells (2,0),(2,1); one doorway between (1,0) and (2,0); cell (1,1) is room 2 with no doorways.

```ts
test('sees across one room', () => expect(lineOfSight(m, { x: 1, z: 2 }, { x: 7, z: 2 })).toBe(true));
test('sees through a doorway', () => expect(lineOfSight(m, { x: 6, z: 2 }, { x: 10, z: 2 })).toBe(true));
test('blocked by a wall', () => expect(lineOfSight(m, { x: 6, z: 2 }, { x: 6, z: 6 })).toBe(false));
test('path goes through the doorway', () => {
  const p = findPath(m, { x: 2, z: 2 }, { x: 10, z: 6 })!;
  expect(p.at(-1)).toEqual({ x: 10, z: 6 });
  // consecutive cells along [from, ...p] are always isOpen
});
test('no path into a sealed room', () => expect(findPath(m, { x: 2, z: 2 }, { x: 6, z: 6 })).toBeNull());
test('finds a path between random reachable points on generated maps', () => { /* seeds 1..20 */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/rules/nav.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** grid DDA for `lineOfSight` and A* over cells (4-neighbour, `isOpen`) for `findPath`.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** — `feat: line of sight and pathfinding`

### Task 4: World state and player movement

**Files:**
- Create: `src/rules/types.ts`, `src/rules/player.ts`, `src/rules/world.ts`
- Test: `tests/rules/player.test.ts`

**Interfaces:**
- Produces:

```ts
// src/rules/types.ts
export type PlayerId = number; // 0..3
export interface InputCmd {
  seq: number; moveX: number; moveZ: number;   // -1..1; +X strafes right, +Z walks forward
  yaw: number; pitch: number;                  // radians; yaw 0 faces -Z, positive turns left
  sprint: boolean; crouch: boolean;
  interact: boolean; drop: boolean; throwIt: boolean; flashlight: boolean; // true only on the step the key went down
}
export interface PlayerState {
  id: PlayerId; name: string; pos: Vec2; yaw: number; pitch: number;
  stamina: number;              // seconds of sprint left, 0..5
  crouching: boolean; sprinting: boolean; flashlight: boolean;
  carrying: number | null;      // memory id
  hiddenIn: number | null;      // hiding spot id
  exposedTo: number[];          // entity ids that saw this player hide
  status: 'active' | 'caught' | 'left';
  stepTimer: number;
}
export interface MemoryState { id: number; kind: string; value: number; pos: Vec2;
  state: 'ground' | 'carried' | 'thrown' | 'banked'; carrier: PlayerId | null; vel: Vec2; air: number; noiseTimer: number }
export type EntityTypeId = 'usher' | 'listener';
export interface EntityState { id: number; type: EntityTypeId; pos: Vec2; yaw: number; active: boolean;
  mode: 'idle' | 'chase' | 'wander' | 'hunt' | 'search'; target: Vec2 | null; path: Vec2[]; timer: number;
  ignore: { memoryId: number; until: number }[] }
export type NoiseSource = { kind: 'player'; id: PlayerId } | { kind: 'memory'; id: number };
export interface NoiseEvent { pos: Vec2; radius: number; tick: number; source: NoiseSource }
export interface RoundState { night: number; quota: number; banked: number; timeLeft: number;
  phase2: boolean; doorOpen: boolean; result: null | 'success' | 'fail' }
export type GameEvent =
  | { type: 'caught'; player: PlayerId; by: EntityTypeId | 'collapse' }
  | { type: 'banked'; player: PlayerId; value: number } | { type: 'left'; player: PlayerId }
  | { type: 'noise'; pos: Vec2; radius: number } | { type: 'phase2' } | { type: 'doorOpen' };
export interface World { tick: number; map: DreamMap; players: PlayerState[]; memories: MemoryState[];
  entities: EntityState[]; noises: NoiseEvent[]; round: RoundState; events: GameEvent[] }
// src/rules/player.ts
export function sanitizeInput(raw: unknown, lastSeq: number): InputCmd | null;
export function movePlayer(p: PlayerState, cmd: InputCmd, map: DreamMap, carried: WeightClass | null, dt: number): void;
// src/rules/world.ts
export function createWorld(map: DreamMap, players: { id: PlayerId; name: string }[], night: number): World;
export function stepWorld(world: World, inputs: ReadonlyMap<PlayerId, InputCmd>, dt: number): void;
export function removePlayer(world: World, id: PlayerId): void;
export const DT = 1 / 30;
```

- [ ] **Step 1: Write the failing tests** (use `twoRoomsMap()`; helper `run(p, cmd, seconds)` calls `movePlayer` at `DT`)

```ts
test('walks forward at 3 m/s facing -Z', () => { /* yaw 0, moveZ 1, 1 s: pos.z decreased by 3 ±0.05, pos.x unchanged */ });
test('strafes right along +X at yaw 0', () => { /* moveX 1, 0.5 s: x +1.5 */ });
test('diagonal input is not faster', () => { /* moveX 1, moveZ 1, 1 s: distance 3 ±0.05 */ });
test('sprints at 5.5 m/s and drains 5 s of stamina', () => { /* after 5 s stamina 0 ±0.05 and sprinting false, speed back to 3 */ });
test('stamina refills fully in 10 s', () => {});
test('crouch moves at 1.5 m/s and blocks sprint', () => {});
test('carry weight scales speed: medium 2.55, heavy 1.95; heavy cannot sprint', () => {});
test('walls stop the player with 0.35 m clearance', () => { /* walk into a wall for 3 s: stays >= 0.35 from the closed edge */ });
test('doorways let the player through', () => {});
test('fuzz: 10000 random inputs never leave the floor or cross a closed edge', () => { /* on generateDream(5, 1); each step the cell before and after are equal or isOpen */ });
test('hidden, caught and left players do not move', () => {});
test('sanitizeInput clamps and rejects', () => {
  expect(sanitizeInput({ ...ok, moveX: 50 }, 0)!.moveX).toBe(1);
  expect(sanitizeInput({ ...ok, moveX: NaN }, 0)).toBeNull();
  expect(sanitizeInput({ ...ok, seq: 3 }, 5)).toBeNull();      // stale or replayed
  expect(sanitizeInput('nope', 0)).toBeNull();
  expect(sanitizeInput({ ...ok, pitch: 9 }, 0)!.pitch).toBeCloseTo(Math.PI / 2);
});
test('createWorld places players on the map spawns with full stamina', () => {});
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** Forward is `(-sin yaw, -cos yaw)`, right is `(cos yaw, -sin yaw)`. Sprint needs movement, stamina > 0, not crouching, not carrying heavy. Collision: resolve X then Z against closed cell edges with `playerRadius`, then push out of closed-cell corners. `stepWorld` for now: `tick++`, clear `events`, apply `movePlayer` per player in id order, copy yaw/pitch/flashlight toggle. `createWorld` builds memories from `map.memories` (state `ground`) and a `RoundState` with `quotaFor(night)` and `nightSeconds`.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: world state and player movement`

### Task 5: Renderer, input and solo walk

**Files:**
- Create: `src/view/renderer.ts`, `src/input/input.ts`, `playwright.config.ts`, `e2e/solo.spec.ts`
- Modify: `src/main.ts`, `index.html`

**Interfaces:**
- Consumes: `generateDream`, `createWorld`, `stepWorld`, `DT`, `InputCmd`
- Produces:

```ts
// src/view/renderer.ts
export interface ViewState { localId: PlayerId; cameraId: PlayerId; players: PlayerState[]; entities: EntityState[];
  memories: MemoryState[]; round: RoundState }
export class Renderer { constructor(canvas: HTMLCanvasElement); setDream(map: DreamMap): void; render(view: ViewState): void; dispose(): void }
// src/input/input.ts
export class Input { constructor(canvas: HTMLCanvasElement); sample(): Omit<InputCmd, 'seq'>; /* clears edge flags */ readonly locked: boolean; dispose(): void }
```
- `main.ts` exposes `window.__dbg = { view(): ViewState }` when the URL has `?debug`.

- [ ] **Step 1: Write the failing e2e test**

```ts
// e2e/solo.spec.ts — playwright.config.ts starts `npm run dev -- --port 5173` as webServer
test('solo: the dream renders and W moves the player', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/?debug&solo&seed=5');
  await page.waitForFunction(() => (window as any).__dbg?.view().players.length === 1);
  const before = await page.evaluate(() => (window as any).__dbg.view().players[0].pos);
  await page.locator('#game').click(); await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => (window as any).__dbg.view().players[0].pos);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.8);
  expect(errors).toEqual([]);
  // canvas is not blank: screenshot the canvas and expect more than one distinct pixel colour
  // losing pointer lock stops movement: press Escape, hold W 400 ms, position unchanged
});
```

- [ ] **Step 2: Run** `npm run e2e -- --trace off` — expected FAIL.
- [ ] **Step 3: Implement.** Renderer: per floor cell a floor and ceiling quad; a wall quad on every closed edge; door frames on doorway edges; the Door as a glowing frame at `map.door`; one point light per `map.lights` entry; exponential fog; a spot light for each player's flashlight; canvas-generated textures (carpet, tile, wall panel) chosen by room template; other players as capsules; memories as small coloured boxes sized by weight; hiding spots as boxes. Camera at the `cameraId` player's position, `eyeHeight` or `crouchEyeHeight`. Input: pointer lock on canvas click; keys from spec 3.5; returns zero movement when not locked. `main.ts` with `?solo`: generate the dream (`seed` query or random), create a one-player world, step at fixed `DT` from `requestAnimationFrame` with an accumulator, render every frame.
- [ ] **Step 4: Run** `npm run e2e -- --trace off` — expected PASS. Also open the page and look at a screenshot to confirm rooms, lighting and fog read as a place.
- [ ] **Step 5: Commit** — `feat: render the dream and walk around solo`

---

## Milestone 2 — Friends can join and see each other

### Task 6: Protocol, loopback transport and host

**Files:**
- Create: `src/net/protocol.ts`, `src/net/transport.ts`, `src/net/loopbackTransport.ts`, `src/net/host.ts`, `src/net/ticker.ts`
- Test: `tests/net/host.test.ts`

**Interfaces:**
- Consumes: `createWorld`, `stepWorld`, `removePlayer`, `sanitizeInput`, `generateDream`
- Produces:

```ts
// src/net/protocol.ts
export interface LobbyPlayer { id: PlayerId; name: string }
export interface Snapshot { tick: number; ack: Record<number, number>; players: PlayerState[]; entities: EntityState[];
  memories: MemoryState[]; /* only those changed since the last snapshot; all of them in the first */ round: RoundState }
export type ClientMsg = { t: 'hello'; name: string } | { t: 'startRequest' } | { t: 'input'; cmd: InputCmd };
export type HostMsg =
  | { t: 'welcome'; id: PlayerId; players: LobbyPlayer[]; night: number }
  | { t: 'refused'; reason: 'full' | 'in-progress' }
  | { t: 'lobby'; players: LobbyPlayer[]; night: number }
  | { t: 'start'; seed: number; night: number; quota: number }
  | { t: 'snapshot'; snap: Snapshot } | { t: 'event'; ev: GameEvent }
  | { t: 'end'; result: 'success' | 'fail'; banked: number; quota: number; nextNight: number };
export function cleanName(raw: unknown): string;   // trimmed, max 16 chars, 'Dreamer' when empty or not a string
// src/net/transport.ts
export type PeerId = string;
export interface HostTransport { onConnect(cb: (p: PeerId) => void): void; onMessage(cb: (p: PeerId, m: unknown) => void): void;
  onDisconnect(cb: (p: PeerId) => void): void; send(p: PeerId, m: HostMsg): void; close(): void }
export interface ClientTransport { onMessage(cb: (m: HostMsg) => void): void; onClose(cb: () => void): void; send(m: ClientMsg): void; close(): void }
// src/net/loopbackTransport.ts
export function createLoopback(opts?: { auto?: boolean }): { host: HostTransport; connect(): ClientTransport; deliver(): void };
// auto: true delivers on a microtask; otherwise messages wait for deliver(). Messages are JSON round-tripped.
// src/net/host.ts
export class GameHost {
  constructor(opts?: { pickSeed?: () => number });
  attach(t: HostTransport): void;          // may be called for several transports
  readonly state: 'lobby' | 'night'; readonly night: number; readonly world: World | null;
  tick(elapsedSeconds: number): void;      // runs whole steps, at most CONFIG.maxStepsPerTick, drops the rest
  close(): void;
}
// src/net/ticker.ts
export function startTicker(hz: number, cb: (elapsedSeconds: number) => void): () => void; // Worker-based interval; setInterval fallback
```
- `startRequest` and `refused` are additions to the spec's message table. Player 0 (the first to say hello, always the host's own player) is the only one whose `startRequest` is honoured.

- [ ] **Step 1: Write the failing tests** (helper `join(lb, name)` connects, sends `hello`, collects received messages)

```ts
test('hello gets welcome with the lowest free id, and everyone gets lobby', () => {});
test('a fifth player is refused as full', () => { /* 4 join, 5th receives { t: 'refused', reason: 'full' } and is not in lobby */ });
test('names are cleaned', () => { expect(cleanName('  ' + 'x'.repeat(500))).toHaveLength(16); expect(cleanName('')).toBe('Dreamer'); expect(cleanName(42)).toBe('Dreamer'); });
test('only player 0 can start; start carries seed, night 1 and quota 150', () => {});
test('joining during a night is refused as in-progress', () => {});
test('inputs move the player and snapshots arrive every 2 steps with acks', () => {
  /* p1 sends 30 forward inputs, host.tick(1): p1 moved ~3 m in the latest snapshot, snap.ack[1] === 30, 15 snapshots sent */
});
test('junk never throws and is ignored', () => {
  /* send undefined, 'x', { t: 'nope' }, { t: 'input' }, { t: 'input', cmd: { moveX: NaN } }, input before hello: host.tick still runs, world unchanged */
});
test('a long stall advances at most 10 steps', () => { const t0 = host.world!.tick; host.tick(5); expect(host.world!.tick - t0).toBe(10); });
test('a client that disconnects in the lobby leaves the player list', () => {});
test('a client that disconnects mid-night is removed from the world and the night continues', () => {});
test('when the last player disconnects mid-night the host returns to the lobby at night 1', () => {});
test('the first snapshot of a night carries every memory; later ones only changed memories', () => {});
```

- [ ] **Step 2: Run** `npx vitest run tests/net` — expected FAIL.
- [ ] **Step 3: Implement.** The host keeps, per peer, its player id and the latest sanitized input; an input is reused each step until replaced, with edge flags (`interact`, `drop`, `throwIt`, `flashlight`) applied once. After each step it forwards `world.events` as `event` messages, and when `world.round.result` is set it sends `end` (`nextNight` = night + 1 on success, 1 on fail) and returns to `lobby`.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: host, protocol and loopback transport`

### Task 7: Client with prediction and interpolation

**Files:**
- Create: `src/net/client.ts`
- Test: `tests/net/client.test.ts`

**Interfaces:**
- Consumes: `ClientTransport`, `HostMsg`, `movePlayer`, `generateDream`, `ViewState`
- Produces:

```ts
export type ClientStatus = 'connecting' | 'lobby' | 'night' | 'refused' | 'closed';
export class GameClient {
  constructor(t: ClientTransport, name: string);
  readonly status: ClientStatus; readonly refusedReason: 'full' | 'in-progress' | null;
  readonly playerId: PlayerId | null; readonly lobby: LobbyPlayer[]; readonly night: number;
  readonly map: DreamMap | null; readonly lastEnd: Extract<HostMsg, { t: 'end' }> | null;
  onEvent: (ev: GameEvent) => void; onChange: () => void;   // status, lobby, start or end changed
  requestStart(): void;
  sendInput(cmd: Omit<InputCmd, 'seq'>): void;   // call once per 1/30 s step: numbers it, sends it, predicts locally
  view(nowMs: number): ViewState | null;         // local player predicted; others and entities interpolated at nowMs - 100
  onSnapshotTime: () => number;                  // clock used to stamp arriving snapshots; defaults to performance.now via injection in main
  close(): void;
}
```

- [ ] **Step 1: Write the failing tests** (loopback without `auto`, manual clock)

```ts
test('the local player moves immediately, before any snapshot returns', () => {});
test('prediction matches the host after reconciliation', () => {
  /* 60 forward inputs with deliver() + host.tick(DT) interleaved 5 steps late: final view pos within 0.01 m of host.world player pos */
});
test('a host correction snaps the prediction', () => { /* host teleports the player; after the next snapshot the view is within 0.01 m of the host pos plus replayed inputs */ });
test('other players are drawn 100 ms in the past, blended between snapshots', () => {
  /* snapshots at t=0 (x=0) and t=66 (x=1) stamped by the manual clock: view(116).players[other].pos.x ≈ 0.24; view(1000) holds the last value */
});
test('memories accumulate from partial snapshot lists', () => {});
test('refused and closed transports set status', () => {});
test('both sides build the same map from start', () => { expect(client.map).toEqual(host.world!.map); });
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** Keep unacknowledged inputs; on each snapshot set the local player from the snapshot, then replay inputs with `seq > snap.ack[playerId]` through `movePlayer` with the carried weight from the snapshot. Keep the last 1 s of snapshots for interpolation; yaw interpolates along the shortest arc.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: client prediction and interpolation`

### Task 8: PeerJS transport, room codes, menu and lobby

**Files:**
- Create: `src/net/roomCode.ts`, `src/net/peerTransport.ts`, `src/view/ui/menu.ts`, `src/view/ui/lobby.ts`, `src/view/ui/messages.ts`, `src/view/ui/ui.css`, `e2e/multiplayer.spec.ts`, `e2e/signal-server.ts`
- Modify: `src/main.ts`, `playwright.config.ts`
- Test: `tests/net/roomCode.test.ts`

**Interfaces:**
- Consumes: `GameHost`, `GameClient`, `createLoopback`, `startTicker`, `Renderer`, `Input`
- Produces:

```ts
// src/net/roomCode.ts
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode(rand?: () => number): string;        // 5 characters
export function normalizeCode(input: string): string | null;       // trims, uppercases; null unless 5 alphabet characters
export const PEER_PREFIX = 'uhg-dream-';
// src/net/peerTransport.ts
export type JoinFailure = 'no-room' | 'blocked' | 'signalling';
export class JoinError extends Error { constructor(public reason: JoinFailure) }
export interface SignalOptions { host?: string; port?: number; path?: string; secure?: boolean } // default: PeerJS cloud
export function hostPeer(code: string, signal?: SignalOptions): Promise<HostTransport>;  // rejects JoinError('signalling')
export function joinPeer(code: string, signal?: SignalOptions): Promise<ClientTransport>; // rejects JoinError; 'blocked' after 15 s without an open channel
// src/view/ui/messages.ts
export const MESSAGES = {
  hostLeft: 'The host left — the dream ended',
  noRoom: 'No room with that code',
  full: 'That room is full',
  inProgress: 'A night is in progress — try again when they are back in the lobby',
  blocked: "Couldn't connect — this network may block direct connections",
  signalling: "Couldn't reach the matchmaking server",
} as const;
```
- `main.ts` reads `?signal=host:port` to build `SignalOptions` (used by e2e and self-hosting).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/net/roomCode.test.ts
test('codes are 5 characters from the alphabet', () => { for (let i = 0; i < 500; i++) expect(makeRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/); });
test('normalizeCode', () => {
  expect(normalizeCode('  abcde ')).toBe('ABCDE');
  expect(normalizeCode('ABC')).toBeNull(); expect(normalizeCode('ABCD0')).toBeNull(); expect(normalizeCode('ABCDEF')).toBeNull();
});
```

```ts
// e2e/multiplayer.spec.ts — e2e/signal-server.ts starts `PeerServer({ port: 9000, path: '/' })` as a second webServer
test('a friend joins by code and both see each other move', async ({ browser }) => {
  // page A: goto '/?debug&signal=localhost:9000', fill name, click "Host a room", read the code from [data-testid=room-code]
  // page B: same URL, fill name, type the code in lowercase, click "Join"
  // both lobbies list 2 names; A clicks "Start night"
  // both: __dbg.view().players.length === 2
  // A holds W for 600 ms; on B, player 0's position changes by > 0.8 m
});
test('a wrong code shows the no-room message', async ({ page }) => { /* expect text MESSAGES.noRoom */ });
test('when the host closes, the client sees the host-left message and the menu', async ({ browser }) => {});
```

- [ ] **Step 2: Run** `npm test` and `npm run e2e -- --trace off` — expected FAIL.
- [ ] **Step 3: Implement.** `peerTransport`: map PeerJS error `peer-unavailable` → `no-room`; `network`, `server-error`, `socket-error`, `unavailable-id` → `signalling`; data channels are `reliable: true`, JSON serialisation. Menu: name field, "Host a room", code field + "Join", "Play solo", "Credits" (placeholder until Task 16). Hosting = `GameHost` + loopback (auto) for the host's own `GameClient` + `hostPeer` attached as a second transport + `startTicker(30, …)`. Solo = the same without `hostPeer`; remove the Task 5 direct-world path so every mode goes through `GameClient`. Lobby: room code, player list, "Start night" for player 0 only, "Leave". The input → `sendInput` loop runs at fixed `DT`; rendering uses `client.view(performance.now())`. A signalling failure shows `MESSAGES.signalling` with a Retry button.
- [ ] **Step 4: Run** `npm test` and `npm run e2e -- --trace off` — expected PASS (update `e2e/solo.spec.ts` to click "Play solo" if `?solo` no longer skips the menu; keep `?solo` skipping it).
- [ ] **Step 5: Commit** — `feat: join rooms by code over PeerJS with menu and lobby`

---

## Milestone 3 — Memories, the Door, quota and timer

### Task 9: Memories and noise

**Files:**
- Create: `src/rules/items.ts`, `src/rules/noise.ts`
- Modify: `src/rules/world.ts`, `src/view/renderer.ts` (carried memory shown in front of its carrier)
- Test: `tests/rules/items.test.ts`

**Interfaces:**
- Consumes: `World`, `CONFIG`, `MEMORY_KINDS`, `lineOfSight`
- Produces:
  - `emitNoise(world: World, pos: Vec2, radius: number, source: NoiseSource): void` — appends to `world.noises` and pushes a `noise` event
  - `pruneNoise(world: World): void` — drops noises older than `noiseMemorySeconds`
  - `handleInteract(world: World, p: PlayerState): void`, `dropCarried(world: World, p: PlayerState, silent: boolean): void`, `throwCarried(world: World, p: PlayerState): void`, `stepMemories(world: World, dt: number): void`, `kindOf(m: MemoryState): MemoryKind`, `carriedWeight(world: World, p: PlayerState): WeightClass | null`
- `stepWorld` order from now on: (1) move players, (2) interact / drop / throw in ascending player id, (3) `stepMemories`, (4) footstep and memory noise, `pruneNoise`, (5) entities, (6) round.

- [ ] **Step 1: Write the failing tests**

```ts
test('interact picks up the nearest memory within 2 m and not beyond', () => {});
test('a player carries one memory at a time', () => {});
test('two players grabbing the same memory on one step: the lower id gets it', () => {
  /* both within 2 m, both interact: memory.carrier === 0, players[1].carrying === null */
});
test('a memory behind a wall cannot be picked up', () => {});
test('drop puts it at the player and emits noise 8 (light, medium) or 14 (heavy)', () => {});
test('throw flies 8 m along the view direction in 0.8 s and emits noise 14 on landing', () => {});
test('a throw at a wall stops on the near side, on a floor cell reachable from the Door', () => {
  /* generateDream(9, 1): from 200 random floor positions and yaws, every landing cell is in reachableCells(map) */
});
test('interact within 2.5 m of the Door banks the carried memory', () => {
  /* round.banked += value, memory.state 'banked', player carrying null, event { type: 'banked', player, value } */
});
test('walking emits noise 4 every 0.5 s, sprinting 12, crouching 1, standing still none', () => {});
test('a noisy memory emits noise 10 every 0.5 s on the ground and while carried, never once banked', () => {});
test('noises older than 1 s are pruned', () => {});
test('removePlayer drops the carried memory at their position', () => {});
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** Interact priority: leave hiding spot (Task 11) → Door (bank if carrying; leave if open, Task 10) → pick up nearest memory in reach with line of sight → hide (Task 11). A thrown memory moves at `throwSpeed`; it stops before a closed edge with 0.3 m clearance. Carried memories follow the carrier's position.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: memories, banking and noise`

### Task 10: Round flow and night progression

**Files:**
- Create: `src/rules/round.ts`
- Modify: `src/rules/world.ts`, `src/rules/items.ts` (leave through the Door), `src/net/host.ts`
- Test: `tests/rules/round.test.ts`, `tests/net/nights.test.ts`

**Interfaces:**
- Produces: `stepRound(world: World, dt: number): void`; `catchPlayer(world: World, p: PlayerState, by: EntityTypeId | 'collapse'): void` (drops what they carry, status `caught`, pushes `caught` event)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/rules/round.test.ts
test('the timer counts down from 480 s', () => {});
test('phase 2 starts at 240 s left and emits phase2 once', () => {});
test('the Door opens when banked reaches the quota and emits doorOpen once', () => {});
test('interact at a closed Door without a memory does nothing', () => {});
test('interact at the open Door without a memory leaves: status left, event left', () => {});
test('success when every uncaught player has left', () => { /* 2 players: one caught, one leaves → result success */ });
test('fail when every player is caught before anyone leaves', () => {});
test('at zero everyone still inside is caught by collapse', () => {});
test('at zero: quota met and someone left → success; quota unmet → fail; quota met but nobody left → fail', () => {});
test('once a result is set the world stops changing', () => {});
test('removing the last active player while another has left ends the night as success', () => {});
test('removing the last active player while the rest are caught ends the night as fail', () => {});
// tests/net/nights.test.ts
test('success sends end with nextNight 2; the next start has quota 250 and 10 rooms', () => {});
test('fail sends end with nextNight 1', () => {});
test('caught players are active again on the next night', () => {});
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** per spec 3.2. `removePlayer` calls the same end-condition check as `stepRound`.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: quota, timer, night results and progression`

---

## Milestone 4 — Entities

### Task 11: Hiding and the entity framework

**Files:**
- Create: `src/rules/entities/index.ts`
- Modify: `src/rules/player.ts`, `src/rules/items.ts`, `src/rules/world.ts`
- Test: `tests/rules/hiding.test.ts`, `tests/rules/entities.test.ts`

**Interfaces:**
- Produces:

```ts
export interface EntityDef { type: EntityTypeId; spawn(id: number, pos: Vec2): EntityState; update(e: EntityState, world: World, dt: number): void }
export const ENTITY_DEFS: Record<EntityTypeId, EntityDef>;        // usher and listener registered in Tasks 12 and 13
export function spawnEntities(world: World): void;                 // called by createWorld
export function stepEntities(world: World, dt: number): void;      // wakes sleepers at phase 2, then calls update for active ones
export function detectable(world: World, e: EntityState): PlayerState[]; // active AND (not hidden OR exposedTo includes e.id)
export function moveAlong(e: EntityState, target: Vec2, speed: number, world: World, dt: number): boolean; // pathfinds, sets yaw, true on arrival
export function tryCatch(world: World, e: EntityState, range: number): void; // catches every detectable player within range
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/rules/hiding.test.ts
test('interact within 1.5 m of a hiding spot hides the player and silently drops what they carry', () => {});
test('a hidden player cannot move and makes no footstep noise; interact leaves the spot', () => {});
test('one hiding spot holds one player', () => {});
test('an entity with line of sight at the moment of hiding is recorded in exposedTo', () => {});
test('detectable excludes hidden players unless exposed, and all caught or left players', () => {});
test('exposedTo is cleared on leaving the spot', () => {});
// tests/rules/entities.test.ts
test('nights 1 and 2: one entity is active at the start, the other wakes at phase 2', () => {});
test('night 3: both are active from the start', () => {});
test('the starting entity is decided by the seed, and differs across seeds', () => {});
test('entities spawn on map.entitySpawns', () => {});
test('moveAlong follows doorways and reports arrival', () => {});
test('tryCatch catches within range and not beyond; the caught player drops their memory', () => {});
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** Until Tasks 12 and 13, register defs whose `spawn` returns an inactive-mode `idle` entity and whose `update` does nothing. Adding a later entity is one new file plus one `ENTITY_DEFS` entry.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: hiding spots and entity framework`

### Task 12: The Usher

**Files:**
- Create: `src/rules/entities/usher.ts`
- Modify: `src/rules/entities/index.ts`, `src/view/renderer.ts`
- Test: `tests/rules/usher.test.ts`

**Interfaces:**
- Consumes: `detectable`, `moveAlong`, `tryCatch`, `lineOfSight`
- Produces: `isObserved(world: World, e: EntityState): boolean`; `usherDef: EntityDef`

- [ ] **Step 1: Write the failing tests**

```ts
test('observed when a player faces it within 50° and 30 m with line of sight', () => {});
test('not observed at 51° off the view direction, at 31 m, or behind a wall', () => {});
test('hidden, caught and left players do not observe', () => {});
test('frozen while observed: position unchanged over 5 s', () => {});
test('unobserved it closes on the nearest detectable player at 6 m/s', () => { /* 12 m straight line: 1 s later ~6 m away */ });
test('catches at 1.0 m only while unobserved', () => { /* observed at 0.5 m: no catch; player turns away: caught next step */ });
test('one watcher is enough to hold it while another player works', () => {});
test('with no detectable player it stays put', () => {});
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** Observation uses the horizontal view direction only (yaw). Renderer: a tall, thin, pale figure built from primitives; it never animates.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: the Usher`

### Task 13: The Listener

**Files:**
- Create: `src/rules/entities/listener.ts`
- Modify: `src/rules/entities/index.ts`, `src/view/renderer.ts`
- Test: `tests/rules/listener.test.ts`, `tests/rules/night-sim.test.ts`

**Interfaces:**
- Consumes: `world.noises`, `moveAlong`, `tryCatch`
- Produces: `listenerDef: EntityDef`

- [ ] **Step 1: Write the failing tests**

```ts
test('wanders between rooms at 2 m/s when it hears nothing', () => {});
test('a noise whose radius reaches it sends it there at 4.5 m/s', () => {});
test('a noise whose radius does not reach it is ignored', () => {});
test('of several noises it goes to the largest radius; ties go to the most recent', () => {});
test('a louder new noise replaces the current target', () => {});
test('on arrival it searches 5 s, then wanders', () => {});
test('after searching a noisy memory it ignores that memory for 20 s', () => {});
test('catches any unhidden player within 1.2 m, even a silent one', () => {});
test('does not react to a silent crouching player 3 m away, or to flashlights', () => {});
test('a hidden player next to it is safe', () => {});
// tests/rules/night-sim.test.ts
test('a scripted full night never throws and ends with a result', () => {
  /* generateDream seeds 1..10, 4 bots with seeded random inputs, step until result or 480 s + 1 step: result is not null */
});
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** Renderer: a low, wide, eyeless shape that sways slowly; brighter emissive pulse in `hunt` mode.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** — `feat: the Listener`

---

## Milestone 5 — Lobby, HUD, spectating, sound, Credits, first models

### Task 14: HUD, spectating and results

**Files:**
- Create: `src/view/ui/hud.ts`
- Modify: `src/view/ui/lobby.ts`, `src/view/renderer.ts`, `src/main.ts`, `e2e/multiplayer.spec.ts`
- Test: `tests/view/hud.test.ts`

**Interfaces:**
- Produces: `formatTime(seconds: number): string`; `promptFor(view: ViewState, map: DreamMap): string | null`; `nextSpectateTarget(view: ViewState, current: PlayerId): PlayerId | null`; `class Hud { constructor(root: HTMLElement); update(view: ViewState, map: DreamMap): void; showResult(end): void }`

- [ ] **Step 1: Write the failing tests**

```ts
test('formatTime', () => { expect(formatTime(480)).toBe('8:00'); expect(formatTime(59.2)).toBe('1:00'); expect(formatTime(0)).toBe('0:00'); });
test('promptFor', () => {
  /* near a memory: 'E — take Music box'; carrying near the Door: 'E — bank (+45)'; open Door, empty hands: 'E — leave the dream';
     closed Door, empty hands: 'Door is closed — 60 more needed'; near a hiding spot: 'E — hide'; hidden: 'E — come out'; otherwise null */
});
test('nextSpectateTarget cycles through active players and returns null when none remain', () => {});
```
E2E addition: host and one friend start a night; the HUD shows `0 / 150` and a timer on both pages.

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** HUD: banked / quota, timer (red in phase 2), stamina bar, carried memory name and value, interaction prompt, a brief line per `banked`, `caught`, `left`, `doorOpen` event. A caught or left player's camera follows `nextSpectateTarget`; left click switches; the HUD reads "Spectating <name>". Phase 2 in the renderer: lights flicker and a seeded half of them go out. `end` shows a result panel (success or fail, banked vs quota, next night number) and returns everyone to the lobby.
- [ ] **Step 4: Run** `npm test` and `npm run e2e -- --trace off` — expected PASS.
- [ ] **Step 5: Commit** — `feat: HUD, spectating and night results`

### Task 15: Sound

**Files:**
- Create: `src/view/audio.ts`
- Modify: `src/main.ts`
- Test: `tests/view/audio.test.ts`

**Interfaces:**
- Produces: `gainAt(distance: number, radius: number): number` (1 at 0 m, 0 at and beyond `radius × 1.5`, linear); `class GameAudio { start(): void /* after a user gesture */; setListener(pos: Vec2, yaw: number): void; onEvent(ev: GameEvent, world: ViewState): void; update(view: ViewState): void; setPhase2(on: boolean): void; dispose(): void }`

- [ ] **Step 1: Write the failing test**

```ts
test('gainAt', () => { expect(gainAt(0, 10)).toBe(1); expect(gainAt(15, 10)).toBe(0); expect(gainAt(7.5, 10)).toBeCloseTo(0.5); expect(gainAt(99, 10)).toBe(0); });
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** with Web Audio oscillators and filtered noise, all positioned with `PannerNode`: fluorescent hum ambience (detunes in phase 2), footsteps from `noise` events, a ringing tone for `phone` and a detuned melody for `musicBox`, a low drone that rises as the Listener nears, a single dry click each time the Usher moves, stingers for `caught`, `banked`, `doorOpen`. The context starts on the first click and is skipped silently where Web Audio is unavailable.
- [ ] **Step 4: Run** `npm test` and `npm run e2e -- --trace off` — expected PASS with no page errors.
- [ ] **Step 5: Commit** — `feat: synthesised positional sound`

### Task 16: Credits screen and imported models

**Files:**
- Create: `src/view/credits.ts`, `src/view/assets.ts`, `src/view/ui/credits.ts`, `public/assets/models/*.glb`
- Modify: `src/view/ui/menu.ts`, `src/view/renderer.ts`
- Test: `tests/view/credits.test.ts`, `e2e/credits.spec.ts`

**Interfaces:**
- Produces:

```ts
// src/view/credits.ts
export type Licence = 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-3.0';
export interface Credit { file: string /* path under public/assets */; title: string; author: string; source: string /* https URL */; licence: Licence; changes: string }
export const CREDITS: Credit[];
export const BUILT_WITH: { name: string; licence: string; url: string }[]; // three.js, PeerJS
// src/view/assets.ts
export type ModelSlot = 'usher' | 'listener' | 'locker' | `memory:${string}`;
export const MODEL_FILES: Partial<Record<ModelSlot, string>>;
export function loadModel(slot: ModelSlot): Promise<THREE.Object3D | null>; // null when no file is mapped or loading fails
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/view/credits.test.ts — lists files under public/assets recursively (empty list when the folder is missing)
test('every asset file has exactly one credits entry', () => {});
test('every credits entry points at a file that exists', () => {});
test('every entry has an author, an https source and an allowed licence', () => {});
test('every MODEL_FILES value has a credits entry', () => {});
```
```ts
// e2e/credits.spec.ts
test('the main menu opens Credits, which lists every entry and Built with', async ({ page }) => {});
test('a missing model file falls back to the generated shape without errors', async ({ page }) => { /* route **/*.glb to 404; solo night renders, no page errors */ });
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** the Credits screen (title, author, licence, link, changes for every entry, then Built with) and `loadModel` with `GLTFLoader`. The renderer shows the generated shape at once and swaps in the model when it resolves.
- [ ] **Step 4: Add models.** For each slot, look for a fitting CC0 or CC-BY model on free asset sites (Kenney, Quaternius, Poly Pizza, OpenGameArt). Read the licence on the asset's own page before downloading; skip anything non-commercial, no-derivatives, or with no licence stated. Save as `public/assets/models/<slot>.glb`, add the `CREDITS` entry and the `MODEL_FILES` mapping in the same commit. If a site is blocked by this environment's network policy, leave that slot on its generated shape and report which sites were unreachable; the game is complete either way.
- [ ] **Step 5: Run** `npm test` and `npm run e2e -- --trace off` — expected PASS.
- [ ] **Step 6: Commit** — `feat: credits screen and free-licensed models`

---

## Milestone 6 — Shareable build

### Task 17: Static build and itch.io package

**Files:**
- Create: `scripts/package.mjs`, `e2e/build.spec.ts`, `e2e/static-server.ts`
- Modify: `package.json`, `README.md`

**Interfaces:**
- Produces: `npm run package` → `release/untitled-horror-game.zip` with `index.html` at the zip root

- [ ] **Step 1: Write the failing test**

```ts
// e2e/build.spec.ts — e2e/static-server.ts serves the dist/ folder at http://localhost:4174/nested/ (as itch.io serves games from a sub-path)
test('the built game runs from a sub-path and a solo night starts', async ({ page }) => { /* no 404 responses, no page errors, __dbg.view().players.length === 1 */ });
```

- [ ] **Step 2: Run** `npm run build && npm run e2e -- --trace off` — expected FAIL: no static server yet.
- [ ] **Step 3: Implement** `scripts/package.mjs` (build, then zip the contents of `dist/` using the `bestzip` dev dependency) and the `package` script. README: what the game is, controls, how to run (`npm install`, `npm run dev`), how to host a room and share the code, how to upload the zip to itch.io as an HTML5 game ("This file will be played in the browser"), the note that strict school or work networks may block joining, and credits pointing to the in-game screen.
- [ ] **Step 4: Run** `npm test`, `npm run e2e -- --trace off`, `npm run package`, then `unzip -l release/untitled-horror-game.zip` — expected: all pass, `index.html` at the root.
- [ ] **Step 5: Commit** — `feat: itch.io package and README`
