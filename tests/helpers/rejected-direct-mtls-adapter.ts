import { connect as connectTls } from 'node:tls';
import type { ConnectionOptions } from 'node:tls';
import type { MudSocket, MudSocketFactory } from '../../server/mud-session.ts';

const GENERIC_TLS_ERROR = 'Secure MUD connection failed.';
const GENERIC_TLS_NOT_READY_ERROR = 'Secure MUD connection is not ready.';

export type MudTlsBindings = {
  MUD_TRANSPORT?: string;
  MUD_TLS_ORIGIN_HOST?: string;
  MUD_TLS_ORIGIN_PORT?: string;
  MUD_TLS_CLIENT_CERT?: string;
  MUD_TLS_CLIENT_KEY?: string;
};

export type MudTlsSocket = {
  readonly authorized: boolean;
  readonly destroyed: boolean;
  setNoDelay?: (noDelay: boolean) => void;
  write(chunk: string | Buffer): void;
  destroy(): void;
  on(event: 'secureConnect', listener: () => void): void;
  on(event: 'data', listener: (chunk: Buffer | Uint8Array) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: () => void): void;
};

export type MudTlsConnect = (options: ConnectionOptions) => MudTlsSocket;

type MudTlsConfiguration = {
  clientCertificate: string;
  clientPrivateKey: string;
  originHost: string;
  originPort: number;
};

type MudSocketListeners = {
  close: Array<() => void>;
  connect: Array<() => void>;
  data: Array<(chunk: Buffer) => void>;
  error: Array<(error: Error) => void>;
};

/**
 * Preserve the rejected direct-TLS candidate as a test-only adapter.
 *
 * Validation deliberately happens when MudSession asks for a socket. That lets
 * MudSession turn missing or malformed bindings into its normal content-free
 * browser error. A deployed canary proved that the Workers runtime did not
 * present these client credentials, so production code must not import this
 * helper.
 */
export function createMudTlsSocketFactory(
  bindings: MudTlsBindings,
  tlsConnector: MudTlsConnect = defaultMudTlsConnect,
): MudSocketFactory {
  const createFixedOriginSocket = () => {
    const configuration = readMudTlsConfiguration(bindings);

    let tlsSocket: MudTlsSocket;
    try {
      tlsSocket = tlsConnector({
        cert: configuration.clientCertificate,
        host: configuration.originHost,
        key: configuration.clientPrivateKey,
        minVersion: 'TLSv1.2',
        port: configuration.originPort,
        rejectUnauthorized: true,
        servername: configuration.originHost,
      });
    } catch {
      throw new Error(GENERIC_TLS_ERROR);
    }

    return new SecureMudSocketAdapter(tlsSocket);
  };

  return createFixedOriginSocket;
}

function defaultMudTlsConnect(options: ConnectionOptions) {
  return connectTls(options) as MudTlsSocket;
}

function readMudTlsConfiguration(bindings: MudTlsBindings): MudTlsConfiguration {
  if (bindings.MUD_TRANSPORT !== 'mtls') {
    throw new Error(GENERIC_TLS_ERROR);
  }

  const originHost = bindings.MUD_TLS_ORIGIN_HOST?.trim().toLowerCase() ?? '';
  if (!isValidDnsHostname(originHost)) {
    throw new Error(GENERIC_TLS_ERROR);
  }

  const originPort = Number(bindings.MUD_TLS_ORIGIN_PORT);
  if (!Number.isInteger(originPort) || originPort < 1 || originPort > 65_535) {
    throw new Error(GENERIC_TLS_ERROR);
  }

  const clientCertificate = bindings.MUD_TLS_CLIENT_CERT;
  const clientPrivateKey = bindings.MUD_TLS_CLIENT_KEY;
  if (!clientCertificate?.trim() || !clientPrivateKey?.trim()) {
    throw new Error(GENERIC_TLS_ERROR);
  }

  return {
    clientCertificate,
    clientPrivateKey,
    originHost,
    originPort,
  };
}

function isValidDnsHostname(hostname: string) {
  if (
    hostname.length < 1 ||
    hostname.length > 253 ||
    !hostname.includes('.') ||
    /^\d+(?:\.\d+){3}$/.test(hostname)
  ) {
    return false;
  }

  return hostname.split('.').every((label) => {
    if (label.length < 1 || label.length > 63) {
      return false;
    }

    return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
  });
}

