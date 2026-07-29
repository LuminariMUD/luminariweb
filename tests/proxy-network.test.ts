import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyIpAddress,
  isBannedProxyPort,
  normalizeIpLiteral,
} from '../server/proxy-network.ts';
import type { NetworkRisk } from '../server/proxy-network.ts';

test('classifies unsafe IPv4 ranges and metadata targets', () => {
  assertUnsafeAddress('0.0.0.0', 'unspecified');
  assertUnsafeAddress('10.1.2.3', 'private');
  assertUnsafeAddress('172.16.0.1', 'private');
  assertUnsafeAddress('192.168.1.1', 'private');
  assertUnsafeAddress('127.0.0.1', 'loopback');
  assertUnsafeAddress('169.254.1.1', 'link-local');
  assertUnsafeAddress('169.254.169.254', 'metadata-service');
  assertUnsafeAddress('224.0.0.1', 'multicast');
  assertUnsafeAddress('192.0.2.10', 'reserved');
  assertUnsafeAddress('198.51.100.10', 'reserved');
  assertUnsafeAddress('203.0.113.10', 'reserved');
  assertUnsafeAddress('255.255.255.255', 'reserved');
});

test('classifies public IPv4 addresses as safe', () => {
  const classification = classifyIpAddress('93.184.216.34');

  assert.equal(classification.family, 4);
  assert.equal(classification.isPublic, true);
  assert.deepEqual(classification.risks, []);
});

test('classifies unsafe IPv6 ranges and IPv4-mapped addresses', () => {
  assertUnsafeAddress('::', 'unspecified');
  assertUnsafeAddress('::1', 'loopback');
  assertUnsafeAddress('fc00::1', 'private');
  assertUnsafeAddress('fd12:3456:789a::1', 'private');
  assertUnsafeAddress('fe80::1', 'link-local');
  assertUnsafeAddress('ff02::1', 'multicast');
  assertUnsafeAddress('100::1', 'reserved');
  assertUnsafeAddress('2001:db8::1', 'reserved');
  assertUnsafeAddress('::ffff:127.0.0.1', 'loopback');
  assertUnsafeAddress('::ffff:10.0.0.1', 'private');
});

test('classifies public IPv6 and public IPv4-mapped addresses as safe', () => {
  const publicIpv6 = classifyIpAddress('2001:4860:4860::8888');
  assert.equal(publicIpv6.family, 6);
  assert.equal(publicIpv6.isPublic, true);
  assert.equal(publicIpv6.mappedIpv4, null);

  const mappedPublic = classifyIpAddress('::ffff:8.8.8.8');
  assert.equal(mappedPublic.family, 6);
  assert.equal(mappedPublic.isPublic, true);
  assert.equal(mappedPublic.mappedIpv4, '8.8.8.8');
});

test('rejects malformed address literals and scoped IPv6 zone IDs', () => {
  assertUnsafeAddress('example.com', 'invalid-address');
  assertUnsafeAddress('999.1.1.1', 'invalid-address');
  assertUnsafeAddress('fe80::1%lo0', 'invalid-address');
  assert.equal(normalizeIpLiteral('[::1]'), '::1');
  assert.equal(normalizeIpLiteral('[fe80::1%lo0]'), null);
});

test('identifies banned service ports while leaving MUD ports available', () => {
  for (const port of [22, 23, 80, 443, 3306, 6379, 8080, 27017]) {
    assert.equal(isBannedProxyPort(port), true, `port ${port} should be banned`);
  }

  for (const port of [3100, 4000, 4100, 4300, 5500]) {
    assert.equal(isBannedProxyPort(port), false, `port ${port} should be allowed`);
  }
});

function assertUnsafeAddress(address: string, risk: NetworkRisk) {
  const classification = classifyIpAddress(address);
  assert.equal(classification.isPublic, false, `${address} should not be public`);
  assert.equal(classification.risks.includes(risk), true, `${address} should include ${risk}`);
}
