import type { Page } from '@playwright/test';

export interface Pos { x: number; z: number }

/** Collects uncaught page errors and console errors for a page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

export async function playerPos(page: Page, id: number): Promise<Pos> {
  return page.evaluate(i => {
    const p = (window as any).__dbg.view().players.find((q: any) => q.id === i);
    return { x: p.pos.x, z: p.pos.z };
  }, id);
}

export const moved = (a: Pos, b: Pos): number => Math.hypot(a.x - b.x, a.z - b.z);

/** How many clearly different colours a screenshot of the game canvas contains. */
export async function distinctColours(page: Page): Promise<number> {
  const png = await page.locator('#game').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add(((d[i]! >> 4) << 8) | ((d[i + 1]! >> 4) << 4) | (d[i + 2]! >> 4));
    return seen.size;
  }, png.toString('base64'));
}
