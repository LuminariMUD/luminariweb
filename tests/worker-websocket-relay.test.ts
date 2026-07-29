import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MUD_ORIGIN_GATEWAY_ORIGIN,
  MUD_ORIGIN_GATEWAY_URL,
  openManagedMtlsWebSocket,
  relayWebSockets,
  type ManagedMtlsFetcher,
  type RelayEvent,
  type RelayPayload,
  type RelayWebSocket,
} from '../worker/websocket-relay.ts';

class FakeRelayWebSocket implements RelayWebSocket {
  readonly acceptOptions: Array<{ allowHalfOpen?: boolean } | undefined> = [];
  binaryType: 'arraybuffer' | 'blob' = 'blob';
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readyState = 0;
  readonly sent: RelayPayload[] = [];
  throwFromAccept = false;
  throwFromSend = false;
  private readonly listeners = new Map<string, Array<(event: RelayEvent) => void>>();

  accept(options?: { allowHalfOpen?: boolean }) {
    if (this.throwFromAccept) {
      throw new Error('PRIVATE-UPSTREAM-ACCEPT-DETAIL');
    }
    this.acceptOptions.push(options);
    this.readyState = 1;
  }

  addEventListener(event: 'close' | 'error' | 'message', listener: (event: RelayEvent) => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }

  send(data: RelayPayload) {
    if (this.throwFromSend) {
      throw new Error('PRIVATE-UPSTREAM-SEND-DETAIL');
    }
    this.sent.push(data);
  }

  emit(event: 'close' | 'error' | 'message', value: RelayEvent = {}) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value);
    }
  }
}

test('managed-mTLS fetch uses only the fixed HTTPS WebSocket origin', async () => {
  const upstream = new FakeRelayWebSocket();
  const observed: Array<{ init?: RequestInit; input: string }> = [];
  const fetcher: ManagedMtlsFetcher = {
    async fetch(input, init) {
      observed.push({ init, input });
      return {
        body: null,
        webSocket: upstream,
      } as unknown as Response;
    },
  };

  const result = await openManagedMtlsWebSocket(fetcher);

  assert.equal(result, upstream);
  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.input, MUD_ORIGIN_GATEWAY_URL);
  assert.equal(observed[0]?.init?.method, 'GET');
  assert.deepEqual(observed[0]?.init?.headers, {
    'Cache-Control': 'no-store',
    Origin: MUD_ORIGIN_GATEWAY_ORIGIN,
    Upgrade: 'websocket',
  });
});

test('managed-mTLS fetch failures expose only a generic error', async () => {
  for (const fetcher of [
    {
      async fetch() {
        throw new Error('PRIVATE-CERTIFICATE-DETAIL /secret/path');
      },
    },
    {
      async fetch() {
        return {
          body: null,
          webSocket: null,
        } as unknown as Response;
      },
    },
  ] satisfies ManagedMtlsFetcher[]) {
    await assert.rejects(() => openManagedMtlsWebSocket(fetcher), {
      message: 'Secure MUD gateway connection failed.',
    });
  }
});

test('relay preserves text and binary frames in both directions', () => {
  const browser = new FakeRelayWebSocket();
  const upstream = new FakeRelayWebSocket();
  let releaseCount = 0;
  relayWebSockets(browser, upstream, () => {
    releaseCount += 1;
  });

  assert.deepEqual(browser.acceptOptions, [{ allowHalfOpen: true }]);
  assert.deepEqual(upstream.acceptOptions, [{ allowHalfOpen: true }]);
  assert.equal(browser.binaryType, 'arraybuffer');
  assert.equal(upstream.binaryType, 'arraybuffer');

  const browserBinary = Uint8Array.from([1, 2, 3]).buffer;
  const upstreamBinary = Uint8Array.from([4, 5, 6]);
  browser.emit('message', { data: 'browser text' });
  browser.emit('message', { data: browserBinary });
  upstream.emit('message', { data: 'upstream text' });
  upstream.emit('message', { data: upstreamBinary });

  assert.deepEqual(upstream.sent, ['browser text', browserBinary]);
  assert.deepEqual(browser.sent, ['upstream text', upstreamBinary]);
  assert.equal(releaseCount, 0);
});

test('close and error races close both peers and release exactly once', () => {
  const browser = new FakeRelayWebSocket();
  const upstream = new FakeRelayWebSocket();
  let releaseCount = 0;
  relayWebSockets(browser, upstream, () => {
    releaseCount += 1;
  });

  browser.emit('close', {
    code: 1000,
  });
  upstream.emit('error');
  browser.emit('error');

  assert.equal(releaseCount, 1);
  assert.deepEqual(browser.closeCalls, [
    {
      code: 1000,
      reason: 'Gateway connection closed.',
    },
  ]);
  assert.deepEqual(upstream.closeCalls, [
    {
      code: 1000,
      reason: 'Gateway connection closed.',
    },
  ]);
});

test('send and accept failures fail closed without exposing upstream detail', () => {
  {
    const browser = new FakeRelayWebSocket();
    const upstream = new FakeRelayWebSocket();
    upstream.throwFromSend = true;
    let releaseCount = 0;
    relayWebSockets(browser, upstream, () => {
      releaseCount += 1;
    });

    browser.emit('message', { data: 'sensitive invented command' });

    assert.equal(releaseCount, 1);
    assert.deepEqual(browser.closeCalls, [
      {
        code: 1011,
        reason: 'Gateway transport error.',
      },
    ]);
    assert.equal(JSON.stringify(browser.closeCalls).includes('PRIVATE-UPSTREAM'), false);
    assert.equal(JSON.stringify(browser.closeCalls).includes('sensitive invented'), false);
  }

  {
    const browser = new FakeRelayWebSocket();
    const upstream = new FakeRelayWebSocket();
    upstream.throwFromAccept = true;
    let releaseCount = 0;

    assert.throws(
      () =>
        relayWebSockets(browser, upstream, () => {
          releaseCount += 1;
        }),
      {
        message: 'Secure MUD gateway connection failed.',
      },
    );
    assert.equal(releaseCount, 1);
  }
});
