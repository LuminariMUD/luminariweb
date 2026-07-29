import net from 'node:net';
import {
  defaultMsdpVariables,
  normalizeMsdpVariableMap,
  terminalDimensionBounds,
} from '../shared/mud.ts';
import type {
  ConnectionStatus,
  MsdpVariableMap,
  MudState,
  ServerMessage,
  TerminalDimensions,
} from '../shared/mud.ts';
import { getConfiguredMsdpVariables, mapMsdpUpdate } from '../shared/msdp-state.ts';
import {
  ONBOARDING_ACTION_MSDP_VARIABLE,
  ONBOARDING_CAPABILITY_VARIABLE,
  ONBOARDING_CONTENT_MSDP_VARIABLE,
  ONBOARDING_MSDP_VARIABLE,
  ONBOARDING_PROTOCOL_VERSION,
  ONBOARDING_PROTOCOL_VERSION_MAX,
  ONBOARDING_SUPPORTED_VERSIONS,
  ONBOARDING_VERSIONS_CAPABILITY_VARIABLE,
  onboardingLimits,
  parseOnboardingState,
  resolveOnboardingAction,
  sessionPhaseForState,
} from '../shared/onboarding.ts';
import {
  EditorTransferAssembler,
  EditorTransferBudget,
  chunkEditorContent,
  editorContentDigest,
  editorTransferLimits,
  normalizeEditorContent,
  parseEditorContentSourceEnvelope,
} from '../shared/onboarding-transfer.ts';
import type {
  EditorTransferBeginMessage,
  EditorTransferChunkMessage,
  EditorTransferClientMessage,
  EditorTransferCommitMessage,
  EditorTransferRejectionCode,
} from '../shared/onboarding-transfer.ts';
import type {
  OnboardingActionMessage,
  OnboardingFallbackReason,
  OnboardingState,
} from '../shared/onboarding.ts';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  IAC,
  MSDP_VAL,
  MSDP_VAR,
  SB,
  SE,
  TELOPT_MSDP,
  TelnetParser,
  WEB_CLIENT_NAME,
  WEB_CLIENT_VERSION,
} from './telnet-parser.ts';
import { SlidingWindowRateLimiter } from './rate-limiter.ts';

const WS_COMMAND_RATE_LIMIT_WINDOW_MS = 10_000;
const WS_COMMAND_RATE_LIMIT_MAX_INPUTS = 20;
/**
 * Onboarding gets its own budget. A gallery of cards produces bursts of
 * legitimate selections that should not spend the normal command allowance,
 * and a runaway UI still cannot flood the MUD.
 */
const WS_ONBOARDING_RATE_LIMIT_WINDOW_MS = 10_000;
const WS_ONBOARDING_RATE_LIMIT_MAX_ACTIONS = 30;
const BROWSER_SOCKET_OPEN_STATE = 1;
const DEFAULT_TERMINAL_DIMENSIONS: TerminalDimensions = {
  columns: DEFAULT_COLUMNS,
  rows: DEFAULT_ROWS,
};

export type BrowserSocket = {
  readonly readyState: number;
  send(data: string): void;
};

export type MudSocketAddress = {
  host: string;
  port: number;
};

export type MudSocket = {
  readonly destroyed: boolean;
  setNoDelay(noDelay: boolean): void;
  write(chunk: string | Buffer): void;
  destroy(): void;
  on(event: 'connect', listener: () => void): void;
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: () => void): void;
};

export type MudSocketFactory = (address: MudSocketAddress) => MudSocket;

export type MudSessionTimeoutSettings = {
  connectTimeoutMs: number;
  idleTimeoutMs: number;
};

export type MudSessionTimerApi = {
  clearTimeout(handle: unknown): void;
  setTimeout(listener: () => void, delayMs: number): unknown;
};

export type MudSessionOptions = {
  createMudSocket?: MudSocketFactory;
  timerApi?: MudSessionTimerApi;
  timeouts?: Partial<MudSessionTimeoutSettings>;
  /** Injectable clock so transfer timeouts are testable without real time. */
  now?: () => number;
};

const DEFAULT_MUD_SESSION_TIMEOUTS: MudSessionTimeoutSettings = {
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 300_000,
};

export class MudSession {
  private mudSocket: MudSocket | null = null;
  private parser: TelnetParser | null = null;
  private state: MudState = {};
  private terminalDimensions: TerminalDimensions = DEFAULT_TERMINAL_DIMENSIONS;
  private msdpInitialized = false;
  private msdpVariables: MsdpVariableMap = normalizeMsdpVariableMap(defaultMsdpVariables);
  private lastDisconnectedStatusKey: string | null = null;
  private readonly commandRateLimiter = new SlidingWindowRateLimiter(
    WS_COMMAND_RATE_LIMIT_WINDOW_MS,
    WS_COMMAND_RATE_LIMIT_MAX_INPUTS,
  );
  private readonly onboardingRateLimiter = new SlidingWindowRateLimiter(
    WS_ONBOARDING_RATE_LIMIT_WINDOW_MS,
    WS_ONBOARDING_RATE_LIMIT_MAX_ACTIONS,
  );
  private onboardingState: OnboardingState | null = null;
  private sensitiveInput = false;
  /** At most one browser->MUD editor upload is in flight at a time. */
  private inboundTransfer: EditorTransferAssembler | null = null;
  /** At most one MUD->browser existing-value download is in flight. */
  private outboundTransfer: EditorTransferAssembler | null = null;
  /** The current non-empty editor value passed the gateway digest. */
  private verifiedEditorTransferId: string | null = null;
  private readonly editorBudget = new EditorTransferBudget();
  private readonly now: () => number;
  private readonly browserSocket: BrowserSocket;
  private readonly createMudSocket: MudSocketFactory;
  private readonly timerApi: MudSessionTimerApi;
  private readonly timeouts: MudSessionTimeoutSettings;
  private connectTimeoutHandle: unknown | null = null;
  private connectTimeoutToken = 0;
  private idleTimeoutHandle: unknown | null = null;
  private idleTimeoutToken = 0;
  private inboundTransferTimeoutHandle: unknown | null = null;
  private inboundTransferTimeoutToken = 0;
  private outboundTransferTimeoutHandle: unknown | null = null;
  private outboundTransferTimeoutToken = 0;

