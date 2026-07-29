/**
 * Gateway-level protocol v2 tests.
 *
 * These drive a real `MudSession` against a fake MUD socket, so they cover the
 * boundary the pure contract tests cannot: negotiation, transfer assembly,
 * staleness, budgets, and the rule that no private content reaches the MUD
 * except as verified MSDP chunks.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ONBOARDING_ACTION_MSDP_VARIABLE,
  ONBOARDING_CAPABILITY_VARIABLE,
  ONBOARDING_CONTENT_MSDP_VARIABLE,
  ONBOARDING_VERSIONS_CAPABILITY_VARIABLE,
} from '../shared/onboarding.ts';
import {
  chunkEditorContent,
  editorContentDigest,
  editorTransferLimits,
} from '../shared/onboarding-transfer.ts';
import type { ServerMessage } from '../shared/mud.ts';
import { createProxyLifecycleHarness, msdpReadyPacket } from './helpers/proxy-lifecycle-harness.ts';
import { makeEditorState, onboardingMsdpPacket } from './helpers/onboarding-fixtures.ts';

type Harness = ReturnType<typeof createProxyLifecycleHarness>;

function transferResults(harness: Harness) {
  return harness.browser.messages.filter(
    (message): message is Extract<ServerMessage, { type: 'onboarding-editor-result' }> =>
      message.type === 'onboarding-editor-result',
  );
}

function lastResult(harness: Harness) {
  const results = transferResults(harness);
  return results[results.length - 1];
}

function contentMessages(harness: Harness) {
  return harness.browser.messages.filter(
    (
      message,
    ): message is Extract<
      ServerMessage,
      { type: 'onboarding-editor-content' | 'onboarding-editor-content-complete' }
    > =>
      message.type === 'onboarding-editor-content' ||
      message.type === 'onboarding-editor-content-complete',
  );
}

/**
 * The first outcome is the decisive one. Chunks that arrive after a rejected
 * begin each report `unknown-transfer`, which would mask the real cause.
 */
function firstResult(harness: Harness) {
  return transferResults(harness)[0];
}

/** Wait until the session has emitted a transfer outcome, or give up. */
async function settle(harness: Harness) {
  for (let attempt = 0; attempt < 50 && transferResults(harness).length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function settleContent(harness: Harness) {
  for (
    let attempt = 0;
    attempt < 50 &&
    !contentMessages(harness).some(
      (message) => message.type === 'onboarding-editor-content-complete',
    );
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function v2Harness(t: { after: (fn: () => void) => void }, options: { now?: () => number } = {}) {
  const harness = createProxyLifecycleHarness({ now: options.now });
  t.after(() => harness.cleanup());
  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  mudSocket.emitData(msdpReadyPacket());
  // Put the session on a v2 editor screen so transfers have somewhere to land.
  mudSocket.emitData(onboardingMsdpPacket(makeEditorState()));
  harness.browser.clearMessages();
  mudSocket.clearWritten();
  return { harness, mudSocket };
}

/** Change one base64 character, keeping the decoded byte length identical. */
function flipBase64(chunk: string): string {
  const replacement = chunk[0] === 'A' ? 'B' : 'A';
  return `${replacement}${chunk.slice(1)}`;
}

function sourceContentPacket(envelope: unknown) {
  return onboardingMsdpPacket(envelope, ONBOARDING_CONTENT_MSDP_VARIABLE);
}

async function describeExistingContent(
  content: string,
  overrides: { revision?: number; transferId?: string; digest?: string } = {},
) {
  const chunks = chunkEditorContent(content);
  const digest = overrides.digest ?? (await editorContentDigest(content));
  const revision = overrides.revision ?? 2;
  const transferId = overrides.transferId ?? `source-transfer-${revision}`;
  const state = makeEditorState({
    revision,
    editor: {
      fieldId: 'background-story',
      maxBytes: 49_152,
      contentRevision: revision,
      empty: false,
      transferId,
      totalBytes: Buffer.byteLength(content, 'utf8'),
      chunkCount: chunks.length,
      digest,
    },
  });
  const begin = {
    v: 2 as const,
    phase: 'begin' as const,
    flowId: state.flowId,
    revision: state.revision,
    fieldId: state.editor!.fieldId,
    transferId,
    totalBytes: state.editor!.totalBytes!,
    chunkCount: state.editor!.chunkCount!,
    digest,
  };

  return { begin, chunks, digest, state, transferId };
}

/** Drive a complete, well-formed upload of `content`. */
async function upload(
  harness: Harness,
  content: string,
  overrides: {
    fieldId?: string;
    flowId?: string;
    revision?: number;
    transferId?: string;
    corruptChunk?: number;
  } = {},
) {
  const chunks = chunkEditorContent(content);
  const transferId = overrides.transferId ?? 'transfer-1';

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: overrides.flowId ?? 'fixture-flow',
    revision: overrides.revision ?? 1,
    fieldId: overrides.fieldId ?? 'background-story',
    transferId,
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: chunks.length,
    digest: await editorContentDigest(content),
  });

  for (const [index, data] of chunks.entries()) {
    harness.session.handleEditorTransfer({
      type: 'onboarding-editor-chunk',
      transferId,
      index,
      // Corrupt in place, preserving length, so the digest is what catches it
      // rather than the byte-count check.
      data: index === overrides.corruptChunk ? flipBase64(data) : data,
    });
  }

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-commit',
    flowId: overrides.flowId ?? 'fixture-flow',
    revision: overrides.revision ?? 1,
    transferId,
  });

  // The commit path is async: it awaits a real SHA-256 digest.
  await settle(harness);
  return transferId;
}

