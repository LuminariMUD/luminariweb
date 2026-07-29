import type { ConnectionStatus } from './mud.ts';

export type BrowserNetworkState = 'online' | 'offline';

export type NetworkStatusKind =
  | 'browser-offline'
  | 'proxy-unavailable'
  | 'mud-connected'
  | 'mud-connecting'
  | 'mud-disconnected'
  | 'mud-error'
  | 'ready';

export type NetworkStatusMessage = {
  kind: NetworkStatusKind;
  browserState: BrowserNetworkState;
  browserLabel: string;
  proxyLabel: string;
  mudLabel: string;
  title: string;
  detail: string;
  canStartConnection: boolean;
  canSendCommand: boolean;
  canUseReconnect: boolean;
};

export type NetworkStatusInput = {
  browserOnline: boolean;
  proxyReady: boolean;
  connectionStatus: ConnectionStatus;
  statusDetail?: string;
};

export type ServiceWorkerCapabilityReason =
  | 'supported'
  | 'missing-service-worker'
  | 'insecure-context';

export type ServiceWorkerCapability = {
  supported: boolean;
  reason: ServiceWorkerCapabilityReason;
  message: string;
};

export type ServiceWorkerCapabilityInput = {
  hasServiceWorker: boolean;
  isSecureContext: boolean;
};

export type ServiceWorkerFetchDecisionReason =
  | 'static-shell'
  | 'non-get'
  | 'cross-origin'
  | 'api-route'
  | 'websocket-route'
  | 'upgrade-request'
  | 'unsupported-url'
  | 'non-static-route';

export type ServiceWorkerFetchDecision = {
  cacheable: boolean;
  reason: ServiceWorkerFetchDecisionReason;
};

export type ServiceWorkerRequestSnapshot = {
  url: string;
  origin: string;
  method?: string;
  headers?: Record<string, string | undefined>;
};

const STATIC_ASSET_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.ico',
  '.js',
  '.png',
  '.svg',
  '.webmanifest',
  '.webp',
  '.woff',
  '.woff2',
]);

export function buildNetworkStatusMessage(input: NetworkStatusInput): NetworkStatusMessage {
  const browserState = getBrowserNetworkState(input.browserOnline);
  const browserLabel = browserState === 'online' ? 'Browser online' : 'Browser offline';
  const proxyLabel = input.proxyReady ? 'Proxy ready' : 'Proxy unavailable';
  const mudLabel = getMudStatusLabel(input.connectionStatus);

  if (!input.browserOnline) {
    return {
      kind: 'browser-offline',
      browserState,
      browserLabel,
      proxyLabel,
      mudLabel,
      title: 'Browser network offline',
      detail: 'Reconnect and command sending require a live browser network, proxy, and MUD route.',
      canStartConnection: false,
      canSendCommand: false,
      canUseReconnect: false,
    };
  }

  if (!input.proxyReady) {
    return {
      kind: 'proxy-unavailable',
      browserState,
      browserLabel,
      proxyLabel,
      mudLabel,
      title: 'Proxy unavailable',
      detail: input.statusDetail || 'The local WebSocket proxy is not ready yet.',
      canStartConnection: false,
      canSendCommand: false,
      canUseReconnect: false,
    };
  }

  switch (input.connectionStatus) {
    case 'idle':
      return {
        kind: 'ready',
        browserState,
        browserLabel,
        proxyLabel,
        mudLabel,
        title: 'Ready to connect',
        detail: input.statusDetail || 'Choose a MUD and connect when ready.',
        canStartConnection: true,
        canSendCommand: false,
        canUseReconnect: true,
      };
    case 'connecting':
      return {
        kind: 'mud-connecting',
        browserState,
        browserLabel,
        proxyLabel,
        mudLabel,
        title: 'Connecting',
        detail: input.statusDetail || 'A MUD connection request is already in progress.',
        canStartConnection: false,
        canSendCommand: false,
        canUseReconnect: false,
      };
    case 'connected':
      return {
        kind: 'mud-connected',
        browserState,
        browserLabel,
        proxyLabel,
        mudLabel,
        title: 'MUD connected',
        detail: input.statusDetail || 'Commands are sent live through the WebSocket proxy.',
        canStartConnection: false,
        canSendCommand: true,
        canUseReconnect: false,
      };
    case 'disconnected':
      return {
        kind: 'mud-disconnected',
        browserState,
        browserLabel,
        proxyLabel,
        mudLabel,
        title: 'MUD disconnected',
        detail: input.statusDetail || 'Reconnect when the remote MUD route is available.',
        canStartConnection: true,
        canSendCommand: false,
        canUseReconnect: true,
      };
    case 'error':
      return {
        kind: 'mud-error',
        browserState,
        browserLabel,
        proxyLabel,
        mudLabel,
        title: 'Connection error',
        detail: input.statusDetail || 'Reconnect after checking the proxy and MUD route.',
        canStartConnection: true,
        canSendCommand: false,
        canUseReconnect: true,
      };
    default:
      return assertNever(input.connectionStatus);
  }
}

