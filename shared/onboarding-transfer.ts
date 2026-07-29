/**
 * Bounded, atomic editor transfer for protocol v2.
 *
 * Six of the seven role-play text fields are 49,152 bytes, which exceeds both
 * the onboarding state document cap and one MSDP variable. Content therefore
 * moves as an explicit begin/chunk/commit sequence in both directions, and
 * nothing mutates a character until a complete transfer passes its digest.
 *
 * The rules here are transport-neutral on purpose: the Node server and the
 * Cloudflare Worker both drive `MudSession`, so this module may not depend on
 * either runtime's APIs. It uses WebCrypto, which both provide.
 *
 * Content handled here is private player text. It must never be logged, echoed
 * into an error, or retained past the transfer's lifecycle.
 */

/** Frozen bounds. See ADR 0004. */
export const editorTransferLimits = {
  /** Raw bytes per chunk before base64. 6,144 -> 8,192 base64 characters. */
  maxChunkBytes: 6_144,
  /** Global ceiling; a field's own source limit may be lower and always wins. */
  maxContentBytes: 49_152,
  /** ceil(maxContentBytes / maxChunkBytes). */
  maxChunks: 8,
  /** One inbound and one outbound transfer per session. */
  maxActiveTransfers: 1,
  /** Wall-clock budget from begin to commit. */
  transferTimeoutMs: 30_000,
  /** One source envelope must fit the shared MSDP/JSON boundary. */
  maxEnvelopeBytes: 16 * 1024,
  /** Editor commits are budgeted separately from small onboarding actions. */
  rateLimitWindowMs: 60_000,
  maxCommitsPerWindow: 12,
  maxBytesPerWindow: 512 * 1024,
} as const;

/** Number of chunks a transfer of `totalBytes` must be split into. */
export function expectedChunkCount(totalBytes: number): number {
  if (totalBytes <= 0) {
    return 0;
  }
  return Math.ceil(totalBytes / editorTransferLimits.maxChunkBytes);
}

// ---------------------------------------------------------------------------
// Message shapes
// ---------------------------------------------------------------------------

/** Browser -> proxy: announce an upload and its exact shape up front. */
export interface EditorTransferBeginMessage {
  type: 'onboarding-editor-begin';
  flowId: string;
  revision: number;
  fieldId: string;
  transferId: string;
  totalBytes: number;
  chunkCount: number;
  /** Lowercase hex SHA-256 of the raw UTF-8 content. */
  digest: string;
}

/** Browser -> proxy: one ordered, base64-encoded slice. */
export interface EditorTransferChunkMessage {
  type: 'onboarding-editor-chunk';
  transferId: string;
  index: number;
  /** base64 of the raw slice. */
  data: string;
}

/** Browser -> proxy: the upload is complete; validate and hand it to the MUD. */
export interface EditorTransferCommitMessage {
  type: 'onboarding-editor-commit';
  flowId: string;
  revision: number;
  transferId: string;
}

/** Browser -> proxy: abandon an upload without mutating anything. */
export interface EditorTransferCancelMessage {
  type: 'onboarding-editor-cancel';
  transferId: string;
}

export type EditorTransferClientMessage =
  | EditorTransferBeginMessage
  | EditorTransferChunkMessage
  | EditorTransferCommitMessage
  | EditorTransferCancelMessage;

/** MUD -> proxy: announce an existing-value download after its state. */
export interface EditorContentSourceBeginEnvelope {
  v: 2;
  phase: 'begin';
  flowId: string;
  revision: number;
  fieldId: string;
  transferId: string;
  totalBytes: number;
  chunkCount: number;
  digest: string;
}

/** MUD -> proxy: one ordered, base64-encoded slice of existing content. */
export interface EditorContentSourceChunkEnvelope {
  phase: 'chunk';
  transferId: string;
  index: number;
  data: string;
}

/** MUD -> proxy: request verification and browser delivery. */
export interface EditorContentSourceCommitEnvelope {
  phase: 'commit';
  transferId: string;
}

export type EditorContentSourceEnvelope =
  | EditorContentSourceBeginEnvelope
  | EditorContentSourceChunkEnvelope
  | EditorContentSourceCommitEnvelope;

/** Proxy -> browser: one verified slice of existing field content. */
export interface EditorContentChunkMessage {
  type: 'onboarding-editor-content';
  transferId: string;
  fieldId: string;
  index: number;
  data: string;
}

/** Proxy -> browser: the download finished and passed its digest. */
export interface EditorContentCompleteMessage {
  type: 'onboarding-editor-content-complete';
  transferId: string;
  fieldId: string;
}