// --- negotiation -----------------------------------------------------------

test('the gateway always advertises the complete onboarding protocol', (t) => {
  const harness = createProxyLifecycleHarness();
  t.after(() => harness.cleanup());
  const mudSocket = harness.connect();
  mudSocket.emitConnect();
  mudSocket.emitData(msdpReadyPacket());

  const written = mudSocket.getWrittenText();
  assert.ok(written.includes(ONBOARDING_CAPABILITY_VARIABLE), 'v1 capability is always advertised');
  // The v1 variable still goes first, so an old source is unaffected.
  assert.ok(written.includes(ONBOARDING_VERSIONS_CAPABILITY_VARIABLE));
  assert.ok(written.includes('2,1'));
  assert.ok(
    written.indexOf(ONBOARDING_CAPABILITY_VARIABLE) <
      written.indexOf(ONBOARDING_VERSIONS_CAPABILITY_VARIABLE),
    'the v1 variable must be sent before the version list',
  );
});

// --- happy path ------------------------------------------------------------

test('a complete upload reaches the MUD as MSDP chunks, never as terminal input', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const content = 'An invented history.\nTwo lines of it.';

  await upload(harness, content);

  const result = lastResult(harness);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'ok');

  const written = mudSocket.getWrittenText();
  assert.ok(written.includes(ONBOARDING_ACTION_MSDP_VARIABLE), 'must use the reserved v2 variable');
  assert.ok(written.includes('"phase":"begin"'));
  assert.ok(written.includes('"phase":"commit"'));
  assert.ok(
    written.includes(`"digest":"${await editorContentDigest(content)}"`),
    'the source digest must cover the normalized bytes actually forwarded',
  );

  // The decisive privacy check: the raw text must never appear on the wire in
  // cleartext, because content travels base64-encoded inside MSDP chunks.
  assert.ok(!written.includes('An invented history.'), 'content must not be sent as plain text');
  assert.ok(!written.includes(`${content}\n`), 'content must not be sent as a command line');
});

test('the gateway does not claim a save; only the MUD can report durability', async (t) => {
  const { harness } = v2Harness(t);
  await upload(harness, 'A modest history.');

  const result = lastResult(harness);
  assert.equal(result.ok, true);
  // "Sent to the MUD" - not "Saved". Durable success arrives later as a state
  // carrying persistenceResult="saved".
  assert.ok(!/saved/i.test(result.detail), 'the gateway must not report a save');
});

