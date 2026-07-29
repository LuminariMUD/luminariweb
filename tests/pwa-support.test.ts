import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNetworkStatusMessage,
  getServiceWorkerCapability,
  getServiceWorkerFetchDecision,
  getServiceWorkerRegistrationErrorMessage,
} from '../shared/pwa-support.ts';

const ORIGIN = 'https://client.example.test';

test('reports distinct browser, proxy, and MUD labels for connected play', () => {
  const status = buildNetworkStatusMessage({
    browserOnline: true,
    proxyReady: true,
    connectionStatus: 'connected',
    statusDetail: 'Connected to game.example:4100.',
  });

  assert.equal(status.kind, 'mud-connected');
  assert.equal(status.browserLabel, 'Browser online');
  assert.equal(status.proxyLabel, 'Proxy ready');
  assert.equal(status.mudLabel, 'MUD connected');
  assert.equal(status.canSendCommand, true);
  assert.equal(status.canStartConnection, false);
  assert.equal(status.canUseReconnect, false);
});

test('keeps browser offline state separate from proxy and MUD status', () => {
  const status = buildNetworkStatusMessage({
    browserOnline: false,
    proxyReady: true,
    connectionStatus: 'connected',
  });

  assert.equal(status.kind, 'browser-offline');
  assert.equal(status.browserLabel, 'Browser offline');
  assert.equal(status.proxyLabel, 'Proxy ready');
  assert.equal(status.mudLabel, 'MUD connected');
  assert.equal(status.canSendCommand, false);
  assert.match(status.detail, /Reconnect and command sending require/);
});

test('allows reconnect only when browser and proxy are ready and no connection is in flight', () => {
  assert.equal(
    buildNetworkStatusMessage({
      browserOnline: true,
      proxyReady: true,
      connectionStatus: 'disconnected',
    }).canUseReconnect,
    true,
  );

  assert.equal(
    buildNetworkStatusMessage({
      browserOnline: true,
      proxyReady: true,
      connectionStatus: 'connecting',
    }).canUseReconnect,
    false,
  );

  assert.equal(
    buildNetworkStatusMessage({
      browserOnline: true,
      proxyReady: false,
      connectionStatus: 'error',
    }).canUseReconnect,
    false,
  );
});

test('reports service-worker support and unsupported browser fallbacks', () => {
  assert.deepEqual(getServiceWorkerCapability({ hasServiceWorker: true, isSecureContext: true }), {
    supported: true,
    reason: 'supported',
    message: 'Service-worker registration is supported.',
  });

  assert.deepEqual(getServiceWorkerCapability({ hasServiceWorker: false, isSecureContext: true }), {
    supported: false,
    reason: 'missing-service-worker',
    message: 'Service workers are not available in this browser.',
  });

  assert.deepEqual(getServiceWorkerCapability({ hasServiceWorker: true, isSecureContext: false }), {
    supported: false,
    reason: 'insecure-context',
    message: 'Service workers require HTTPS or a localhost secure context.',
  });
});

test('maps service-worker registration errors to stable messages', () => {
  assert.equal(
    getServiceWorkerRegistrationErrorMessage(new Error('scope denied')),
    'Service-worker registration failed: scope denied',
  );
  assert.equal(
    getServiceWorkerRegistrationErrorMessage('bad'),
    'Service-worker registration failed.',
  );
});

test('allows same-origin static shell requests for service-worker caching', () => {
  for (const url of [
    `${ORIGIN}/`,
    `${ORIGIN}/index.html`,
    `${ORIGIN}/manifest.webmanifest`,
    `${ORIGIN}/favicon.svg`,
    `${ORIGIN}/icons.svg`,
    `${ORIGIN}/assets/index-a1b2c3.js`,
    `${ORIGIN}/assets/index-a1b2c3.css`,
  ]) {
    assert.deepEqual(getServiceWorkerFetchDecision({ url, origin: ORIGIN }), {
      cacheable: true,
      reason: 'static-shell',
    });
  }
});

test('excludes dynamic and unsafe requests from service-worker caching', () => {
  assert.deepEqual(
    getServiceWorkerFetchDecision({ url: `${ORIGIN}/api/settings`, origin: ORIGIN }),
    { cacheable: false, reason: 'api-route' },
  );
  assert.deepEqual(getServiceWorkerFetchDecision({ url: `${ORIGIN}/ws`, origin: ORIGIN }), {
    cacheable: false,
    reason: 'websocket-route',
  });
  assert.deepEqual(
    getServiceWorkerFetchDecision({
      url: `${ORIGIN}/assets/index.js`,
      origin: ORIGIN,
      method: 'POST',
    }),
    { cacheable: false, reason: 'non-get' },
  );
  assert.deepEqual(
    getServiceWorkerFetchDecision({
      url: `${ORIGIN}/ws`,
      origin: ORIGIN,
      headers: { Upgrade: 'websocket' },
    }),
    { cacheable: false, reason: 'upgrade-request' },
  );
  assert.deepEqual(
    getServiceWorkerFetchDecision({
      url: 'https://other.example.test/assets/index.js',
      origin: ORIGIN,
    }),
    { cacheable: false, reason: 'cross-origin' },
  );
  assert.deepEqual(getServiceWorkerFetchDecision({ url: `${ORIGIN}/play`, origin: ORIGIN }), {
    cacheable: false,
    reason: 'non-static-route',
  });
});
