import { expect, test } from '@playwright/test';

// The built game is served from a sub-folder, the way itch.io serves uploaded games.
const BUILT = 'http://127.0.0.1:4174/nested/';

test('the built game runs from a sub-path and a solo night starts', async ({ page }) => {
  const pageErrors: string[] = [];
  const missing: string[] = [];
  const models: string[] = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('response', r => {
    if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
    if (r.url().endsWith('.glb') && r.status() === 200) models.push(r.url());
  });
  await page.goto(`${BUILT}?debug&solo&seed=5`);
  await page.waitForFunction(() => (window as any).__dbg?.view()?.players.length === 1);
  await expect(page.getByTestId('hud-quota')).toHaveText('0 / 150');
  await page.waitForTimeout(1000);
  expect(missing).toEqual([]);
  expect(pageErrors).toEqual([]);
  for (const url of models) expect(url).toContain('/nested/assets/models/');
});

test('the built menu shows Credits', async ({ page }) => {
  await page.goto(BUILT);
  await page.getByTestId('credits').click();
  await expect(page.getByTestId('credit').first()).toBeVisible();
});