test('cancel leaves the source editor through the reserved structured action path', (t) => {
  const { harness, mudSocket } = v2Harness(t);

  harness.session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: 'fixture-flow',
    revision: 1,
    action: 'cancel-editor',
  });

  const written = mudSocket.getWrittenText();
  assert.ok(written.includes(ONBOARDING_ACTION_MSDP_VARIABLE));
  assert.ok(written.includes('"action":"cancel-editor"'));
  assert.ok(written.includes('"phase":"cancel"'));
  assert.ok(written.includes('"fieldId":"background-story"'));
  assert.ok(!written.includes('cancel-editor\n'), 'cancel must never become terminal input');
});

test('content at the exact field limit uploads in bounded chunks', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const content = 'x'.repeat(editorTransferLimits.maxContentBytes);

  await upload(harness, content);

  assert.equal(lastResult(harness).ok, true);
  const written = mudSocket.getWrittenText();
  assert.ok(written.includes(`"chunkCount":${editorTransferLimits.maxChunks}`));
});

test('existing content is verified in full before any browser chunk is released', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const content = 'An existing invented history.\nWith a second line.';
  const described = await describeExistingContent(content);

  mudSocket.emitData(onboardingMsdpPacket(described.state));
  const stateMessageIndex = harness.browser.messages.findIndex(
    (message) =>
      message.type === 'onboarding-state' &&
      message.state.editor?.transferId === described.transferId,
  );
  assert.ok(stateMessageIndex >= 0, 'the bound state must reach the browser first');

  mudSocket.emitData(sourceContentPacket(described.begin));
  for (const [index, data] of described.chunks.entries()) {
    mudSocket.emitData(
      sourceContentPacket({
        phase: 'chunk',
        transferId: described.transferId,
        index,
        data,
      }),
    );
  }
  assert.equal(
    contentMessages(harness).length,
    0,
    'unverified source chunks must never be streamed to the browser',
  );

  mudSocket.emitData(sourceContentPacket({ phase: 'commit', transferId: described.transferId }));
  await settleContent(harness);

  const delivered = contentMessages(harness);
  const deliveredChunks = delivered.filter(
    (message): message is Extract<ServerMessage, { type: 'onboarding-editor-content' }> =>
      message.type === 'onboarding-editor-content',
  );
  assert.equal(deliveredChunks.length, described.chunks.length);
  assert.deepEqual(
    deliveredChunks.map((message) => message.index),
    described.chunks.map((_, index) => index),
  );
  assert.equal(
    Buffer.concat(deliveredChunks.map((message) => Buffer.from(message.data, 'base64'))).toString(
      'utf8',
    ),
    content,
  );
  assert.equal(delivered.at(-1)?.type, 'onboarding-editor-content-complete');
  assert.ok(
    harness.browser.rawMessages.every((message) => !message.includes(content)),
    'private content must not appear in cleartext browser frames',
  );

  // The gateway now knows the player saw the authoritative value, so a save
  // against this exact state is allowed.
  harness.browser.clearMessages();
  mudSocket.clearWritten();
  await upload(harness, `${content}\nA new ending.`, {
    revision: described.state.revision,
    transferId: 'browser-after-load',
  });
  assert.equal(lastResult(harness).ok, true);
  assert.ok(mudSocket.getWrittenText().includes(ONBOARDING_ACTION_MSDP_VARIABLE));
});

test('a maximum-size existing value downloads in exactly eight bounded chunks', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const content = 'z'.repeat(editorTransferLimits.maxContentBytes);
  const described = await describeExistingContent(content);

  mudSocket.emitData(onboardingMsdpPacket(described.state));
  mudSocket.emitData(sourceContentPacket(described.begin));
  for (const [index, data] of described.chunks.entries()) {
    assert.ok(data.length <= 8_192);
    mudSocket.emitData(
      sourceContentPacket({
        phase: 'chunk',
        transferId: described.transferId,
        index,
        data,
      }),
    );
  }
  mudSocket.emitData(sourceContentPacket({ phase: 'commit', transferId: described.transferId }));
  await settleContent(harness);

  assert.equal(
    contentMessages(harness).filter((message) => message.type === 'onboarding-editor-content')
      .length,
    editorTransferLimits.maxChunks,
  );
  assert.equal(
    contentMessages(harness).filter(
      (message) => message.type === 'onboarding-editor-content-complete',
    ).length,
    1,
  );
});

