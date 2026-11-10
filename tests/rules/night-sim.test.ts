import { expect, test } from 'vitest';
import { generateDream } from '../../src/dream/generator';
import { cellOf, roomIdAt } from '../../src/dream/grid';
import { createRng } from '../../src/dream/rng';
import type { InputCmd } from '../../src/rules/types';
import { DT, createWorld, stepWorld } from '../../src/rules/world';
import { idle } from './helpers';

test('a scripted full night never throws and ends with a result', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const night = seed % 2 === 0 ? 3 : 1;
    const map = generateDream(seed, night);
    const w = createWorld(map, [0, 1, 2, 3].map(id => ({ id, name: `bot${id}` })), night);
    const rng = createRng(seed * 7919);
    const total = map.memories.reduce((a, m) => a + m.value, 0);
    const held: Record<number, InputCmd> = {};
    const limit = Math.round(480 / DT) + 1;
    let steps = 0;
    while (!w.round.result && steps < limit) {
      const inputs = new Map<number, InputCmd>();
      for (const p of w.players) {
        if (steps % 15 === 0 || !held[p.id]) {
          held[p.id] = { ...idle, moveX: rng.next() * 2 - 1, moveZ: rng.next() * 2 - 1, yaw: rng.next() * 6.283 - 3.14, sprint: rng.chance(0.3), crouch: rng.chance(0.2) };
        }
        inputs.set(p.id, { ...held[p.id]!, seq: steps + 1, interact: rng.chance(0.05), drop: rng.chance(0.01), throwIt: rng.chance(0.01), flashlight: rng.chance(0.01) });
      }
      stepWorld(w, inputs, DT);
      steps++;
      if (steps % 30 === 0) {
        for (const p of w.players) expect(roomIdAt(map, cellOf(p.pos))).toBeGreaterThanOrEqual(0);
        for (const e of w.entities) expect(roomIdAt(map, cellOf(e.pos))).toBeGreaterThanOrEqual(0);
        for (const m of w.memories) expect(roomIdAt(map, cellOf(m.pos))).toBeGreaterThanOrEqual(0);
        expect(w.round.banked).toBeLessThanOrEqual(total);
        expect(w.memories.filter(m => m.state === 'carried').length).toBeLessThanOrEqual(4);
      }
    }
    expect(w.round.result).not.toBeNull();
    expect(w.players.every(p => p.status !== 'active')).toBe(true);
  }
}, 60_000);