/**
 * Proxy -> browser: terminal outcome of a transfer. `code` is a stable,
 * privacy-safe token; it never carries any part of the content.
 */
export interface EditorTransferResultMessage {
  type: 'onboarding-editor-result';
  transferId: string;
  ok: boolean;
  code: EditorTransferRejectionCode;
  detail: string;
}

export type EditorTransferRejectionCode =
  | 'ok'
  | 'no-state'
  | 'not-an-editor-screen'
  | 'stale-flow'
  | 'stale-revision'
  | 'unknown-field'
  | 'unknown-transfer'
  | 'transfer-in-progress'
  | 'duplicate-chunk'
  | 'out-of-order-chunk'
  | 'missing-chunk'
  | 'chunk-too-large'
  | 'too-many-chunks'
  | 'content-too-large'
  | 'size-mismatch'
  | 'digest-mismatch'
  | 'invalid-base64'
  | 'invalid-utf8'
  | 'invalid-control-character'
  | 'invalid-digest-format'
  | 'transfer-timeout'
  | 'rate-limited'
  | 'not-connected'
  | 'editor-not-loaded'
  | 'source-transfer-invalid';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const HEX_DIGEST = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PROTOCOL_ID = /^[A-Za-z0-9_.:/-]+$/;
const MAX_ID_LENGTH = 120;
const MAX_REVISION = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    PROTOCOL_ID.test(value)
  );
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isCanonicalBase64(value: unknown, allowEmpty = false): value is string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(editorTransferLimits.maxChunkBytes / 3) * 4 ||
    !BASE64.test(value)
  ) {
    return false;
  }

  const bytes = bytesFromBase64(value);
  return bytes !== null && base64FromBytes(bytes) === value;
}

export function isEditorTransferClientMessage(
  value: unknown,
): value is EditorTransferClientMessage {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case 'onboarding-editor-begin':
      return (
        hasExactKeys(value, [
          'type',
          'flowId',
          'revision',
          'fieldId',
          'transferId',
          'totalBytes',
          'chunkCount',
          'digest',
        ]) &&
        isId(value.flowId) &&
        isBoundedInteger(value.revision, 0, MAX_REVISION) &&
        isId(value.fieldId) &&
        isId(value.transferId) &&
        isBoundedInteger(value.totalBytes, 0, editorTransferLimits.maxContentBytes) &&
        isBoundedInteger(value.chunkCount, 0, editorTransferLimits.maxChunks) &&
        typeof value.digest === 'string' &&
        HEX_DIGEST.test(value.digest) &&
        // The declared shape must be internally consistent before any chunk is
        // accepted, so a transfer can never be resized mid-flight.
        value.chunkCount === expectedChunkCount(value.totalBytes)
      );
    case 'onboarding-editor-chunk':
      return (
        hasExactKeys(value, ['type', 'transferId', 'index', 'data']) &&
        isId(value.transferId) &&
        isBoundedInteger(value.index, 0, editorTransferLimits.maxChunks - 1) &&
        isCanonicalBase64(value.data)
      );
    case 'onboarding-editor-commit':
      return (
        hasExactKeys(value, ['type', 'flowId', 'revision', 'transferId']) &&
        isId(value.flowId) &&
        isBoundedInteger(value.revision, 0, MAX_REVISION) &&
        isId(value.transferId)
      );
    case 'onboarding-editor-cancel':
      return hasExactKeys(value, ['type', 'transferId']) && isId(value.transferId);
    default:
      return false;
  }
}

/**
 * Parse one canonical, flat source envelope. Requiring the exact compact JSON
 * serialization rejects duplicate keys, alternate number spellings, trailing
 * data, and extensions before any private bytes enter an assembler. The C
 * source emits this exact representation.
 */
