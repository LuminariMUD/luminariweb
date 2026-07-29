import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  DO,
  DONT,
  IAC,
  MSDP_TABLE_CLOSE,
  MSDP_TABLE_OPEN,
  MSDP_VAL,
  MSDP_VAR,
  SB,
  SE,
  TELOPT_CHARSET,
  TELOPT_ECHO,
  TELOPT_MCCP,
  TELOPT_MSDP,
  TELOPT_NAWS,
  TELOPT_SGA,
  TELOPT_TTYPE,
  TTYPE_IS,
  TTYPE_SEND,
  TelnetParser,
  WEB_CLIENT_NAME,
  WILL,
  WONT,
  parseMsdpPayload,
} from '../server/telnet-parser.ts';
import {
  assertNawsDimensions,
  assertNoNawsDimensions,
  doNawsPacket,
  nawsSubnegotiationPacket,
  willNawsPacket,
} from './helpers/naws-packets.ts';
import { createCapturedTelnetTransport } from './helpers/telnet-test-socket.ts';
import type { MudValue } from '../shared/mud.ts';

type BufferPart = number | number[] | string | Buffer;

test('imports parser utilities without starting proxy server side effects', () => {
  const harness = createHarness();

  harness.parser.push(Buffer.from('smoke', 'utf8'));

  assert.equal(typeof TelnetParser, 'function');
  assert.deepEqual(harness.textEvents, ['smoke']);
  assert.equal(harness.transport.writeCount, 0);
  assert.deepEqual(parseMsdpPayload(packet([MSDP_VAR], 'HEALTH', [MSDP_VAL], '1')), [
    ['HEALTH', 1],
  ]);
});

test('handles split IAC sequences with explicit callback order', () => {
  const harness = createHarness();

  harness.parser.push(packet('look', [IAC]));
  assert.deepEqual(harness.events, ['text:look']);
  assert.deepEqual(harness.transport.getBytes(), []);

  harness.parser.push(packet([WILL]));
  assert.deepEqual(harness.events, ['text:look']);
  assert.deepEqual(harness.transport.getBytes(), []);

  harness.parser.push(packet([TELOPT_MSDP], ' after'));

  assert.deepEqual(harness.events, ['text:look', 'msdp-ready', 'text: after']);
  assert.equal(harness.msdpReadyCount, 1);
  assert.deepEqual(harness.transport.getBytes(), [IAC, DO, TELOPT_MSDP]);
});

test('treats doubled IAC as literal data while preserving UTF-8 decoder state', () => {
  const harness = createHarness();
  const expectedText = Buffer.concat([
    Buffer.from([0xc3, 0xa9]),
    Buffer.from([IAC]),
    Buffer.from(' ', 'utf8'),
    Buffer.from([0xe2, 0x82, 0xac]),
  ]).toString('utf8');

  harness.parser.push(Buffer.from([0xc3]));
  harness.parser.push(packet([0xa9, IAC]));
  harness.parser.push(packet([IAC, 0x20, 0xe2]));
  harness.parser.push(Buffer.from([0x82, 0xac]));

  assert.equal(harness.textEvents.join(''), expectedText);
  assert.equal(harness.transport.writeCount, 0);
});

test('flushes text around WILL, WONT, DO, and DONT negotiation bytes', () => {
  const harness = createHarness();

  harness.parser.push(
    packet(
      'before',
      [IAC, WILL, TELOPT_ECHO],
      'middle',
      [IAC, WONT, TELOPT_SGA],
      'after',
      [IAC, DO, TELOPT_TTYPE],
      'tail',
      [IAC, DONT, TELOPT_TTYPE],
      'done',
    ),
  );

  assert.deepEqual(harness.textEvents, ['before', 'middle', 'after', 'tail', 'done']);
  assert.deepEqual(harness.transport.getBytes(), [IAC, DO, TELOPT_ECHO, IAC, WILL, TELOPT_TTYPE]);
});

test('emits MSDP subnegotiation pairs only after complete boundaries', () => {
  const harness = createHarness();
  const frame = subnegotiation(
    TELOPT_MSDP,
    [MSDP_VAR],
    'HEALTH',
    [MSDP_VAL],
    '42',
    [MSDP_VAR],
    'ROOM',
    [MSDP_VAL, MSDP_TABLE_OPEN, MSDP_VAR],
    'name',
    [MSDP_VAL],
    'Training Room',
    [MSDP_TABLE_CLOSE],
  );

  harness.parser.push(frame.subarray(0, frame.length - 2));
  assert.deepEqual(harness.msdpPairs, []);

  harness.parser.push(frame.subarray(frame.length - 2));

  assert.deepEqual(harness.msdpPairs, [
    ['HEALTH', 42],
    ['ROOM', { name: 'Training Room' }],
  ]);
  assert.deepEqual(harness.textEvents, []);
});

