/**
 * Browser-level onboarding coverage.
 *
 * These specs exist for what only a rendered page can prove: that focus lands
 * somewhere useful, that results are announced rather than only coloured, that
 * private content stays out of browser storage, and that nothing overflows
 * horizontally at 390 px and 360 px. The protocol itself is covered far more
 * thoroughly by the Node suites, and duplicating that here would be slow
 * without being more convincing.
 *
 * Deliberately one connection per project rather than one per assertion. Each
 * connect opens a proxy WebSocket, and the proxy caps them per IP; five specs
 * reconnecting from loopback contend with each other and fail for reasons that
 * have nothing to do with the product.
 *
 * Every value typed below is invented.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { expect, test } from '@playwright/test';

let mud: ChildProcess;
let mudPort: number;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

test.beforeAll(async () => {
  mudPort = await freePort();
  mud = spawn(process.execPath, ['scripts/synthetic-onboarding-mud.mjs', String(mudPort)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('synthetic MUD did not start')), 15_000);
    mud.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    mud.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`synthetic MUD exited with ${code}`));
    });
  });
});

test.afterAll(() => {
  mud?.kill();
});

/*
 * Let the proxy release this project's WebSocket lease before the next
 * viewport project connects from the same loopback address. The server frees
 * the lease when the socket actually closes, which lags page teardown, and
 * without this pause the next project can mount before the app has settled.
 */
test.afterEach(async ({ page }) => {
  await page.goto('about:blank').catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1_000));
});

