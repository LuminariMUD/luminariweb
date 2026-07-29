import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import type { ConnectionOptions } from 'node:tls';
import {
  createMudTlsSocketFactory,
  type MudTlsConnect,
  type MudTlsSocket,
} from './rejected-direct-mtls-adapter.ts';
import type { MudSocketFactory } from '../../server/mud-session.ts';

export const SYNTHETIC_MTLS_ORIGIN = 'mud-origin.synthetic.test';

type SyntheticIdentity = {
  certificate: string;
  privateKey: string;
};

export type SyntheticMtlsPki = {
  readonly client: SyntheticIdentity;
  readonly directory: string;
  readonly expiredClient: SyntheticIdentity;
  readonly expiredServer: SyntheticIdentity;
  readonly server: SyntheticIdentity;
  readonly trustedCaCertificate: string;
  readonly untrustedClient: SyntheticIdentity;
  readonly untrustedServer: SyntheticIdentity;
  readonly untrustedCaCertificate: string;
  destroy(): void;
};

export type SyntheticClientIdentity = 'expired' | 'none' | 'trusted' | 'untrusted';
export type SyntheticServerIdentity = 'expired' | 'trusted' | 'untrusted';

export type SyntheticMtlsProxy = {
  readonly acceptedBackendConnections: number;
  readonly backendToClientBytes: number;
  readonly clientToBackendBytes: number;
  readonly port: number;
  close(): Promise<void>;
  createMudSocketFactory(options?: {
    clientIdentity?: SyntheticClientIdentity;
    originHost?: string;
    trustServerCa?: 'trusted' | 'untrusted';
  }): MudSocketFactory;
};

/**
 * Generate a disposable two-CA PKI for real TLS integration tests.
 *
 * All OpenSSL output is suppressed, the directory is private to the current
 * user, and callers remove it after the file's test suite completes. The
 * repository therefore contains certificates-as-code, never a reusable key.
 */
export function createSyntheticMtlsPki(): SyntheticMtlsPki {
  const directory = mkdtempSync(join(tmpdir(), 'luminari-mtls-test-'));
  chmodSync(directory, 0o700);

  issueCa(directory, 'trusted-ca', 'Luminari synthetic trusted CA');
  issueCa(directory, 'untrusted-ca', 'Luminari synthetic untrusted CA');

  issueIdentity(directory, 'server', 'trusted-ca', SYNTHETIC_MTLS_ORIGIN, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    `subjectAltName=DNS:${SYNTHETIC_MTLS_ORIGIN}`,
  ]);
  issueIdentity(directory, 'client', 'trusted-ca', 'synthetic-worker-client', [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=clientAuth',
  ]);
  issueIdentity(
    directory,
    'expired-server',
    'trusted-ca',
    SYNTHETIC_MTLS_ORIGIN,
    [
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      `subjectAltName=DNS:${SYNTHETIC_MTLS_ORIGIN}`,
    ],
    0,
  );
  issueIdentity(
    directory,
    'expired-client',
    'trusted-ca',
    'synthetic-expired-client',
    [
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=clientAuth',
    ],
    0,
  );
  issueIdentity(directory, 'untrusted-server', 'untrusted-ca', SYNTHETIC_MTLS_ORIGIN, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    `subjectAltName=DNS:${SYNTHETIC_MTLS_ORIGIN}`,
  ]);
  issueIdentity(directory, 'untrusted-client', 'untrusted-ca', 'synthetic-untrusted-client', [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=clientAuth',
  ]);

  let destroyed = false;
  return {
    client: readIdentity(directory, 'client'),
    directory,
    expiredClient: readIdentity(directory, 'expired-client'),
    expiredServer: readIdentity(directory, 'expired-server'),
    server: readIdentity(directory, 'server'),
    trustedCaCertificate: readFileSync(join(directory, 'trusted-ca.pem'), 'utf8'),
    untrustedClient: readIdentity(directory, 'untrusted-client'),
    untrustedServer: readIdentity(directory, 'untrusted-server'),
    untrustedCaCertificate: readFileSync(join(directory, 'untrusted-ca.pem'), 'utf8'),
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

/**
 * Put an authenticating TLS endpoint in front of the ordinary synthetic MUD.
 *
 * The proxy opens the backend only from Node's authorized secure-connection
 * callback. Bytes are buffered for one event-loop turn and rewritten into a
 * changing sequence of small and large writes, forcing both split and
 * coalesced boundaries without retaining application content.
 */
export async function startSyntheticMtlsProxy(options: {
  backendPort: number;
  pki: SyntheticMtlsPki;
  serverIdentity?: SyntheticServerIdentity;
}): Promise<SyntheticMtlsProxy> {
  const { backendPort, pki } = options;
  const serverIdentity =
    options.serverIdentity === 'untrusted'
      ? pki.untrustedServer
      : options.serverIdentity === 'expired'
        ? pki.expiredServer
        : pki.server;
  const liveSockets = new Set<net.Socket>();
  let acceptedBackendConnections = 0;
  let backendToClientBytes = 0;
  let clientToBackendBytes = 0;

  const server = tls.createServer(
    {
      ca: pki.trustedCaCertificate,
      cert: serverIdentity.certificate,
      key: serverIdentity.privateKey,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      requestCert: true,
    },
    (clientSocket) => {
      if (!clientSocket.authorized) {
        clientSocket.destroy();
        return;
      }

      const backendSocket = net.createConnection({
        host: '127.0.0.1',
        port: backendPort,
      });
      liveSockets.add(clientSocket);
      liveSockets.add(backendSocket);

      backendSocket.once('connect', () => {
        acceptedBackendConnections += 1;
      });

      reframe(clientSocket, backendSocket, (byteCount) => {
        clientToBackendBytes += byteCount;
      });
      reframe(backendSocket, clientSocket, (byteCount) => {
        backendToClientBytes += byteCount;
      });

      clientSocket.once('close', () => {
        liveSockets.delete(clientSocket);
        backendSocket.destroy();
      });
      backendSocket.once('close', () => {
        liveSockets.delete(backendSocket);
        clientSocket.destroy();
      });
      clientSocket.on('error', () => undefined);
      backendSocket.on('error', () => clientSocket.destroy());
    },
  );
  server.on('tlsClientError', () => undefined);

  const port = await listenOnLoopback(server);
  let closed = false;

  return {
    get acceptedBackendConnections() {
      return acceptedBackendConnections;
    },
    get backendToClientBytes() {
      return backendToClientBytes;
    },
    get clientToBackendBytes() {
      return clientToBackendBytes;
    },
    port,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const socket of liveSockets) {
        socket.destroy();
      }
      await closeServer(server);
    },
    createMudSocketFactory(factoryOptions = {}) {
      const originHost = factoryOptions.originHost ?? SYNTHETIC_MTLS_ORIGIN;
      const identity =
        factoryOptions.clientIdentity === 'none'
          ? null
          : factoryOptions.clientIdentity === 'untrusted'
            ? pki.untrustedClient
            : factoryOptions.clientIdentity === 'expired'
              ? pki.expiredClient
              : pki.client;
      const trustedServerCa =
        factoryOptions.trustServerCa === 'untrusted'
          ? pki.untrustedCaCertificate
          : pki.trustedCaCertificate;

      const connector: MudTlsConnect = (connectionOptions) => {
        const nodeOptions: ConnectionOptions = {
          ...connectionOptions,
          ca: trustedServerCa,
          host: '127.0.0.1',
        };
        if (identity) {
          nodeOptions.cert = identity.certificate;
          nodeOptions.key = identity.privateKey;
        } else {
          delete nodeOptions.cert;
          delete nodeOptions.key;
        }
        return tls.connect(nodeOptions) as unknown as MudTlsSocket;
      };

      return createMudTlsSocketFactory(
        {
          MUD_TLS_CLIENT_CERT: pki.client.certificate,
          MUD_TLS_CLIENT_KEY: pki.client.privateKey,
          MUD_TLS_ORIGIN_HOST: originHost,
          MUD_TLS_ORIGIN_PORT: String(port),
          MUD_TRANSPORT: 'mtls',
        },
        connector,
      );
    },
  };
}