  constructor(browserSocket: BrowserSocket, options: MudSessionOptions = {}) {
    this.browserSocket = browserSocket;
    this.createMudSocket = options.createMudSocket ?? createNetMudSocket;
    this.timerApi = options.timerApi ?? defaultMudSessionTimerApi;
    this.timeouts = normalizeMudSessionTimeouts(options.timeouts);
    this.now = options.now ?? (() => Date.now());
  }

  allowCommandInput() {
    return this.commandRateLimiter.allow().allowed;
  }

  connect(host: string, port: number, msdpVariables: MsdpVariableMap) {
    if (!isValidHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
      this.sendStatus('error', 'Provide a valid MUD host and port.');
      return;
    }

    this.cleanupActiveSocket({ destroySocket: true });
    this.resetMudState();
    this.msdpVariables = normalizeMsdpVariableMap(msdpVariables);
    this.sendStatus('connecting', `Connecting to ${host}:${port}...`);

    let mudSocket: MudSocket;
    try {
      mudSocket = this.createMudSocket({ host, port });
    } catch {
      this.cleanupActiveSocket({ destroySocket: false });
      this.sendStatus('error', 'Connection error. Unable to open the MUD socket.');
      return;
    }

    this.mudSocket = mudSocket;
    this.parser = this.createParser(mudSocket);
    this.registerSocketHandlers(mudSocket, host, port);
    this.armConnectTimeout(mudSocket);

    try {
      mudSocket.setNoDelay(true);
    } catch {
      this.cleanupCurrentSocket(mudSocket);
      this.destroySocket(mudSocket);
      this.sendStatus('error', 'Connection error. Unable to configure the MUD socket.');
    }
  }

  updateMsdpVariables(msdpVariables: MsdpVariableMap) {
    this.msdpVariables = normalizeMsdpVariableMap(msdpVariables);

    if (!this.msdpInitialized) {
      return;
    }

    this.applyMsdpConfiguration();
  }

  updateTerminalDimensions(dimensions: TerminalDimensions) {
    const normalizedDimensions = normalizeTerminalDimensions(dimensions);
    if (
      normalizedDimensions.columns === this.terminalDimensions.columns &&
      normalizedDimensions.rows === this.terminalDimensions.rows
    ) {
      return;
    }

    this.terminalDimensions = normalizedDimensions;
    this.applyTerminalDimensionsToParser(
      'Connection error. Unable to send terminal size to the MUD.',
    );
  }

  disconnect(detail: string) {
    this.cleanupActiveSocket({ destroySocket: true });
    this.resetMudState();
    this.sendStatus('disconnected', detail);
  }

  closeBrowser() {
    this.cleanupActiveSocket({ destroySocket: true });
    this.resetMudState();
  }

  keepAlive() {
    const mudSocket = this.mudSocket;
    if (!mudSocket || mudSocket.destroyed) {
      return;
    }

    this.armIdleTimeout(mudSocket);
  }

  sendInput(text: string) {
    const mudSocket = this.mudSocket;
    if (!mudSocket || mudSocket.destroyed) {
      this.sendStatus('error', 'Connect to a MUD before sending commands.');
      return;
    }

    const wroteInput = this.writeToActiveSocket(
      text.endsWith('\n') ? text : `${text}\n`,
      'Connection error. Unable to send command to the MUD.',
    );

    if (wroteInput) {
      if (mudSocket && this.isCurrentSocket(mudSocket)) {
        this.armIdleTimeout(mudSocket);
      }

      this.requestStateRefresh();
    }
  }

  sendStatus(status: ConnectionStatus, detail: string) {
    if (status === 'disconnected') {
      const statusKey = `${status}:${detail}`;
      if (this.lastDisconnectedStatusKey === statusKey) {
        return;
      }
      this.lastDisconnectedStatusKey = statusKey;
    } else {
      this.lastDisconnectedStatusKey = null;
    }

    this.send({ type: 'connection-status', status, detail });
  }

  allowOnboardingAction() {
    return this.onboardingRateLimiter.allow().allowed;
  }

  /**
   * Translate a typed browser action into the exact line the MUD's existing
   * `nanny()` input path already accepts. The MUD still validates it normally;
   * this only rejects actions that the latest server state does not offer.
   */
  sendOnboardingAction(message: OnboardingActionMessage) {
    if (message.action === 'cancel-editor') {
      this.forwardEditorCancel(message);
      return;
    }

    const resolved = resolveOnboardingAction(this.onboardingState, message);
    if (!resolved.ok) {
      this.send({ type: 'onboarding-rejected', code: resolved.code, detail: resolved.detail });
      return;
    }

    const mudSocket = this.mudSocket;
    if (!mudSocket || mudSocket.destroyed) {
      this.send({
        type: 'onboarding-rejected',
        code: 'not-connected',
        detail: 'The MUD connection is closed.',
      });
      return;
    }

    // Deliberately not routed through sendInput(): onboarding lines must never
    // pick up the ordinary command path's history and automation behavior, and
    // the value is never logged or retained here.
    const wrote = this.writeToActiveSocket(
      `${resolved.line}\n`,
      'Connection error. Unable to send your choice to the MUD.',
    );

    if (wrote) {
      this.armIdleTimeout(mudSocket);
    }
  }

