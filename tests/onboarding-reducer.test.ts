import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeCreationStep,
  initialOnboardingUiState,
  isEditorDirty,
  onboardingReducer,
  shouldShowOnboarding,
} from '../src/features/onboarding/onboarding-reducer.ts';
import type { OnboardingState } from '../shared/onboarding.ts';
import {
  makeAccountLobbyState,
  makeEditorState,
  makeOnboardingState,
  makePasswordState,
} from './helpers/onboarding-fixtures.ts';

test('a new server state marks the server as supported and clears pending', () => {
  const state = onboardingReducer(
    { ...initialOnboardingUiState, pending: true },
    { type: 'server-state', state: makeOnboardingState(), phase: 'creating' },
  );

  assert.equal(state.supported, true);
  assert.equal(state.pending, false);
  assert.equal(state.phase, 'creating');
  assert.equal(shouldShowOnboarding(state), true);
});

test('a stale revision within the same flow is ignored', () => {
  const first = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: makeOnboardingState({ revision: 6 }),
    phase: 'creating',
  });
  const second = onboardingReducer(first, {
    type: 'server-state',
    state: makeOnboardingState({ revision: 3, screen: 'name' }),
    phase: 'creating',
  });

  assert.equal(second.state?.revision, 6);
  assert.equal(second.state?.screen, 'race');
});

test('a new flow resets the inspected choice', () => {
  const inspected = onboardingReducer(
    onboardingReducer(initialOnboardingUiState, {
      type: 'server-state',
      state: makeOnboardingState(),
      phase: 'creating',
    }),
    { type: 'inspect-choice', choiceId: 'human' },
  );
  assert.equal(inspected.inspectedChoiceId, 'human');

  const reconnected = onboardingReducer(inspected, {
    type: 'server-state',
    state: makeOnboardingState({ flowId: 'a-new-connection' }),
    phase: 'creating',
  });
  assert.equal(reconnected.inspectedChoiceId, null);
});

test('a non-password server screen clears sensitivity in the same flow', () => {
  const masked = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: makePasswordState(),
    phase: 'account',
  });
  assert.equal(masked.sensitive, true);

  // The proxy has already combined the structured screen with live Telnet
  // ECHO state, so the next server state is authoritative.
  const sameFlow = onboardingReducer(masked, {
    type: 'server-state',
    state: makeAccountLobbyState(),
    phase: 'account',
  });
  assert.equal(sameFlow.sensitive, false);
});

test('a fallback hides the structured surface but keeps the notice', () => {
  const active = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: makeOnboardingState(),
    phase: 'creating',
  });
  const fallen = onboardingReducer(active, {
    type: 'server-fallback',
    reason: 'version-skew',
    detail: 'unsupported protocol',
  });

  assert.equal(fallen.state, null);
  assert.equal(shouldShowOnboarding(fallen), false);
  assert.equal(fallen.fallback?.reason, 'version-skew');
});

test('a disconnect fallback is silent because the status bar already says so', () => {
  const active = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: makeOnboardingState(),
    phase: 'creating',
  });
  const fallen = onboardingReducer(active, {
    type: 'server-fallback',
    reason: 'disconnected',
    detail: 'closed',
  });

  assert.equal(fallen.fallback, null);
  assert.equal(fallen.phase, 'offline');
});

test('choosing the classic terminal survives a reconnect', () => {
  const classic = onboardingReducer(initialOnboardingUiState, { type: 'prefer-classic' });
  const reconnected = onboardingReducer(classic, { type: 'disconnected' });

  assert.equal(reconnected.preferClassic, true);
  assert.equal(reconnected.state, null);

  const back = onboardingReducer(reconnected, { type: 'prefer-structured' });
  assert.equal(back.preferClassic, false);
});

test('the structured surface never covers the playing state', () => {
  const playing = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: makeOnboardingState({ mode: 'play', screen: 'handoff' }),
    phase: 'playing',
  });
  assert.equal(shouldShowOnboarding(playing), false);
});

test('a rejection surfaces once and clears on the next server state', () => {
  const active = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: makeOnboardingState(),
    phase: 'creating',
  });
  const rejected = onboardingReducer(active, {
    type: 'rejected',
    code: 'stale-revision',
    detail: 'the screen changed',
  });
  assert.equal(rejected.rejection?.code, 'stale-revision');
  assert.equal(rejected.pending, false);

  const refreshed = onboardingReducer(rejected, {
    type: 'server-state',
    state: makeOnboardingState({ revision: 2 }),
    phase: 'creating',
  });
  assert.equal(refreshed.rejection, null);
});