export function parseEditorContentSourceEnvelope(
  payload: unknown,
): EditorContentSourceEnvelope | null {
  if (
    typeof payload !== 'string' ||
    payload.length === 0 ||
    new TextEncoder().encode(payload).byteLength > editorTransferLimits.maxEnvelopeBytes
  ) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }

  let envelope: EditorContentSourceEnvelope | null = null;
  if (
    value.phase === 'begin' &&
    hasExactKeys(value, [
      'v',
      'phase',
      'flowId',
      'revision',
      'fieldId',
      'transferId',
      'totalBytes',
      'chunkCount',
      'digest',
    ]) &&
    value.v === 2 &&
    isId(value.flowId) &&
    isBoundedInteger(value.revision, 0, MAX_REVISION) &&
    isId(value.fieldId) &&
    isId(value.transferId) &&
    isBoundedInteger(value.totalBytes, 1, editorTransferLimits.maxContentBytes) &&
    isBoundedInteger(value.chunkCount, 1, editorTransferLimits.maxChunks) &&
    value.chunkCount === expectedChunkCount(value.totalBytes) &&
    typeof value.digest === 'string' &&
    HEX_DIGEST.test(value.digest)
  ) {
    envelope = value as unknown as EditorContentSourceBeginEnvelope;
  } else if (
    value.phase === 'chunk' &&
    hasExactKeys(value, ['phase', 'transferId', 'index', 'data']) &&
    isId(value.transferId) &&
    isBoundedInteger(value.index, 0, editorTransferLimits.maxChunks - 1) &&
    isCanonicalBase64(value.data)
  ) {
    envelope = value as unknown as EditorContentSourceChunkEnvelope;
  } else if (
    value.phase === 'commit' &&
    hasExactKeys(value, ['phase', 'transferId']) &&
    isId(value.transferId)
  ) {
    envelope = value as unknown as EditorContentSourceCommitEnvelope;
  }

  return envelope && JSON.stringify(envelope) === payload ? envelope : null;
}

// ---------------------------------------------------------------------------
// Content rules
// ---------------------------------------------------------------------------

/**
 * Normalize line endings the way the terminal editor does, so structured and
 * Telnet input converge on identical stored text.
 */