  // -------------------------------------------------------------------------
  // Protocol v2 editor transfer
  // -------------------------------------------------------------------------

  /**
   * Drive one step of a browser->MUD editor upload. Nothing here mutates a
   * character: the gateway only proves the transfer is well-formed, complete,
   * and current before handing verified content to the MUD, which revalidates
   * everything again and owns the actual save.
   */
  handleEditorTransfer(message: EditorTransferClientMessage) {
    switch (message.type) {
      case 'onboarding-editor-begin':
        this.beginEditorTransfer(message);
        return;
      case 'onboarding-editor-chunk':
        this.acceptEditorChunk(message);
        return;
      case 'onboarding-editor-commit':
        void this.commitEditorTransfer(message);
        return;
      case 'onboarding-editor-cancel': {
        const transfer = this.activeInboundTransfer(message.transferId);
        if (!transfer) {
          return;
        }
        this.clearInboundTransfer();
        this.sendTransferResult(message.transferId, true, 'ok', 'Editor transfer cancelled.');
        return;
      }
    }
  }

  private beginEditorTransfer(message: EditorTransferBeginMessage) {
    const state = this.onboardingState;
    if (!state) {
      this.sendTransferResult(
        message.transferId,
        false,
        'no-state',
        'No onboarding state is active.',
      );
      return;
    }
    if (state.flowId !== message.flowId) {
      this.sendTransferResult(
        message.transferId,
        false,
        'stale-flow',
        'That editor belongs to an earlier connection.',
      );
      return;
    }
    if (state.revision !== message.revision) {
      this.sendTransferResult(
        message.transferId,
        false,
        'stale-revision',
        'The screen changed before you saved.',
      );
      return;
    }
    // The field must be the one the source is currently offering. This is what
    // stops a save aimed at one field from landing on another.
    if (
      state.version !== ONBOARDING_PROTOCOL_VERSION_MAX ||
      state.inputKind !== 'multiline' ||
      !state.actions.includes('save-text') ||
      !state.editor ||
      state.editor.fieldId !== message.fieldId
    ) {
      this.sendTransferResult(
        message.transferId,
        false,
        'unknown-field',
        'That field is not open for editing.',
      );
      return;
    }
    if (
      state.editor.empty !== true &&
      (!state.editor.transferId ||
        state.editor.transferId !== this.verifiedEditorTransferId ||
        this.outboundTransfer !== null)
    ) {
      this.sendTransferResult(
        message.transferId,
        false,
        'editor-not-loaded',
        'The existing text has not finished loading safely.',
      );
      return;
    }
    if (message.totalBytes > state.editor.maxBytes) {
      this.sendTransferResult(
        message.transferId,
        false,
        'content-too-large',
        'That text is longer than this field allows.',
      );
      return;
    }
    // One upload at a time. An abandoned transfer is replaced only once it has
    // expired, so a stuck client cannot starve itself forever.
    if (this.inboundTransfer && !this.inboundTransfer.isExpired(this.now())) {
      this.sendTransferResult(
        message.transferId,
        false,
        'transfer-in-progress',
        'Another save is still in progress.',
      );
      return;
    }

    this.clearInboundTransfer();
    this.inboundTransfer = new EditorTransferAssembler({
      transferId: message.transferId,
      fieldId: message.fieldId,
      flowId: message.flowId,
      revision: message.revision,
      totalBytes: message.totalBytes,
      chunkCount: message.chunkCount,
      digest: message.digest,
      maxBytes: state.editor.maxBytes,
      startedAtMs: this.now(),
    });
    this.armInboundTransferTimeout(message.transferId);
  }

  private acceptEditorChunk(message: EditorTransferChunkMessage) {
    const transfer = this.activeInboundTransfer(message.transferId);
    if (!transfer) {
      return;
    }

    const accepted = transfer.acceptChunk(message.index, message.data);
    if (!accepted.ok) {
      // Any deviation kills the whole transfer rather than skipping a chunk.
      this.clearInboundTransfer();
      this.sendTransferResult(message.transferId, false, accepted.code, 'That save was rejected.');
    }
  }

  private async commitEditorTransfer(message: EditorTransferCommitMessage) {
    const transfer = this.activeInboundTransfer(message.transferId);
    if (!transfer) {
      return;
    }

    const state = this.onboardingState;
    // Re-check currency at commit: the source may have moved on while the
    // chunks were arriving, and a stale commit must not be forwarded.
    if (!state || state.flowId !== message.flowId || state.revision !== message.revision) {
      this.clearInboundTransfer();
      this.sendTransferResult(
        message.transferId,
        false,
        'stale-revision',
        'The screen changed before you saved.',
      );
      return;
    }

    const result = await transfer.finish();
    if (this.inboundTransfer !== transfer) {
      return;
    }
    if (!result.ok) {
      this.clearInboundTransfer();
      this.sendTransferResult(message.transferId, false, result.code, 'That save was rejected.');
      return;
    }

    const currentState = this.onboardingState;
    if (
      !currentState ||
      currentState.flowId !== message.flowId ||
      currentState.revision !== message.revision ||
      currentState.editor?.fieldId !== transfer.fieldId
    ) {
      this.clearInboundTransfer();
      this.sendTransferResult(
        message.transferId,
        false,
        'stale-revision',
        'The screen changed before you saved.',
      );
      return;
    }

    const byteCount = Buffer.byteLength(result.content, 'utf8');
    if (!this.editorBudget.tryConsume(byteCount, this.now())) {
      this.clearInboundTransfer();
      this.sendTransferResult(
        message.transferId,
        false,
        'rate-limited',
        'Too many saves too quickly. Try again shortly.',
      );
      return;
    }

    const fieldId = transfer.fieldId;
    this.clearInboundTransfer();

    if (
      !(await this.forwardEditorCommit(message.transferId, fieldId, currentState, result.content))
    ) {
      return;
    }

    // Deliberately not a success message. The browser may only report a save
    // once the MUD publishes a state carrying persistenceResult="saved".
    this.sendTransferResult(message.transferId, true, 'ok', 'Sent to the MUD.');
  }

