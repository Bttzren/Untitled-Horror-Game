import { expect, test } from 'vitest';
import { generateDream } from '../../src/dream/generator';
import { cellOf, isOpen, roomIdAt } from '../../src/dream/grid';
import { createRng } from '../../src/dream/rng';
import { CONFIG, type WeightClass } from '../../src/rules/config';
import { movePlayer, sanitizeInput } from '../../src/rules/player';
import type { InputCmd, PlayerState } from '../../src/rules/types';
import { DT, createWorld, removePlayer, stepWorld } from '../../src/rules/world';
import { dist } from '../../src/shared/vec';
import type { DreamMap } from '../../src/dream/types';
import { hallMap, twoRoomsMap } from '../fixtures/maps';

const idle: InputCmd = {
  seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, sprint: false, crouch: false,
  interact: false, drop: false, throwIt: false, flashlight: false,
};
const cmd = (over: Partial<InputCmd>): InputCmd => ({ ...idle, ...over });

function player(map: DreamMap, x: number, z: number): PlayerState {
  const p = createWorld(map, [{ id: 0, name: 'a' }], 1).players[0]!;
  p.pos = { x, z };
  return p;
}
function run(p: PlayerState, c: InputCmd, seconds: number, map: DreamMap, carried: WeightClass | null = null): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) movePlayer(p, c, map, carried, DT);
}