function issueCa(directory: string, prefix: string, commonName: string) {
  runOpenSsl(directory, [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-days',
    '2',
    '-subj',
    `/CN=${commonName}`,
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
    '-keyout',
    `${prefix}.key`,
    '-out',
    `${prefix}.pem`,
  ]);
}

function issueIdentity(
  directory: string,
  prefix: string,
  caPrefix: string,
  commonName: string,
  extensions: string[],
  days = 2,
) {
  writeFileSync(join(directory, `${prefix}.ext`), `${extensions.join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  runOpenSsl(directory, [
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-subj',
    `/CN=${commonName}`,
    '-keyout',
    `${prefix}.key`,
    '-out',
    `${prefix}.csr`,
  ]);
  runOpenSsl(directory, [
    'x509',
    '-req',
    '-in',
    `${prefix}.csr`,
    '-CA',
    `${caPrefix}.pem`,
    '-CAkey',
    `${caPrefix}.key`,
    '-CAserial',
    `${caPrefix}.srl`,
    '-CAcreateserial',
    '-days',
    String(days),
    '-sha256',
    '-extfile',
    `${prefix}.ext`,
    '-out',
    `${prefix}.pem`,
  ]);
}

function readIdentity(directory: string, prefix: string): SyntheticIdentity {
  return {
    certificate: readFileSync(join(directory, `${prefix}.pem`), 'utf8'),
    privateKey: readFileSync(join(directory, `${prefix}.key`), 'utf8'),
  };
}

function runOpenSsl(directory: string, args: string[]) {
  execFileSync('openssl', args, {
    cwd: directory,
    stdio: 'ignore',
  });
}

function listenOnLoopback(server: tls.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Synthetic TLS endpoint did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: tls.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function reframe(
  source: net.Socket,
  destination: net.Socket,
  observeBytes: (byteCount: number) => void,
) {
  const writePattern = [1, 19, 2, 127, 7, 509];
  let pending = Buffer.alloc(0);
  let scheduled = false;
  let patternIndex = 0;

  const flush = () => {
    scheduled = false;
    const bytes = pending;
    pending = Buffer.alloc(0);
    observeBytes(bytes.length);

    let offset = 0;
    while (offset < bytes.length && !destination.destroyed) {
      const writeSize = writePattern[patternIndex % writePattern.length] ?? bytes.length;
      patternIndex += 1;
      const end = Math.min(offset + writeSize, bytes.length);
      destination.write(bytes.subarray(offset, end));
      offset = end;
    }
  };

  source.on('data', (chunk: Buffer) => {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    if (!scheduled) {
      scheduled = true;
      setImmediate(flush);
    }
  });
}
