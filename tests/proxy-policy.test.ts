import assert from 'node:assert/strict';
import test from 'node:test';
import type { MudPreset } from '../shared/app-settings.ts';
import {
  checkWebSocketOrigin,
  createProxyPolicy,
  destinationKey,
  validateProxyDestination,
} from '../server/proxy-policy.ts';
import type { DnsLookup } from '../server/proxy-policy.ts';

const TEST_PRESETS: MudPreset[] = [
  {
    id: 'krynn',
    name: 'Chronicles of Krynn',
    host: 'krynn.d20mud.com',
    port: 4300,
  },
];

test('public policy accepts curated presets and server-only allowlist additions', async () => {
  const lookups: string[] = [];
  const policy = createTestPolicy({
    env: {
      PROXY_ALLOWED_DESTINATIONS: 'extra.example.test:4200',
    },
    dnsLookup: async (hostname) => {
      lookups.push(hostname);
      return [{ address: '93.184.216.34', family: 4 }];
    },
  });

  const presetDecision = await validateProxyDestination(policy, {
    host: 'KRYNN.D20MUD.COM.',
    port: 4300,
  });
  assert.equal(presetDecision.allowed, true);
  assert.deepEqual(presetDecision.allowed ? presetDecision.value : null, {
    host: 'krynn.d20mud.com',
    port: 4300,
    source: 'allowlist',
  });

  const extraDecision = await validateProxyDestination(policy, {
    host: 'extra.example.test',
    port: 4200,
  });
  assert.equal(extraDecision.allowed, true);
  assert.equal(policy.allowedDestinations.has(destinationKey('extra.example.test', 4200)), true);
  assert.deepEqual(lookups, ['krynn.d20mud.com', 'extra.example.test']);
});