  /**
   * Emit the verified content to the MUD as bounded MSDP chunks on the reserved
   * v2 action variable. Content never travels as terminal input, so it cannot
   * be interpreted as editor commands.
   */
  private async forwardEditorCommit(
    transferId: string,
    fieldId: string,
    state: OnboardingState,
    content: string,
  ): Promise<boolean> {
    const mudSocket = this.mudSocket;
    if (!mudSocket || mudSocket.destroyed) {
      this.sendTransferResult(transferId, false, 'not-connected', 'The MUD connection is closed.');
      return false;
    }

    const chunks = chunkEditorContent(content);
    // The gateway normalized line endings after validating the browser
    // upload, so the source must receive a digest for these exact normalized
    // bytes rather than the browser's pre-normalization declaration.
    const digest = await editorContentDigest(content);
    if (!this.isCurrentSocket(mudSocket) || mudSocket.destroyed) {
      this.sendTransferResult(transferId, false, 'not-connected', 'The MUD connection is closed.');
      return false;
    }
    const currentState = this.onboardingState;
    if (
      !currentState ||
      currentState.flowId !== state.flowId ||
      currentState.revision !== state.revision ||
      currentState.editor?.fieldId !== fieldId
    ) {
      this.sendTransferResult(
        transferId,
        false,
        'stale-revision',
        'The screen changed before you saved.',
      );
      return false;
    }
    const envelopes: string[] = [
      JSON.stringify({
        v: ONBOARDING_PROTOCOL_VERSION_MAX,
        action: 'save-text',
        phase: 'begin',
        flowId: state.flowId,
        revision: state.revision,
        fieldId,
        transferId,
        totalBytes: Buffer.byteLength(content, 'utf8'),
        chunkCount: chunks.length,
        digest,
      }),
      ...chunks.map((data, index) => JSON.stringify({ phase: 'chunk', transferId, index, data })),
      JSON.stringify({ phase: 'commit', transferId }),
    ];

    for (const envelope of envelopes) {
      if (!this.sendMsdpPair(ONBOARDING_ACTION_MSDP_VARIABLE, envelope)) {
        this.sendTransferResult(
          transferId,
          false,
          'not-connected',
          'The MUD connection closed mid-save.',
        );
        return false;
      }
    }

    this.armIdleTimeout(mudSocket);
    return true;
  }

  /**
   * Cancel is a structured source action too: it must leave the source's
   * terminal editor state rather than merely clearing the browser draft.
   */
  private forwardEditorCancel(message: OnboardingActionMessage) {
    const state = this.onboardingState;
    if (!state) {
      this.send({
        type: 'onboarding-rejected',
        code: 'no-state',
        detail: 'No onboarding state is active.',
      });
      return;
    }
    if (message.flowId !== state.flowId) {
      this.send({
        type: 'onboarding-rejected',
        code: 'stale-flow',
        detail: 'That editor belongs to an earlier connection.',
      });
      return;
    }
    if (message.revision !== state.revision) {
      this.send({
        type: 'onboarding-rejected',
        code: 'stale-revision',
        detail: 'The screen changed before you cancelled.',
      });
      return;
    }
    if (!state.actions.includes('cancel-editor') || !state.editor) {
      this.send({
        type: 'onboarding-rejected',
        code: 'action-not-allowed',
        detail: 'This editor cannot be cancelled right now.',
      });
      return;
    }

    const mudSocket = this.mudSocket;
    if (!mudSocket || mudSocket.destroyed) {
      this.send({
        type: 'onboarding-rejected',
        code: 'not-connected',
        detail: 'The MUD connection is closed.',
      });
      return;
    }

    this.clearInboundTransfer();
    const envelope = JSON.stringify({
      v: ONBOARDING_PROTOCOL_VERSION_MAX,
      action: 'cancel-editor',
      phase: 'cancel',
      flowId: state.flowId,
      revision: state.revision,
      fieldId: state.editor.fieldId,
    });
    if (!this.sendMsdpPair(ONBOARDING_ACTION_MSDP_VARIABLE, envelope)) {
      this.send({
        type: 'onboarding-rejected',
        code: 'not-connected',
        detail: 'The MUD connection closed before the editor was cancelled.',
      });
      return;
    }

    this.armIdleTimeout(mudSocket);
  }

  private activeInboundTransfer(transferId: string): EditorTransferAssembler | null {
    const transfer = this.inboundTransfer;
    if (!transfer || transfer.transferId !== transferId) {
      this.sendTransferResult(
        transferId,
        false,
        'unknown-transfer',
        'That save is no longer active.',
      );
      return null;
    }
    if (transfer.isExpired(this.now())) {
      this.clearInboundTransfer();
      this.sendTransferResult(transferId, false, 'transfer-timeout', 'That save timed out.');
      return null;
    }
    return transfer;
  }

  private clearInboundTransfer() {
    this.clearInboundTransferTimeout();
    this.inboundTransfer?.clear();
    this.inboundTransfer = null;
  }

