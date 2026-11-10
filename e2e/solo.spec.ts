import { expect, test } from '@playwright/test';
import { distinctColours, moved, playerPos, watchErrors } from './helpers';

test('solo: the dream renders and W moves the player', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?debug&solo&seed=5');
  await page.waitForFunction(() => (window as any).__dbg?.view()?.players.length === 1);
  const before = await playerPos(page, 0);

  await page.locator('#game').click();
  await page.waitForFunction(() => document.pointerLockElement !== null);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  const after = await playerPos(page, 0);
  expect(moved(before, after)).toBeGreaterThan(0.8);

  expect(await distinctColours(page)).toBeGreaterThan(8);

  // Losing pointer lock stops movement.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => document.pointerLockElement === null);
  const held = await playerPos(page, 0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  expect(moved(held, await playerPos(page, 0))).toBeLessThan(0.01);

  expect(errors).toEqual([]);
});