test('walks forward at 3 m/s facing -Z', () => {
  const m = hallMap(), p = player(m, 12, 20);
  run(p, cmd({ moveZ: 1 }), 1, m);
  expect(p.pos.z).toBeCloseTo(17, 1);
  expect(p.pos.x).toBeCloseTo(12, 5);
});
test('strafes right along +X at yaw 0', () => {
  const m = hallMap(), p = player(m, 12, 12);
  run(p, cmd({ moveX: 1 }), 0.5, m);
  expect(p.pos.x).toBeCloseTo(13.5, 1);
  expect(p.pos.z).toBeCloseTo(12, 5);
});
test('yaw turns the walking direction: a quarter turn left walks toward -X', () => {
  const m = hallMap(), p = player(m, 12, 12);
  run(p, cmd({ moveZ: 1, yaw: Math.PI / 2 }), 1, m);
  expect(p.pos.x).toBeCloseTo(9, 1);
  expect(p.pos.z).toBeCloseTo(12, 1);
});
test('diagonal input is not faster', () => {
  const m = hallMap(), p = player(m, 12, 12), start = { ...p.pos };
  run(p, cmd({ moveX: 1, moveZ: 1 }), 1, m);
  expect(dist(start, p.pos)).toBeCloseTo(3, 1);
});
test('sprints at 5.5 m/s and drains 5 s of stamina', () => {
  const m = hallMap(), p = player(m, 12, 22);
  run(p, cmd({ moveZ: 1, sprint: true }), 1, m);
  expect(p.pos.z).toBeCloseTo(16.5, 1);
  expect(p.sprinting).toBe(true);
  expect(p.stamina).toBeCloseTo(4, 1);
  p.pos = { x: 12, z: 22 };
  run(p, cmd({ moveZ: 1, sprint: true, yaw: Math.PI }), 4.1, m); // a little over 5 s of sprinting in total
  expect(p.winded).toBe(true);
  expect(p.stamina).toBeLessThan(0.6);
  p.pos = { x: 12, z: 2 }; const from = { ...p.pos };
  run(p, cmd({ moveZ: 1, sprint: true, yaw: Math.PI }), 0.5, m);
  expect(p.sprinting).toBe(false);
  expect(dist(from, p.pos)).toBeCloseTo(1.5, 1); // back to walking pace while winded
});
test('stamina refills fully in 10 s', () => {
  const m = hallMap(), p = player(m, 12, 12);
  p.stamina = 0;
  run(p, idle, 10, m);
  expect(p.stamina).toBeCloseTo(CONFIG.staminaSeconds, 1);
  run(p, idle, 3, m);
  expect(p.stamina).toBeLessThanOrEqual(CONFIG.staminaSeconds);
});
test('standing still with sprint held does not drain stamina', () => {
  const m = hallMap(), p = player(m, 12, 12);
  run(p, cmd({ sprint: true }), 2, m);
  expect(p.stamina).toBe(CONFIG.staminaSeconds);
  expect(p.sprinting).toBe(false);
});
test('crouch moves at 1.5 m/s and blocks sprint', () => {
  const m = hallMap(), p = player(m, 12, 20);
  run(p, cmd({ moveZ: 1, crouch: true, sprint: true }), 1, m);
  expect(p.pos.z).toBeCloseTo(18.5, 1);
  expect(p.crouching).toBe(true);
  expect(p.sprinting).toBe(false);
  expect(p.stamina).toBe(CONFIG.staminaSeconds);
});
test('carry weight scales speed: medium 2.55, heavy 1.95; heavy cannot sprint', () => {
  const m = hallMap();
  const a = player(m, 12, 20); run(a, cmd({ moveZ: 1 }), 1, m, 'medium');
  expect(20 - a.pos.z).toBeCloseTo(2.55, 1);
  const b = player(m, 12, 20); run(b, cmd({ moveZ: 1, sprint: true }), 1, m, 'heavy');
  expect(20 - b.pos.z).toBeCloseTo(1.95, 1);
  expect(b.sprinting).toBe(false);
  const c = player(m, 12, 20); run(c, cmd({ moveZ: 1 }), 1, m, 'light');
  expect(20 - c.pos.z).toBeCloseTo(3, 1);
});
test('walls stop the player with 0.35 m clearance', () => {
  const m = twoRoomsMap(), p = player(m, 6, 2);
  run(p, cmd({ moveZ: -1 }), 3, m); // backwards = +Z, into the wall between (1,0) and the sealed room
  expect(p.pos.z).toBeCloseTo(4 - 0.35, 3);
  run(p, cmd({ moveZ: 1 }), 3, m); // forwards = -Z, into the map edge
  expect(p.pos.z).toBeCloseTo(0.35, 3);
});
test('doorways let the player through', () => {
  const m = twoRoomsMap(), p = player(m, 6, 2);
  run(p, cmd({ moveX: 1 }), 1.5, m);
  expect(cellOf(p.pos)).toEqual({ cx: 2, cz: 0 });
});
test('fuzz: 10000 random inputs never leave the floor or cross a closed edge', () => {
  const m = generateDream(5, 1), rng = createRng(99);
  const p = player(m, m.spawns[0]!.x, m.spawns[0]!.z);
  let c = cmd({});
  const visited = new Set<string>();
  for (let i = 0; i < 10000; i++) {
    if (i % 20 === 0) c = cmd({ moveX: rng.next() * 2 - 1, moveZ: rng.next() * 2 - 1, yaw: rng.next() * 6.28 - 3.14, sprint: rng.chance(0.5) });
    const before = cellOf(p.pos);
    movePlayer(p, c, m, null, DT);
    const after = cellOf(p.pos);
    expect(roomIdAt(m, after)).toBeGreaterThanOrEqual(0);
    const dxc = Math.abs(before.cx - after.cx), dzc = Math.abs(before.cz - after.cz);
    expect(dxc).toBeLessThanOrEqual(1);
    expect(dzc).toBeLessThanOrEqual(1);
    if (dxc + dzc === 1) expect(isOpen(m, before, after)).toBe(true);
    if (dxc + dzc === 2) {
      // A diagonal step is legal only if it could be walked as two open steps.
      const viaX = { cx: after.cx, cz: before.cz }, viaZ = { cx: before.cx, cz: after.cz };
      const ok = (isOpen(m, before, viaX) && isOpen(m, viaX, after)) || (isOpen(m, before, viaZ) && isOpen(m, viaZ, after));
      expect(ok).toBe(true);
    }
    visited.add(`${after.cx},${after.cz}`);
  }
  expect(visited.size).toBeGreaterThan(3);
});
test('hidden players can look but not move; caught and left players do nothing', () => {
  const m = hallMap();
  const h = player(m, 12, 12); h.hiddenIn = 0;
  run(h, cmd({ moveZ: 1, yaw: 1 }), 1, m);
  expect(h.pos).toEqual({ x: 12, z: 12 });
  expect(h.yaw).toBe(1);
  for (const status of ['caught', 'left'] as const) {
    const p = player(m, 12, 12); p.status = status;
    run(p, cmd({ moveZ: 1, yaw: 1 }), 1, m);
    expect(p.pos).toEqual({ x: 12, z: 12 });
    expect(p.yaw).toBe(0);
  }
});
test('sanitizeInput clamps and rejects', () => {
  const ok = { ...idle, seq: 6 };
  expect(sanitizeInput(ok, 5)).toEqual(ok);
  expect(sanitizeInput({ ...ok, moveX: 50 }, 0)!.moveX).toBe(1);
  expect(sanitizeInput({ ...ok, moveZ: -50 }, 0)!.moveZ).toBe(-1);
  expect(sanitizeInput({ ...ok, moveX: NaN }, 0)).toBeNull();
  expect(sanitizeInput({ ...ok, yaw: Infinity }, 0)).toBeNull();
  expect(sanitizeInput({ ...ok, seq: 3 }, 5)).toBeNull();
  expect(sanitizeInput({ ...ok, seq: 5 }, 5)).toBeNull();
  expect(sanitizeInput({ ...ok, seq: 6.5 }, 5)).toBeNull();
  expect(sanitizeInput('nope', 0)).toBeNull();
  expect(sanitizeInput(null, 0)).toBeNull();
  expect(sanitizeInput({ ...ok, pitch: 9 }, 0)!.pitch).toBeCloseTo(Math.PI / 2);
  expect(sanitizeInput({ ...ok, interact: 'yes' }, 0)!.interact).toBe(false);
  expect(Math.abs(sanitizeInput({ ...ok, yaw: 100 }, 0)!.yaw)).toBeLessThanOrEqual(Math.PI);
});
test('createWorld places players on the map spawns with full stamina', () => {
  const m = hallMap();
  const w = createWorld(m, [{ id: 0, name: 'a' }, { id: 2, name: 'c' }], 2);
  expect(w.players.map(p => p.pos)).toEqual([m.spawns[0], m.spawns[2]]);
  for (const p of w.players) { expect(p.stamina).toBe(5); expect(p.status).toBe('active'); expect(p.carrying).toBeNull(); }
  expect(w.round).toMatchObject({ night: 2, quota: 250, banked: 0, timeLeft: 480, phase2: false, doorOpen: false, result: null });
  expect(w.tick).toBe(0);
});
test('stepWorld applies each player input and counts ticks', () => {
  const w = createWorld(hallMap(), [{ id: 0, name: 'a' }, { id: 1, name: 'b' }], 1);
  const z0 = w.players[0]!.pos.z, z1 = w.players[1]!.pos.z;
  for (let i = 0; i < 30; i++) stepWorld(w, new Map([[0, cmd({ moveZ: 1, seq: i + 1 })]]), DT);
  expect(w.tick).toBe(30);
  expect(z0 - w.players[0]!.pos.z).toBeCloseTo(3, 1);
  expect(w.players[1]!.pos.z).toBe(z1);
});
test('the flashlight toggles on the flashlight flag', () => {
  const w = createWorld(hallMap(), [{ id: 0, name: 'a' }], 1);
  const start = w.players[0]!.flashlight;
  stepWorld(w, new Map([[0, cmd({ flashlight: true })]]), DT);
  expect(w.players[0]!.flashlight).toBe(!start);
  stepWorld(w, new Map([[0, cmd({ seq: 2 })]]), DT);
  expect(w.players[0]!.flashlight).toBe(!start);
});
test('removePlayer takes the player out of the world', () => {
  const w = createWorld(hallMap(), [{ id: 0, name: 'a' }, { id: 1, name: 'b' }], 1);
  removePlayer(w, 0);
  expect(w.players.map(p => p.id)).toEqual([1]);
});
