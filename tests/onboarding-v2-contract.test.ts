/**
 * Protocol v2 contract tests.
 *
 * The recurring theme: a v1 source must never be able to drive a v2 surface,
 * and the browser must never invent an affordance the source did not offer.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ONBOARDING_PROTOCOL_VERSION_MAX,
  ONBOARDING_SUPPORTED_VERSIONS,
  parseOnboardingState,
  resolveOnboardingAction,
  roleplayScreens,
  sessionPhaseForState,
} from '../shared/onboarding.ts';
import type { OnboardingActionMessage, OnboardingState } from '../shared/onboarding.ts';
import {
  makeCatalogState,
  makeEditorState,
  makeForcedShortDescriptionState,
  makeOnboardingState,
  makeRoleplayHubState,
} from './helpers/onboarding-fixtures.ts';

function action(
  state: OnboardingState,
  overrides: Partial<OnboardingActionMessage>,
): OnboardingActionMessage {
  return {
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: 'select',
    ...overrides,
  };
}

// --- negotiation -----------------------------------------------------------

test('both v1 and v2 are supported, highest first', () => {
  assert.deepEqual([...ONBOARDING_SUPPORTED_VERSIONS], [2, 1]);
  assert.equal(ONBOARDING_PROTOCOL_VERSION_MAX, 2);
});

test('a v1 state still parses unchanged', () => {
  const result = parseOnboardingState(makeOnboardingState());
  assert.ok(result.ok);
  assert.equal(result.state.version, 1);
  // v2-only fields must be absent, not defaulted into existence.
  assert.equal(result.state.profile, undefined);
  assert.equal(result.state.editor, undefined);
  assert.equal(result.state.persistenceResult, undefined);
});

test('a v1 state naming a role-play screen is version skew, not a render', () => {
  for (const screen of ['roleplay-hub', 'background-story'] as const) {
    const result = parseOnboardingState(makeOnboardingState({ version: 1, screen }));
    assert.ok(!result.ok, `${screen} must not parse at v1`);
    assert.equal(result.reason, 'version-skew');
  }
});

test('a v1 state cannot smuggle v2 fields or v2 actions', () => {
  const result = parseOnboardingState({
    ...makeOnboardingState(),
    version: 1,
    profile: [
      {
        id: 'profile/age',
        label: 'Age',
        wireValue: '9',
        status: 'unset',
        mutable: true,
      },
    ],
    editor: { fieldId: 'background-story', maxBytes: 49_152, contentRevision: 1 },
    persistenceResult: 'saved',
    actions: ['select', 'open', 'save-text'],
  });

  assert.ok(result.ok);
  assert.equal(result.state.profile, undefined);
  assert.equal(result.state.editor, undefined);
  assert.equal(result.state.persistenceResult, undefined);
  // v2-only actions are dropped; the legitimate v1 action survives.
  assert.deepEqual(result.state.actions, ['select']);
});

test('every role-play screen parses at v2', () => {
  for (const screen of roleplayScreens) {
    const result = parseOnboardingState(
      makeOnboardingState({ version: 2, mode: 'roleplay-profile', screen }),
    );
    assert.ok(result.ok, `${screen} must parse at v2`);
    assert.equal(result.state.screen, screen);
  }
});

test('the role-play mode maps to the structured creating phase', () => {
  const result = parseOnboardingState(makeRoleplayHubState());
  assert.ok(result.ok);
  assert.equal(sessionPhaseForState(result.state), 'creating');
});

// --- hub -------------------------------------------------------------------

test('hub item statuses survive parsing and closed statuses are never mutable', () => {
  const result = parseOnboardingState(makeRoleplayHubState());
  assert.ok(result.ok);
  const items = result.state.profile ?? [];
  assert.equal(items.length, 4);

  const byId = new Map(items.map((item) => [item.id, item]));
  assert.equal(byId.get('profile/short-description')?.status, 'unset');
  assert.equal(byId.get('profile/background-story')?.status, 'configured');
  assert.equal(byId.get('profile/age')?.status, 'locked');
  assert.equal(byId.get('profile/faction')?.status, 'unavailable');

  // Even if a source claimed mutable:true, a locked/unavailable/error item is
  // forced closed rather than trusted.
  for (const status of ['locked', 'unavailable', 'error'] as const) {
    const forced = parseOnboardingState(
      makeRoleplayHubState({
        profile: [
          {
            id: 'profile/age',
            label: 'Age',
            wireValue: '9',
            status,
            mutable: true,
            required: false,
          },
        ],
      }),
    );
    assert.ok(forced.ok);
    assert.equal(forced.state.profile?.[0].mutable, false, `${status} must not be mutable`);
  }
});

test('opening a hub item uses its server-offered wire value and respects mutability', () => {
  const result = parseOnboardingState(makeRoleplayHubState());
  assert.ok(result.ok);
  const state = result.state;

  const opened = resolveOnboardingAction(
    state,
    action(state, { action: 'open', choiceId: 'profile/background-story' }),
  );
  assert.ok(opened.ok);
  assert.equal(opened.line, '2');

  const locked = resolveOnboardingAction(
    state,
    action(state, { action: 'open', choiceId: 'profile/age' }),
  );
  assert.ok(!locked.ok);
  assert.equal(locked.code, 'item-not-mutable');

  const unknown = resolveOnboardingAction(
    state,
    action(state, { action: 'open', choiceId: 'profile/invented' }),
  );
  assert.ok(!unknown.ok);
  assert.equal(unknown.code, 'unknown-choice');
});

// --- forced gate -----------------------------------------------------------

test('the forced short-description gate cannot be cancelled', () => {
  const result = parseOnboardingState({
    ...makeForcedShortDescriptionState(),
    // Even if `cancel` were offered and given a wire value, `blocking` wins.
    actions: ['continue', 'cancel', 'classic-terminal'],
    controlWire: { continue: '', cancel: '0' },
  });
  assert.ok(result.ok);
  const state = result.state;
  assert.equal(state.blocking, true);

  const cancelled = resolveOnboardingAction(state, action(state, { action: 'cancel' }));
  assert.ok(!cancelled.ok);
  assert.equal(cancelled.code, 'cancel-not-allowed');

  // The player can still reach the classic terminal from the gate.
  assert.ok(state.actions.includes('classic-terminal'));
});

// --- control wire and pagination -------------------------------------------

test('control actions require a server-offered wire value', () => {
  const withWire = parseOnboardingState(makeCatalogState());
  assert.ok(withWire.ok);
  const paged = resolveOnboardingAction(
    withWire.state,
    action(withWire.state, { action: 'next-page' }),
  );
  assert.ok(paged.ok);
  assert.equal(paged.line, 'n');

  const withoutWire = parseOnboardingState(makeCatalogState({ controlWire: undefined }));
  assert.ok(withoutWire.ok);
  const rejected = resolveOnboardingAction(
    withoutWire.state,
    action(withoutWire.state, { action: 'next-page' }),
  );
  assert.ok(!rejected.ok);
  assert.equal(rejected.code, 'no-wire-value');
});

test('short-description review uses its server-offered numeric control values', () => {
  const result = parseOnboardingState(
    makeOnboardingState({
      version: 2,
      mode: 'roleplay-profile',
      screen: 'short-desc-review',
      title: 'Your description',
      prompt: 'Keep it or start again.',
      inputKind: 'choice',
      persistence: 'none',
      choices: [],
      actions: ['confirm', 'reselect', 'continue', 'cancel', 'classic-terminal'],
      controlWire: { confirm: '1', reselect: '2', continue: '3', cancel: '0' },
    }),
  );
  assert.ok(result.ok);

  for (const [name, expected] of [
    ['confirm', '1'],
    ['reselect', '2'],
    ['continue', '3'],
    ['cancel', '0'],
  ] as const) {
    const resolved = resolveOnboardingAction(result.state, action(result.state, { action: name }));
    assert.ok(resolved.ok);
    assert.equal(resolved.line, expected);
  }
});

test('pagination cannot step outside the page window the server published', () => {
  const first = parseOnboardingState(
    makeCatalogState({
      page: { index: 0, count: 3 },
      actions: ['select', 'next-page', 'previous-page', 'classic-terminal'],
    }),
  );
  assert.ok(first.ok);
  const back = resolveOnboardingAction(
    first.state,
    action(first.state, { action: 'previous-page' }),
  );
  assert.ok(!back.ok);
  assert.equal(back.code, 'no-such-page');

  const last = parseOnboardingState(
    makeCatalogState({
      page: { index: 2, count: 3 },
      actions: ['select', 'next-page', 'previous-page', 'classic-terminal'],
    }),
  );
  assert.ok(last.ok);
  const forward = resolveOnboardingAction(last.state, action(last.state, { action: 'next-page' }));
  assert.ok(!forward.ok);
  assert.equal(forward.code, 'no-such-page');
});

test('an inconsistent page descriptor is dropped rather than half-trusted', () => {
  const result = parseOnboardingState(makeCatalogState({ page: { index: 5, count: 3 } }));
  assert.ok(result.ok);
  assert.equal(result.state.page, undefined);
});

// --- editor ----------------------------------------------------------------

test('editor actions never resolve to a command line', () => {
  const result = parseOnboardingState(makeEditorState());
  assert.ok(result.ok);
  const state = result.state;

  for (const name of ['save-text', 'cancel-editor'] as const) {
    const resolved = resolveOnboardingAction(state, action(state, { action: name }));
    assert.ok(!resolved.ok, `${name} must not produce a line`);
    assert.equal(resolved.code, 'structured-transport-required');
  }
});

test('a multiline screen refuses ordinary line submission', () => {
  const result = parseOnboardingState(
    makeEditorState({ actions: ['submit', 'save-text', 'classic-terminal'] }),
  );
  assert.ok(result.ok);
  const resolved = resolveOnboardingAction(
    result.state,
    action(result.state, { action: 'submit', value: 'a whole background story' }),
  );
  assert.ok(!resolved.ok);
  assert.equal(resolved.code, 'input-not-expected');
});

test('a half-described editor transfer is treated as no transfer', () => {
  const digest = 'a'.repeat(64);
  const complete = parseOnboardingState(
    makeEditorState({
      editor: {
        fieldId: 'background-story',
        maxBytes: 49_152,
        contentRevision: 3,
        transferId: 'transfer-1',
        totalBytes: 7_000,
        chunkCount: 2,
        digest,
      },
    }),
  );
  assert.ok(complete.ok);
  assert.equal(complete.state.editor?.transferId, 'transfer-1');

  // Missing digest, wrong chunk count, and a malformed digest each fall back to
  // metadata-only, so the browser waits instead of assembling partial content.
  for (const broken of [
    { transferId: 'transfer-1', totalBytes: 7_000, chunkCount: 2 },
    { transferId: 'transfer-1', totalBytes: 7_000, chunkCount: 5, digest },
    { transferId: 'transfer-1', totalBytes: 7_000, chunkCount: 2, digest: 'NOTHEX' },
  ]) {
    const result = parseOnboardingState(
      makeEditorState({
        editor: {
          fieldId: 'background-story',
          maxBytes: 49_152,
          contentRevision: 3,
          ...broken,
        } as OnboardingState['editor'],
      }),
    );
    assert.ok(result.ok);
    assert.equal(result.state.editor?.transferId, undefined);
    assert.equal(result.state.editor?.fieldId, 'background-story');
  }
});

test('an editor field cannot declare a limit above the global editor cap', () => {
  const result = parseOnboardingState(
    makeEditorState({
      editor: { fieldId: 'background-story', maxBytes: 1_000_000, contentRevision: 1 },
    }),
  );
  assert.ok(result.ok);
  assert.equal(result.state.editor, undefined);
});

// --- staleness -------------------------------------------------------------

test('a stale revision is rejected on every v2 action', () => {
  const result = parseOnboardingState(makeRoleplayHubState());
  assert.ok(result.ok);
  const state = result.state;

  const stale = resolveOnboardingAction(
    state,
    action(state, {
      action: 'open',
      choiceId: 'profile/background-story',
      revision: state.revision + 1,
    }),
  );
  assert.ok(!stale.ok);
  assert.equal(stale.code, 'stale-revision');
});
