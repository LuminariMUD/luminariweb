import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { MudSession } from '../server/mud-session.ts';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import { FakeBrowserSocket, getStatusDetails } from './helpers/proxy-lifecycle-harness.ts';
import {
  createSyntheticMtlsPki,
  startSyntheticMtlsProxy,
  type SyntheticMtlsPki,
  type SyntheticServerIdentity,
} from './helpers/synthetic-mtls-proxy.ts';

let syntheticMtlsPki: SyntheticMtlsPki;

test.before(() => {
  syntheticMtlsPki = createSyntheticMtlsPki();
});

test.after(() => {
  syntheticMtlsPki.destroy();
});

test('real certificate and hostname failures never open the synthetic MUD backend', async () => {
  const backend = await startCountingBackend();

  try {
    for (const scenario of [
      {
        name: 'wrong server hostname',
        originHost: 'wrong-origin.synthetic.test',
      },
      {
        name: 'untrusted server certificate',
        serverIdentity: 'untrusted' as SyntheticServerIdentity,
      },
      {
        name: 'expired server certificate',
        serverIdentity: 'expired' as SyntheticServerIdentity,
      },
      {
        clientIdentity: 'none' as const,
        name: 'missing client certificate',
      },
      {
        clientIdentity: 'untrusted' as const,
        name: 'untrusted client certificate',
      },
      {
        clientIdentity: 'expired' as const,
        name: 'expired client certificate',
      },
    ]) {
      const proxy = await startSyntheticMtlsProxy({
        backendPort: backend.port,
        pki: syntheticMtlsPki,
        serverIdentity: scenario.serverIdentity,
      });
      const browser = new FakeBrowserSocket();
      const session = new MudSession(browser, {
        createMudSocket: proxy.createMudSocketFactory({
          clientIdentity: scenario.clientIdentity,
          originHost: scenario.originHost,
        }),
        timeouts: {
          connectTimeoutMs: 2_000,
          idleTimeoutMs: 2_000,
        },
      });
      const startingBackendConnections = backend.connections;

      try {
        session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));
        await waitForConnectionError(browser);

        assert.equal(
          getStatusDetails(browser).some((detail) => detail.startsWith('connected:')),
          false,
          `${scenario.name} must not report connected`,
        );
        assert.match(getStatusDetails(browser).at(-1) ?? '', /^error:Connection error\./);
        assert.equal(proxy.acceptedBackendConnections, 0);
        assert.equal(
          backend.connections,
          startingBackendConnections,
          `${scenario.name} must not reach the backend`,
        );
        assert.equal(browser.terminalMessages.length, 0);
        assert.equal(browser.stateMessages.length, 0);
        assert.equal(
          browser.rawMessages.some(
            (message) =>
              message.includes('synthetic.test') ||
              message.includes('certificate') ||
              message.includes('private key'),
          ),
          false,
          `${scenario.name} must remain content-free and hide the internal origin`,
        );
      } finally {
        session.closeBrowser();
        await proxy.close();
      }
    }
  } finally {
    await backend.close();
  }
});

async function waitForConnectionError(browser: FakeBrowserSocket) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (browser.statusMessages.some((message) => message.status === 'error')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`TLS failure did not surface; statuses: ${getStatusDetails(browser).join(', ')}`);
}

async function startCountingBackend(): Promise<{
  readonly connections: number;
  readonly port: number;
  close(): Promise<void>;
}> {
  const liveSockets = new Set<net.Socket>();
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    liveSockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => liveSockets.delete(socket));
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Synthetic backend did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    get connections() {
      return connections;
    },
    port,
    close() {
      for (const socket of liveSockets) {
        socket.destroy();
      }
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
