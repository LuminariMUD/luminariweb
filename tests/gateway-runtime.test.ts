import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createFixedLoopbackMudSocketFactory,
  createGatewayRuntime,
  FIXED_LOOPBACK_BACKEND_HOST,
  readFixedLoopbackBackendPort,
  type MudConnectionDialer,
} from '../server/gateway-runtime.ts';
import { MudSession, type MudSocket } from '../server/mud-session.ts';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import { FakeBrowserSocket, getStatusDetails } from './helpers/proxy-lifecycle-harness.ts';

class FakeMudSocket extends EventEmitter {
  destroyed = false;

  setNoDelay() {}

  write() {}

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.emit('close');
  }
}

test('fixed-loopback port parsing is strict and optional', () => {
  assert.equal(readFixedLoopbackBackendPort(undefined), null);
  assert.equal(readFixedLoopbackBackendPort('4100'), 4100);

  for (const value of ['', '0', '-1', '4100extra', '65536', '4100.5']) {
    assert.throws(() => readFixedLoopbackBackendPort(value), {
      message: 'PROXY_FIXED_LOOPBACK_BACKEND_PORT must be a valid TCP port.',
    });
  }
});

test('fixed-loopback mode refuses a missing or public listen host', () => {
  for (const listenHost of [undefined, '0.0.0.0', '::', 'gateway.example.test']) {
    assert.throws(
      () =>
        createGatewayRuntime({
          PROXY_FIXED_LOOPBACK_BACKEND_PORT: '4100',
          PROXY_LISTEN_HOST: listenHost,
        }),
      {
        message:
          'PROXY_LISTEN_HOST must be 127.0.0.1 when PROXY_FIXED_LOOPBACK_BACKEND_PORT is enabled.',
      },
    );
  }
});

test('ordinary development runtime retains the normal MudSession socket factory', () => {
  const runtime = createGatewayRuntime({});

  assert.equal(runtime.createMudSocket, undefined);
  assert.equal(runtime.fixedLoopbackBackendPort, null);
  assert.equal(runtime.listenHost, undefined);
});

test('fixed-loopback factory ignores the logical destination and preserves its status identity', (t) => {
  const observedAddresses: Array<{ host: string; port: number }> = [];
  const mudSocket = new FakeMudSocket();
  const dial: MudConnectionDialer = (address) => {
    observedAddresses.push(address);
    return mudSocket as unknown as MudSocket;
  };
  const runtime = createGatewayRuntime(
    {
      PROXY_FIXED_LOOPBACK_BACKEND_PORT: '4100',
      PROXY_LISTEN_HOST: FIXED_LOOPBACK_BACKEND_HOST,
    },
    dial,
  );
  const browser = new FakeBrowserSocket();
  const session = new MudSession(browser, {
    createMudSocket: runtime.createMudSocket,
  });
  t.after(() => session.closeBrowser());

  session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));

  assert.deepEqual(observedAddresses, [
    {
      host: FIXED_LOOPBACK_BACKEND_HOST,
      port: 4100,
    },
  ]);

  mudSocket.emit('connect');
  assert.deepEqual(getStatusDetails(browser), [
    'connecting:Connecting to luminarimud.com:4100...',
    'connected:Connected to luminarimud.com:4100.',
  ]);
});

test('fixed-loopback factory validates its programmatic port', () => {
  for (const port of [0, 65_536, 4100.5, Number.NaN]) {
    assert.throws(() => createFixedLoopbackMudSocketFactory(port), {
      message: 'The fixed loopback MUD port is invalid.',
    });
  }
});