test('malformed and partial MSDP boundaries do not throw or emit stale callbacks', () => {
  const partialHarness = createHarness();
  const malformedHarness = createHarness();

  assert.doesNotThrow(() => {
    partialHarness.parser.push(
      packet([IAC, SB, TELOPT_MSDP, MSDP_VAR], 'HEALTH', [MSDP_VAL], '99'),
    );
  });
  assert.deepEqual(partialHarness.msdpPairs, []);

  assert.doesNotThrow(() => {
    malformedHarness.parser.push(subnegotiation(TELOPT_MSDP, [MSDP_VAR], 'HEALTH'));
  });
  assert.deepEqual(malformedHarness.msdpPairs, []);

  assert.doesNotThrow(() => {
    malformedHarness.parser.push(subnegotiation(TELOPT_MSDP, [MSDP_VAR], 'PSP', [MSDP_VAL], '9'));
  });
  assert.deepEqual(malformedHarness.msdpPairs, [['PSP', 9]]);
});

test('captures TTYPE SEND, NAWS, and unsupported-option negotiation responses', () => {
  const harness = createHarness();

  harness.parser.push(packet([IAC, DO, TELOPT_TTYPE]));
  harness.parser.push(subnegotiation(TELOPT_TTYPE, [TTYPE_SEND]));
  harness.parser.push(packet([IAC, DO, TELOPT_NAWS]));
  harness.parser.push(packet([IAC, WILL, TELOPT_MCCP]));
  harness.parser.push(packet([IAC, DO, TELOPT_CHARSET]));
  harness.parser.push(packet([IAC, WILL, 99]));
  harness.parser.push(packet([IAC, DO, 98]));

  assert.deepEqual(
    harness.transport.getBytes(),
    Array.from(
      packet(
        [IAC, WILL, TELOPT_TTYPE],
        [IAC, SB, TELOPT_TTYPE, TTYPE_IS],
        WEB_CLIENT_NAME,
        [IAC, SE],
        willNawsPacket(),
        nawsSubnegotiationPacket({ columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS }),
        [IAC, DONT, TELOPT_MCCP],
        [IAC, WONT, TELOPT_CHARSET],
        [IAC, DONT, 99],
        [IAC, WONT, 98],
      ),
    ),
  );
});

test('sends custom initial NAWS dimensions after negotiation', () => {
  const harness = createHarness();

  harness.parser.updateTerminalSize({ columns: 132, rows: 44 });
  harness.parser.push(doNawsPacket());

  assert.deepEqual(
    harness.transport.getBytes(),
    Array.from(
      packet(
        willNawsPacket(),
        nawsSubnegotiationPacket({
          columns: 132,
          rows: 44,
        }),
      ),
    ),
  );
  assertNawsDimensions(harness.transport.getChunks(), [{ columns: 132, rows: 44 }]);
});

test('sends changed NAWS dimensions only after support is negotiated', () => {
  const harness = createHarness();

  harness.parser.updateTerminalSize({ columns: 101, rows: 31 });
  assertNoNawsDimensions(harness.transport.getChunks());

  harness.parser.push(doNawsPacket());
  harness.parser.updateTerminalSize({ columns: 102, rows: 32 });
  harness.parser.updateTerminalSize({ columns: 102, rows: 32 });

  assertNawsDimensions(harness.transport.getChunks(), [
    { columns: 101, rows: 31 },
    { columns: 102, rows: 32 },
  ]);
});

test('clears buffered parser state on close without stale re-entry callbacks', () => {
  const harness = createHarness();

  harness.parser.push(Buffer.from([0xc3]));
  harness.parser.push(packet([IAC, SB, TELOPT_MSDP, MSDP_VAR], 'HEALTH', [MSDP_VAL], '99'));
  harness.parser.close();
  harness.parser.push(packet('fresh'));
  harness.parser.push(subnegotiation(TELOPT_MSDP, [MSDP_VAR], 'PSP', [MSDP_VAL], '9'));

  assert.deepEqual(harness.textEvents, ['fresh']);
  assert.deepEqual(harness.msdpPairs, [['PSP', 9]]);
});

function createHarness() {
  const transport = createCapturedTelnetTransport();
  const textEvents: string[] = [];
  const msdpPairs: Array<[string, MudValue]> = [];
  const events: string[] = [];
  let msdpReadyCount = 0;
  const parser = new TelnetParser(transport, {
    onText: (text) => {
      textEvents.push(text);
      events.push(`text:${text}`);
    },
    onMsdp: (variable, value) => {
      msdpPairs.push([variable, value]);
      events.push(`msdp:${variable}`);
    },
    onMsdpReady: () => {
      msdpReadyCount += 1;
      events.push('msdp-ready');
    },
  });

  return {
    events,
    msdpPairs,
    parser,
    textEvents,
    transport,
    get msdpReadyCount() {
      return msdpReadyCount;
    },
  };
}

function subnegotiation(option: number, ...payload: BufferPart[]) {
  return packet([IAC, SB, option], ...payload, [IAC, SE]);
}

function packet(...parts: BufferPart[]) {
  return Buffer.concat(parts.map(toBuffer));
}

function toBuffer(part: BufferPart) {
  if (typeof part === 'number') {
    return Buffer.from([part]);
  }

  if (typeof part === 'string') {
    return Buffer.from(part, 'utf8');
  }

  return Buffer.from(part);
}
