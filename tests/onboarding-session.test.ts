import assert from 'node:assert/strict';
import test from 'node:test';
import { DONT, IAC, TELOPT_ECHO, WILL, WONT } from '../server/telnet-parser.ts';
import {
  characterMenuChoiceIds,
  ONBOARDING_CAPABILITY_VARIABLE,
  ONBOARDING_MSDP_VARIABLE,
  ONBOARDING_PROTOCOL_VERSION,
  onboardingLimits,
} from '../shared/onboarding.ts';
import type { ServerMessage } from '../shared/mud.ts';
import { createProxyLifecycleHarness, msdpReadyPacket } from './helpers/proxy-lifecycle-harness.ts';
import {
  makeAccountLobbyState,
  makeCharacterMenuState,
  makeOnboardingState,
  makePasswordState,
  onboardingMsdpPacket,
} from './helpers/onboarding-fixtures.ts';

function messagesOfType<T extends ServerMessage['type']>(
  harness: ReturnType<typeof createProxyLifecycleHarness>,
  type: T,
) {
  return harness.browser.messages.filter(
    (message): message is Extract<ServerMessage, { type: T }> => message.type === type,
  );
}

function connectedHarness(t: { after: (fn: () => void) => void }) {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());
  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  mudSocket.emitData(msdpReadyPacket());
  harness.browser.clearMessages();
  return { harness, mudSocket };
}

test('the proxy announces onboarding capability during MSDP negotiation', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());
  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  mudSocket.emitData(msdpReadyPacket());

  const written = mudSocket.getWrittenText();
  assert.ok(written.includes(ONBOARDING_CAPABILITY_VARIABLE));
  assert.ok(written.includes(String(ONBOARDING_PROTOCOL_VERSION)));
});

test('a valid onboarding payload becomes a typed browser message with a session phase', (t) => {
  const { harness, mudSocket } = connectedHarness(t);

  mudSocket.emitData(onboardingMsdpPacket(makeAccountLobbyState()));

  const states = messagesOfType(harness, 'onboarding-state');
  assert.equal(states.length, 1);
  assert.equal(states[0].phase, 'account');
  assert.equal(states[0].state.screen, 'account-menu');
  assert.equal(states[0].state.characters.length, 2);
});

test('malformed and oversized payloads fall back to the terminal instead of throwing', (t) => {
  const { harness, mudSocket } = connectedHarness(t);

  mudSocket.emitData(onboardingMsdpPacket('this is not json'));
  mudSocket.emitData(onboardingMsdpPacket('x'.repeat(onboardingLimits.maxPayloadBytes + 1)));

  const fallbacks = messagesOfType(harness, 'onboarding-fallback');
  assert.deepEqual(
    fallbacks.map((message) => message.reason),
    ['malformed-payload', 'payload-too-large'],
  );
});

test('an out-of-order revision does not reopen an earlier screen', (t) => {
  const { harness, mudSocket } = connectedHarness(t);

  mudSocket.emitData(onboardingMsdpPacket(makeOnboardingState({ revision: 4 })));
  mudSocket.emitData(onboardingMsdpPacket(makeOnboardingState({ revision: 2, screen: 'name' })));

  const states = messagesOfType(harness, 'onboarding-state');
  assert.equal(states.length, 1);
  assert.equal(states[0].state.revision, 4);
});

test('Telnet ECHO negotiation is reported to the browser as sensitive input', (t) => {
  const { harness, mudSocket } = connectedHarness(t);

  mudSocket.emitData(Buffer.from([IAC, WILL, TELOPT_ECHO]));
  mudSocket.emitData(Buffer.from([IAC, WONT, TELOPT_ECHO]));

  assert.deepEqual(
    messagesOfType(harness, 'sensitive-input').map((message) => message.sensitive),
    [true, false],
  );

  // The proxy must also answer the negotiation so the MUD stops echoing.
  const written = mudSocket.getWrittenBytes();
  assert.ok(written.join(',').includes([IAC, DONT, TELOPT_ECHO].join(',')));
});

