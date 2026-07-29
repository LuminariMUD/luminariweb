import assert from 'node:assert/strict';
import test from 'node:test';
import {
  characterMenuChoiceIds,
  ONBOARDING_PROTOCOL_VERSION_MAX,
  isOnboardingActionMessage,
  onboardingLimits,
  parseOnboardingState,
  resolveOnboardingAction,
  sessionPhaseForState,
} from '../shared/onboarding.ts';
import {
  makeAccountLobbyState,
  makeCharacterMenuState,
  makeOnboardingState,
  makePasswordState,
} from './helpers/onboarding-fixtures.ts';

test('a well-formed state parses and keeps its server-supplied fields', () => {
  const result = parseOnboardingState(makeOnboardingState());
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.state.screen, 'race');
  assert.equal(result.state.choices.length, 2);
  assert.equal(result.state.choices[0].wireValue, 'Human');
  assert.deepEqual(result.state.actions, ['select', 'detail', 'classic-terminal']);
});

test('a future protocol version is reported as version skew, not a parse failure', () => {
  const result = parseOnboardingState(
    makeOnboardingState({ version: ONBOARDING_PROTOCOL_VERSION_MAX + 1 }),
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'version-skew');
});

test('an unknown screen falls back rather than rendering an empty shell', () => {
  const result = parseOnboardingState({
    ...makeOnboardingState(),
    screen: 'some-future-screen',
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'version-skew');
});

test('missing flowId, revision, or mode is rejected', () => {
  for (const field of ['flowId', 'revision', 'mode'] as const) {
    const state: Record<string, unknown> = { ...makeOnboardingState() };
    delete state[field];
    const result = parseOnboardingState(state);
    assert.equal(result.ok, false, `expected ${field} to be required`);
  }
});

test('oversized choice and character lists are rejected instead of truncated', () => {
  const tooManyChoices = parseOnboardingState(
    makeOnboardingState({
      choices: Array.from({ length: onboardingLimits.maxChoices + 1 }, (_, index) => ({
        id: `choice-${index}`,
        label: `Choice ${index}`,
        wireValue: `${index}`,
        enabled: true,
      })),
    }),
  );
  assert.equal(tooManyChoices.ok, false);
  assert.ok(!tooManyChoices.ok);
  assert.equal(tooManyChoices.reason, 'payload-too-large');
});

test('control characters are stripped from server text', () => {
  const result = parseOnboardingState(
    makeOnboardingState({ title: 'Choose\u0007 your\u0000 ancestry' }),
  );
  assert.ok(result.ok);
  assert.equal(result.state.title, 'Choose your ancestry');
});

test('over-long strings are rejected rather than silently cut', () => {
  const result = parseOnboardingState(
    makeOnboardingState({ title: 'x'.repeat(onboardingLimits.maxShortText + 1) }),
  );
  assert.equal(result.ok, false);
});

test('a password screen is treated as sensitive even without the flag', () => {
  const result = parseOnboardingState({
    ...makePasswordState(),
    sensitiveInput: false,
  });
  assert.ok(result.ok);
  assert.equal(result.state.sensitiveInput, true);
});

test('duplicate choice and character ids are collapsed', () => {
  const base = makeOnboardingState();
  const result = parseOnboardingState({
    ...base,
    choices: [base.choices[0], base.choices[0], base.choices[1]],
  });
  assert.ok(result.ok);
  assert.equal(result.state.choices.length, 2);
});

test('session phase is derived from mode, never from connection status', () => {
  assert.equal(sessionPhaseForState(makeAccountLobbyState()), 'account');
  assert.equal(sessionPhaseForState(makeOnboardingState()), 'creating');
  assert.equal(sessionPhaseForState(makeCharacterMenuState()), 'character');
  assert.equal(sessionPhaseForState(makeOnboardingState({ mode: 'play' })), 'playing');
});

test('a stale revision cannot mutate a later state', () => {
  const state = makeOnboardingState({ revision: 5 });
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: 4,
    action: 'select',
    choiceId: 'human',
  });
  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.code, 'stale-revision');
});

test('an action from a previous connection is rejected', () => {
  const state = makeOnboardingState();
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: 'a-different-flow',
    revision: state.revision,
    action: 'select',
    choiceId: 'human',
  });
  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.code, 'stale-flow');
});

test('an action the screen does not offer is rejected', () => {
  const state = makeOnboardingState();
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'quit',
  });
  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.code, 'action-not-allowed');
});

test('a locked choice cannot be selected even if the browser asks', () => {
  const state = makeOnboardingState({
    choices: [
      {
        id: 'locked',
        label: 'Locked Ancestry',
        wireValue: 'Locked Ancestry',
        enabled: false,
        lockReason: 'Not unlocked on this account.',
      },
    ],
  });
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: 'locked',
  });
  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.code, 'choice-locked');
});

