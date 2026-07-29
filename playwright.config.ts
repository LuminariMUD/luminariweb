import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level end-to-end configuration.
 *
 * These specs drive a real browser against a real web listener and a real
 * synthetic MUD over TCP, which is the gap the pure unit suites cannot cover:
 * focus behaviour, live-region announcements, and horizontal overflow at the
 * required widths are only observable in a rendered page.
 *
 * The 390 px and 360 px projects are not decoration. The plan requires the
 * suite to work at both, so they are enforced on every run rather than
 * checked by hand.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/e2e',
  // Onboarding is a sequence of server round trips; parallel specs sharing one
  // listener would interleave unpredictably.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  /*
   * One retry. The three viewport projects share a single listener and connect
   * from the same loopback address, so a project can occasionally start while
   * the previous one's proxy session is still draining and mount before the
   * app has settled. That is a property of the harness, not the product, and a
   * retry resolves it without masking a real failure: a genuine regression
   * fails both attempts.
   */
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    // Traces and videos of an onboarding flow would capture entered text.
    // Nothing here may record private profile content.
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: {
    /*
     * Runs the BUILT server, not the TypeScript source. The source server
     * resolves the client bundle relative to its own directory, so running it
     * from server/ looks for ./client and serves an error page; only
     * dist/server/index.js finds dist/client.
     *
     * The proxy defaults to public mode, which refuses loopback destinations
     * outright — a good default that cannot be overridden by
     * PROXY_ALLOW_LOCAL_DESTINATIONS alone. Reaching the synthetic MUD needs
     * both private mode and the local-destination opt-in, which is exactly the
     * developer-machine configuration and cannot be reached accidentally in a
     * deployment. The connection limit is raised because every spec connects
     * from the same loopback address and leases outlive page teardown briefly.
     */
    command: `npm run build && PORT=${PORT} PROXY_PUBLIC_MODE=0 PROXY_ALLOW_LOCAL_DESTINATIONS=1 WS_CONNECTION_LIMIT_PER_IP=32 node dist/server/index.js`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
