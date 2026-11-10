import { expect, test } from 'vitest';
import { createRng } from '../../src/dream/rng';

test('same seed gives the same sequence', () => {
  const a = createRng(42), b = createRng(42);
  expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
});

test('different seeds differ', () => {
  expect(createRng(1).next()).not.toBe(createRng(2).next());
});

test('next is in [0,1) and int is inclusive', () => {
  const r = createRng(7);
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const n = r.next();
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1);
    seen.add(r.int(1, 3));
  }
  expect([...seen].sort()).toEqual([1, 2, 3]);
});

test('pick returns an item from the list and chance respects 0 and 1', () => {
  const r = createRng(3);
  for (let i = 0; i < 100; i++) {
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
  }
});