test('a structured password screen does not poison later non-password screens', (t) => {
  const { harness, mudSocket } = connectedHarness(t);

  mudSocket.emitData(onboardingMsdpPacket(makePasswordState()));
  mudSocket.emitData(
    onboardingMsdpPacket(
      makeOnboardingState({
        revision: 2,
        screen: 'name',
        title: 'Name your character',
        prompt: 'Enter the name your character will be known by.',
        inputKind: 'text',
        sensitiveInput: false,
        choices: [],
        actions: ['submit', 'classic-terminal'],
      }),
    ),
  );

  const states = messagesOfType(harness, 'onboarding-state');
  assert.equal(states.length, 2);
  assert.equal(states[0].state.sensitiveInput, true);
  assert.equal(states[1].state.screen, 'name');
  assert.equal(states[1].state.sensitiveInput, false);
  assert.equal(messagesOfType(harness, 'sensitive-input').length, 0);
});

test('a valid action is translated to the exact line the MUD expects', (t) => {
  const { harness, mudSocket } = connectedHarness(t);
  const state = makeOnboardingState();
  mudSocket.emitData(onboardingMsdpPacket(state));
  mudSocket.writtenChunks.length = 0;

  harness.session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: 'moonelf',
  });

  assert.equal(mudSocket.getWrittenText(), 'Moon Elf\n');
});

test('the selected-character play action reaches the existing MUD menu', (t) => {
  const { harness, mudSocket } = connectedHarness(t);
  const state = makeCharacterMenuState();
  mudSocket.emitData(onboardingMsdpPacket(state));
  mudSocket.writtenChunks.length = 0;

  harness.session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: characterMenuChoiceIds.enterGame,
  });

  assert.equal(mudSocket.getWrittenText(), '1\n');
});

test('a stale action is rejected without touching the MUD socket', (t) => {
  const { harness, mudSocket } = connectedHarness(t);
  const state = makeOnboardingState({ revision: 9 });
  mudSocket.emitData(onboardingMsdpPacket(state));
  mudSocket.writtenChunks.length = 0;

  harness.session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: 8,
    action: 'select',
    choiceId: 'human',
  });

  assert.equal(mudSocket.getWrittenText(), '');
  const rejections = messagesOfType(harness, 'onboarding-rejected');
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0].code, 'stale-revision');
});

test('disconnecting clears onboarding state so private data cannot linger', (t) => {
  const { harness, mudSocket } = connectedHarness(t);
  mudSocket.emitData(onboardingMsdpPacket(makeAccountLobbyState()));
  harness.browser.clearMessages();

  harness.session.disconnect('Disconnected.');

  const fallbacks = messagesOfType(harness, 'onboarding-fallback');
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].reason, 'disconnected');

  // Actions issued after the clear must not reach the MUD.
  harness.session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: 'fixture-flow',
    revision: 1,
    action: 'select',
    choiceId: 'human',
  });
  const rejections = messagesOfType(harness, 'onboarding-rejected');
  assert.equal(rejections.at(-1)?.code, 'no-state');
});

test('play mode ends the structured flow without leaving state behind', (t) => {
  const { harness, mudSocket } = connectedHarness(t);
  mudSocket.emitData(
    onboardingMsdpPacket(
      makeOnboardingState({
        mode: 'play',
        screen: 'handoff',
        inputKind: 'none',
        choices: [],
        actions: [],
      }),
    ),
  );

  const states = messagesOfType(harness, 'onboarding-state');
  assert.equal(states.at(-1)?.phase, 'playing');

  harness.session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: 'fixture-flow',
    revision: 1,
    action: 'select',
    choiceId: 'human',
  });
  assert.equal(messagesOfType(harness, 'onboarding-rejected').at(-1)?.code, 'no-state');
});

test('the onboarding variable never leaks into the ordinary MSDP HUD state', (t) => {
  const { harness, mudSocket } = connectedHarness(t);
  mudSocket.emitData(onboardingMsdpPacket(makeOnboardingState()));

  assert.equal(messagesOfType(harness, 'state').length, 0);
  assert.ok(!JSON.stringify(harness.browser.messages).includes(`"${ONBOARDING_MSDP_VARIABLE}"`));
});

test('onboarding actions have their own rate budget', (t) => {
  const { harness } = connectedHarness(t);

  let allowed = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (harness.session.allowOnboardingAction()) {
      allowed += 1;
    }
  }

  assert.equal(allowed, 30);
  // The ordinary command budget is untouched by gallery clicking.
  assert.equal(harness.session.allowCommandInput(), true);
});