test('a local classic-terminal action does not put the UI into a pending wait', () => {
  const pending = onboardingReducer(initialOnboardingUiState, {
    type: 'action-sent',
    action: 'select',
  });
  assert.equal(pending.pending, true);

  const local = onboardingReducer(initialOnboardingUiState, {
    type: 'action-sent',
    action: 'classic-terminal',
  });
  assert.equal(local.pending, false);
});

test('creation steps map onto the server screens', () => {
  assert.equal(activeCreationStep('race'), 'race');
  assert.equal(activeCreationStep('race-detail'), 'race');
  assert.equal(activeCreationStep('alignment'), 'alignment');
  assert.equal(activeCreationStep('account-menu'), null);
});

// ---------------------------------------------------------------------------
// Protocol v2 editor session
// ---------------------------------------------------------------------------

function editorState(overrides: Partial<OnboardingState> = {}) {
  return makeEditorState(overrides);
}

/** base64 of a UTF-8 string, matching what the proxy sends down. */
function b64(value: string) {
  return Buffer.from(value, 'utf8').toString('base64');
}

test('an empty field is immediately editable', () => {
  const state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState(),
    phase: 'creating',
  });

  assert.equal(state.editor?.fieldId, 'background-story');
  assert.equal(state.editor?.loadPhase, 'ready');
  assert.equal(state.editor?.draft, '');
});

test('a field with content stays read-only until the whole transfer verifies', () => {
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState({
      editor: {
        fieldId: 'background-story',
        maxBytes: 49_152,
        contentRevision: 2,
        transferId: 'transfer-1',
        totalBytes: 11,
        chunkCount: 1,
        digest: 'a'.repeat(64),
      },
    }),
    phase: 'creating',
  });

  // Until the transfer completes the field must not be editable, or the player
  // could overwrite text they have not seen.
  assert.equal(state.editor?.loadPhase, 'loading');
  assert.equal(state.editor?.draft, '');

  state = onboardingReducer(state, {
    type: 'editor-draft-changed',
    draft: 'typed too early',
  });
  assert.equal(state.editor?.draft, '', 'edits are ignored while loading');

  state = onboardingReducer(state, {
    type: 'editor-content-chunk',
    transferId: 'transfer-1',
    fieldId: 'background-story',
    index: 0,
    data: b64('old history'),
  });
  state = onboardingReducer(state, {
    type: 'editor-content-complete',
    transferId: 'transfer-1',
    fieldId: 'background-story',
  });

  assert.equal(state.editor?.loadPhase, 'ready');
  assert.equal(state.editor?.draft, 'old history');
  assert.equal(state.editor?.loaded, 'old history');
  assert.equal(isEditorDirty(state.editor), false);
});

test('an out-of-order or foreign content chunk is ignored', () => {
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState({
      editor: {
        fieldId: 'background-story',
        maxBytes: 49_152,
        contentRevision: 2,
        transferId: 'transfer-1',
        totalBytes: 11,
        chunkCount: 1,
        digest: 'a'.repeat(64),
      },
    }),
    phase: 'creating',
  });

  for (const stray of [
    { transferId: 'other', fieldId: 'background-story', index: 0 },
    { transferId: 'transfer-1', fieldId: 'goals', index: 0 },
    { transferId: 'transfer-1', fieldId: 'background-story', index: 3 },
  ]) {
    state = onboardingReducer(state, {
      type: 'editor-content-chunk',
      data: b64('junk'),
      ...stray,
    });
  }

  assert.equal(state.editor?.incoming?.chunks.length, 0, 'no stray chunk may be accepted');
});

test('undecodable content fails the load rather than showing partial text', () => {
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState({
      editor: {
        fieldId: 'background-story',
        maxBytes: 49_152,
        contentRevision: 2,
        transferId: 'transfer-1',
        totalBytes: 4,
        chunkCount: 1,
        digest: 'a'.repeat(64),
      },
    }),
    phase: 'creating',
  });

  state = onboardingReducer(state, {
    type: 'editor-content-chunk',
    transferId: 'transfer-1',
    fieldId: 'background-story',
    index: 0,
    // Valid base64 that is not valid UTF-8.
    data: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64'),
  });
  state = onboardingReducer(state, {
    type: 'editor-content-complete',
    transferId: 'transfer-1',
    fieldId: 'background-story',
  });

  assert.equal(state.editor?.loadPhase, 'failed');
  assert.equal(state.editor?.draft, '');
});

test('a half-described non-empty field stays closed rather than becoming editable', () => {
  const state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState({
      editor: {
        fieldId: 'background-story',
        maxBytes: 49_152,
        contentRevision: 2,
        empty: false,
      },
    }),
    phase: 'creating',
  });

  assert.equal(state.editor?.loadPhase, 'failed');
  assert.equal(state.editor?.incoming, null);
});

