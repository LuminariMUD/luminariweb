import { createConnection } from 'node:net';
import type { MudSocket, MudSocketFactory } from './mud-session.ts';

export const FIXED_LOOPBACK_BACKEND_HOST = '127.0.0.1';

export const GATEWAY_RUNTIME_ENV = {
  fixedLoopbackBackendPort: 'PROXY_FIXED_LOOPBACK_BACKEND_PORT',
  listenHost: 'PROXY_LISTEN_HOST',
} as const;

export type MudConnectionDialer = (options: { host: string; port: number }) => MudSocket;

export type GatewayRuntime = {
  createMudSocket: MudSocketFactory | undefined;
  fixedLoopbackBackendPort: number | null;
  listenHost: string | undefined;
};

export function createGatewayRuntime(
  env: NodeJS.ProcessEnv = process.env,
  dial: MudConnectionDialer = createNetConnection,
): GatewayRuntime {
  const fixedLoopbackBackendPort = readFixedLoopbackBackendPort(
    env[GATEWAY_RUNTIME_ENV.fixedLoopbackBackendPort],
  );
  const listenHost = readListenHost(env[GATEWAY_RUNTIME_ENV.listenHost]);

  if (fixedLoopbackBackendPort !== null && listenHost !== FIXED_LOOPBACK_BACKEND_HOST) {
    throw new Error(
      `${GATEWAY_RUNTIME_ENV.listenHost} must be ${FIXED_LOOPBACK_BACKEND_HOST} when ${GATEWAY_RUNTIME_ENV.fixedLoopbackBackendPort} is enabled.`,
    );
  }

  return {
    createMudSocket:
      fixedLoopbackBackendPort === null
        ? undefined
        : createFixedLoopbackMudSocketFactory(fixedLoopbackBackendPort, dial),
    fixedLoopbackBackendPort,
    listenHost,
  };
}

export function readFixedLoopbackBackendPort(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const normalized = value.trim();
  if (!/^[1-9]\d{0,4}$/.test(normalized)) {
    throw new Error(`${GATEWAY_RUNTIME_ENV.fixedLoopbackBackendPort} must be a valid TCP port.`);
  }

  const port = Number(normalized);
  if (port > 65_535) {
    throw new Error(`${GATEWAY_RUNTIME_ENV.fixedLoopbackBackendPort} must be a valid TCP port.`);
  }

  return port;
}

export function createFixedLoopbackMudSocketFactory(
  port: number,
  dial: MudConnectionDialer = createNetConnection,
): MudSocketFactory {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('The fixed loopback MUD port is invalid.');
  }

  return () =>
    dial({
      host: FIXED_LOOPBACK_BACKEND_HOST,
      port,
    });
}

function readListenHost(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function createNetConnection(options: { host: string; port: number }) {
  return createConnection(options);
}