test('selecting a valid choice resolves to the exact server-supplied wire value', () => {
  const state = makeOnboardingState();
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: 'moonelf',
  });
  assert.ok(resolved.ok);
  assert.equal(resolved.line, 'Moon Elf');
  assert.equal(resolved.sensitive, false);
});

test('selecting an account character resolves to its menu number', () => {
  const state = makeAccountLobbyState();
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: 'Fixtureb',
  });
  assert.ok(resolved.ok);
  assert.equal(resolved.line, '2');
});

test('the selected-character menu can enter play, open role-play, or return to the account', () => {
  const state = { ...makeCharacterMenuState(), version: 2 };
  const enterGame = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: characterMenuChoiceIds.enterGame,
  });
  const accountMenu = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: characterMenuChoiceIds.accountMenu,
  });
  const roleplayProfile = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: characterMenuChoiceIds.roleplayProfile,
  });

  assert.ok(enterGame.ok);
  assert.equal(enterGame.line, '1');
  assert.ok(accountMenu.ok);
  assert.equal(accountMenu.line, '0');
  assert.ok(roleplayProfile.ok);
  assert.equal(roleplayProfile.line, '2');
});

test('selected-character compatibility choices are gated to the exact menu state', () => {
  const state = makeOnboardingState();
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    choiceId: characterMenuChoiceIds.enterGame,
  });

  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.code, 'unknown-choice');

  const characterMenu = makeCharacterMenuState();
  const detail = resolveOnboardingAction(characterMenu, {
    type: 'onboarding-action',
    flowId: characterMenu.flowId,
    revision: characterMenu.revision,
    action: 'detail',
    choiceId: characterMenuChoiceIds.enterGame,
  });
  assert.equal(detail.ok, false);
  assert.ok(!detail.ok);
  assert.equal(detail.code, 'unknown-choice');

  const inheritedProperty = resolveOnboardingAction(characterMenu, {
    type: 'onboarding-action',
    flowId: characterMenu.flowId,
    revision: characterMenu.revision,
    action: 'select',
    choiceId: 'toString',
  });
  assert.equal(inheritedProperty.ok, false);
  assert.ok(!inheritedProperty.ok);
  assert.equal(inheritedProperty.code, 'unknown-choice');
});

test('a submitted password is marked sensitive so it is never echoed or stored', () => {
  const state = makePasswordState();
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'submit',
    value: 'synthetic-value',
  });
  assert.ok(resolved.ok);
  assert.equal(resolved.sensitive, true);
});

test('confirm and reselect map onto the existing y/n prompts', () => {
  const state = makeOnboardingState({
    screen: 'race-detail',
    inputKind: 'confirm',
    actions: ['confirm', 'reselect', 'classic-terminal'],
  });
  const confirm = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'confirm',
  });
  const reselect = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'reselect',
  });
  assert.ok(confirm.ok);
  assert.equal(confirm.line, 'y');
  assert.ok(reselect.ok);
  assert.equal(reselect.line, 'n');
});

test('the account-link cancel action maps to its server-authorized return command', () => {
  const state = makeOnboardingState({
    mode: 'account',
    screen: 'account-link',
    inputKind: 'text',
    choices: [],
    actions: ['submit', 'cancel', 'classic-terminal'],
  });
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'cancel',
  });

  assert.ok(resolved.ok);
  assert.equal(resolved.line, 'q');
  assert.equal(resolved.sensitive, false);
});

test('cancel remains rejected on screens without an explicit server return path', () => {
  const state = makeOnboardingState({ actions: ['cancel', 'classic-terminal'] });
  const resolved = resolveOnboardingAction(state, {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'cancel',
  });

  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.code, 'cancel-not-supported');
});

test('action messages are validated before they reach the session', () => {
  assert.equal(
    isOnboardingActionMessage({
      type: 'onboarding-action',
      flowId: 'f',
      revision: 1,
      action: 'select',
      choiceId: 'human',
    }),
    true,
  );
  assert.equal(isOnboardingActionMessage({ type: 'onboarding-action' }), false);
  assert.equal(
    isOnboardingActionMessage({
      type: 'onboarding-action',
      flowId: 'f',
      revision: 1.5,
      action: 'select',
    }),
    false,
  );
  assert.equal(
    isOnboardingActionMessage({
      type: 'onboarding-action',
      flowId: 'f',
      revision: 1,
      action: 'drop-database',
    }),
    false,
  );
  assert.equal(
    isOnboardingActionMessage({
      type: 'onboarding-action',
      flowId: 'f',
      revision: 1,
      action: 'submit',
      value: 'x'.repeat(onboardingLimits.maxShortText + 1),
    }),
    false,
  );
});