test('a gateway load failure closes only the matching source transfer', () => {
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState({
      editor: {
        fieldId: 'background-story',
        maxBytes: 49_152,
        contentRevision: 2,
        empty: false,
        transferId: 'source-transfer',
        totalBytes: 11,
        chunkCount: 1,
        digest: 'a'.repeat(64),
      },
    }),
    phase: 'creating',
  });

  const unchanged = onboardingReducer(state, {
    type: 'editor-result',
    transferId: 'other-transfer',
    ok: false,
    code: 'digest-mismatch',
    detail: 'Existing text could not be loaded safely.',
  });
  assert.equal(unchanged, state);

  state = onboardingReducer(state, {
    type: 'editor-result',
    transferId: 'source-transfer',
    ok: false,
    code: 'digest-mismatch',
    detail: 'Existing text could not be loaded safely.',
  });
  assert.equal(state.editor?.loadPhase, 'failed');
  assert.equal(state.editor?.incoming, null);
  assert.equal(state.editor?.notice?.code, 'digest-mismatch');
});

test('browser completion rechecks declared chunk count and byte length', () => {
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState({
      editor: {
        fieldId: 'background-story',
        maxBytes: 49_152,
        contentRevision: 2,
        empty: false,
        transferId: 'source-transfer',
        totalBytes: 12,
        chunkCount: 2,
        digest: 'a'.repeat(64),
      },
    }),
    phase: 'creating',
  });

  state = onboardingReducer(state, {
    type: 'editor-content-chunk',
    transferId: 'source-transfer',
    fieldId: 'background-story',
    index: 0,
    data: b64('only one'),
  });
  state = onboardingReducer(state, {
    type: 'editor-content-complete',
    transferId: 'source-transfer',
    fieldId: 'background-story',
  });

  assert.equal(state.editor?.loadPhase, 'failed');
  assert.equal(state.editor?.draft, '');
});

test('a live draft survives a same-field revision bump but not a field change', () => {
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState(),
    phase: 'creating',
  });
  state = onboardingReducer(state, { type: 'editor-draft-changed', draft: 'work in progress' });

  // A validation error bumps the revision on the same field: losing the draft
  // here would throw away everything the player typed.
  state = onboardingReducer(state, {
    type: 'server-state',
    state: editorState({ revision: 2, error: { code: 'too-long', message: 'Too long.' } }),
    phase: 'creating',
  });
  assert.equal(state.editor?.draft, 'work in progress');

  // Moving to a different field must not carry the draft across.
  state = onboardingReducer(state, {
    type: 'server-state',
    state: editorState({
      revision: 3,
      screen: 'goals-editor',
      editor: { fieldId: 'goals', maxBytes: 49_152, contentRevision: 0, empty: true },
    }),
    phase: 'creating',
  });
  assert.equal(state.editor?.fieldId, 'goals');
  assert.equal(state.editor?.draft, '');
});

test('an idea seeds only its matching empty editor in the same flow', () => {
  const suggestion = 'I always measure a room by its exits.';
  const ideaState = makeOnboardingState({
    version: 2,
    mode: 'roleplay-profile',
    screen: 'personality-ideas',
    title: 'Personality',
    prompt: 'Choose a theme or write your own.',
    inputKind: 'none',
    persistence: 'none',
    choices: [],
    examples: [{ id: 'example/0', text: suggestion }],
    actions: ['continue', 'cancel', 'classic-terminal'],
    controlWire: { continue: 'q', cancel: '0' },
  });
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: ideaState,
    phase: 'creating',
  });

  state = onboardingReducer(state, { type: 'editor-draft-changed', draft: suggestion });
  assert.deepEqual(state.ideaDraft, { fieldId: 'personality', draft: suggestion });

  // Generating another set is a same-screen revision and must not discard the
  // player's chosen starting point.
  state = onboardingReducer(state, {
    type: 'server-state',
    state: { ...ideaState, revision: ideaState.revision + 1 },
    phase: 'creating',
  });
  assert.equal(state.ideaDraft?.draft, suggestion);

  state = onboardingReducer(state, {
    type: 'server-state',
    state: editorState({
      revision: ideaState.revision + 2,
      screen: 'personality-editor',
      editor: {
        fieldId: 'personality',
        maxBytes: 49_152,
        contentRevision: 0,
        empty: true,
      },
    }),
    phase: 'creating',
  });

  assert.equal(state.editor?.fieldId, 'personality');
  assert.equal(state.editor?.loaded, '');
  assert.equal(state.editor?.draft, suggestion);
  assert.equal(isEditorDirty(state.editor), true);
  assert.equal(state.ideaDraft, null);
});

