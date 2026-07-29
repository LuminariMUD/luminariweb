import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { appSettings } from '../shared/app-settings.ts';
import { parseClientMessage } from '../shared/client-message.ts';
import { isEditorTransferClientMessage } from '../shared/onboarding-transfer.ts';
import { normalizeMsdpVariableMap } from '../shared/mud.ts';
import type { ClientMessage } from '../shared/mud.ts';
import { ActiveConnectionCounter } from './connection-accounting.ts';
import { createGatewayRuntime } from './gateway-runtime.ts';
import { MudSession } from './mud-session.ts';
import {
  checkWebSocketOrigin,
  createProxyPolicy,
  validateProxyDestination,
} from './proxy-policy.ts';
import { SlidingWindowRateLimiter } from './rate-limiter.ts';

const HTTP_RATE_LIMIT_WINDOW_MS = 10_000;
const HTTP_RATE_LIMIT_MAX_REQUESTS = 25;
/**
 * Concurrent WebSockets permitted from one IP.
 *
 * Tunable because the sensible value depends on deployment: a shared NAT or
 * an automated browser suite legitimately opens several, while a public
 * deployment wants it tight. Clamped so a typo cannot disable the limit.
 */
const WS_CONNECTION_LIMIT_PER_IP = parseConnectionLimit(process.env.WS_CONNECTION_LIMIT_PER_IP, 4);

function parseConnectionLimit(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 64) {
    return fallback;
  }

  return parsed;
}
/** LuminariMUD's default listening port, used for the local development preset. */
const DEFAULT_LOCAL_MUD_PORT = 4100;
const port = Number(process.env.PORT ?? appSettings.ports.server);
const gatewayRuntime = createGatewayRuntime();
const proxyPolicy = createProxyPolicy({
  env: process.env,
  localOriginPorts: [
    appSettings.ports.client,
    appSettings.ports.server,
    appSettings.ports.preview,
    port,
  ],
  presets: appSettings.connection.muds,
});
/**
 * When the development opt-in is on, offer the local MUD as a one-click preset
 * and make it the default, so testing a locally running server does not mean
 * retyping a host and port. This never appears on a normal deployment: it is
 * gated on the same flag that permits loopback destinations at all.
 */
const servedAppSettings = buildServedAppSettings();

function buildServedAppSettings() {
  if (!proxyPolicy.allowLocalDestinations) {
    return appSettings;
  }

  const localPort = parseLocalMudPort(process.env.LOCAL_MUD_PORT);
  const localPreset = {
    id: 'local-development',
    name: 'Local development MUD',
    host: '127.0.0.1',
    port: localPort,
    description: 'A MUD running on this machine. Development only.',
  };

  return {
    ...appSettings,
    connection: {
      ...appSettings.connection,
      defaultHost: localPreset.host,
      defaultPort: localPreset.port,
      muds: [localPreset, ...appSettings.connection.muds],
    },
  };
}

function parseLocalMudPort(value: string | undefined) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_LOCAL_MUD_PORT;
  }

  return parsed;
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const httpRateLimiters = new Map<string, SlidingWindowRateLimiter>();
const websocketConnectionsByIp = new ActiveConnectionCounter(WS_CONNECTION_LIMIT_PER_IP);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, '../client');

app.get('/health', rateLimitHttpRequests, (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/settings', rateLimitHttpRequests, (_request, response) => {
  response.json(servedAppSettings);
});

/*
 * Fingerprinted client and onboarding-media files are bounded, read-only
 * content. Do not charge them to the dynamic-route request budget: one
 * structured screen can legitimately load more than 25 responsive renditions
 * at once, and the Cloudflare deployment likewise serves these through its
 * asset binding rather than an application rate limiter.
 */
app.use(express.static(clientDist));

app.get(/^(?!\/ws).*/, rateLimitHttpRequests, (_request, response) => {
  response.sendFile(path.join(clientDist, 'index.html'));
});