test('the structured onboarding shell is usable and private', async ({ page }, testInfo) => {
  const runtimeProblems: string[] = [];
  const reducedData = testInfo.project.name === 'mobile-360';
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      runtimeProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    runtimeProblems.push(`pageerror: ${error.message}`);
  });

  // Persisted settings from another run must not decide this run's destination.
  await page.addInitScript(
    ({ useReducedData }) => {
      localStorage.clear();
      sessionStorage.clear();
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: useReducedData },
      });
    },
    { useReducedData: reducedData },
  );
  await page.goto('/');
  await expect(page).toHaveTitle('Luminari Web');
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);

  /*
   * The structured shell replaces the entire app surface, header included, so
   * a page that mounts into a live session has no connect form at all.
   * Returning to the classic terminal is a real affordance and restores it.
   */
  const returnToTerminal = page.getByRole('button', { name: 'Use the classic terminal' });
  if (await returnToTerminal.isVisible().catch(() => false)) {
    await returnToTerminal.click();
  }

  /*
   * Located by class rather than the banner role: the header is nested, so it
   * does not reliably expose role=banner.
   */
  const header = page.locator('.topbar');
  const showHeader = page.getByRole('button', { name: 'Show Header' });

  /*
   * Bounded retry rather than a single long wait.
   *
   * The app can mount straight into the structured shell when a session from a
   * previous project is still draining at the proxy, and that surface has no
   * connect form to wait for — waiting longer never resolves it, but reloading
   * does. Three attempts is comfortably more than the one it has ever needed.
   */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await showHeader.isVisible().catch(() => false)) {
      await showHeader.click();
    }
    if (await header.isVisible().catch(() => false)) {
      break;
    }
    if (await returnToTerminal.isVisible().catch(() => false)) {
      await returnToTerminal.click();
      continue;
    }
    await page.reload();
  }
  await expect(header).toBeVisible({ timeout: 30_000 });

  // Scoped to the header form: a second "Connect" exists as the mobile
  // reconnect control, and an unscoped lookup is ambiguous at narrow widths.
  const connectButton = header.getByRole('button', { name: 'Connect' });
  await expect(connectButton).toBeEnabled({ timeout: 30_000 });
  await header.getByLabel('Host', { exact: true }).fill('127.0.0.1');
  await header.getByLabel('Port', { exact: true }).fill(String(mudPort));
  await connectButton.click();

  // --- the structured shell replaces the terminal surface -------------------

  const shell = page.locator('.app-shell--onboarding');
  await expect(shell).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/welcome to luminari/i);

  // Invariant 10: the classic terminal is reachable from every structured state.
  const classicTerminal = page.getByRole('button', { name: 'Use the classic terminal' });
  await expect(classicTerminal).toBeVisible();

  // --- accessibility --------------------------------------------------------

  /*
   * Focus moves into each new screen so a keyboard or screen-reader user lands
   * at the start of the new content. Which element receives it is deliberately
   * screen-dependent: a text-entry screen focuses its input, because focusing
   * the heading there would make the player tab forward before typing.
   * Everything else focuses the heading. Being left on <body> is the failure.
   */
  const focused = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? 'NONE',
    className: String(document.activeElement?.className ?? ''),
  }));
  expect(focused.tag).not.toBe('BODY');
  expect(focused.className).toMatch(/onboarding__title|onboarding-form__input/);

  // Server errors and durable success are announced, not merely styled.
  expect(await page.locator('[aria-live]').count()).toBeGreaterThan(0);

  // Audio is supplemental: the complete path remains usable with sound
  // explicitly disabled, and the visible control confirms the state.
  const soundToggle = page.getByRole('button', { name: 'Sound on' });
  await soundToggle.click();
  await page.getByRole('checkbox', { name: 'Enable sound' }).uncheck();
  await expect(page.getByRole('button', { name: 'Sound off' })).toBeVisible();

  // --- responsiveness -------------------------------------------------------

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `page overflows horizontally in the ${testInfo.project.name} viewport`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);

  // --- privacy --------------------------------------------------------------

  const stored = await page.evaluate(() => {
    const dump: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) {
        dump.push(`${key}=${localStorage.getItem(key) ?? ''}`);
      }
    }
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key) {
        dump.push(`${key}=${sessionStorage.getItem(key) ?? ''}`);
      }
    }
    return dump.join('\n');
  });

  // Display settings may persist; onboarding state and profile drafts may not.
  expect(stored).not.toMatch(/onboarding-state|roleplay|background-story|profile\//i);

  // --- walk the v2 role-play path -------------------------------------------

  const heading = page.getByRole('heading', { level: 1 });
  const chooseCard = async (label: string, nextTitle: RegExp) => {
    const card = page.locator('.onboarding-card__button').filter({ hasText: label }).first();
    await expect(card).toBeEnabled();
    await card.click();
    await expect(heading).toHaveText(nextTitle);
  };

  await page.getByLabel('Enter account name').fill('Fixtureaccount');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(heading).toHaveText(/account password/i);

  await page.getByLabel('Password').fill('invented-passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(heading).toHaveText(/your characters/i);

  await page.getByRole('button', { name: 'Create a character' }).click();
  await expect(heading).toHaveText(/name your character/i);

  await page.getByLabel('Character name').fill('Fixtureling');
  await page.getByRole('button', { name: 'Claim this name' }).click();
  await expect(heading).toHaveText(/confirm the name/i);
  await page.getByRole('button', { name: 'Keep this name' }).click();
  await expect(heading).toHaveText(/choose an identity/i);

  await chooseCard('Male', /choose your ancestry/i);
  await chooseCard('Human', /choose your path/i);
  await chooseCard('Wizard', /guided or custom build/i);
  await chooseCard('Guided build', /choose an alignment/i);
  await chooseCard('True Neutral', /recommended settings/i);
  await chooseCard('Use recommended settings', /role-play details/i);
  await chooseCard('Fill in role-play details', /role-play profile/i);
  await expect(page.locator('.rp-hub-item')).toHaveCount(14);

  const shortDescriptionItem = page
    .locator('.rp-hub-item')
    .filter({ hasText: 'Short description' });
  const backgroundStoryItem = page.locator('.rp-hub-item').filter({ hasText: 'Background story' });
  const goalsItem = page.locator('.rp-hub-item').filter({ hasText: 'Goals' });
  const ageItem = page.locator('.rp-hub-item').filter({ hasText: 'Age' });

  await expect(shortDescriptionItem.getByRole('button')).toBeEnabled();
  await expect(ageItem.getByRole('button')).toBeEnabled();
  if (reducedData) {
    await expect(shortDescriptionItem.locator('picture')).toHaveCount(0);
    await expect(ageItem.locator('picture')).toHaveCount(0);
    await expect(page.locator('.onboarding-scene picture')).toHaveCount(0);
  } else {
    await expect(shortDescriptionItem.locator('picture img')).toHaveAttribute(
      'src',
      /roleplay\/short-description/,
    );
    await expect(ageItem.locator('picture img')).toHaveAttribute('src', /roleplay\/profile-hub/);
  }

  const assertHubImageContained = async (item: ReturnType<typeof page.locator>, label: string) => {
    const overflow = await item.locator('picture').evaluate((picture) => {
      const image = picture.querySelector('img');
      if (!image) {
        return null;
      }

      const pictureRect = picture.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      return {
        horizontal: Math.max(0, imageRect.right - pictureRect.right),
        vertical: Math.max(0, imageRect.bottom - pictureRect.bottom),
      };
    });
    expect(overflow, `${label} hub art did not render`).not.toBeNull();
    expect(overflow!.horizontal, `${label} hub art overflowed horizontally`).toBeLessThanOrEqual(1);
    expect(overflow!.vertical, `${label} hub art overflowed vertically`).toBeLessThanOrEqual(1);
  };

  if (!reducedData) {
    await assertHubImageContained(shortDescriptionItem, 'Short description');
    await assertHubImageContained(ageItem, 'Age');
  }

  const hubOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    hubOverflow.scrollWidth,
    `role-play hub overflows horizontally in the ${testInfo.project.name} viewport`,
  ).toBeLessThanOrEqual(hubOverflow.clientWidth + 1);

  // Capture only the synthetic Age card: no account, character, or profile
  // content enters the screenshot evidence.
  await ageItem.screenshot({
    path: `/tmp/luminari-roleplay-age-${testInfo.project.name}.png`,
    animations: 'disabled',
  });

  // Exercise both private transfer directions in the rendered app: save a
  // synthetic draft, return to the hub, reopen it, and wait for the verified
  // source download to make the field editable with the exact value.
  const privateFixture = 'An invented browser history, kept only for this synthetic session.';
  await backgroundStoryItem.getByRole('button').click();
  await expect(heading).toHaveText(/background story/i);
  const editor = page.getByLabel('Background story');
  await expect(editor).toBeEditable();
  await editor.fill(privateFixture);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(heading).toHaveText(/role-play profile/i);

  await backgroundStoryItem.getByRole('button').click();
  await expect(heading).toHaveText(/background story/i);
  await expect(editor).toBeEditable();
  await expect(editor).toHaveValue(privateFixture);

  const privateStorage = await page.evaluate(() => {
    const values: string[] = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) {
          values.push(`${key}=${storage.getItem(key) ?? ''}`);
        }
      }
    }
    return values.join('\n');
  });
  expect(privateStorage).not.toContain(privateFixture);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(heading).toHaveText(/role-play profile/i);

  // A source-generated idea is only an in-memory starting point. It carries
  // into the matching empty editor, remains editable, and is never persisted
  // until the player explicitly saves.
  await goalsItem.getByRole('button').click();
  await expect(heading).toHaveText(/^goals$/i);
  await page.getByRole('button', { name: 'Suggest something else' }).click();
  const idea = page.locator('.rp-idea').first();
  await expect(idea).toBeVisible();
  const suggestedText = await idea.locator('.rp-idea-text').textContent();
  await idea.getByRole('button', { name: 'Use this as a starting point' }).click();
  await expect(idea.getByRole('button', { name: 'Starting point selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Write it myself' }).click();
  const goalsEditor = page.getByLabel('Goals');
  await expect(goalsEditor).toBeEditable();
  await expect(goalsEditor).toHaveValue(suggestedText ?? '');
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toMatch(/discard/i);
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(heading).toHaveText(/role-play profile/i);

  await shortDescriptionItem.getByRole('button').click();
  await expect(heading).toHaveText(/describe yourself/i);
  await page.getByRole('button', { name: 'Back to profile' }).click();
  await expect(heading).toHaveText(/role-play profile/i);

  expect(runtimeProblems, `browser console problems in ${testInfo.project.name}`).toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);

  // --- the terminal fallback actually works ---------------------------------

  await classicTerminal.click();
  await expect(shell).toBeHidden();
});
