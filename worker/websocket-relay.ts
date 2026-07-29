export const MUD_ORIGIN_GATEWAY_URL = 'https://mud-origin.luminarimud.com/gateway/ws';
export const MUD_ORIGIN_GATEWAY_ORIGIN = 'https://mud-origin.luminarimud.com';

const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;
const NORMAL_CLOSE_CODE = 1000;
const INTERNAL_ERROR_CLOSE_CODE = 1011;
const GENERIC_CLOSE_REASON = 'Gateway connection closed.';
const GENERIC_ERROR_REASON = 'Gateway transport error.';

export type RelayPayload = string | ArrayBuffer | ArrayBufferView;

export type RelayEvent = {
  code?: number;
  data?: RelayPayload;
};

export type RelayWebSocket = {
  accept(options?: { allowHalfOpen?: boolean }): void;
  addEventListener(
    event: 'close' | 'error' | 'message',
    listener: (event: RelayEvent) => void,
  ): void;
  binaryType: 'arraybuffer' | 'blob';
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  send(data: RelayPayload): void;
};

export type ManagedMtlsFetcher = {
  fetch(input: string, init?: RequestInit): Promise<Response>;
};

export async function openManagedMtlsWebSocket(fetcher: ManagedMtlsFetcher) {
  let response: Response;

  try {
    response = await fetcher.fetch(MUD_ORIGIN_GATEWAY_URL, {
      headers: {
        'Cache-Control': 'no-store',
        Origin: MUD_ORIGIN_GATEWAY_ORIGIN,
        Upgrade: 'websocket',
      },
      method: 'GET',
    });
  } catch {
    throw secureGatewayError();
  }

  const upstream = response.webSocket;
  if (!upstream) {
    void response.body?.cancel().catch(() => undefined);
    throw secureGatewayError();
  }

  return upstream as unknown as RelayWebSocket;
}

export function relayWebSockets(
  browser: RelayWebSocket,
  upstream: RelayWebSocket,
  release: () => void,
) {
  let terminated = false;

  const terminate = (code: number, reason: string) => {
    if (terminated) {
      return;
    }

    terminated = true;
    release();
    closeWebSocket(browser, code, reason);
    closeWebSocket(upstream, code, reason);
  };

  const relay = (source: RelayWebSocket, destination: RelayWebSocket) => {
    source.addEventListener('message', (event) => {
      if (terminated || event.data === undefined) {
        return;
      }

      if (destination.readyState !== WEBSOCKET_OPEN) {
        terminate(INTERNAL_ERROR_CLOSE_CODE, GENERIC_ERROR_REASON);
        return;
      }

      try {
        destination.send(event.data);
      } catch {
        terminate(INTERNAL_ERROR_CLOSE_CODE, GENERIC_ERROR_REASON);
      }
    });

    source.addEventListener('close', (event) => {
      terminate(normalizeCloseCode(event.code), GENERIC_CLOSE_REASON);
    });

    source.addEventListener('error', () => {
      terminate(INTERNAL_ERROR_CLOSE_CODE, GENERIC_ERROR_REASON);
    });
  };

  browser.binaryType = 'arraybuffer';
  upstream.binaryType = 'arraybuffer';
  relay(browser, upstream);
  relay(upstream, browser);

  try {
    upstream.accept({ allowHalfOpen: true });
    browser.accept({ allowHalfOpen: true });
  } catch {
    terminate(INTERNAL_ERROR_CLOSE_CODE, GENERIC_ERROR_REASON);
    throw secureGatewayError();
  }
}

function normalizeCloseCode(code: number | undefined) {
  if (
    code === undefined ||
    code < NORMAL_CLOSE_CODE ||
    code === 1004 ||
    code === 1005 ||
    code === 1006 ||
    code === 1015 ||
    code > 4999
  ) {
    return NORMAL_CLOSE_CODE;
  }

  return code;
}

function closeWebSocket(socket: RelayWebSocket, code: number, reason: string) {
  if (socket.readyState !== WEBSOCKET_OPEN && socket.readyState !== WEBSOCKET_CONNECTING) {
    return;
  }

  try {
    socket.close(code, reason);
  } catch {
    return;
  }
}

function secureGatewayError() {
  return new Error('Secure MUD gateway connection failed.');
}
