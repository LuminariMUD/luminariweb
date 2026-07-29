import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { ConnectionOptions } from 'node:tls';
import { MudSession } from '../server/mud-session.ts';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import {
  createMudTlsSocketFactory,
  type MudTlsBindings,
  type MudTlsConnect,
  type MudTlsSocket,
} from './helpers/rejected-direct-mtls-adapter.ts';
import { FakeBrowserSocket, getStatusDetails } from './helpers/proxy-lifecycle-harness.ts';

const VALID_BINDINGS: MudTlsBindings = {
  MUD_TLS_CLIENT_CERT: 'synthetic client certificate',
  MUD_TLS_CLIENT_KEY: 'synthetic client private key',
  MUD_TLS_ORIGIN_HOST: 'mud-origin.example.test',
  MUD_TLS_ORIGIN_PORT: '4443',
  MUD_TRANSPORT: 'mtls',
};

class FakeTlsSocket extends EventEmitter {
  authorized = false;
  destroyed = false;
  destroyCount = 0;
  noDelayCalls: boolean[] = [];
  writtenChunks: Buffer[] = [];
  throwFromSetNoDelay = false;

  setNoDelay(noDelay: boolean) {
    if (this.throwFromSetNoDelay) {
      throw new Error('Synthetic unsupported operation.');
    }
    this.noDelayCalls.push(noDelay);
  }

  write(chunk: string | Buffer) {
    if (this.destroyed) {
      throw new Error('Synthetic destroyed socket.');
    }
    this.writtenChunks.push(
      typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk),
    );
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.destroyCount += 1;
    this.emit('close');
  }
}

function fakeConnector(socket: FakeTlsSocket, observed: ConnectionOptions[]): MudTlsConnect {
  return (options) => {
    observed.push(options);
    return socket as unknown as MudTlsSocket;
  };
}

test('constructs strict mutual TLS options for the fixed origin and ignores browser address', () => {
  const tlsSocket = new FakeTlsSocket();
  const observed: ConnectionOptions[] = [];
  const factory = createMudTlsSocketFactory(VALID_BINDINGS, fakeConnector(tlsSocket, observed));

  factory({ host: 'attacker.example.test', port: 23 });

  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], {
    cert: VALID_BINDINGS.MUD_TLS_CLIENT_CERT,
    host: 'mud-origin.example.test',
    key: VALID_BINDINGS.MUD_TLS_CLIENT_KEY,
    minVersion: 'TLSv1.2',
    port: 4443,
    rejectUnauthorized: true,
    servername: 'mud-origin.example.test',
  });
  assert.equal('ca' in observed[0], false);
});

test('missing or insecure configuration fails before a TLS socket is opened', () => {
  for (const bindings of [
    { ...VALID_BINDINGS, MUD_TRANSPORT: 'plaintext' },
    { ...VALID_BINDINGS, MUD_TLS_ORIGIN_HOST: '127.0.0.1' },
    { ...VALID_BINDINGS, MUD_TLS_ORIGIN_PORT: '0' },
    { ...VALID_BINDINGS, MUD_TLS_CLIENT_CERT: '' },
    { ...VALID_BINDINGS, MUD_TLS_CLIENT_KEY: '' },
  ]) {
    let connectCount = 0;
    const factory = createMudTlsSocketFactory(bindings, () => {
      connectCount += 1;
      return new FakeTlsSocket() as unknown as MudTlsSocket;
    });

    assert.throws(() => factory({ host: 'luminarimud.com', port: 4100 }), {
      message: 'Secure MUD connection failed.',
    });
    assert.equal(connectCount, 0);
  }
});

test('MudSession turns missing TLS secrets into a generic browser failure', () => {
  const browser = new FakeBrowserSocket();
  let connectCount = 0;
  const session = new MudSession(browser, {
    createMudSocket: createMudTlsSocketFactory(
      { ...VALID_BINDINGS, MUD_TLS_CLIENT_KEY: undefined },
      () => {
        connectCount += 1;
        return new FakeTlsSocket() as unknown as MudTlsSocket;
      },
    ),
  });

  session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));

  assert.equal(connectCount, 0);
  assert.deepEqual(getStatusDetails(browser), [
    'connecting:Connecting to luminarimud.com:4100...',
    'error:Connection error. Unable to open the MUD socket.',
  ]);
});

