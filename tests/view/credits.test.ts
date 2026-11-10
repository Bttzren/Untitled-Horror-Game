import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import { BUILT_WITH, CREDITS } from '../../src/view/credits';
import { MODEL_FILES } from '../../src/view/modelFiles';

const ROOT = 'public/assets';
const ALLOWED = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0'];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [relative(ROOT, p).split('\\').join('/')];
  });
}

test('every asset file has exactly one credits entry', () => {
  for (const f of files(ROOT)) expect(CREDITS.filter(c => c.file === f), f).toHaveLength(1);
});

test('every credits entry points at a file that exists', () => {
  const present = files(ROOT);
  for (const c of CREDITS) expect(present, c.file).toContain(c.file);
});

test('every entry has a title, an author, an https source and an allowed licence', () => {
  for (const c of CREDITS) {
    expect(c.title.trim().length, c.file).toBeGreaterThan(0);
    expect(c.author.trim().length, c.file).toBeGreaterThan(0);
    expect(c.source, c.file).toMatch(/^https:\/\/\S+$/);
    expect(ALLOWED, c.file).toContain(c.licence);
    expect(c.changes.trim().length, c.file).toBeGreaterThan(0);
  }
});

test('every model the game loads has a credits entry', () => {
  for (const [slot, file] of Object.entries(MODEL_FILES)) {
    expect(CREDITS.some(c => c.file === file), slot).toBe(true);
  }
});

test('built-with lists the libraries the game ships', () => {
  expect(BUILT_WITH.map(b => b.name)).toEqual(expect.arrayContaining(['three.js', 'PeerJS']));
  for (const b of BUILT_WITH) expect(b.url).toMatch(/^https:\/\//);
});