test('a browser cannot blind-write a non-empty field before its download verifies', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const described = await describeExistingContent('Existing text that must be seen first.');
  mudSocket.emitData(onboardingMsdpPacket(described.state));
  mudSocket.clearWritten();
  harness.browser.clearMessages();

  await upload(harness, 'Replacement text.', {
    revision: described.state.revision,
    transferId: 'blind-write',
  });

  assert.equal(firstResult(harness).code, 'editor-not-loaded');
  assert.ok(!mudSocket.getWrittenText().includes(ONBOARDING_ACTION_MSDP_VARIABLE));
});

// --- rejection paths -------------------------------------------------------

test('corrupt, reordered, or incomplete source downloads release no private bytes', async (t) => {
  const corruptRun = v2Harness(t);
  const corrupt = await describeExistingContent('q'.repeat(20_000));
  corruptRun.mudSocket.emitData(onboardingMsdpPacket(corrupt.state));
  corruptRun.mudSocket.emitData(sourceContentPacket(corrupt.begin));
  for (const [index, data] of corrupt.chunks.entries()) {
    corruptRun.mudSocket.emitData(
      sourceContentPacket({
        phase: 'chunk',
        transferId: corrupt.transferId,
        index,
        data: index === 1 ? flipBase64(data) : data,
      }),
    );
  }
  corruptRun.mudSocket.emitData(
    sourceContentPacket({ phase: 'commit', transferId: corrupt.transferId }),
  );
  await settle(corruptRun.harness);
  assert.equal(lastResult(corruptRun.harness).code, 'digest-mismatch');
  assert.equal(contentMessages(corruptRun.harness).length, 0);

  const reorderedRun = v2Harness(t);
  const reordered = await describeExistingContent('r'.repeat(20_000));
  reorderedRun.mudSocket.emitData(onboardingMsdpPacket(reordered.state));
  reorderedRun.mudSocket.emitData(sourceContentPacket(reordered.begin));
  reorderedRun.mudSocket.emitData(
    sourceContentPacket({
      phase: 'chunk',
      transferId: reordered.transferId,
      index: 1,
      data: reordered.chunks[1],
    }),
  );
  assert.equal(lastResult(reorderedRun.harness).code, 'out-of-order-chunk');
  assert.equal(contentMessages(reorderedRun.harness).length, 0);

  const incompleteRun = v2Harness(t);
  const incomplete = await describeExistingContent('s'.repeat(20_000));
  incompleteRun.mudSocket.emitData(onboardingMsdpPacket(incomplete.state));
  incompleteRun.mudSocket.emitData(sourceContentPacket(incomplete.begin));
  incompleteRun.mudSocket.emitData(
    sourceContentPacket({
      phase: 'chunk',
      transferId: incomplete.transferId,
      index: 0,
      data: incomplete.chunks[0],
    }),
  );
  incompleteRun.mudSocket.emitData(
    sourceContentPacket({ phase: 'commit', transferId: incomplete.transferId }),
  );
  await settle(incompleteRun.harness);
  assert.equal(lastResult(incompleteRun.harness).code, 'missing-chunk');
  assert.equal(contentMessages(incompleteRun.harness).length, 0);
});

test('mismatched or non-canonical source envelopes fail closed', async (t) => {
  const mismatchRun = v2Harness(t);
  const mismatch = await describeExistingContent('Existing fixture content.');
  mismatchRun.mudSocket.emitData(onboardingMsdpPacket(mismatch.state));
  mismatchRun.mudSocket.emitData(
    sourceContentPacket({ ...mismatch.begin, revision: mismatch.begin.revision + 1 }),
  );
  assert.equal(lastResult(mismatchRun.harness).code, 'source-transfer-invalid');
  assert.equal(contentMessages(mismatchRun.harness).length, 0);

  const duplicateRun = v2Harness(t);
  const duplicate = await describeExistingContent('Other existing fixture content.');
  duplicateRun.mudSocket.emitData(onboardingMsdpPacket(duplicate.state));
  const duplicateDigest = JSON.stringify(duplicate.begin).replace(
    `,"digest":"${duplicate.digest}"`,
    `,"digest":"${duplicate.digest}","digest":"${duplicate.digest}"`,
  );
  duplicateRun.mudSocket.emitData(sourceContentPacket(duplicateDigest));
  assert.equal(lastResult(duplicateRun.harness).code, 'source-transfer-invalid');
  assert.equal(contentMessages(duplicateRun.harness).length, 0);
});

