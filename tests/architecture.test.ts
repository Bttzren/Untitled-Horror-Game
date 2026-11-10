import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

function tsFiles(dir: string): string[] {
  let out: string[] = [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('rules and dream stay free of view, net, input and browser APIs', () => {
  const files = [...tsFiles('src/rules'), ...tsFiles('src/dream')];
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const code = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, f).not.toMatch(/from ['"].*\/(net|view|input)\//);
    expect(code, f).not.toMatch(/\b(window|document|navigator|performance)\b/);
  }
});