test('raw TCP connect and unauthorized TLS handshakes never report connected or write bytes', () => {
  const browser = new FakeBrowserSocket();
  const tlsSocket = new FakeTlsSocket();
  const session = new MudSession(browser, {
    createMudSocket: createMudTlsSocketFactory(VALID_BINDINGS, fakeConnector(tlsSocket, [])),
  });

  session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));

  tlsSocket.emit('connect');
  assert.deepEqual(getStatusDetails(browser), ['connecting:Connecting to luminarimud.com:4100...']);
  assert.equal(tlsSocket.writtenChunks.length, 0);

  tlsSocket.emit('secureConnect');
  assert.deepEqual(getStatusDetails(browser), [
    'connecting:Connecting to luminarimud.com:4100...',
    'error:Connection error. The MUD connection closed unexpectedly.',
  ]);
  assert.equal(tlsSocket.destroyCount, 1);
  assert.equal(tlsSocket.writtenChunks.length, 0);
  assert.equal(
    getStatusDetails(browser).some((detail) => detail.startsWith('connected:')),
    false,
  );
});

test('the first authenticated server byte gates writes and preserves the logical status identity', (t) => {
  const browser = new FakeBrowserSocket();
  const tlsSocket = new FakeTlsSocket();
  const factory = createMudTlsSocketFactory(VALID_BINDINGS, fakeConnector(tlsSocket, []));
  const adapter = factory({ host: 'luminarimud.com', port: 4100 });

  assert.throws(() => adapter.write('pre-handshake command'), {
    message: 'Secure MUD connection is not ready.',
  });
  assert.equal(tlsSocket.writtenChunks.length, 0);

  const session = new MudSession(browser, { createMudSocket: () => adapter });
  t.after(() => session.closeBrowser());
  session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));
  tlsSocket.emit('data', Buffer.from('pre-handshake data'));
  assert.equal(
    browser.messages.some((message) => message.type === 'terminal'),
    false,
  );

  tlsSocket.authorized = true;
  tlsSocket.emit('secureConnect');
  assert.deepEqual(getStatusDetails(browser), ['connecting:Connecting to luminarimud.com:4100...']);
  assert.throws(() => adapter.write('pre-acceptance command'), {
    message: 'Secure MUD connection is not ready.',
  });

  tlsSocket.emit('data', Buffer.from('server acceptance byte'));
  assert.deepEqual(getStatusDetails(browser), [
    'connecting:Connecting to luminarimud.com:4100...',
    'connected:Connected to luminarimud.com:4100.',
  ]);

  session.sendInput('look');
  assert.equal(Buffer.concat(tlsSocket.writtenChunks).toString('utf8').includes('look\n'), true);
});

test('setNoDelay remains a non-throwing compatibility shim', () => {
  const tlsSocket = new FakeTlsSocket();
  tlsSocket.throwFromSetNoDelay = true;
  const adapter = createMudTlsSocketFactory(
    VALID_BINDINGS,
    fakeConnector(tlsSocket, []),
  )({ host: 'luminarimud.com', port: 4100 });

  assert.doesNotThrow(() => adapter.setNoDelay(true));
  assert.equal(adapter.destroyed, false);
});

test('asynchronous TLS errors are content-free and emitted once', () => {
  const tlsSocket = new FakeTlsSocket();
  const adapter = createMudTlsSocketFactory(
    {
      ...VALID_BINDINGS,
      MUD_TLS_CLIENT_KEY: 'PRIVATE-KEY-MARKER',
    },
    fakeConnector(tlsSocket, []),
  )({ host: 'luminarimud.com', port: 4100 });
  const errors: Error[] = [];
  adapter.on('error', (error) => errors.push(error));

  tlsSocket.emit('error', new Error('PRIVATE-KEY-MARKER /secret/path'));
  tlsSocket.emit('error', new Error('another failure'));

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, 'Secure MUD connection failed.');
  assert.equal(JSON.stringify(errors).includes('PRIVATE-KEY-MARKER'), false);
  assert.equal(JSON.stringify(errors).includes('/secret/path'), false);
});

test('a TLS error still fails closed when the runtime marks its socket destroyed first', () => {
  const tlsSocket = new FakeTlsSocket();
  const adapter = createMudTlsSocketFactory(
    VALID_BINDINGS,
    fakeConnector(tlsSocket, []),
  )({ host: 'luminarimud.com', port: 4100 });
  const errors: Error[] = [];
  adapter.on('error', (error) => errors.push(error));

  tlsSocket.destroyed = true;
  tlsSocket.emit('error', new Error('Synthetic certificate verification failure.'));

  assert.deepEqual(
    errors.map((error) => error.message),
    ['Secure MUD connection failed.'],
  );
});
