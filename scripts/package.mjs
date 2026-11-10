// Builds the game and zips it for itch.io: release/untitled-horror-game.zip, with index.html at the top level.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('release/untitled-horror-game.zip');
execSync('npm run build', { stdio: 'inherit' });
mkdirSync(resolve('release'), { recursive: true });
if (existsSync(out)) rmSync(out);
// Run from inside dist/ so the zip holds its contents, not the folder itself.
execSync(`npx bestzip "${out}" *`, { cwd: resolve('dist'), stdio: 'inherit' });
console.log(`\nReady to upload: ${out}`);
