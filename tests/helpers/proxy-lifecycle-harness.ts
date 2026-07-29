import { EventEmitter } from 'node:events';
import { IAC, MSDP_VAL, MSDP_VAR, SB, SE, TELOPT_MSDP, WILL } from '../../server/telnet-parser.ts';
import { MudSession } from '../../server/mud-session.ts';
import type {
  BrowserSocket,
  MudSessionTimerApi,
  MudSessionTimeoutSettings,
  MudSocket,
  MudSocketAddress,
} from '../../server/mud-session.ts';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../../shared/mud.ts';
import type { MsdpVariableMap, ServerMessage, TerminalDimensions } from '../../shared/mud.ts';
import {
  assertNawsDimensions,
  assertNoNawsDimensions,
  getNawsDimensionsFromWrites,
} from './naws-packets.ts';

const BROWSER_SOCKET_OPEN_STATE = 1;
const BROWSER_SOCKET_CLOSED_STATE = 3;

export class FakeBrowserSocket implements BrowserSocket {
  readyState = BROWSER_SOCKET_OPEN_STATE;
  readonly rawMessages: string[] = [];
  readonly messages: ServerMessage[] = [];

  send(data: string) {
    if (this.readyState !== BROWSER_SOCKET_OPEN_STATE) {
      throw new Error('Cannot send to a closed fake browser socket.');
    }

    this.rawMessages.push(data);
    this.messages.push(JSON.parse(data) as ServerMessage);
  }

  close() {
    this.readyState = BROWSER_SOCKET_CLOSED_STATE;
  }

  clearMessages() {
    this.rawMessages.length = 0;
    this.messages.length = 0;
  }

  get statusMessages() {
    return this.messages.filter(isConnectionStatusMessage);
  }

  get stateMessages() {
    return this.messages.filter(isStateMessage);
  }

  get terminalMessages() {
    return this.messages.filter(isTerminalMessage);
  }
}

export class FakeMudSocket extends EventEmitter implements MudSocket {
  destroyed = false;
  noDelay = false;
  destroyCount = 0;
  readonly writtenChunks: Buffer[] = [];
  readonly address: MudSocketAddress;

  constructor(address: MudSocketAddress) {
    super();
    this.address = address;
  }

  setNoDelay(noDelay: boolean) {
    this.noDelay = noDelay;
  }