/**
 * MudSession is intentionally unaware of TLS. This adapter translates the TLS
 * lifecycle into its narrow MudSocket contract and never forwards the raw TCP
 * `connect` event emitted before certificate verification.
 */
class SecureMudSocketAdapter implements MudSocket {
  private readonly listeners: MudSocketListeners = {
    close: [],
    connect: [],
    data: [],
    error: [],
  };
  private failureEmitted = false;
  private handshakeAuthorized = false;
  private locallyDestroyed = false;
  private secure = false;
  private readonly tlsSocket: MudTlsSocket;

  constructor(tlsSocket: MudTlsSocket) {
    this.tlsSocket = tlsSocket;

    tlsSocket.on('secureConnect', () => {
      if (this.destroyed || this.secure) {
        return;
      }

      if (!tlsSocket.authorized) {
        this.emitFailure();
        this.destroy();
        return;
      }

      this.handshakeAuthorized = true;
    });

    tlsSocket.on('data', (chunk) => {
      if (!this.handshakeAuthorized || this.destroyed) {
        return;
      }

      if (!this.secure) {
        // With TLS 1.3, a client can observe `secureConnect` immediately before
        // a mutual-TLS server's fatal "certificate required" alert. The fixed
        // Luminari endpoint sends Telnet negotiation as soon as stunnel has
        // accepted the client and opened the loopback backend. Treat that first
        // authenticated application byte as the acceptance signal, so
        // MudSession cannot report connected or write credentials during that
        // alert race.
        this.secure = true;
        this.emit('connect');
      }
      if (this.destroyed) {
        return;
      }
      this.emit('data', Buffer.from(chunk));
    });

    tlsSocket.on('error', () => {
      if (this.locallyDestroyed) {
        return;
      }

      this.emitFailure();
    });

    tlsSocket.on('close', () => {
      if (!this.secure && !this.locallyDestroyed) {
        this.emitFailure();
      }
      this.locallyDestroyed = true;
      this.emit('close');
    });
  }

  get destroyed() {
    return this.locallyDestroyed || this.tlsSocket.destroyed;
  }

  setNoDelay(noDelay: boolean) {
    try {
      this.tlsSocket.setNoDelay?.(noDelay);
    } catch {
      // Workers' TLS socket surface may omit this Node TCP convenience. It is
      // not a security control, so MudSession must not tear down an otherwise
      // valid TLS handshake when it is absent or unsupported.
    }
  }

  write(chunk: string | Buffer) {
    if (!this.secure || this.destroyed) {
      throw new Error(GENERIC_TLS_NOT_READY_ERROR);
    }

    try {
      this.tlsSocket.write(chunk);
    } catch {
      throw new Error(GENERIC_TLS_ERROR);
    }
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.locallyDestroyed = true;
    try {
      this.tlsSocket.destroy();
    } catch {
      // Destruction is best-effort and must never expose TLS implementation or
      // certificate details through MudSession's browser status.
    }
  }

  on(event: 'connect', listener: () => void): void;
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: () => void): void;
  on(
    event: 'close' | 'connect' | 'data' | 'error',
    listener: (() => void) | ((chunk: Buffer) => void) | ((error: Error) => void),
  ) {
    if (event === 'data') {
      this.listeners.data.push(listener as (chunk: Buffer) => void);
      return;
    }
    if (event === 'error') {
      this.listeners.error.push(listener as (error: Error) => void);
      return;
    }

    this.listeners[event].push(listener as () => void);
  }

  private emit(event: 'close' | 'connect'): void;
  private emit(event: 'data', chunk: Buffer): void;
  private emit(event: 'error', error: Error): void;
  private emit(event: 'close' | 'connect' | 'data' | 'error', value?: Buffer | Error) {
    if (event === 'data') {
      for (const listener of [...this.listeners.data]) {
        listener(value as Buffer);
      }
      return;
    }
    if (event === 'error') {
      for (const listener of [...this.listeners.error]) {
        listener(value as Error);
      }
      return;
    }

    for (const listener of [...this.listeners[event]]) {
      listener();
    }
  }

  private emitFailure() {
    if (this.failureEmitted) {
      return;
    }

    this.failureEmitted = true;
    this.emit('error', new Error(GENERIC_TLS_ERROR));
  }
}