test('an idea never overwrites existing content or crosses a field boundary', () => {
  const ideaState = makeOnboardingState({
    version: 2,
    mode: 'roleplay-profile',
    screen: 'goals-ideas',
    title: 'Goals',
    prompt: 'Choose an idea.',
    inputKind: 'none',
    persistence: 'none',
    choices: [],
    actions: ['continue', 'classic-terminal'],
    controlWire: { continue: 'q' },
  });
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: ideaState,
    phase: 'creating',
  });
  state = onboardingReducer(state, {
    type: 'editor-draft-changed',
    draft: 'Find the lost archive.',
  });

  state = onboardingReducer(state, {
    type: 'server-state',
    state: editorState({
      revision: ideaState.revision + 1,
      screen: 'goals-editor',
      editor: {
        fieldId: 'goals',
        maxBytes: 49_152,
        contentRevision: 4,
        empty: false,
        transferId: 'existing-goals',
        totalBytes: 14,
        chunkCount: 1,
        digest: 'a'.repeat(64),
      },
    }),
    phase: 'creating',
  });
  assert.equal(state.editor?.draft, '');
  assert.equal(state.editor?.loadPhase, 'loading');
  assert.equal(state.ideaDraft, null);

  state = onboardingReducer(
    onboardingReducer(initialOnboardingUiState, {
      type: 'server-state',
      state: ideaState,
      phase: 'creating',
    }),
    { type: 'editor-draft-changed', draft: 'Find the lost archive.' },
  );
  state = onboardingReducer(state, {
    type: 'server-state',
    state: editorState({
      revision: ideaState.revision + 1,
      screen: 'personality-editor',
      editor: {
        fieldId: 'personality',
        maxBytes: 49_152,
        contentRevision: 0,
        empty: true,
      },
    }),
    phase: 'creating',
  });
  assert.equal(state.editor?.draft, '');
  assert.equal(state.ideaDraft, null);
});

test('a changed authoritative value cannot silently overwrite or be overwritten by a live draft', () => {
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState(),
    phase: 'creating',
  });
  state = onboardingReducer(state, { type: 'editor-draft-changed', draft: 'work in progress' });

  state = onboardingReducer(state, {
    type: 'server-state',
    state: editorState({
      revision: 2,
      editor: {
        fieldId: 'background-story',
        maxBytes: 49_152,
        contentRevision: 4,
        empty: false,
        transferId: 'new-source-value',
        totalBytes: 9,
        chunkCount: 1,
        digest: 'a'.repeat(64),
      },
    }),
    phase: 'creating',
  });

  assert.equal(state.editor?.draft, 'work in progress');
  assert.equal(state.editor?.loadPhase, 'failed');
  assert.equal(state.editor?.incoming, null);
});

test('private drafts do not survive fallback, disconnect, or a terminal switch', () => {
  const base = onboardingReducer(
    onboardingReducer(initialOnboardingUiState, {
      type: 'server-state',
      state: editorState(),
      phase: 'creating',
    }),
    { type: 'editor-draft-changed', draft: 'a private history' },
  );
  assert.equal(base.editor?.draft, 'a private history');

  const afterFallback = onboardingReducer(base, {
    type: 'server-fallback',
    reason: 'malformed-payload',
    detail: 'bad payload',
  });
  assert.equal(afterFallback.editor, null);

  const afterClassic = onboardingReducer(base, { type: 'prefer-classic' });
  assert.equal(afterClassic.editor, null);

  const afterDisconnect = onboardingReducer(base, { type: 'disconnected' });
  assert.equal(afterDisconnect.editor, null);
});

test('a transfer result clears the saving flag without claiming a save', () => {
  let state = onboardingReducer(initialOnboardingUiState, {
    type: 'server-state',
    state: editorState(),
    phase: 'creating',
  });
  state = onboardingReducer(state, {
    type: 'editor-save-started',
    transferId: 'transfer-1',
  });
  assert.equal(state.editor?.saving, true);

  state = onboardingReducer(state, {
    type: 'editor-result',
    transferId: 'transfer-1',
    ok: true,
    code: 'ok',
    detail: 'Sent to the MUD.',
  });

  assert.equal(state.editor?.saving, false);
  assert.equal(state.editor?.notice?.ok, true);
  // Durability is only ever reported by a state carrying persistenceResult.
  assert.ok(!/saved/i.test(state.editor?.notice?.detail ?? ''));
});