test('source downloads must already use the source canonical text representation', async (t) => {
  for (const [label, content, expectedCode] of [
    ['line endings', 'first\r\nsecond', 'invalid-control-character'],
    ['terminal sentinel', 'a story~', 'source-transfer-invalid'],
  ]) {
    const run = v2Harness(t);
    const described = await describeExistingContent(content);
    run.mudSocket.emitData(onboardingMsdpPacket(described.state));
    run.mudSocket.emitData(sourceContentPacket(described.begin));
    for (const [index, data] of described.chunks.entries()) {
      run.mudSocket.emitData(
        sourceContentPacket({
          phase: 'chunk',
          transferId: described.transferId,
          index,
          data,
        }),
      );
    }
    run.mudSocket.emitData(
      sourceContentPacket({ phase: 'commit', transferId: described.transferId }),
    );
    await settle(run.harness);

    assert.equal(lastResult(run.harness).code, expectedCode, label);
    assert.equal(contentMessages(run.harness).length, 0, label);
  }
});

test('a corrupted chunk fails the digest and sends nothing to the MUD', async (t) => {
  const { harness, mudSocket } = v2Harness(t);

  await upload(harness, 'y'.repeat(20_000), { corruptChunk: 1 });

  const result = lastResult(harness);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'digest-mismatch');
  assert.ok(
    !mudSocket.getWrittenText().includes('"phase":"commit"'),
    'no commit may reach the MUD',
  );
});

test('an upload aimed at a field the source is not offering is rejected', async (t) => {
  const { harness, mudSocket } = v2Harness(t);

  await upload(harness, 'a history', { fieldId: 'goals' });

  const result = firstResult(harness);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown-field');
  assert.ok(!mudSocket.getWrittenText().includes('"phase":"begin"'));
});

test('a stale flow or revision is rejected before any chunk is accepted', async (t) => {
  const { harness } = v2Harness(t);

  await upload(harness, 'a history', { flowId: 'other-flow', transferId: 'transfer-flow' });
  assert.equal(firstResult(harness).code, 'stale-flow');

  harness.browser.clearMessages();
  await upload(harness, 'a history', { revision: 99, transferId: 'transfer-rev' });
  assert.equal(firstResult(harness).code, 'stale-revision');
});

test('a newer state invalidates an upload already in flight', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const content = 'y'.repeat(20_000);
  const chunks = chunkEditorContent(content);

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: 'fixture-flow',
    revision: 1,
    fieldId: 'background-story',
    transferId: 'transfer-1',
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: chunks.length,
    digest: await editorContentDigest(content),
  });
  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId: 'transfer-1',
    index: 0,
    data: chunks[0],
  });

  // The source moves the screen on underneath the upload.
  mudSocket.emitData(onboardingMsdpPacket(makeEditorState({ revision: 2 })));

  const invalidated = lastResult(harness);
  assert.equal(invalidated.ok, false);
  assert.equal(invalidated.code, 'stale-revision');

  // The remaining chunks now belong to nothing.
  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId: 'transfer-1',
    index: 1,
    data: chunks[1],
  });
  assert.equal(lastResult(harness).code, 'unknown-transfer');
});

test('only one upload may be in flight at a time', async (t) => {
  const { harness } = v2Harness(t);
  const digest = await editorContentDigest('history');

  const begin = {
    type: 'onboarding-editor-begin' as const,
    flowId: 'fixture-flow',
    revision: 1,
    fieldId: 'background-story',
    totalBytes: 7,
    chunkCount: 1,
    digest,
  };

  harness.session.handleEditorTransfer({ ...begin, transferId: 'transfer-1' });
  harness.session.handleEditorTransfer({ ...begin, transferId: 'transfer-2' });

  const result = lastResult(harness);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'transfer-in-progress');
});

