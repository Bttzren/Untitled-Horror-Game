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

test('solo: when the dream collapses the result shows in the waiting room, and a new night can start', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?debug&solo&seed=5');
  await page.waitForFunction(() => (window as any).__dbg?.view()?.players.length === 1);
  await expect(page.getByTestId('hud-quota')).toHaveText('0 / 150');
  await page.evaluate(() => { (window as any).__dbg.host.world.round.timeLeft = 0.2; });
  await expect(page.getByTestId('result')).toContainText('The dream kept you');
  await expect(page.getByTestId('result')).toContainText('0 / 150 banked');
  await expect(page.getByTestId('lobby-night')).toHaveText('Night 1');
  await page.getByTestId('start').click();
  await page.waitForFunction(() => (window as any).__dbg?.view()?.round.timeLeft > 470);
  expect(errors).toEqual([]);
});

test('solo: banking the quota opens the Door and leaving wins the night', async ({ page }) => {
  await page.goto('/?debug&solo&seed=5');
  await page.waitForFunction(() => (window as any).__dbg?.view()?.players.length === 1);
  // Put the player at the Door with the quota already banked, then press E for real.
  await page.evaluate(() => {
    const w = (window as any).__dbg.host.world;
    w.round.banked = w.round.quota;
    w.entities.length = 0;
    w.memories.forEach((m: any) => { m.state = 'banked'; });
  });
  await page.locator('#game').click();
  await page.waitForFunction(() => document.pointerLockElement !== null);
  await expect(page.getByTestId('hud-prompt')).toHaveText('E — leave the dream');
  await page.keyboard.press('KeyE');
  await expect(page.getByTestId('result')).toContainText('You woke up');
  await expect(page.getByTestId('lobby-night')).toHaveText('Night 2');
});
