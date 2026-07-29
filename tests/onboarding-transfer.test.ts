/**
 * Editor transfer tests.
 *
 * The invariant under test throughout: no malformed, partial, reordered, stale,
 * oversized, or corrupted transfer may ever yield content. Only a complete
 * transfer that passes its digest produces a string a caller could commit.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EditorTransferAssembler,
  EditorTransferBudget,
  chunkEditorContent,
  editorContentDigest,
  editorTransferLimits,
  expectedChunkCount,
  hasDisallowedControlCharacters,
  isEditorTransferClientMessage,
  normalizeEditorContent,
  parseEditorContentSourceEnvelope,
} from '../shared/onboarding-transfer.ts';
import type { EditorTransferDescriptor } from '../shared/onboarding-transfer.ts';

async function describeContent(
  content: string,
  overrides: Partial<EditorTransferDescriptor> = {},
): Promise<{ descriptor: EditorTransferDescriptor; chunks: string[] }> {
  const chunks = chunkEditorContent(content);
  return {
    chunks,
    descriptor: {
      transferId: 'transfer-1',
      fieldId: 'background-story',
      flowId: 'fixture-flow',
      revision: 7,
      totalBytes: Buffer.byteLength(content, 'utf8'),
      chunkCount: chunks.length,
      digest: await editorContentDigest(content),
      maxBytes: editorTransferLimits.maxContentBytes,
      startedAtMs: 0,
      ...overrides,
    },
  };
}

async function roundTrip(content: string) {
  const { descriptor, chunks } = await describeContent(content);
  const assembler = new EditorTransferAssembler(descriptor);
  for (const [index, data] of chunks.entries()) {
    const accepted = assembler.acceptChunk(index, data);
    assert.ok(accepted.ok, `chunk ${index} must be accepted`);
  }
  return assembler.finish();
}

// --- happy path ------------------------------------------------------------

test('content round-trips through chunking and digest verification', async () => {
  const result = await roundTrip('A short history.\nTwo lines long.');
  assert.ok(result.ok);
  assert.equal(result.content, 'A short history.\nTwo lines long.');
});

test('content at the exact 49,152-byte limit round-trips in bounded chunks', async () => {
  const content = 'x'.repeat(editorTransferLimits.maxContentBytes);
  const chunks = chunkEditorContent(content);

  assert.equal(chunks.length, editorTransferLimits.maxChunks);
  assert.equal(chunks.length, expectedChunkCount(content.length));
  for (const chunk of chunks) {
    // Each base64 chunk must leave room inside both transport envelopes.
    assert.ok(chunk.length <= 8_192, 'base64 chunk must fit its envelope budget');
  }

  const result = await roundTrip(content);
  assert.ok(result.ok);
  assert.equal(Buffer.byteLength(result.content, 'utf8'), editorTransferLimits.maxContentBytes);
});

test('multi-byte content is chunked by bytes, not characters, and still verifies', async () => {
  // Deliberately sized so a chunk boundary lands mid-character if the splitter
  // were character-based rather than byte-based.
  const content = '世界'.repeat(3_000);
  const result = await roundTrip(content);
  assert.ok(result.ok);
  assert.equal(result.content, content);
});

test('a leading byte-order mark is preserved as content during verification', async () => {
  const content = '\ufeffan authored opening';
  const result = await roundTrip(content);
  assert.ok(result.ok);
  assert.equal(result.content, content);
});

// --- rejection paths -------------------------------------------------------

test('an out-of-order chunk aborts the transfer', async () => {
  const { descriptor, chunks } = await describeContent('y'.repeat(20_000));
  const assembler = new EditorTransferAssembler(descriptor);

  assert.ok(assembler.acceptChunk(0, chunks[0]).ok);
  const skipped = assembler.acceptChunk(2, chunks[2]);
  assert.ok(!skipped.ok);
  assert.equal(skipped.code, 'out-of-order-chunk');
});

test('a duplicate chunk is rejected', async () => {
  const { descriptor, chunks } = await describeContent('y'.repeat(20_000));
  const assembler = new EditorTransferAssembler(descriptor);

  assert.ok(assembler.acceptChunk(0, chunks[0]).ok);
  const repeated = assembler.acceptChunk(0, chunks[0]);
  assert.ok(!repeated.ok);
  assert.equal(repeated.code, 'duplicate-chunk');
});

test('a missing chunk yields no content', async () => {
  const { descriptor, chunks } = await describeContent('y'.repeat(20_000));
  const assembler = new EditorTransferAssembler(descriptor);

  for (const [index, data] of chunks.slice(0, -1).entries()) {
    assert.ok(assembler.acceptChunk(index, data).ok);
  }
  const result = await assembler.finish();
  assert.ok(!result.ok);
  assert.equal(result.code, 'missing-chunk');
});

test('corrupted content fails its digest and yields nothing', async () => {
  const { descriptor } = await describeContent('The original history.');
  const assembler = new EditorTransferAssembler(descriptor);

  // Same length, different bytes: only the digest can catch this.
  assert.ok(assembler.acceptChunk(0, chunkEditorContent('The tampered history.')[0]).ok);
  const result = await assembler.finish();
  assert.ok(!result.ok);
  assert.equal(result.code, 'digest-mismatch');
});

test('content exceeding the field limit is rejected mid-stream', async () => {
  const content = 'z'.repeat(20_000);
  // The source declared a 4,096-byte field (long description), so the transfer
  // must die as soon as it outgrows that, not at commit time.
  const { descriptor, chunks } = await describeContent(content, { maxBytes: 4_096 });
  const assembler = new EditorTransferAssembler(descriptor);

  // The first 6,144-byte chunk already exceeds the 4,096-byte field, so the
  // transfer dies on chunk 0 rather than at commit.
  const result = assembler.acceptChunk(0, chunks[0]);
  assert.ok(!result.ok);
  assert.equal(result.code, 'content-too-large');
});

test('invalid base64 is rejected without decoding', async () => {
  const { descriptor } = await describeContent('anything');
  const assembler = new EditorTransferAssembler(descriptor);
  const result = assembler.acceptChunk(0, '!!!not base64!!!');
  assert.ok(!result.ok);
  assert.equal(result.code, 'invalid-base64');
});

test('a declared size that does not match the delivered bytes is rejected', async () => {
  const content = 'a modest history';
  const { chunks } = await describeContent(content);
  const { descriptor } = await describeContent(content, { totalBytes: 999 });
  const assembler = new EditorTransferAssembler(descriptor);

  // Positional chunk sizing makes the mismatch fail immediately rather than
  // retaining bytes until commit.
  const result = assembler.acceptChunk(0, chunks[0]);
  assert.ok(!result.ok);
  assert.equal(result.code, 'size-mismatch');
});

test('control characters are rejected but tab and newline survive', async () => {
  assert.equal(hasDisallowedControlCharacters('plain\ttext\nlines'), false);
  assert.equal(hasDisallowedControlCharacters('bell\u0007here'), true);
  assert.equal(hasDisallowedControlCharacters('escape\u001bhere'), true);

  const result = await roundTrip('story with a \u0007 bell');
  assert.ok(!result.ok);
  assert.equal(result.code, 'invalid-control-character');
});

test('line endings are normalized so terminal and browser text converge', () => {
  assert.equal(normalizeEditorContent('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('clearing an assembler drops its buffers', async () => {
  const { descriptor, chunks } = await describeContent('y'.repeat(20_000));
  const assembler = new EditorTransferAssembler(descriptor);
  assert.ok(assembler.acceptChunk(0, chunks[0]).ok);

  assembler.clear();

  // After clearing, the transfer is unusable rather than silently resumable.
  const result = await assembler.finish();
  assert.ok(!result.ok);
  assert.equal(result.code, 'missing-chunk');
});

// --- message validation ----------------------------------------------------

test('a begin message must be internally consistent', async () => {
  const digest = await editorContentDigest('hello');
  const base = {
    type: 'onboarding-editor-begin',
    flowId: 'fixture-flow',
    revision: 7,
    fieldId: 'background-story',
    transferId: 'transfer-1',
    totalBytes: 5,
    chunkCount: 1,
    digest,
  };
  assert.equal(isEditorTransferClientMessage(base), true);

  // A chunk count that disagrees with the byte count would let a transfer be
  // resized mid-flight.
  assert.equal(isEditorTransferClientMessage({ ...base, chunkCount: 4 }), false);
  assert.equal(isEditorTransferClientMessage({ ...base, digest: 'not-a-digest' }), false);
  assert.equal(
    isEditorTransferClientMessage({
      ...base,
      totalBytes: editorTransferLimits.maxContentBytes + 1,
      chunkCount: 9,
    }),
    false,
  );
});

test('an oversized or non-base64 chunk message is rejected before assembly', () => {
  const base = {
    type: 'onboarding-editor-chunk',
    transferId: 'transfer-1',
    index: 0,
    data: 'AAAA',
  };
  assert.equal(isEditorTransferClientMessage(base), true);
  assert.equal(isEditorTransferClientMessage({ ...base, data: 'A'.repeat(9_000) }), false);
  assert.equal(isEditorTransferClientMessage({ ...base, data: '<script>' }), false);
  assert.equal(
    isEditorTransferClientMessage({ ...base, index: editorTransferLimits.maxChunks }),
    false,
  );
});

test('unknown message shapes are rejected', () => {
  assert.equal(isEditorTransferClientMessage(null), false);
  assert.equal(isEditorTransferClientMessage({ type: 'onboarding-editor-unknown' }), false);
  assert.equal(isEditorTransferClientMessage({ type: 'onboarding-editor-cancel' }), false);
  assert.equal(
    isEditorTransferClientMessage({ type: 'onboarding-editor-cancel', transferId: 'transfer-1' }),
    true,
  );
});

test('source envelopes require exact canonical JSON and canonical base64', async () => {
  const content = 'existing content';
  const digest = await editorContentDigest(content);
  const data = chunkEditorContent(content)[0];
  const begin = JSON.stringify({
    v: 2,
    phase: 'begin',
    flowId: 'fixture-flow',
    revision: 7,
    fieldId: 'background-story',
    transferId: 'source-transfer',
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: 1,
    digest,
  });

  assert.equal(parseEditorContentSourceEnvelope(begin)?.phase, 'begin');
  assert.equal(
    parseEditorContentSourceEnvelope(
      JSON.stringify({ phase: 'chunk', transferId: 'source-transfer', index: 0, data }),
    )?.phase,
    'chunk',
  );
  assert.equal(
    parseEditorContentSourceEnvelope(
      JSON.stringify({ phase: 'commit', transferId: 'source-transfer' }),
    )?.phase,
    'commit',
  );

  assert.equal(parseEditorContentSourceEnvelope(` ${begin}`), null);
  assert.equal(
    parseEditorContentSourceEnvelope(begin.replace('"revision":7', '"revision":7,"revision":7')),
    null,
  );
  assert.equal(
    parseEditorContentSourceEnvelope(
      JSON.stringify({
        phase: 'chunk',
        transferId: 'source-transfer',
        index: 0,
        data: `${data}=`,
      }),
    ),
    null,
  );
});

// --- budgets and timeouts --------------------------------------------------

test('the commit budget limits both count and bytes', () => {
  const budget = new EditorTransferBudget();
  for (let index = 0; index < editorTransferLimits.maxCommitsPerWindow; index += 1) {
    assert.equal(budget.tryConsume(100, 1_000), true, `commit ${index} should fit`);
  }
  assert.equal(budget.tryConsume(100, 1_000), false, 'count budget must be enforced');

  const byteBudget = new EditorTransferBudget();
  assert.equal(byteBudget.tryConsume(editorTransferLimits.maxBytesPerWindow, 1_000), true);
  assert.equal(byteBudget.tryConsume(1, 1_000), false, 'byte budget must be enforced');

  // The window rolls forward rather than latching closed.
  assert.equal(byteBudget.tryConsume(1, 1_000 + editorTransferLimits.rateLimitWindowMs + 1), true);
});

test('a transfer expires against its own start time', async () => {
  const { descriptor } = await describeContent('history', { startedAtMs: 1_000 });
  const assembler = new EditorTransferAssembler(descriptor);
  assert.equal(assembler.isExpired(1_000 + editorTransferLimits.transferTimeoutMs), false);
  assert.equal(assembler.isExpired(1_001 + editorTransferLimits.transferTimeoutMs), true);
});