  write(chunk: string | Buffer) {
    if (this.destroyed) {
      throw new Error('Cannot write to a destroyed fake MUD socket.');
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

  emitConnect() {
    this.emit('connect');
  }

  emitData(chunk: string | Buffer) {
    this.emit('data', typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
  }

  emitError(error = new Error('Synthetic MUD socket error.')) {
    this.emit('error', error);
  }

  emitClose() {
    if (!this.destroyed) {
      this.destroyed = true;
    }

    this.emit('close');
  }

  getWrittenBytes() {
    return Array.from(Buffer.concat(this.writtenChunks));
  }

  getWrittenText() {
    return Buffer.concat(this.writtenChunks).toString('utf8');
  }

  /** Drop everything written so far, so a test can assert on what follows. */
  clearWritten() {
    this.writtenChunks.length = 0;
  }

  getWrittenNawsDimensions() {
    return getNawsDimensionsFromWrites(this.writtenChunks);
  }
}

export type FakeMudSessionTimer = {
  cleared: boolean;
  delayMs: number;
  listener: () => void;
};

export class FakeMudSessionTimerController {
  readonly timers: FakeMudSessionTimer[] = [];
  readonly api: MudSessionTimerApi = {
    clearTimeout: (handle) => {
      if (isFakeMudSessionTimer(handle)) {
        handle.cleared = true;
      }
    },
    setTimeout: (listener, delayMs) => {
      const timer: FakeMudSessionTimer = {
        cleared: false,
        delayMs,
        listener,
      };
      this.timers.push(timer);
      return timer;
    },
  };

  get activeTimers() {
    return this.timers.filter((timer) => !timer.cleared);
  }

  getLastTimer(delayMs?: number) {
    const timers = delayMs ? this.timers.filter((timer) => timer.delayMs === delayMs) : this.timers;
    const timer = timers.at(-1);
    if (!timer) {
      throw new Error('Expected a fake session timer to exist.');
    }

    return timer;
  }

  fire(timer: FakeMudSessionTimer, options: { includeCleared?: boolean } = {}) {
    if (timer.cleared && !options.includeCleared) {
      return false;
    }

    timer.cleared = true;
    timer.listener();
    return true;
  }

  fireNext(delayMs?: number) {
    const timer = this.activeTimers.find((activeTimer) =>
      delayMs === undefined ? true : activeTimer.delayMs === delayMs,
    );
    if (!timer) {
      return false;
    }

    return this.fire(timer);
  }
}

export type ProxyLifecycleHarnessOptions = {
  timerController?: FakeMudSessionTimerController;
  timeouts?: Partial<MudSessionTimeoutSettings>;
  /** Controllable clock so transfer timeouts are testable without real time. */
  now?: () => number;
};

export function createProxyLifecycleHarness(options: ProxyLifecycleHarnessOptions = {}) {
  const browser = new FakeBrowserSocket();
  const mudSockets: FakeMudSocket[] = [];
  const timerController = options.timerController ?? new FakeMudSessionTimerController();
  const session = new MudSession(browser, {
    createMudSocket: (address) => {
      const socket = new FakeMudSocket(address);
      mudSockets.push(socket);
      return socket;
    },
    timerApi: timerController.api,
    timeouts: options.timeouts,
    now: options.now,
  });

  return {
    browser,
    session,
    mudSockets,
    timers: timerController,
    connect(host = 'mud.example.test', port = 4000) {
      session.connect(host, port, normalizeMsdpVariableMap(defaultMsdpVariables));
      return getLastMudSocket(mudSockets);
    },
    connectDestination(
      destination: MudSocketAddress,
      msdpVariables: MsdpVariableMap = normalizeMsdpVariableMap(defaultMsdpVariables),
    ) {
      session.connect(destination.host, destination.port, msdpVariables);
      return getLastMudSocket(mudSockets);
    },
    cleanup() {
      session.closeBrowser();
      for (const socket of mudSockets) {
        socket.destroy();
      }
      browser.close();
    },
    get lastMudSocket() {
      return getLastMudSocket(mudSockets);
    },
  };
}

export function msdpReadyPacket() {
  return Buffer.from([IAC, WILL, TELOPT_MSDP]);
}

export function msdpScalarPacket(variable: string, value: string | number) {
  return Buffer.concat([
    Buffer.from([IAC, SB, TELOPT_MSDP, MSDP_VAR]),
    Buffer.from(variable, 'utf8'),
    Buffer.from([MSDP_VAL]),
    Buffer.from(String(value), 'utf8'),
    Buffer.from([IAC, SE]),
  ]);
}

export function getStatusDetails(browser: FakeBrowserSocket) {
  return browser.statusMessages.map((message) => `${message.status}:${message.detail}`);
}

export function assertMudSocketNawsDimensions(
  socket: FakeMudSocket,
  expectedDimensions: readonly TerminalDimensions[],
) {
  assertNawsDimensions(socket.writtenChunks, expectedDimensions);
}

export function assertMudSocketHasNoNawsDimensions(socket: FakeMudSocket) {
  assertNoNawsDimensions(socket.writtenChunks);
}

function getLastMudSocket(sockets: readonly FakeMudSocket[]) {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error('Expected a fake MUD socket to have been created.');
  }

  return socket;
}

function isFakeMudSessionTimer(handle: unknown): handle is FakeMudSessionTimer {
  return (
    !!handle &&
    typeof handle === 'object' &&
    'cleared' in handle &&
    'delayMs' in handle &&
    'listener' in handle
  );
}

function isConnectionStatusMessage(
  message: ServerMessage,
): message is Extract<ServerMessage, { type: 'connection-status' }> {
  return message.type === 'connection-status';
}

function isStateMessage(
  message: ServerMessage,
): message is Extract<ServerMessage, { type: 'state' }> {
  return message.type === 'state';
}

function isTerminalMessage(
  message: ServerMessage,
): message is Extract<ServerMessage, { type: 'terminal' }> {
  return message.type === 'terminal';
}
