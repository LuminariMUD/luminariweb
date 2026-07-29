import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_BROWSER_MESSAGE_BYTES, parseClientMessage } from '../shared/client-message.ts';
import { defaultMsdpVariables } from '../shared/mud.ts';

test('parses heartbeat and connect messages from Worker-compatible payloads', () => {
  assert.deepEqual(parseClientMessage('{"type":"heartbeat"}'), {
    errorDetail: null,
    message: { type: 'heartbeat' },
  });

  const connectPayload = Buffer.from(
    JSON.stringify({
      type: 'connect',
      host: 'luminarimud.com',
      port: 4100,
      msdpVariables: defaultMsdpVariables,
    }),
  );
  const parsedConnect = parseClientMessage(connectPayload);

  assert.equal(parsedConnect.errorDetail, null);
  assert.equal(parsedConnect.message?.type, 'connect');
  if (parsedConnect.message?.type === 'connect') {
    assert.equal(parsedConnect.message.host, 'luminarimud.com');
    assert.equal(parsedConnect.message.port, 4100);
    assert.equal(parsedConnect.message.msdpVariables.serverId, 'SERVER_ID');
  }
});

test('rejects malformed, oversized, and invalid resize messages', () => {
  assert.equal(parseClientMessage('not json').message, null);
  assert.equal(parseClientMessage('x'.repeat(65_537)).message, null);

  const invalidResize = parseClientMessage(
    JSON.stringify({
      type: 'resize',
      columns: 1,
      rows: 1,
    }),
  );
  assert.equal(invalidResize.message, null);
  assert.equal(invalidResize.errorDetail, 'Received invalid terminal resize dimensions.');
});

test('the browser message cap is measured in UTF-8 bytes, not UTF-16 code units', () => {
  // Regression: browserMessageDataToString() compared String.length, so a
  // message of multi-byte text passed a byte-named limit at ~3x its stated
  // size. Each of these characters is 3 UTF-8 bytes.
  const multiByteFiller = '世'.repeat(30_000);
  const overCap = JSON.stringify({ type: 'input', text: multiByteFiller });

  assert.ok(
    overCap.length <= MAX_BROWSER_MESSAGE_BYTES,
    'fixture must be under the cap by code-unit count so it would have passed before',
  );
  assert.ok(
    Buffer.byteLength(overCap, 'utf8') > MAX_BROWSER_MESSAGE_BYTES,
    'fixture must be over the cap by byte count',
  );
  assert.equal(parseClientMessage(overCap).message, null);

  // A multi-byte message that genuinely fits still parses.
  const underCap = JSON.stringify({ type: 'input', text: '世'.repeat(1_000) });
  assert.ok(Buffer.byteLength(underCap, 'utf8') <= MAX_BROWSER_MESSAGE_BYTES);
  assert.equal(parseClientMessage(underCap).message?.type, 'input');

  // Binary frames were already measured in bytes and must stay that way.
  assert.equal(parseClientMessage(Buffer.alloc(MAX_BROWSER_MESSAGE_BYTES + 1, 0x20)).message, null);
});