test('an expired transfer is rejected rather than silently resumed', async (t) => {
  let now = 1_000;
  const { harness } = v2Harness(t, { now: () => now });
  const content = 'history';
  const chunks = chunkEditorContent(content);

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: 'fixture-flow',
    revision: 1,
    fieldId: 'background-story',
    transferId: 'transfer-1',
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: chunks.length,
    digest: await editorContentDigest(content),
  });

  now += editorTransferLimits.transferTimeoutMs + 1;

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId: 'transfer-1',
    index: 0,
    data: chunks[0],
  });

  assert.equal(lastResult(harness).code, 'transfer-timeout');
});

test('the gateway actively expires uploads even when no later message arrives', async (t) => {
  const { harness } = v2Harness(t);
  const content = 'history';

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: 'fixture-flow',
    revision: 1,
    fieldId: 'background-story',
    transferId: 'timer-upload',
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: 1,
    digest: await editorContentDigest(content),
  });

  const timer = harness.timers.getLastTimer(editorTransferLimits.transferTimeoutMs);
  assert.equal(harness.timers.fire(timer), true);
  assert.equal(lastResult(harness).code, 'transfer-timeout');

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId: 'timer-upload',
    index: 0,
    data: chunkEditorContent(content)[0],
  });
  assert.equal(lastResult(harness).code, 'unknown-transfer');
});

test('the gateway actively expires source downloads without exposing partial content', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const described = await describeExistingContent('t'.repeat(20_000));
  mudSocket.emitData(onboardingMsdpPacket(described.state));
  mudSocket.emitData(sourceContentPacket(described.begin));
  mudSocket.emitData(
    sourceContentPacket({
      phase: 'chunk',
      transferId: described.transferId,
      index: 0,
      data: described.chunks[0],
    }),
  );

  const timer = harness.timers.getLastTimer(editorTransferLimits.transferTimeoutMs);
  assert.equal(harness.timers.fire(timer), true);
  assert.equal(lastResult(harness).code, 'transfer-timeout');
  assert.equal(contentMessages(harness).length, 0);
});

test('an older replay cannot invalidate an upload already in flight', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const content = 'u'.repeat(7_000);
  const chunks = chunkEditorContent(content);
  const transferId = 'upload-survives-replay';

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: 'fixture-flow',
    revision: 1,
    fieldId: 'background-story',
    transferId,
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: chunks.length,
    digest: await editorContentDigest(content),
  });
  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId,
    index: 0,
    data: chunks[0],
  });

  mudSocket.emitData(onboardingMsdpPacket(makeEditorState({ revision: 0 })));
  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId,
    index: 1,
    data: chunks[1],
  });
  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-commit',
    flowId: 'fixture-flow',
    revision: 1,
    transferId,
  });
  await settle(harness);

  assert.equal(lastResult(harness).ok, true);
  assert.ok(mudSocket.getWrittenText().includes('"phase":"commit"'));
});

test('a newer state invalidates a source download, while an older replay does not', async (t) => {
  const replayRun = v2Harness(t);
  const replay = await describeExistingContent('v'.repeat(7_000));
  replayRun.mudSocket.emitData(onboardingMsdpPacket(replay.state));
  replayRun.mudSocket.emitData(sourceContentPacket(replay.begin));
  replayRun.mudSocket.emitData(
    sourceContentPacket({
      phase: 'chunk',
      transferId: replay.transferId,
      index: 0,
      data: replay.chunks[0],
    }),
  );
  replayRun.mudSocket.emitData(onboardingMsdpPacket(makeEditorState({ revision: 1 })));
  replayRun.mudSocket.emitData(
    sourceContentPacket({
      phase: 'chunk',
      transferId: replay.transferId,
      index: 1,
      data: replay.chunks[1],
    }),
  );
  replayRun.mudSocket.emitData(
    sourceContentPacket({ phase: 'commit', transferId: replay.transferId }),
  );
  await settleContent(replayRun.harness);
  assert.equal(
    contentMessages(replayRun.harness).at(-1)?.type,
    'onboarding-editor-content-complete',
  );

  const newerRun = v2Harness(t);
  const newer = await describeExistingContent('w'.repeat(7_000));
  newerRun.mudSocket.emitData(onboardingMsdpPacket(newer.state));
  newerRun.mudSocket.emitData(sourceContentPacket(newer.begin));
  newerRun.mudSocket.emitData(
    sourceContentPacket({
      phase: 'chunk',
      transferId: newer.transferId,
      index: 0,
      data: newer.chunks[0],
    }),
  );
  newerRun.mudSocket.emitData(onboardingMsdpPacket(makeEditorState({ revision: 3 })));

  assert.equal(lastResult(newerRun.harness).code, 'stale-revision');
  assert.equal(contentMessages(newerRun.harness).length, 0);
});