export function normalizeEditorContent(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

/**
 * Reject control characters the terminal editor would treat as formatting or
 * command bytes. Tab and newline are the only ones allowed through.
 */
// eslint-disable-next-line no-control-regex -- rejecting control bytes is the point
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

export function hasDisallowedControlCharacters(content: string): boolean {
  return DISALLOWED_CONTROL.test(content);
}

/** Lowercase hex SHA-256 of the raw UTF-8 bytes of `content`. */
export async function editorContentDigest(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Split raw content into the exact ordered base64 chunks the protocol expects. */
export function chunkEditorContent(content: string): string[] {
  const bytes = new TextEncoder().encode(content);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += editorTransferLimits.maxChunkBytes) {
    chunks.push(
      base64FromBytes(bytes.subarray(offset, offset + editorTransferLimits.maxChunkBytes)),
    );
  }
  return chunks;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type EditorAssemblyFailure = {
  ok: false;
  code: EditorTransferRejectionCode;
  detail: string;
};

export type EditorAssemblyResult = { ok: true; content: string } | EditorAssemblyFailure;

export interface EditorTransferDescriptor {
  transferId: string;
  fieldId: string;
  flowId: string;
  revision: number;
  totalBytes: number;
  chunkCount: number;
  digest: string;
  /** Field's authoritative byte limit, from the source's editor metadata. */
  maxBytes: number;
  startedAtMs: number;
  /** Browser uploads normalize CR/CRLF; source downloads must already be LF-only. */
  normalizeLineEndings?: boolean;
}

/**
 * Accumulates ordered chunks for one transfer. Used by the gateway for browser
 * uploads and by the browser for source downloads. It holds private content, so
 * callers must call `clear()` on every lifecycle exit, not only on success.
 */
export class EditorTransferAssembler {
  private readonly descriptor: EditorTransferDescriptor;
  private readonly chunks: (Uint8Array | null)[];
  private receivedBytes = 0;
  private nextIndex = 0;

  constructor(descriptor: EditorTransferDescriptor) {
    this.descriptor = descriptor;
    this.chunks = new Array<Uint8Array | null>(descriptor.chunkCount).fill(null);
  }

  get transferId(): string {
    return this.descriptor.transferId;
  }

  get fieldId(): string {
    return this.descriptor.fieldId;
  }

  get flowId(): string {
    return this.descriptor.flowId;
  }

  get revision(): number {
    return this.descriptor.revision;
  }

  get totalBytes(): number {
    return this.descriptor.totalBytes;
  }

  get chunkCount(): number {
    return this.descriptor.chunkCount;
  }

  get digest(): string {
    return this.descriptor.digest;
  }

  isExpired(nowMs: number): boolean {
    return (
      nowMs < this.descriptor.startedAtMs ||
      nowMs - this.descriptor.startedAtMs > editorTransferLimits.transferTimeoutMs
    );
  }

  /** Accept one ordered chunk. Any deviation aborts the whole transfer. */
  acceptChunk(index: number, data: string): { ok: true } | EditorAssemblyFailure {
    if (index >= this.descriptor.chunkCount) {
      return { ok: false, code: 'too-many-chunks', detail: 'chunk index past the declared count' };
    }
    if (this.chunks[index] !== null) {
      return { ok: false, code: 'duplicate-chunk', detail: 'chunk already received' };
    }
    // Strict ordering keeps the assembler O(1) in decisions and removes any
    // window where a reordered stream could be reassembled ambiguously.
    if (index !== this.nextIndex) {
      return { ok: false, code: 'out-of-order-chunk', detail: 'chunk arrived out of order' };
    }

    const bytes = bytesFromBase64(data);
    if (!bytes) {
      return { ok: false, code: 'invalid-base64', detail: 'chunk was not valid base64' };
    }
    if (bytes.byteLength > editorTransferLimits.maxChunkBytes) {
      return { ok: false, code: 'chunk-too-large', detail: 'chunk exceeded the chunk limit' };
    }

    const expectedBytes =
      index < this.descriptor.chunkCount - 1
        ? editorTransferLimits.maxChunkBytes
        : this.descriptor.totalBytes -
          editorTransferLimits.maxChunkBytes * (this.descriptor.chunkCount - 1);
    if (bytes.byteLength !== expectedBytes) {
      return {
        ok: false,
        code: 'size-mismatch',
        detail: 'chunk size did not match its declared position',
      };
    }

    this.receivedBytes += bytes.byteLength;
    if (
      this.receivedBytes > this.descriptor.totalBytes ||
      this.receivedBytes > this.descriptor.maxBytes
    ) {
      return { ok: false, code: 'content-too-large', detail: 'content exceeded its declared size' };
    }

    this.chunks[index] = bytes;
    this.nextIndex += 1;
    return { ok: true };
  }

  /**
   * Verify the completed transfer and return its content. Every failure path
   * here must leave the character untouched.
   */
  async finish(): Promise<EditorAssemblyResult> {
    if (this.nextIndex !== this.descriptor.chunkCount || this.chunks.some((c) => c === null)) {
      return { ok: false, code: 'missing-chunk', detail: 'transfer is incomplete' };
    }
    if (this.receivedBytes !== this.descriptor.totalBytes) {
      return {
        ok: false,
        code: 'size-mismatch',
        detail: 'byte count did not match the declaration',
      };
    }

    const joined = new Uint8Array(this.receivedBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk as Uint8Array, offset);
      offset += (chunk as Uint8Array).byteLength;
    }

    let content: string;
    try {
      // Preserve a leading U+FEFF as content. Digest verification covers exact
      // bytes, so consuming a UTF-8 BOM would create a false mismatch.
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(joined);
    } catch {
      return { ok: false, code: 'invalid-utf8', detail: 'content was not valid UTF-8' };
    }

    // Digest the bytes exactly as declared, before normalization, so the check
    // proves transport integrity rather than agreement about normalization.
    const digest = await editorContentDigest(content);
    if (digest !== this.descriptor.digest) {
      return { ok: false, code: 'digest-mismatch', detail: 'content failed its integrity check' };
    }

    const normalized =
      this.descriptor.normalizeLineEndings === false ? content : normalizeEditorContent(content);
    if (hasDisallowedControlCharacters(normalized)) {
      return {
        ok: false,
        code: 'invalid-control-character',
        detail: 'content contained disallowed control characters',
      };
    }

    return { ok: true, content: normalized };
  }

  /** Overwrite and drop every buffer. Safe to call repeatedly. */
  clear(): void {
    for (let index = 0; index < this.chunks.length; index += 1) {
      this.chunks[index]?.fill(0);
      this.chunks[index] = null;
    }
    this.receivedBytes = 0;
    this.nextIndex = 0;
  }
}

/**
 * Byte-and-count budget for editor commits, kept separate from the ordinary
 * onboarding action allowance so a burst of card selections cannot starve a
 * legitimate save (and a save loop cannot flood the MUD).
 */
export class EditorTransferBudget {
  private windowStartMs = 0;
  private commits = 0;
  private bytes = 0;

  /** Returns false when this commit would exceed either budget. */
  tryConsume(byteCount: number, nowMs: number): boolean {
    if (nowMs - this.windowStartMs > editorTransferLimits.rateLimitWindowMs) {
      this.windowStartMs = nowMs;
      this.commits = 0;
      this.bytes = 0;
    }

    if (
      this.commits + 1 > editorTransferLimits.maxCommitsPerWindow ||
      this.bytes + byteCount > editorTransferLimits.maxBytesPerWindow
    ) {
      return false;
    }

    this.commits += 1;
    this.bytes += byteCount;
    return true;
  }

  reset(): void {
    this.windowStartMs = 0;
    this.commits = 0;
    this.bytes = 0;
  }
}