  /**
   * Accept one source->gateway content envelope. No chunk reaches the browser
   * until commit has verified ordering, exact byte counts, UTF-8, controls,
   * state currency, and SHA-256.
   */
  private handleEditorContentPayload(value: unknown) {
    const envelope = parseEditorContentSourceEnvelope(value);
    if (!envelope) {
      if (
        this.outboundTransfer ||
        (this.onboardingState?.editor?.transferId &&
          this.onboardingState.editor.transferId !== this.verifiedEditorTransferId)
      ) {
        this.rejectOutboundTransfer(
          'source-transfer-invalid',
          'Existing text could not be loaded safely.',
        );
      }
      return;
    }

    switch (envelope.phase) {
      case 'begin':
        this.beginOutboundTransfer(envelope);
        return;
      case 'chunk':
        this.acceptOutboundChunk(envelope.transferId, envelope.index, envelope.data);
        return;
      case 'commit':
        void this.commitOutboundTransfer(envelope.transferId);
        return;
    }
  }

  private beginOutboundTransfer(
    envelope: Extract<
      NonNullable<ReturnType<typeof parseEditorContentSourceEnvelope>>,
      { phase: 'begin' }
    >,
  ) {
    const state = this.onboardingState;
    const editor = state?.editor;
    if (
      !state ||
      state.version !== ONBOARDING_PROTOCOL_VERSION_MAX ||
      !editor ||
      editor.empty !== false ||
      state.flowId !== envelope.flowId ||
      state.revision !== envelope.revision ||
      editor.fieldId !== envelope.fieldId ||
      editor.transferId !== envelope.transferId ||
      editor.totalBytes !== envelope.totalBytes ||
      editor.chunkCount !== envelope.chunkCount ||
      editor.digest !== envelope.digest ||
      envelope.totalBytes > editor.maxBytes
    ) {
      this.rejectOutboundTransfer(
        state ? 'source-transfer-invalid' : 'no-state',
        'Existing text could not be loaded safely.',
        envelope.transferId,
      );
      return;
    }

    if (this.outboundTransfer) {
      this.rejectOutboundTransfer(
        'transfer-in-progress',
        'Existing text could not be loaded safely.',
      );
      return;
    }

    this.verifiedEditorTransferId = null;
    this.outboundTransfer = new EditorTransferAssembler({
      transferId: envelope.transferId,
      fieldId: envelope.fieldId,
      flowId: envelope.flowId,
      revision: envelope.revision,
      totalBytes: envelope.totalBytes,
      chunkCount: envelope.chunkCount,
      digest: envelope.digest,
      maxBytes: editor.maxBytes,
      startedAtMs: this.now(),
      normalizeLineEndings: false,
    });
    this.armOutboundTransferTimeout(envelope.transferId);
  }

  private acceptOutboundChunk(transferId: string, index: number, data: string) {
    const transfer = this.activeOutboundTransfer(transferId);
    if (!transfer) {
      return;
    }

    const accepted = transfer.acceptChunk(index, data);
    if (!accepted.ok) {
      this.rejectOutboundTransfer(
        accepted.code,
        'Existing text could not be loaded safely.',
        transferId,
      );
    }
  }

  private async commitOutboundTransfer(transferId: string) {
    const transfer = this.activeOutboundTransfer(transferId);
    if (!transfer) {
      return;
    }
    if (!this.sourceTransferMatchesCurrentState(transfer)) {
      this.rejectOutboundTransfer(
        'stale-revision',
        'The editor changed before its existing text finished loading.',
        transferId,
      );
      return;
    }

    const result = await transfer.finish();
    if (this.outboundTransfer !== transfer) {
      return;
    }
    if (!result.ok) {
      this.rejectOutboundTransfer(
        result.code,
        'Existing text could not be loaded safely.',
        transferId,
      );
      return;
    }
    if (normalizeEditorContent(result.content) !== result.content || result.content.includes('~')) {
      this.rejectOutboundTransfer(
        'source-transfer-invalid',
        'Existing text could not be loaded safely.',
        transferId,
      );
      return;
    }
    if (!this.sourceTransferMatchesCurrentState(transfer)) {
      this.rejectOutboundTransfer(
        'stale-revision',
        'The editor changed before its existing text finished loading.',
        transferId,
      );
      return;
    }

    const chunks = chunkEditorContent(result.content);
    if (chunks.length !== transfer.chunkCount) {
      this.rejectOutboundTransfer(
        'size-mismatch',
        'Existing text could not be loaded safely.',
        transferId,
      );
      return;
    }

    const fieldId = transfer.fieldId;
    this.verifiedEditorTransferId = transferId;
    this.clearOutboundTransfer();
    for (const [index, data] of chunks.entries()) {
      this.send({
        type: 'onboarding-editor-content',
        transferId,
        fieldId,
        index,
        data,
      });
    }
    this.send({
      type: 'onboarding-editor-content-complete',
      transferId,
      fieldId,
    });
  }

  private activeOutboundTransfer(transferId: string): EditorTransferAssembler | null {
    const transfer = this.outboundTransfer;
    if (!transfer || transfer.transferId !== transferId) {
      this.rejectOutboundTransfer(
        'unknown-transfer',
        'Existing text could not be loaded safely.',
        transferId,
      );
      return null;
    }
    if (transfer.isExpired(this.now())) {
      this.rejectOutboundTransfer(
        'transfer-timeout',
        'Existing text took too long to load.',
        transferId,
      );
      return null;
    }
    return transfer;
  }

  private sourceTransferMatchesCurrentState(transfer: EditorTransferAssembler): boolean {
    const state = this.onboardingState;
    const editor = state?.editor;
    return (
      state?.version === ONBOARDING_PROTOCOL_VERSION_MAX &&
      state.flowId === transfer.flowId &&
      state.revision === transfer.revision &&
      editor?.empty === false &&
      editor.fieldId === transfer.fieldId &&
      editor.transferId === transfer.transferId &&
      editor.totalBytes === transfer.totalBytes &&
      editor.chunkCount === transfer.chunkCount &&
      editor.digest === transfer.digest
    );
  }