// --- lifecycle -------------------------------------------------------------

test('a disconnect clears an in-flight upload', async (t) => {
  const { harness } = v2Harness(t);
  const content = 'y'.repeat(20_000);
  const chunks = chunkEditorContent(content);

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: 'fixture-flow',
    revision: 1,
    fieldId: 'background-story',
    transferId: 'transfer-1',
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: chunks.length,
    digest: await editorContentDigest(content),
  });
  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId: 'transfer-1',
    index: 0,
    data: chunks[0],
  });

  harness.session.disconnect('Disconnected.');
  harness.browser.clearMessages();

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId: 'transfer-1',
    index: 1,
    data: chunks[1],
  });

  assert.equal(lastResult(harness).code, 'unknown-transfer');
});

test('fallback and disconnect clear source downloads and their timers', async (t) => {
  const fallbackRun = v2Harness(t);
  const fallback = await describeExistingContent('x'.repeat(7_000));
  fallbackRun.mudSocket.emitData(onboardingMsdpPacket(fallback.state));
  fallbackRun.mudSocket.emitData(sourceContentPacket(fallback.begin));
  const fallbackTimer = fallbackRun.harness.timers.getLastTimer(
    editorTransferLimits.transferTimeoutMs,
  );

  fallbackRun.mudSocket.emitData(onboardingMsdpPacket('{'));
  assert.equal(fallbackTimer.cleared, true);
  fallbackRun.mudSocket.emitData(
    sourceContentPacket({ phase: 'commit', transferId: fallback.transferId }),
  );
  assert.equal(contentMessages(fallbackRun.harness).length, 0);

  const disconnectRun = v2Harness(t);
  const disconnect = await describeExistingContent('y'.repeat(7_000));
  disconnectRun.mudSocket.emitData(onboardingMsdpPacket(disconnect.state));
  disconnectRun.mudSocket.emitData(sourceContentPacket(disconnect.begin));
  const disconnectTimer = disconnectRun.harness.timers.getLastTimer(
    editorTransferLimits.transferTimeoutMs,
  );

  disconnectRun.harness.session.disconnect('Disconnected.');
  assert.equal(disconnectTimer.cleared, true);
  assert.equal(contentMessages(disconnectRun.harness).length, 0);
});

test('cancelling an upload mutates nothing and clears the buffer', async (t) => {
  const { harness, mudSocket } = v2Harness(t);
  const content = 'y'.repeat(20_000);
  const chunks = chunkEditorContent(content);

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: 'fixture-flow',
    revision: 1,
    fieldId: 'background-story',
    transferId: 'transfer-1',
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: chunks.length,
    digest: await editorContentDigest(content),
  });
  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId: 'transfer-1',
    index: 0,
    data: chunks[0],
  });
  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-cancel',
    transferId: 'transfer-1',
  });

  assert.ok(!mudSocket.getWrittenText().includes('"phase":"begin"'));

  harness.session.handleEditorTransfer({
    type: 'onboarding-editor-chunk',
    transferId: 'transfer-1',
    index: 1,
    data: chunks[1],
  });
  assert.equal(lastResult(harness).code, 'unknown-transfer');
});

// --- privacy ---------------------------------------------------------------

test('no rejection message echoes any part of the submitted content', async (t) => {
  const { harness } = v2Harness(t);
  const secret = 'PRIVATEBACKSTORYMARKER';

  await upload(harness, `${secret} and more`, { fieldId: 'goals' });

  assert.ok(transferResults(harness).length > 0, 'the upload must have been answered');
  for (const result of transferResults(harness)) {
    assert.ok(!result.detail.includes(secret), 'a rejection must not echo content');
    assert.ok(!result.code.includes(secret));
  }
});
