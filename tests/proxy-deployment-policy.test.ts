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

const DEPLOYMENT_PRESETS: MudPreset[] = [
  {
    id: 'luminari',
    name: 'LuminariMUD',
    host: 'luminari.example.test',
    port: 4100,
  },
];

test('public deployment defaults reject arbitrary destinations before DNS', async () => {
  let lookupCount = 0;
  const policy = createDeploymentPolicy({
    dnsLookup: async () => {
      lookupCount += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    },
  });

  const decision = await validateProxyDestination(policy, {
    host: 'unlisted.example.test',
    port: 4000,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed ? null : decision.code, 'disallowed-destination');
  assert.equal(decision.allowed ? null : decision.detail, 'This MUD destination is not allowed.');
  assert.equal(lookupCount, 0);
});

test('public deployment accepts curated presets and configured allowlist entries', async () => {
  const lookups: string[] = [];
  const policy = createDeploymentPolicy({
    env: {
      PROXY_ALLOWED_DESTINATIONS: 'extra.example.test:4200',
      PROXY_ALLOWED_ORIGINS: 'https://play.example.com',
    },
    dnsLookup: async (hostname) => {
      lookups.push(hostname);
      return [{ address: '93.184.216.34', family: 4 }];
    },
  });

  const presetDecision = await validateProxyDestination(policy, {
    host: 'LUMINARI.EXAMPLE.TEST.',
    port: 4100,
  });
  assert.equal(presetDecision.allowed, true);
  assert.deepEqual(presetDecision.allowed ? presetDecision.value : null, {
    host: 'luminari.example.test',
    port: 4100,
    source: 'allowlist',
  });

  const extraDecision = await validateProxyDestination(policy, {
    host: 'extra.example.test',
    port: 4200,
  });
  assert.equal(extraDecision.allowed, true);
  assert.equal(policy.allowedDestinations.has(destinationKey('extra.example.test', 4200)), true);
  assert.equal(checkWebSocketOrigin(policy, 'https://play.example.com').allowed, true);
  assert.deepEqual(lookups, ['luminari.example.test', 'extra.example.test']);
});

test('public deployment rejects missing and unexpected WebSocket origins', () => {
  const policy = createDeploymentPolicy({
    env: {
      PROXY_ALLOWED_ORIGINS: 'https://play.example.com',
    },
  });

  const missingDecision = checkWebSocketOrigin(policy, undefined);
  assert.equal(missingDecision.allowed, false);
  assert.equal(missingDecision.allowed ? null : missingDecision.code, 'missing-origin');
  assert.equal(
    missingDecision.allowed ? null : missingDecision.detail,
    'WebSocket origin is not allowed.',
  );

  const unexpectedDecision = checkWebSocketOrigin(policy, 'https://attacker.example.com');
  assert.equal(unexpectedDecision.allowed, false);
  assert.equal(unexpectedDecision.allowed ? null : unexpectedDecision.code, 'invalid-origin');

  const malformedDecision = checkWebSocketOrigin(policy, 'https://play.example.com/path');
  assert.equal(malformedDecision.allowed, false);
  assert.equal(malformedDecision.allowed ? null : malformedDecision.code, 'invalid-origin');
});

test('deployment policy rejects banned service ports before network checks', async () => {
  let lookupCount = 0;
  const policy = createDeploymentPolicy({
    env: {
      PROXY_ALLOW_CUSTOM_DESTINATIONS: 'true',
    },
    dnsLookup: async () => {
      lookupCount += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    },
  });

  const decision = await validateProxyDestination(policy, {
    host: 'custom.example.test',
    port: 22,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed ? null : decision.code, 'banned-port');
  assert.equal(decision.allowed ? null : decision.detail, 'This MUD port is not allowed.');
  assert.equal(lookupCount, 0);
});

test('custom routing keeps unsafe networks and metadata targets blocked', async () => {
  const unsafeDnsPolicy = createDeploymentPolicy({
    env: {
      PROXY_ALLOW_CUSTOM_DESTINATIONS: 'true',
    },
    dnsLookup: async () => [{ address: '10.1.2.3', family: 4 }],
  });

  const unsafeDnsDecision = await validateProxyDestination(unsafeDnsPolicy, {
    host: 'custom.example.test',
    port: 4000,
  });
  assert.equal(unsafeDnsDecision.allowed, false);
  assert.equal(unsafeDnsDecision.allowed ? null : unsafeDnsDecision.code, 'unsafe-network');

  const metadataDecision = await validateProxyDestination(unsafeDnsPolicy, {
    host: 'metadata.google.internal',
    port: 4000,
  });
  assert.equal(metadataDecision.allowed, false);
  assert.equal(metadataDecision.allowed ? null : metadataDecision.code, 'disallowed-destination');

  const privateIpDecision = await validateProxyDestination(unsafeDnsPolicy, {
    host: '192.168.1.25',
    port: 4000,
  });
  assert.equal(privateIpDecision.allowed, false);
  assert.equal(privateIpDecision.allowed ? null : privateIpDecision.code, 'public-ip-literal');
});

test('deployment timeout settings clamp to bounded public values', () => {
  const policy = createDeploymentPolicy({
    env: {
      PROXY_CONNECT_TIMEOUT_MS: '50',
      PROXY_DNS_RETRY_COUNT: '8',
      PROXY_DNS_TIMEOUT_MS: '999999',
      PROXY_IDLE_TIMEOUT_MS: '5',
    },
  });

  assert.equal(policy.timeouts.connectTimeoutMs, 1000);
  assert.equal(policy.timeouts.dnsRetries, 2);
  assert.equal(policy.timeouts.dnsTimeoutMs, 10000);
  assert.equal(policy.timeouts.idleTimeoutMs, 30000);
  assert.deepEqual(policy.configurationWarnings, [
    'PROXY_CONNECT_TIMEOUT_MS value raised to minimum.',
    'PROXY_DNS_RETRY_COUNT value lowered to maximum.',
    'PROXY_DNS_TIMEOUT_MS value lowered to maximum.',
    'PROXY_IDLE_TIMEOUT_MS value raised to minimum.',
  ]);
});

test('deployment policy returns sanitized DNS failure details', async () => {
  const policy = createDeploymentPolicy({
    env: {
      PROXY_ALLOW_CUSTOM_DESTINATIONS: 'true',
      PROXY_DNS_RETRY_COUNT: '0',
    },
    dnsLookup: async () => {
      throw new Error('secret resolver path /internal/dns.conf');
    },
  });

  const decision = await validateProxyDestination(policy, {
    host: 'custom.example.test',
    port: 4000,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed ? null : decision.code, 'dns-failed');
  assert.equal(
    decision.allowed ? null : decision.detail,
    'This MUD destination could not be verified.',
  );
  assert.equal(decision.allowed ? false : decision.detail.includes('secret'), false);
  assert.equal(decision.allowed ? false : decision.detail.includes('/internal'), false);
});

function createDeploymentPolicy(
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
    presets: DEPLOYMENT_PRESETS,
  });
}

const publicDnsLookup: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