wss.on('connection', (socket, request) => {
  const originDecision = checkWebSocketOrigin(proxyPolicy, request.headers.origin);
  if (!originDecision.allowed) {
    socket.close(1008, originDecision.detail);
    return;
  }

  const clientIp = getRemoteAddress(request);
  const connectionLease = websocketConnectionsByIp.acquire(clientIp);

  if (!connectionLease) {
    socket.close(1013, 'Too many active connections.');
    return;
  }

  const session = new MudSession(socket, {
    createMudSocket: gatewayRuntime.createMudSocket,
    timeouts: {
      connectTimeoutMs: proxyPolicy.timeouts.connectTimeoutMs,
      idleTimeoutMs: proxyPolicy.timeouts.idleTimeoutMs,
    },
  });
  let activeConnectValidationToken: number | null = null;
  let nextConnectValidationToken = 0;

  socket.on('message', (data) => {
    void handleBrowserMessage(data);
  });

  async function handleBrowserMessage(data: unknown) {
    const parsedMessage = parseClientMessage(data);
    const message = parsedMessage.message;
    if (!message) {
      session.sendStatus('error', parsedMessage.errorDetail);
      return;
    }

    if (message.type === 'input' && !session.allowCommandInput()) {
      session.sendStatus('error', 'Command rate limit exceeded. Slow down and retry.');
      return;
    }

    if (message.type === 'connect') {
      await handleConnectMessage(message);
      return;
    }

    if (message.type === 'disconnect') {
      cancelPendingConnectValidation();
      session.disconnect('Disconnected.');
      return;
    }

    if (message.type === 'msdp-config') {
      session.updateMsdpVariables(normalizeMsdpVariableMap(message.msdpVariables));
      return;
    }

    if (message.type === 'heartbeat') {
      session.keepAlive();
      return;
    }

    if (message.type === 'onboarding-action') {
      if (!session.allowOnboardingAction()) {
        session.sendStatus('error', 'Too many onboarding actions. Slow down and retry.');
        return;
      }

      session.sendOnboardingAction(message);
      return;
    }

    if (isEditorTransferClientMessage(message)) {
      // Chunks are deliberately outside the onboarding action budget: one save
      // is legitimately several messages. The session applies its own separate
      // commit count and byte budget.
      session.handleEditorTransfer(message);
      return;
    }

    if (message.type === 'resize') {
      session.updateTerminalDimensions({
        columns: message.columns,
        rows: message.rows,
      });
      return;
    }

    session.sendInput(message.text);
  }

  async function handleConnectMessage(message: Extract<ClientMessage, { type: 'connect' }>) {
    if (activeConnectValidationToken !== null) {
      session.sendStatus('error', 'A connection request is already in progress.');
      return;
    }

    const connectValidationToken = nextConnectValidationToken + 1;
    nextConnectValidationToken = connectValidationToken;
    activeConnectValidationToken = connectValidationToken;

    try {
      const destinationDecision = await validateProxyDestination(proxyPolicy, {
        host: message.host,
        port: message.port,
      });

      if (activeConnectValidationToken !== connectValidationToken) {
        return;
      }

      activeConnectValidationToken = null;

      if (!destinationDecision.allowed) {
        session.sendStatus('error', destinationDecision.detail);
        return;
      }

      session.connect(
        destinationDecision.value.host,
        destinationDecision.value.port,
        normalizeMsdpVariableMap(message.msdpVariables),
      );
    } catch {
      if (activeConnectValidationToken !== connectValidationToken) {
        return;
      }

      activeConnectValidationToken = null;
      session.sendStatus('error', 'This MUD destination could not be verified.');
    }
  }

  function cancelPendingConnectValidation() {
    if (activeConnectValidationToken === null) {
      return;
    }

    activeConnectValidationToken = null;
    nextConnectValidationToken += 1;
  }

  socket.on('close', () => {
    cancelPendingConnectValidation();
    connectionLease.release();
    session.closeBrowser();
  });
});

const handleListening = () => {
  const listenHost = gatewayRuntime.listenHost ?? 'all interfaces';
  console.log(`LuminariWebClient proxy listening on ${listenHost}:${port}`);
};

if (gatewayRuntime.listenHost) {
  server.listen(port, gatewayRuntime.listenHost, handleListening);
} else {
  server.listen(port, handleListening);
}

function rateLimitHttpRequests(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  const clientIp = getRemoteAddress(request);
  const limiter = getHttpRateLimiter(clientIp);
  const result = limiter.allow();

  response.setHeader('X-RateLimit-Limit', String(HTTP_RATE_LIMIT_MAX_REQUESTS));
  response.setHeader('X-RateLimit-Remaining', String(result.remaining));
  response.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAtMs / 1000)));

  if (!result.allowed) {
    response.setHeader(
      'Retry-After',
      String(Math.max(1, Math.ceil((result.resetAtMs - Date.now()) / 1000))),
    );
    response.status(429).json({ error: 'Too many requests.' });
    return;
  }

  next();
}

function getHttpRateLimiter(clientIp: string) {
  const existingLimiter = httpRateLimiters.get(clientIp);
  if (existingLimiter) {
    return existingLimiter;
  }

  const limiter = new SlidingWindowRateLimiter(
    HTTP_RATE_LIMIT_WINDOW_MS,
    HTTP_RATE_LIMIT_MAX_REQUESTS,
  );
  httpRateLimiters.set(clientIp, limiter);
  pruneStaleRateLimiters();
  return limiter;
}

function pruneStaleRateLimiters() {
  const now = Date.now();

  for (const [clientIp, limiter] of httpRateLimiters) {
    if (limiter.isStale(now)) {
      httpRateLimiters.delete(clientIp);
    }
  }
}

function getRemoteAddress(request: IncomingMessage | express.Request) {
  return request.socket.remoteAddress ?? 'unknown';
}