test('public policy rejects arbitrary destinations before DNS lookup', async () => {
  const policy = createTestPolicy({
    dnsLookup: async () => {
      throw new Error('DNS should not be called for disallowed destinations.');
    },
  });

  const decision = await validateProxyDestination(policy, {
    host: 'not-allowed.example.test',
    port: 4000,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed ? null : decision.code, 'disallowed-destination');
  assert.equal(decision.allowed ? null : decision.detail, 'This MUD destination is not allowed.');
});

test('explicit custom routing allows public-routable hostnames but still blocks banned ports', async () => {
  const policy = createTestPolicy({
    env: {
      PROXY_ALLOW_CUSTOM_DESTINATIONS: 'true',
    },
  });

  const allowedDecision = await validateProxyDestination(policy, {
    host: 'custom.example.test',
    port: 4000,
  });
  assert.equal(allowedDecision.allowed, true);
  assert.deepEqual(allowedDecision.allowed ? allowedDecision.value : null, {
    host: 'custom.example.test',
    port: 4000,
    source: 'custom',
  });

  const bannedPortDecision = await validateProxyDestination(policy, {
    host: 'custom.example.test',
    port: 22,
  });
  assert.equal(bannedPortDecision.allowed, false);
  assert.equal(bannedPortDecision.allowed ? null : bannedPortDecision.code, 'banned-port');
});

test('public mode blocks direct IP literals unless explicitly allowlisted', async () => {
  const customPolicy = createTestPolicy({
    env: {
      PROXY_ALLOW_CUSTOM_DESTINATIONS: 'true',
    },
  });

  const customDirectIpDecision = await validateProxyDestination(customPolicy, {
    host: '93.184.216.34',
    port: 4000,
  });
  assert.equal(customDirectIpDecision.allowed, false);
  assert.equal(
    customDirectIpDecision.allowed ? null : customDirectIpDecision.code,
    'public-ip-literal',
  );

  const allowlistedPolicy = createTestPolicy({
    env: {
      PROXY_ALLOWED_DESTINATIONS: '93.184.216.34:4000',
    },
  });
  const allowlistedDecision = await validateProxyDestination(allowlistedPolicy, {
    host: '93.184.216.34',
    port: 4000,
  });
  assert.equal(allowlistedDecision.allowed, true);

  const privatePolicy = createTestPolicy({
    env: {
      PROXY_PUBLIC_MODE: 'false',
    },
  });
  const unsafePrivateDecision = await validateProxyDestination(privatePolicy, {
    host: '10.0.0.5',
    port: 4000,
  });
  assert.equal(unsafePrivateDecision.allowed, false);
  assert.equal(unsafePrivateDecision.allowed ? null : unsafePrivateDecision.code, 'unsafe-network');
});

test('origin policy allows configured and local origins while rejecting unexpected origins', () => {
  const policy = createTestPolicy({
    env: {
      PROXY_ALLOWED_ORIGINS: 'https://play.example.com',
    },
    localOriginPorts: [5190],
  });

  assert.equal(checkWebSocketOrigin(policy, 'http://localhost:5190').allowed, true);
  assert.equal(checkWebSocketOrigin(policy, 'https://play.example.com').allowed, true);

  const missingDecision = checkWebSocketOrigin(policy, undefined);
  assert.equal(missingDecision.allowed, false);
  assert.equal(missingDecision.allowed ? null : missingDecision.code, 'missing-origin');

  const unexpectedDecision = checkWebSocketOrigin(policy, 'https://evil.example.com');
  assert.equal(unexpectedDecision.allowed, false);
  assert.equal(unexpectedDecision.allowed ? null : unexpectedDecision.code, 'invalid-origin');

  const privatePolicy = createTestPolicy({
    env: {
      PROXY_PUBLIC_MODE: 'false',
    },
  });
  assert.equal(checkWebSocketOrigin(privatePolicy, undefined).allowed, true);
});

test('DNS failures and unsafe resolved addresses return sanitized rejection details', async () => {
  const dnsFailurePolicy = createTestPolicy({
    env: {
      PROXY_ALLOW_CUSTOM_DESTINATIONS: 'true',
      PROXY_DNS_RETRY_COUNT: '0',
    },
    dnsLookup: async () => {
      throw new Error('secret.internal resolver failure');
    },
  });

  const dnsFailureDecision = await validateProxyDestination(dnsFailurePolicy, {
    host: 'custom.example.test',
    port: 4000,
  });
  assert.equal(dnsFailureDecision.allowed, false);
  assert.equal(dnsFailureDecision.allowed ? null : dnsFailureDecision.code, 'dns-failed');
  assert.equal(
    dnsFailureDecision.allowed ? '' : dnsFailureDecision.detail.includes('secret'),
    false,
  );
  assert.equal(
    dnsFailureDecision.allowed ? '' : dnsFailureDecision.detail.includes('resolver'),
    false,
  );

  const unsafeDnsPolicy = createTestPolicy({
    env: {
      PROXY_ALLOW_CUSTOM_DESTINATIONS: 'true',
    },
    dnsLookup: async () => [{ address: '10.0.0.10', family: 4 }],
  });
  const unsafeDnsDecision = await validateProxyDestination(unsafeDnsPolicy, {
    host: 'custom.example.test',
    port: 4000,
  });
  assert.equal(unsafeDnsDecision.allowed, false);
  assert.equal(unsafeDnsDecision.allowed ? null : unsafeDnsDecision.code, 'unsafe-network');
});

test('environment parsing fails closed or clamps malformed settings', () => {
  const policy = createTestPolicy({
    env: {
      PROXY_ALLOWED_DESTINATIONS: 'bad-entry, safe.example.test:4000, unsafe.example.test:22',
      PROXY_ALLOWED_ORIGINS: 'not a url, https://play.example.com/path',
      PROXY_ALLOW_CUSTOM_DESTINATIONS: 'maybe',
      PROXY_CONNECT_TIMEOUT_MS: '10',
      PROXY_DNS_RETRY_COUNT: '9',
      PROXY_DNS_TIMEOUT_MS: 'not-a-number',
      PROXY_IDLE_TIMEOUT_MS: '999999999',
    },
  });

  assert.equal(policy.allowCustomDestinations, false);
  assert.equal(policy.allowedDestinations.has(destinationKey('safe.example.test', 4000)), true);
  assert.equal(policy.allowedDestinations.has(destinationKey('unsafe.example.test', 22)), false);
  assert.equal(policy.allowedOrigins.has('https://play.example.com'), false);
  assert.equal(policy.timeouts.connectTimeoutMs, 1000);
  assert.equal(policy.timeouts.dnsRetries, 2);
  assert.equal(policy.timeouts.dnsTimeoutMs, 3000);
  assert.equal(policy.timeouts.idleTimeoutMs, 3600000);
  assert.ok(policy.configurationWarnings.length >= 5);
});

test('local MUD destinations stay blocked unless development explicitly opts in', async () => {
  const defaultPolicy = createTestPolicy({
    env: { PROXY_PUBLIC_MODE: 'false' },
  });
  assert.equal(defaultPolicy.allowLocalDestinations, false);

  const blocked = await validateProxyDestination(defaultPolicy, { host: '127.0.0.1', port: 4100 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed ? null : blocked.code, 'unsafe-network');
});

test('the development opt-in permits loopback and private MUD hosts', async () => {
  const policy = createTestPolicy({
    env: { PROXY_PUBLIC_MODE: 'false', PROXY_ALLOW_LOCAL_DESTINATIONS: 'true' },
  });

  assert.equal(policy.allowLocalDestinations, true);
  assert.ok(
    policy.configurationWarnings.some((warning) => warning.includes('developer machine only')),
    'enabling the opt-in must warn',
  );

  for (const host of ['127.0.0.1', '10.0.0.10', '192.168.1.20', '::1']) {
    const decision = await validateProxyDestination(policy, { host, port: 4100 });
    assert.equal(decision.allowed, true, `${host} should be reachable in development`);
  }
});

test('the development opt-in never unblocks metadata, link-local, or reserved ranges', async () => {
  const policy = createTestPolicy({
    env: { PROXY_PUBLIC_MODE: 'false', PROXY_ALLOW_LOCAL_DESTINATIONS: 'true' },
  });

  // Cloud metadata services are the reason this guard exists.
  for (const host of ['169.254.169.254', '169.254.170.2', '224.0.0.1', '0.0.0.0', '240.0.0.1']) {
    const decision = await validateProxyDestination(policy, { host, port: 4100 });
    assert.equal(decision.allowed, false, `${host} must stay blocked`);
  }

  // A hostname that resolves into a link-local address is blocked too.
  const dnsPolicy = createTestPolicy({
    env: { PROXY_PUBLIC_MODE: 'false', PROXY_ALLOW_LOCAL_DESTINATIONS: 'true' },
    dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
  });
  const dnsDecision = await validateProxyDestination(dnsPolicy, {
    host: 'rebind.example.test',
    port: 4100,
  });
  assert.equal(dnsDecision.allowed, false);
  assert.equal(dnsDecision.allowed ? null : dnsDecision.code, 'unsafe-network');
});

test('the development opt-in is refused in public mode', async () => {
  const policy = createTestPolicy({
    env: { PROXY_PUBLIC_MODE: 'true', PROXY_ALLOW_LOCAL_DESTINATIONS: 'true' },
  });

  assert.equal(policy.allowLocalDestinations, false);
  assert.ok(
    policy.configurationWarnings.some((warning) => warning.includes('ignored in public mode')),
    'a public deployment must be told the opt-in was refused',
  );

  const decision = await validateProxyDestination(policy, { host: '127.0.0.1', port: 4100 });
  assert.equal(decision.allowed, false);
});

function createTestPolicy(
  options: {
    dnsLookup?: DnsLookup;
    env?: NodeJS.ProcessEnv;
    localOriginPorts?: readonly number[];
  } = {},
) {
  return createProxyPolicy({
    dnsLookup: options.dnsLookup ?? publicDnsLookup,
    env: options.env,
    localOriginPorts: options.localOriginPorts,
    presets: TEST_PRESETS,
  });
}

const publicDnsLookup: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
