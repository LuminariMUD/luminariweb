import { appSettings } from '../shared/app-settings.ts';
import type { AppSettings } from '../shared/app-settings.ts';
import { ActiveConnectionCounter } from '../server/connection-accounting.ts';
import {
  openManagedMtlsWebSocket,
  relayWebSockets,
  type ManagedMtlsFetcher,
  type RelayWebSocket,
} from './websocket-relay.ts';

const PRODUCTION_MUD_HOST = 'luminarimud.com';
const PRODUCTION_MUD_PORT = 4100;
const PRODUCTION_MUD_NAME = 'LuminariMUD';
const WEBSOCKET_CONNECTION_LIMIT_PER_IP = 4;

type Env = {
  ASSETS: Fetcher;
  MUD_ORIGIN_MTLS: Fetcher;
};

const websocketConnectionsByIp = new ActiveConnectionCounter(WEBSOCKET_CONNECTION_LIMIT_PER_IP);

const productionAppSettings: AppSettings = {
  ...appSettings,
  connection: {
    defaultHost: PRODUCTION_MUD_HOST,
    defaultPort: PRODUCTION_MUD_PORT,
    muds: [
      {
        id: 'luminari',
        name: PRODUCTION_MUD_NAME,
        host: PRODUCTION_MUD_HOST,
        port: PRODUCTION_MUD_PORT,
        description: 'The world of Lumia, hosted by LuminariMUD.',
      },
    ],
  },
};

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return handleHealthRequest(request);
    }

    if (url.pathname === '/api/settings') {
      return handleSettingsRequest(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Not found.' }, 404);
    }

    if (url.pathname === '/ws') {
      return handleWebSocketRequest(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function handleHealthRequest(request: Request) {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET');
  }

  return jsonResponse({ ok: true });
}

function handleSettingsRequest(request: Request) {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET');
  }

  return jsonResponse(productionAppSettings);
}

async function handleWebSocketRequest(request: Request, env: Env) {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET');
  }

  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade.', {
      status: 426,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        Upgrade: 'websocket',
      },
    });
  }

  if (!hasSameOrigin(request)) {
    return new Response('WebSocket origin is not allowed.', {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const connectionLease = websocketConnectionsByIp.acquire(clientIp);
  if (!connectionLease) {
    return new Response('Too many active connections.', {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': '30',
      },
    });
  }

  let upstream: RelayWebSocket;
  try {
    upstream = await openManagedMtlsWebSocket(env.MUD_ORIGIN_MTLS as unknown as ManagedMtlsFetcher);
  } catch {
    connectionLease.release();
    return secureGatewayUnavailable();
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  try {
    relayWebSockets(server as unknown as RelayWebSocket, upstream, () => connectionLease.release());
  } catch {
    connectionLease.release();
    return secureGatewayUnavailable();
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

function hasSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function secureGatewayUnavailable() {
  return new Response('The secure MUD gateway is unavailable.', {
    status: 502,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function methodNotAllowed(allowedMethod: string) {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: allowedMethod,
      'Cache-Control': 'no-store',
    },
  });
}
function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
