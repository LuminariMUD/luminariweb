import assert from 'node:assert/strict';
import test from 'node:test';
import { ActiveConnectionCounter } from '../server/connection-accounting.ts';
import {
  assertMudSocketHasNoNawsDimensions,
  assertMudSocketNawsDimensions,
  createProxyLifecycleHarness,
  getStatusDetails,
  msdpReadyPacket,
  msdpScalarPacket,
} from './helpers/proxy-lifecycle-harness.ts';
import { doNawsPacket } from './helpers/naws-packets.ts';

test('manual disconnect emits one disconnected status and ignores the resulting socket close', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  const mudSocket = harness.connect();
  assert.deepEqual(getStatusDetails(harness.browser), [
    'connecting:Connecting to mud.example.test:4000...',
  ]);

  mudSocket.emitConnect();
  assert.deepEqual(getStatusDetails(harness.browser), [
    'connecting:Connecting to mud.example.test:4000...',
    'connected:Connected to mud.example.test:4000.',
  ]);

  harness.session.disconnect('Disconnected.');
  assert.equal(mudSocket.destroyCount, 1);
  assert.deepEqual(getStatusDetails(harness.browser), [
    'connecting:Connecting to mud.example.test:4000...',
    'connected:Connected to mud.example.test:4000.',
    'disconnected:Disconnected.',
  ]);

  mudSocket.emitClose();
  harness.session.disconnect('Disconnected.');
  assert.deepEqual(getStatusDetails(harness.browser), [
    'connecting:Connecting to mud.example.test:4000...',
    'connected:Connected to mud.example.test:4000.',
    'disconnected:Disconnected.',
  ]);
});

test('MUD socket close emits one closed status for the active socket', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  harness.browser.clearMessages();

  mudSocket.emitClose();
  mudSocket.emitClose();

  assert.deepEqual(getStatusDetails(harness.browser), [
    'disconnected:Connection to mud.example.test:4000 closed.',
  ]);
});

test('runs 25 deterministic connect and disconnect cycles without stale socket cleanup', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  for (let cycle = 1; cycle <= 25; cycle += 1) {
    const port = 4100 + cycle;
    const mudSocket = harness.connect('cycle.example.test', port);
    mudSocket.emitConnect();
    mudSocket.emitData(msdpReadyPacket());

    assert.equal(mudSocket.noDelay, true, `cycle ${cycle} should enable TCP no-delay`);
    assert.ok(mudSocket.writtenChunks.length > 0, `cycle ${cycle} should initialize MSDP`);

    harness.session.disconnect('Disconnected.');
    assert.equal(mudSocket.destroyCount, 1, `cycle ${cycle} should destroy once`);
    assert.equal(mudSocket.destroyed, true, `cycle ${cycle} should leave socket destroyed`);
  }

  assert.equal(harness.mudSockets.length, 25);
  assert.equal(
    harness.browser.statusMessages.filter((message) => message.status === 'disconnected').length,
    25,
  );
});

test('browser close destroys active MUD socket and active connection accounting releases once', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  const mudSocket = harness.connect();
  mudSocket.emitConnect();

  harness.session.closeBrowser();
  harness.session.closeBrowser();

  assert.equal(mudSocket.destroyCount, 1);
  assert.equal(mudSocket.destroyed, true);
  assert.deepEqual(getStatusDetails(harness.browser), [
    'connecting:Connecting to mud.example.test:4000...',
    'connected:Connected to mud.example.test:4000.',
  ]);

  const counter = new ActiveConnectionCounter(1);
  const lease = counter.acquire('client-a');
  assert.ok(lease);
  assert.equal(counter.getActiveCount('client-a'), 1);
  assert.equal(counter.acquire('client-a'), null);

  assert.equal(lease.release(), true);
  assert.equal(lease.release(), false);
  assert.equal(counter.getActiveCount('client-a'), 0);
});

test('MUD socket close resets active lifecycle state and allows fresh MSDP readiness', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  const firstSocket = harness.connect();
  firstSocket.emitConnect();
  firstSocket.emitData(msdpReadyPacket());
  firstSocket.emitData(msdpScalarPacket('HEALTH', 12));

  assert.deepEqual(
    harness.browser.stateMessages.map((message) => message.state),
    [{ health: 12 }],
  );
  assert.ok(firstSocket.writtenChunks.length > 0);

  harness.browser.clearMessages();
  firstSocket.emitClose();

  assert.deepEqual(getStatusDetails(harness.browser), [
    'disconnected:Connection to mud.example.test:4000 closed.',
  ]);

  harness.session.sendInput('look');
  assert.deepEqual(getStatusDetails(harness.browser), [
    'disconnected:Connection to mud.example.test:4000 closed.',
    'error:Connect to a MUD before sending commands.',
  ]);

  harness.browser.clearMessages();
  const secondSocket = harness.connect();
  secondSocket.emitData(msdpReadyPacket());

  assert.notEqual(secondSocket, firstSocket);
  assert.ok(secondSocket.writtenChunks.length > 0);
  assert.deepEqual(getStatusDetails(harness.browser), [
    'connecting:Connecting to mud.example.test:4000...',
  ]);
});