export function getServiceWorkerCapability(
  input: ServiceWorkerCapabilityInput,
): ServiceWorkerCapability {
  if (!input.hasServiceWorker) {
    return {
      supported: false,
      reason: 'missing-service-worker',
      message: 'Service workers are not available in this browser.',
    };
  }

  if (!input.isSecureContext) {
    return {
      supported: false,
      reason: 'insecure-context',
      message: 'Service workers require HTTPS or a localhost secure context.',
    };
  }

  return {
    supported: true,
    reason: 'supported',
    message: 'Service-worker registration is supported.',
  };
}

export function getServiceWorkerRegistrationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return `Service-worker registration failed: ${error.message}`;
  }

  return 'Service-worker registration failed.';
}

export function getServiceWorkerFetchDecision(
  request: ServiceWorkerRequestSnapshot,
): ServiceWorkerFetchDecision {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return { cacheable: false, reason: 'non-get' };
  }

  if (getHeaderValue(request.headers, 'upgrade')?.toLowerCase() === 'websocket') {
    return { cacheable: false, reason: 'upgrade-request' };
  }

  let url: URL;
  try {
    url = new URL(request.url, request.origin);
  } catch {
    return { cacheable: false, reason: 'unsupported-url' };
  }

  if (url.origin !== request.origin) {
    return { cacheable: false, reason: 'cross-origin' };
  }

  if (isApiRoute(url.pathname)) {
    return { cacheable: false, reason: 'api-route' };
  }

  if (isWebSocketRoute(url.pathname)) {
    return { cacheable: false, reason: 'websocket-route' };
  }

  if (isStaticShellPath(url.pathname)) {
    return { cacheable: true, reason: 'static-shell' };
  }

  return { cacheable: false, reason: 'non-static-route' };
}

export function getBrowserNetworkState(browserOnline: boolean): BrowserNetworkState {
  return browserOnline ? 'online' : 'offline';
}

function getMudStatusLabel(status: ConnectionStatus) {
  switch (status) {
    case 'idle':
      return 'MUD idle';
    case 'connecting':
      return 'MUD connecting';
    case 'connected':
      return 'MUD connected';
    case 'disconnected':
      return 'MUD disconnected';
    case 'error':
      return 'MUD error';
    default:
      return assertNever(status);
  }
}

function isApiRoute(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isWebSocketRoute(pathname: string) {
  return pathname === '/ws' || pathname.startsWith('/ws/');
}

function isStaticShellPath(pathname: string) {
  if (pathname === '/' || pathname === '/index.html') {
    return true;
  }

  if (pathname.startsWith('/assets/')) {
    return Boolean(getStaticExtension(pathname));
  }

  return STATIC_ASSET_EXTENSIONS.has(getStaticExtension(pathname));
}

function getStaticExtension(pathname: string) {
  const extensionStart = pathname.lastIndexOf('.');
  return extensionStart >= 0 ? pathname.slice(extensionStart).toLowerCase() : '';
}

function getHeaderValue(headers: Record<string, string | undefined> | undefined, name: string) {
  if (!headers) {
    return undefined;
  }

  const normalizedName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return value;
    }
  }

  return undefined;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled PWA support value: ${String(value)}`);
}