  private rejectOutboundTransfer(
    code: EditorTransferRejectionCode,
    detail: string,
    fallbackTransferId = 'source-transfer',
  ) {
    const transferId =
      this.outboundTransfer?.transferId ??
      this.onboardingState?.editor?.transferId ??
      fallbackTransferId;
    this.verifiedEditorTransferId = null;
    this.clearOutboundTransfer();
    this.sendTransferResult(transferId, false, code, detail);
  }

  private clearOutboundTransfer() {
    this.clearOutboundTransferTimeout();
    this.outboundTransfer?.clear();
    this.outboundTransfer = null;
  }

  private sendTransferResult(
    transferId: string,
    ok: boolean,
    code: EditorTransferRejectionCode,
    detail: string,
  ) {
    // `detail` is a fixed phrase. Never interpolate any part of the content.
    this.send({ type: 'onboarding-editor-result', transferId, ok, code, detail });
  }

  private handleOnboardingPayload(value: unknown) {
    // The MUD publishes the state as a compact JSON document inside one MSDP
    // string, which keeps the C side simple while the real validation happens
    // here, before anything reaches the browser.
    if (typeof value !== 'string') {
      this.failOnboarding('malformed-payload', 'The onboarding payload was not a string.');
      return;
    }

    if (Buffer.byteLength(value, 'utf8') > onboardingLimits.maxPayloadBytes) {
      this.failOnboarding('payload-too-large', 'The onboarding payload exceeded its size limit.');
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      this.failOnboarding('malformed-payload', 'The onboarding payload could not be read.');
      return;
    }

    const result = parseOnboardingState(decoded);
    if (!result.ok) {
      this.failOnboarding(result.reason, result.detail);
      return;
    }

    const state = result.state;
    if (this.onboardingState && state.flowId === this.onboardingState.flowId) {
      // A replayed or out-of-order update must not reopen a screen the player
      // already moved past, nor disturb either transfer direction.
      if (state.revision <= this.onboardingState.revision) {
        return;
      }
    }

    // Every accepted state is either a newer revision or a new flow. It
    // invalidates both directions before the replacement state is published:
    // field identity, limits, character ownership, or save state may differ.
    if (this.inboundTransfer) {
      const transferId = this.inboundTransfer.transferId;
      this.clearInboundTransfer();
      this.sendTransferResult(
        transferId,
        false,
        'stale-revision',
        'The screen changed before you saved.',
      );
    }
    if (this.outboundTransfer) {
      this.rejectOutboundTransfer(
        'stale-revision',
        'The editor changed before its existing text finished loading.',
      );
    }
    this.verifiedEditorTransferId = null;

    if (state.mode === 'play') {
      this.onboardingState = null;
      this.send({ type: 'onboarding-state', state, phase: 'playing' });
      return;
    }

    this.onboardingState = state;

    // Cross-check the structured flag against the live Telnet ECHO state and
    // prefer hiding. Keep those two signals independent: a structured
    // password screen must not synthesize a sticky Telnet ECHO state that can
    // leak into the next non-password screen.
    if (this.sensitiveInput && !state.sensitiveInput) {
      state.sensitiveInput = true;
    }

    this.send({ type: 'onboarding-state', state, phase: sessionPhaseForState(state) });
  }

  private failOnboarding(reason: OnboardingFallbackReason, detail: string) {
    this.onboardingState = null;
    this.clearInboundTransfer();
    this.clearOutboundTransfer();
    this.verifiedEditorTransferId = null;
    this.editorBudget.reset();
    this.send({ type: 'onboarding-fallback', reason, detail });
  }

  private setSensitiveInput(sensitive: boolean) {
    if (this.sensitiveInput === sensitive) {
      return;
    }

    this.sensitiveInput = sensitive;
    this.send({ type: 'sensitive-input', sensitive });
  }

  private clearOnboarding(reason: OnboardingFallbackReason, detail: string) {
    this.setSensitiveInput(false);
    // Private draft content must not survive a disconnect, an account switch,
    // a character switch, or a fallback to the terminal.
    this.clearInboundTransfer();
    this.clearOutboundTransfer();
    this.verifiedEditorTransferId = null;
    this.editorBudget.reset();

    if (!this.onboardingState) {
      return;
    }

    this.onboardingState = null;
    this.send({ type: 'onboarding-fallback', reason, detail });
  }

  private createParser(mudSocket: MudSocket) {
    const parser = new TelnetParser(mudSocket, {
      onText: (text) => {
        if (!this.isCurrentSocket(mudSocket)) {
          return;
        }

        this.send({ type: 'terminal', text });
      },
      onMsdp: (variable, value) => {
        if (!this.isCurrentSocket(mudSocket)) {
          return;
        }

        if (variable === ONBOARDING_MSDP_VARIABLE) {
          this.handleOnboardingPayload(value);
          return;
        }
        if (variable === ONBOARDING_CONTENT_MSDP_VARIABLE) {
          this.handleEditorContentPayload(value);
          return;
        }

        const partial = mapMsdpUpdate(variable, value, this.msdpVariables);
        if (Object.keys(partial).length === 0) {
          return;
        }

        this.state = { ...this.state, ...partial };
        this.send({ type: 'state', state: partial });
      },
      onMsdpReady: () => {
        if (!this.isCurrentSocket(mudSocket) || this.msdpInitialized) {
          return;
        }

        this.msdpInitialized = true;
        this.initializeMsdp();
      },
      onSensitiveInput: (sensitive) => {
        if (!this.isCurrentSocket(mudSocket)) {
          return;
        }

        this.setSensitiveInput(sensitive);
      },
    });

    parser.updateTerminalSize(this.terminalDimensions);
    return parser;
  }