test('MUD socket error resets lifecycle state and keeps error details stable', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  harness.session.sendInput('say secret-player-command');
  harness.browser.clearMessages();

  mudSocket.emitError(new Error('secret-player-command internal socket failure'));
  mudSocket.emitClose();

  assert.equal(mudSocket.destroyCount, 1);
  assert.deepEqual(getStatusDetails(harness.browser), [
    'error:Connection error. The MUD connection closed unexpectedly.',
  ]);
  assert.equal(harness.browser.rawMessages.join('\n').includes('secret-player-command'), false);
  assert.equal(harness.browser.rawMessages.join('\n').includes('internal socket failure'), false);

  harness.session.sendInput('look');
  assert.deepEqual(getStatusDetails(harness.browser), [
    'error:Connection error. The MUD connection closed unexpectedly.',
    'error:Connect to a MUD before sending commands.',
  ]);
});

test('reconnect after MSDP state ignores stale callbacks and stale state', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  const firstSocket = harness.connect();
  firstSocket.emitConnect();
  firstSocket.emitData(msdpReadyPacket());
  firstSocket.emitData(msdpScalarPacket('HEALTH', 12));

  assert.deepEqual(
    harness.browser.stateMessages.map((message) => message.state),
    [{ health: 12 }],
  );

  harness.browser.clearMessages();
  const secondSocket = harness.connect();
  assert.equal(firstSocket.destroyCount, 1);
  assert.deepEqual(getStatusDetails(harness.browser), [
    'connecting:Connecting to mud.example.test:4000...',
  ]);

  harness.browser.clearMessages();
  firstSocket.emitData(msdpScalarPacket('HEALTH', 99));
  firstSocket.emitError(new Error('stale socket error'));
  firstSocket.emitClose();

  assert.deepEqual(harness.browser.messages, []);

  secondSocket.emitConnect();
  secondSocket.emitData(msdpReadyPacket());
  secondSocket.emitData(msdpScalarPacket('PSP', 7));

  assert.deepEqual(getStatusDetails(harness.browser), [
    'connected:Connected to mud.example.test:4000.',
  ]);
  assert.deepEqual(
    harness.browser.stateMessages.map((message) => message.state),
    [{ psp: 7 }],
  );
});

test('terminal resize before connect and before NAWS negotiation uses latest dimensions', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  harness.session.updateTerminalDimensions({ columns: 140, rows: 50 });
  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  assertMudSocketHasNoNawsDimensions(mudSocket);

  harness.session.updateTerminalDimensions({ columns: 141, rows: 51 });
  assertMudSocketHasNoNawsDimensions(mudSocket);

  mudSocket.emitData(doNawsPacket());

  assertMudSocketNawsDimensions(mudSocket, [{ columns: 141, rows: 51 }]);
});

test('terminal resize after NAWS negotiation stops on disconnect and refreshes after reconnect', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());

  const firstSocket = harness.connect();
  firstSocket.emitConnect();
  firstSocket.emitData(doNawsPacket());
  harness.session.updateTerminalDimensions({ columns: 132, rows: 42 });

  assertMudSocketNawsDimensions(firstSocket, [
    { columns: 120, rows: 40 },
    { columns: 132, rows: 42 },
  ]);

  harness.session.disconnect('Disconnected.');
  const firstWriteCountAfterDisconnect = firstSocket.writtenChunks.length;
  harness.session.updateTerminalDimensions({ columns: 133, rows: 43 });
  firstSocket.emitData(doNawsPacket());

  assert.equal(firstSocket.writtenChunks.length, firstWriteCountAfterDisconnect);
  assertMudSocketNawsDimensions(firstSocket, [
    { columns: 120, rows: 40 },
    { columns: 132, rows: 42 },
  ]);

  const secondSocket = harness.connect();
  assertMudSocketHasNoNawsDimensions(secondSocket);
  secondSocket.emitData(doNawsPacket());

  assertMudSocketNawsDimensions(secondSocket, [{ columns: 133, rows: 43 }]);
});

