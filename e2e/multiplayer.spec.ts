import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { moved, playerPos, watchErrors } from './helpers';

const URL = '/?debug&signal=127.0.0.1:9000';

// Every page keeps rendering 3D; leaving them open starves later tests.
const contexts: BrowserContext[] = [];
test.afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

async function open(browser: Browser, url = URL): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(url);
  return { page, errors };
}

async function hostRoom(page: Page, name: string): Promise<string> {
  await page.getByTestId('name').fill(name);
  await page.getByTestId('host').click();
  const code = (await page.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  return code;
}

async function joinRoom(page: Page, name: string, code: string): Promise<void> {
  await page.getByTestId('name').fill(name);
  await page.getByTestId('code').fill(code);
  await page.getByTestId('join').click();
}

test('a friend joins by code and both see each other move', async ({ browser }) => {
  const a = await open(browser), b = await open(browser);
  const code = await hostRoom(a.page, 'Ann');
  await joinRoom(b.page, 'Bo', `  ${code.toLowerCase()} `);
  for (const p of [a.page, b.page]) await expect(p.getByTestId('lobby-players').locator('li')).toHaveText([/Ann/, /Bo/]);
  await expect(b.page.getByTestId('start')).toHaveCount(0); // only the host can start

  await a.page.getByTestId('start').click();
  for (const p of [a.page, b.page]) await p.waitForFunction(() => (window as any).__dbg?.view()?.players.length === 2);
  for (const p of [a.page, b.page]) {
    await expect(p.getByTestId('hud-quota')).toHaveText('0 / 150');
    await expect(p.getByTestId('hud-timer')).toHaveText(/^[78]:\d\d$/);
  }

  const before = await playerPos(b.page, 0);
  await a.page.getByTestId('resume').click();
  await a.page.waitForFunction(() => document.pointerLockElement !== null);
  // Hold W until the friend's screen shows the host has walked (frame rates vary a lot on test machines).
  await a.page.keyboard.down('KeyW');
  await expect.poll(async () => moved(before, await playerPos(b.page, 0)), { timeout: 15_000 }).toBeGreaterThan(0.8);
  await a.page.keyboard.up('KeyW');
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a wrong code shows the no-room message', async ({ browser }) => {
  const { page } = await open(browser);
  await joinRoom(page, 'Cy', 'ZZZZZ');
  // The matchmaking server takes a few seconds to give up on a room that does not exist.
  await expect(page.getByTestId('menu-error')).toHaveText('No room with that code', { timeout: 20_000 });
  await joinRoom(page, 'Cy', 'abc');
  await expect(page.getByTestId('menu-error')).toHaveText('No room with that code');
});

test('when the host leaves, the client sees the host-left message and the menu', async ({ browser }) => {
  const a = await open(browser), b = await open(browser);
  const code = await hostRoom(a.page, 'Ann');
  await joinRoom(b.page, 'Bo', code);
  await expect(b.page.getByTestId('lobby-players').locator('li')).toHaveCount(2);
  await a.page.getByTestId('leave').click();
  await expect(b.page.getByTestId('menu-error')).toHaveText('The host left — the dream ended');
  await expect(b.page.getByTestId('host')).toBeVisible();
});

test('an unreachable matchmaking server shows a message with a retry button', async ({ browser }) => {
  const { page } = await open(browser, '/?debug&signal=127.0.0.1:9'); // nothing listens there
  await page.getByTestId('name').fill('Dee');
  await page.getByTestId('host').click();
  await expect(page.getByTestId('menu-error')).toHaveText("Couldn't reach the matchmaking server", { timeout: 25_000 });
  await expect(page.getByTestId('retry')).toBeVisible();
});

test('a caught player spectates their friend; a late joiner is told to wait; a friend dropping out is announced', async ({ browser }) => {
  const a = await open(browser), b = await open(browser), late = await open(browser);
  const code = await hostRoom(a.page, 'Ann');
  await joinRoom(b.page, 'Bo', code);
  await expect(a.page.getByTestId('lobby-players').locator('li')).toHaveCount(2);
  await a.page.getByTestId('start').click();
  for (const p of [a.page, b.page]) await p.waitForFunction(() => (window as any).__dbg?.view()?.players.length === 2);

  // Someone arriving mid-night is refused with a reason.
  await joinRoom(late.page, 'Cy', code);
  await expect(late.page.getByTestId('menu-error')).toContainText('A night is in progress');

  // Bo is caught (forced from the host's side), and ends up watching Ann.
  await a.page.evaluate(() => {
    const w = (window as any).__dbg.host.world;
    w.entities.length = 0;
    const bo = w.players.find((p: any) => p.id === 1);
    bo.status = 'caught';
    w.events.push({ type: 'caught', player: 1, by: 'usher' });
  });
  await expect(b.page.getByTestId('hud-spectating')).toContainText('Spectating Ann');
  await b.page.waitForFunction(() => (window as any).__dbg.view().cameraId === 0);

  // Bo closes the tab: Ann is told, and her night carries on.
  await b.page.close();
  await expect(a.page.getByTestId('hud-feed')).toContainText('Bo disconnected', { timeout: 30_000 });
  expect(await a.page.evaluate(() => (window as any).__dbg.view().players.length)).toBe(1);
  expect(a.errors).toEqual([]);
});