  private registerSocketHandlers(mudSocket: MudSocket, host: string, port: number) {
    mudSocket.on('connect', () => {
      if (!this.isCurrentSocket(mudSocket)) {
        return;
      }

      this.clearConnectTimeout();
      this.armIdleTimeout(mudSocket);
      this.sendStatus('connected', `Connected to ${host}:${port}.`);
    });

    mudSocket.on('data', (chunk) => {
      if (!this.isCurrentSocket(mudSocket)) {
        return;
      }

      this.armIdleTimeout(mudSocket);

      try {
        this.parser?.push(chunk);
      } catch {
        this.cleanupCurrentSocket(mudSocket);
        this.destroySocket(mudSocket);
        this.sendStatus('error', 'Connection error. Unable to parse MUD traffic.');
      }
    });

    mudSocket.on('error', () => {
      if (!this.isCurrentSocket(mudSocket)) {
        return;
      }

      this.cleanupCurrentSocket(mudSocket);
      this.destroySocket(mudSocket);
      this.sendStatus('error', 'Connection error. The MUD connection closed unexpectedly.');
    });

    mudSocket.on('close', () => {
      if (!this.cleanupCurrentSocket(mudSocket)) {
        return;
      }

      this.sendStatus('disconnected', `Connection to ${host}:${port} closed.`);
    });
  }

  private initializeMsdp() {
    if (!this.mudSocket || this.mudSocket.destroyed) {
      return;
    }

    this.sendMsdpPair('CLIENT_ID', WEB_CLIENT_NAME);
    this.sendMsdpPair('CLIENT_VERSION', WEB_CLIENT_VERSION);
    // Capability negotiation: a MUD that understands this variable may emit
    // structured onboarding state. Any other server simply ignores it and the
    // browser stays on the classic terminal flow.
    this.sendMsdpPair(ONBOARDING_CAPABILITY_VARIABLE, ONBOARDING_PROTOCOL_VERSION);
    // Current gateways always offer the complete protocol. An old source has
    // already been satisfied by the v1 variable above and simply ignores this
    // list, so compatibility does not require a product-feature kill switch.
    this.sendMsdpPair(
      ONBOARDING_VERSIONS_CAPABILITY_VARIABLE,
      ONBOARDING_SUPPORTED_VERSIONS.join(','),
    );
    this.sendMsdpPair('REPORT', ONBOARDING_MSDP_VARIABLE);
    this.sendMsdpPair('ANSI_COLORS', 1);
    this.sendMsdpPair('256_COLORS', 1);
    this.sendMsdpPair('UTF_8', 1);
    this.applyMsdpConfiguration();
  }

  private sendMsdpPair(variable: string, value: string | number) {
    if (!this.mudSocket || this.mudSocket.destroyed) {
      return false;
    }

    const payload = Buffer.concat([
      Buffer.from([IAC, SB, TELOPT_MSDP, MSDP_VAR]),
      Buffer.from(variable, 'utf8'),
      Buffer.from([MSDP_VAL]),
      Buffer.from(String(value), 'utf8'),
      Buffer.from([IAC, SE]),
    ]);

    return this.writeToActiveSocket(payload, 'Connection error. Unable to exchange MSDP data.');
  }

  private requestStateRefresh() {
    if (!this.msdpInitialized) {
      return;
    }

    for (const variable of getConfiguredMsdpVariables(this.msdpVariables)) {
      if (!this.sendMsdpPair('SEND', variable)) {
        return;
      }
    }
  }

  private applyMsdpConfiguration() {
    for (const variable of getConfiguredMsdpVariables(this.msdpVariables)) {
      if (!this.sendMsdpPair('REPORT', variable)) {
        return;
      }
    }

    this.requestStateRefresh();
  }

  private applyTerminalDimensionsToParser(failureDetail: string) {
    const mudSocket = this.mudSocket;
    if (!mudSocket || mudSocket.destroyed || !this.parser) {
      return;
    }

    try {
      this.parser.updateTerminalSize(this.terminalDimensions);
    } catch {
      this.cleanupCurrentSocket(mudSocket);
      this.destroySocket(mudSocket);
      this.sendStatus('error', failureDetail);
    }
  }

  private writeToActiveSocket(chunk: string | Buffer, failureDetail: string) {
    const mudSocket = this.mudSocket;
    if (!mudSocket || mudSocket.destroyed) {
      return false;
    }

    try {
      mudSocket.write(chunk);
      return true;
    } catch {
      this.cleanupCurrentSocket(mudSocket);
      this.destroySocket(mudSocket);
      this.sendStatus('error', failureDetail);
      return false;
    }
  }

  private cleanupActiveSocket(options: { destroySocket: boolean }) {
    const mudSocket = this.mudSocket;
    this.clearSocketTimers();
    this.parser?.close();
    this.parser = null;
    this.mudSocket = null;
    this.msdpInitialized = false;

    if (options.destroySocket && mudSocket) {
      this.destroySocket(mudSocket);
    }
  }

  private cleanupCurrentSocket(mudSocket: MudSocket) {
    if (this.mudSocket !== mudSocket) {
      return false;
    }

    this.clearSocketTimers();
    this.parser?.close();
    this.parser = null;
    this.mudSocket = null;
    this.msdpInitialized = false;
    this.resetMudState();
    return true;
  }

  private resetMudState() {
    this.state = {};
    // Account names, character lists, and any entered value must not survive a
    // disconnect or an account switch.
    this.clearOnboarding('disconnected', 'The MUD connection ended.');
  }

  private destroySocket(mudSocket: MudSocket) {
    if (mudSocket.destroyed) {
      return;
    }

    try {
      mudSocket.destroy();
    } catch {
      this.sendStatus('error', 'Connection error. Unable to close the MUD socket cleanly.');
    }
  }

  private isCurrentSocket(mudSocket: MudSocket) {
    return this.mudSocket === mudSocket;
  }