test('connect timeout destroys only the pending active socket and resets lifecycle state', (t) => {
  const harness = createProxyLifecycleHarness({
    timeouts: {
      connectTimeoutMs: 25,
      idleTimeoutMs: 100,
    },
  });
  t.after(() => harness.cleanup());

  const mudSocket = harness.connect();
  assert.equal(harness.timers.fireNext(25), true);

  assert.equal(mudSocket.destroyCount, 1);
  assert.equal(mudSocket.destroyed, true);
  assert.deepEqual(getStatusDetails(harness.browser), [
    'connecting:Connecting to mud.example.test:4000...',
    'error:Connection timed out before the MUD accepted the connection.',
  ]);

  harness.browser.clearMessages();
  mudSocket.emitConnect();
  mudSocket.emitData(msdpReadyPacket());
  harness.session.sendInput('look');

  assert.deepEqual(getStatusDetails(harness.browser), [
    'error:Connect to a MUD before sending commands.',
  ]);
});

test('idle timeout destroys only the active connected socket without leaking command text', (t) => {
  const harness = createProxyLifecycleHarness({
    timeouts: {
      connectTimeoutMs: 25,
      idleTimeoutMs: 100,
    },
  });
  t.after(() => harness.cleanup());

  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  harness.session.sendInput('say secret-timeout-command');
  harness.browser.clearMessages();

  assert.equal(harness.timers.fireNext(100), true);

  assert.equal(mudSocket.destroyCount, 1);
  assert.deepEqual(getStatusDetails(harness.browser), [
    'disconnected:Connection closed after being idle too long.',
  ]);
  assert.equal(harness.browser.rawMessages.join('\n').includes('secret-timeout-command'), false);

  harness.session.sendInput('look');
  assert.deepEqual(getStatusDetails(harness.browser), [
    'disconnected:Connection closed after being idle too long.',
    'error:Connect to a MUD before sending commands.',
  ]);
});

test('heartbeat refreshes the active idle timeout without writing to the MUD', (t) => {
  const harness = createProxyLifecycleHarness({
    timeouts: {
      connectTimeoutMs: 25,
      idleTimeoutMs: 100,
    },
  });
  t.after(() => harness.cleanup());

  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  const firstIdleTimer = harness.timers.getLastTimer(100);
  const writeCountBeforeHeartbeat = mudSocket.writtenChunks.length;

  harness.session.keepAlive();
  const refreshedIdleTimer = harness.timers.getLastTimer(100);

  assert.equal(firstIdleTimer.cleared, true);
  assert.notEqual(refreshedIdleTimer, firstIdleTimer);
  assert.equal(mudSocket.writtenChunks.length, writeCountBeforeHeartbeat);

  harness.timers.fire(firstIdleTimer, { includeCleared: true });
  assert.equal(mudSocket.destroyed, false);

  harness.timers.fire(refreshedIdleTimer);
  assert.equal(mudSocket.destroyed, true);
});

test('stale connect and idle timeout callbacks are ignored after reconnect or activity', (t) => {
  const harness = createProxyLifecycleHarness({
    timeouts: {
      connectTimeoutMs: 25,
      idleTimeoutMs: 100,
    },
  });
  t.after(() => harness.cleanup());

  const firstSocket = harness.connect('first.example.test', 4001);
  const staleConnectTimer = harness.timers.getLastTimer(25);
  const secondSocket = harness.connect('second.example.test', 4002);
  assert.equal(firstSocket.destroyCount, 1);
  harness.browser.clearMessages();

  assert.equal(harness.timers.fire(staleConnectTimer, { includeCleared: true }), true);
  assert.equal(secondSocket.destroyed, false);
  assert.deepEqual(harness.browser.messages, []);

  secondSocket.emitConnect();
  const firstIdleTimer = harness.timers.getLastTimer(100);
  harness.session.sendInput('look');
  harness.browser.clearMessages();

  assert.equal(harness.timers.fire(firstIdleTimer, { includeCleared: true }), true);
  assert.equal(secondSocket.destroyed, false);
  assert.deepEqual(harness.browser.messages, []);
});

test('manual disconnect clears timeout callbacks without duplicate close statuses', (t) => {
  const harness = createProxyLifecycleHarness({
    timeouts: {
      connectTimeoutMs: 25,
      idleTimeoutMs: 100,
    },
  });
  t.after(() => harness.cleanup());

  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  const idleTimer = harness.timers.getLastTimer(100);

  harness.session.disconnect('Disconnected.');
  harness.browser.clearMessages();

  assert.equal(harness.timers.fire(idleTimer, { includeCleared: true }), true);
  mudSocket.emitClose();

  assert.equal(mudSocket.destroyCount, 1);
  assert.deepEqual(harness.browser.messages, []);
});
