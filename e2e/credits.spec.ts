import { expect, test } from '@playwright/test';
import { distinctColours } from './helpers';

test('the main menu opens Credits, which lists every entry and Built with', async ({ page }) => {
  await page.goto('/?debug');
  await page.getByTestId('credits').click();
  await expect(page.getByTestId('credits-screen')).toBeVisible();
  const expected = await page.evaluate(() => (window as any).__dbg.credits.length);
  await expect(page.getByTestId('credit')).toHaveCount(expected);
  await expect(page.getByTestId('built-with')).toContainText('three.js');
  await expect(page.getByTestId('built-with')).toContainText('PeerJS');
  await page.getByTestId('credits-back').click();
  await expect(page.getByTestId('host')).toBeVisible();
});

test('a missing model file falls back to the generated shape without errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.route('**/*.glb', route => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/?debug&solo&seed=5');
  await page.waitForFunction(() => (window as any).__dbg?.view()?.players.length === 1);
  await page.waitForTimeout(1500);
  expect(await distinctColours(page)).toBeGreaterThan(8);
  expect(await page.evaluate(() => (window as any).__dbg.view().memories.length)).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