  private armConnectTimeout(mudSocket: MudSocket) {
    this.clearConnectTimeout();
    const timeoutToken = this.connectTimeoutToken + 1;
    this.connectTimeoutToken = timeoutToken;
    this.connectTimeoutHandle = this.timerApi.setTimeout(() => {
      if (this.connectTimeoutToken !== timeoutToken || !this.isCurrentSocket(mudSocket)) {
        return;
      }

      this.cleanupCurrentSocket(mudSocket);
      this.destroySocket(mudSocket);
      this.sendStatus('error', 'Connection timed out before the MUD accepted the connection.');
    }, this.timeouts.connectTimeoutMs);
  }

  private armIdleTimeout(mudSocket: MudSocket) {
    this.clearIdleTimeout();
    const timeoutToken = this.idleTimeoutToken + 1;
    this.idleTimeoutToken = timeoutToken;
    this.idleTimeoutHandle = this.timerApi.setTimeout(() => {
      if (this.idleTimeoutToken !== timeoutToken || !this.isCurrentSocket(mudSocket)) {
        return;
      }

      this.cleanupCurrentSocket(mudSocket);
      this.destroySocket(mudSocket);
      this.sendStatus('disconnected', 'Connection closed after being idle too long.');
    }, this.timeouts.idleTimeoutMs);
  }

  private armInboundTransferTimeout(transferId: string) {
    this.clearInboundTransferTimeout();
    const timeoutToken = this.inboundTransferTimeoutToken + 1;
    this.inboundTransferTimeoutToken = timeoutToken;
    this.inboundTransferTimeoutHandle = this.timerApi.setTimeout(() => {
      if (
        this.inboundTransferTimeoutToken !== timeoutToken ||
        this.inboundTransfer?.transferId !== transferId
      ) {
        return;
      }

      this.clearInboundTransfer();
      this.sendTransferResult(transferId, false, 'transfer-timeout', 'That save timed out.');
    }, editorTransferLimits.transferTimeoutMs);
  }

  private armOutboundTransferTimeout(transferId: string) {
    this.clearOutboundTransferTimeout();
    const timeoutToken = this.outboundTransferTimeoutToken + 1;
    this.outboundTransferTimeoutToken = timeoutToken;
    this.outboundTransferTimeoutHandle = this.timerApi.setTimeout(() => {
      if (
        this.outboundTransferTimeoutToken !== timeoutToken ||
        this.outboundTransfer?.transferId !== transferId
      ) {
        return;
      }

      this.rejectOutboundTransfer(
        'transfer-timeout',
        'Existing text took too long to load.',
        transferId,
      );
    }, editorTransferLimits.transferTimeoutMs);
  }

  private clearSocketTimers() {
    this.clearConnectTimeout();
    this.clearIdleTimeout();
  }

  private clearConnectTimeout() {
    if (this.connectTimeoutHandle === null) {
      return;
    }

    this.timerApi.clearTimeout(this.connectTimeoutHandle);
    this.connectTimeoutHandle = null;
    this.connectTimeoutToken += 1;
  }

  private clearIdleTimeout() {
    if (this.idleTimeoutHandle === null) {
      return;
    }

    this.timerApi.clearTimeout(this.idleTimeoutHandle);
    this.idleTimeoutHandle = null;
    this.idleTimeoutToken += 1;
  }

  private clearInboundTransferTimeout() {
    if (this.inboundTransferTimeoutHandle === null) {
      return;
    }

    this.timerApi.clearTimeout(this.inboundTransferTimeoutHandle);
    this.inboundTransferTimeoutHandle = null;
    this.inboundTransferTimeoutToken += 1;
  }

  private clearOutboundTransferTimeout() {
    if (this.outboundTransferTimeoutHandle === null) {
      return;
    }

    this.timerApi.clearTimeout(this.outboundTransferTimeoutHandle);
    this.outboundTransferTimeoutHandle = null;
    this.outboundTransferTimeoutToken += 1;
  }

  private send(message: ServerMessage) {
    if (this.browserSocket.readyState !== BROWSER_SOCKET_OPEN_STATE) {
      return;
    }

    try {
      this.browserSocket.send(JSON.stringify(message));
    } catch {
      return;
    }
  }
}

function createNetMudSocket(address: MudSocketAddress): MudSocket {
  return net.createConnection({ host: address.host, port: address.port });
}

const defaultMudSessionTimerApi: MudSessionTimerApi = {
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setTimeout: (listener, delayMs) => setTimeout(listener, delayMs),
};

function normalizeMudSessionTimeouts(
  timeouts: Partial<MudSessionTimeoutSettings> | undefined,
): MudSessionTimeoutSettings {
  return {
    connectTimeoutMs: normalizeMudSessionTimeout(
      timeouts?.connectTimeoutMs,
      DEFAULT_MUD_SESSION_TIMEOUTS.connectTimeoutMs,
    ),
    idleTimeoutMs: normalizeMudSessionTimeout(
      timeouts?.idleTimeoutMs,
      DEFAULT_MUD_SESSION_TIMEOUTS.idleTimeoutMs,
    ),
  };
}

function normalizeMudSessionTimeout(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeTerminalDimensions(dimensions: TerminalDimensions): TerminalDimensions {
  return {
    columns: normalizeTerminalDimension(
      dimensions.columns,
      terminalDimensionBounds.columns.min,
      terminalDimensionBounds.columns.max,
      DEFAULT_TERMINAL_DIMENSIONS.columns,
    ),
    rows: normalizeTerminalDimension(
      dimensions.rows,
      terminalDimensionBounds.rows.min,
      terminalDimensionBounds.rows.max,
      DEFAULT_TERMINAL_DIMENSIONS.rows,
    ),
  };
}

function normalizeTerminalDimension(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isValidHost(host: string) {
  return /^[a-z0-9.-]+$/i.test(host) || net.isIP(host) !== 0;
}
