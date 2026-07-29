/**
 * Presentation state for the structured onboarding experience.
 *
 * This reducer decides only what to show. It never computes available races,
 * valid alignments, account unlocks, or save success: those come from the MUD
 * and arrive already validated at the proxy boundary.
 */

import type {
  OnboardingActionName,
  OnboardingFallbackReason,
  OnboardingState,
  SessionPhase,
} from '../../../shared/onboarding.ts';

export interface OnboardingRejection {
  code: string;
  detail: string;
}

export interface OnboardingFallbackNotice {
  reason: OnboardingFallbackReason;
  detail: string;
}

export interface OnboardingUiState {
  /** The connected MUD has emitted at least one valid structured state. */
  supported: boolean;
  state: OnboardingState | null;
  phase: SessionPhase;
  /** Latest authoritative input sensitivity reported by the proxy. */
  sensitive: boolean;
  rejection: OnboardingRejection | null;
  fallback: OnboardingFallbackNotice | null;
  /** The player explicitly asked for the classic terminal this session. */
  preferClassic: boolean;
  /** An action is in flight; controls are disabled until the server answers. */
  pending: boolean;
  /** Screen the player is inspecting in detail, if any. */
  inspectedChoiceId: string | null;
  /**
   * Live editor session for the current multiline screen. Drafts live only
   * here, in component memory: they are never written to local storage, a
   * service-worker cache, or anywhere else that outlives the session.
   */
  editor: OnboardingEditorUiState | null;
  /**
   * A suggestion selected before its multiline editor exists. It may cross
   * only into the matching empty field in the same connection flow.
   */
  ideaDraft: OnboardingIdeaDraft | null;
}

export interface OnboardingIdeaDraft {
  fieldId: string;
  draft: string;
}

export type EditorLoadPhase =
  /** No content transfer is expected; the field is empty and editable now. */
  | 'ready'
  /** The source is sending existing content; the field must stay read-only. */
  | 'loading'
  /** A transfer failed. The field stays read-only rather than showing partial text. */
  | 'failed';

export interface OnboardingEditorUiState {
  fieldId: string;
  maxBytes: number;
  contentRevision: number;
  /** Assembled server content, once the whole transfer verified. */
  loaded: string;
  /** What the player has typed. Never persisted anywhere. */
  draft: string;
  loadPhase: EditorLoadPhase;
  /** Ordered base64 chunks of an in-flight download. */
  incoming: {
    transferId: string;
    totalBytes: number;
    chunkCount: number;
    chunks: string[];
  } | null;
  /** Source transfer that produced `loaded`, if the field was non-empty. */
  authoritativeTransferId: string | null;
  /** A save is in flight; the save control stays disabled until it resolves. */
  saving: boolean;
  savingTransferId: string | null;
  /** Last transfer outcome, for the aria-live region. Never contains content. */
  notice: { ok: boolean; code: string; detail: string } | null;
}

/** True when the player has unsaved changes that a surface switch would drop. */
export function isEditorDirty(editor: OnboardingEditorUiState | null): boolean {
  return Boolean(editor) && editor!.draft !== editor!.loaded;
}

export const initialOnboardingUiState: OnboardingUiState = {
  supported: false,
  state: null,
  phase: 'offline',
  sensitive: false,
  rejection: null,
  fallback: null,
  preferClassic: false,
  pending: false,
  inspectedChoiceId: null,
  editor: null,
  ideaDraft: null,
};

export type OnboardingUiAction =
  | { type: 'server-state'; state: OnboardingState; phase: SessionPhase }
  | { type: 'server-fallback'; reason: OnboardingFallbackReason; detail: string }
  | { type: 'sensitive-input'; sensitive: boolean }
  | { type: 'rejected'; code: string; detail: string }
  | { type: 'action-sent'; action: OnboardingActionName }
  | { type: 'inspect-choice'; choiceId: string | null }
  | { type: 'prefer-classic' }
  | { type: 'prefer-structured' }
  | { type: 'disconnected' }
  | { type: 'editor-draft-changed'; draft: string }
  | { type: 'editor-save-started'; transferId: string }
  | {
      type: 'editor-content-chunk';
      transferId: string;
      fieldId: string;
      index: number;
      data: string;
    }
  | { type: 'editor-content-complete'; transferId: string; fieldId: string }
  | { type: 'editor-result'; transferId: string; ok: boolean; code: string; detail: string }
  | { type: 'editor-discard-draft' };

/**
 * Build the editor session for an incoming state, carrying a live draft across
 * a same-field revision bump (a validation error should not discard what the
 * player typed) but never across a change of field.
 */
function editorForState(
  incoming: OnboardingState,
  existing: OnboardingEditorUiState | null,
  seed: OnboardingIdeaDraft | null,
): OnboardingEditorUiState | null {
  const meta = incoming.editor;
  if (!meta) {
    return null;
  }

  const describedTransfer =
    meta.transferId && typeof meta.totalBytes === 'number' && typeof meta.chunkCount === 'number'
      ? {
          transferId: meta.transferId,
          totalBytes: meta.totalBytes,
          chunkCount: meta.chunkCount,
          chunks: [],
        }
      : null;

  if (existing && existing.fieldId === meta.fieldId) {
    const dirty = isEditorDirty(existing);
    const contentChanged = existing.contentRevision !== meta.contentRevision;

    // A validation refresh for the same stored value must not erase a live
    // draft. If the underlying value changed independently, keep the draft in
    // memory but close the field rather than permitting a blind overwrite.
    if (dirty && incoming.persistenceResult !== 'saved') {
      return {
        ...existing,
        maxBytes: meta.maxBytes,
        contentRevision: meta.contentRevision,
        loadPhase: contentChanged ? 'failed' : existing.loadPhase,
        incoming: contentChanged ? null : existing.incoming,
        saving: false,
        savingTransferId: null,
      };
    }

    if (describedTransfer && existing.authoritativeTransferId === describedTransfer.transferId) {
      return {
        ...existing,
        maxBytes: meta.maxBytes,
        contentRevision: meta.contentRevision,
        saving: false,
        savingTransferId: null,
      };
    }

    if (meta.empty === true && !describedTransfer) {
      const draft = seed?.fieldId === meta.fieldId ? seed.draft : '';

      return {
        fieldId: meta.fieldId,
        maxBytes: meta.maxBytes,
        contentRevision: meta.contentRevision,
        loaded: '',
        draft,
        loadPhase: 'ready',
        incoming: null,
        authoritativeTransferId: null,
        saving: false,
        savingTransferId: null,
        notice: null,
      };
    }

    return {
      ...existing,
      maxBytes: meta.maxBytes,
      contentRevision: meta.contentRevision,
      // A non-empty field without a complete transfer descriptor is closed.
      loadPhase: describedTransfer ? 'loading' : 'failed',
      incoming: describedTransfer,
      saving: false,
      savingTransferId: null,
      notice: null,
    };
  }

  const draft = seed?.fieldId === meta.fieldId && meta.empty === true ? seed.draft : '';

  return {
    fieldId: meta.fieldId,
    maxBytes: meta.maxBytes,
    contentRevision: meta.contentRevision,
    loaded: '',
    draft,
    // A described transfer means content is coming; until it verifies, the
    // field must not be editable or it would overwrite unseen text.
    loadPhase: describedTransfer ? 'loading' : meta.empty === true ? 'ready' : 'failed',
    incoming: describedTransfer,
    authoritativeTransferId: null,
    saving: false,
    savingTransferId: null,
    notice: null,
  };
}

function ideaFieldForScreen(screen: OnboardingState['screen']): string | null {
  switch (screen) {
    case 'goals-ideas':
      return 'goals';
    case 'personality-ideas':
      return 'personality';
    case 'ideals-ideas':
      return 'ideals';
    case 'bonds-ideas':
      return 'bonds';
    case 'flaws-ideas':
      return 'flaws';
    default:
      return null;
  }
}

/** Decode assembled base64 chunks into the loaded content. */
function decodeIncomingChunks(chunks: string[]): { content: string; byteLength: number } | null {
  try {
    const binary = chunks.map((chunk) => atob(chunk)).join('');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return {
      content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      byteLength: bytes.byteLength,
    };
  } catch {
    return null;
  }
}

export function onboardingReducer(
  current: OnboardingUiState,
  action: OnboardingUiAction,
): OnboardingUiState {
  switch (action.type) {
    case 'server-state': {
      const incoming = action.state;
      const existing = current.state;

      // Out-of-order updates must never reopen a screen already passed.
      if (
        existing &&
        existing.flowId === incoming.flowId &&
        incoming.revision < existing.revision
      ) {
        return current;
      }

      const flowChanged = !existing || existing.flowId !== incoming.flowId;
      const incomingIdeaField = ideaFieldForScreen(incoming.screen);
      const seed =
        !flowChanged &&
        current.ideaDraft &&
        incoming.editor?.empty === true &&
        incoming.editor.fieldId === current.ideaDraft.fieldId
          ? current.ideaDraft
          : null;

      return {
        ...current,
        supported: true,
        state: incoming,
        phase: action.phase,
        // The proxy has already combined the structured screen flag with its
        // live Telnet ECHO state. Replacing this value lets a later
        // non-password screen clear masking without waiting for a second,
        // potentially absent ECHO negotiation event.
        sensitive: incoming.sensitiveInput,
        rejection: null,
        fallback: null,
        pending: false,
        inspectedChoiceId: flowChanged ? null : current.inspectedChoiceId,
        // A new flow means a different character or connection; no draft may
        // survive that boundary.
        editor: editorForState(incoming, flowChanged ? null : current.editor, seed),
        ideaDraft:
          !flowChanged && current.ideaDraft && incomingIdeaField === current.ideaDraft.fieldId
            ? current.ideaDraft
            : null,
      };
    }

    case 'server-fallback':
      return {
        ...current,
        state: null,
        pending: false,
        inspectedChoiceId: null,
        // Dropping to the terminal discards private draft content.
        editor: null,
        ideaDraft: null,
        phase: action.reason === 'disconnected' ? 'offline' : current.phase,
        // A server that never supported the protocol should not be reported as
        // having lost it.
        supported: action.reason === 'unsupported-server' ? false : current.supported,
        fallback:
          action.reason === 'disconnected'
            ? null
            : { reason: action.reason, detail: action.detail },
      };

    case 'sensitive-input':
      return { ...current, sensitive: action.sensitive };

    case 'rejected':
      return {
        ...current,
        pending: false,
        rejection: { code: action.code, detail: action.detail },
      };

    case 'action-sent':
      return {
        ...current,
        rejection: null,
        // A purely local action does not wait on the server.
        pending: action.action !== 'classic-terminal',
      };

    case 'inspect-choice':
      return { ...current, inspectedChoiceId: action.choiceId };

    case 'editor-draft-changed': {
      if (!current.editor || current.editor.loadPhase !== 'ready') {
        const fieldId = current.state ? ideaFieldForScreen(current.state.screen) : null;

        if (!current.editor && fieldId) {
          return {
            ...current,
            ideaDraft: { fieldId, draft: action.draft },
          };
        }
        return current;
      }
      return {
        ...current,
        editor: { ...current.editor, draft: action.draft, notice: null },
        ideaDraft: null,
      };
    }

    case 'editor-save-started': {
      if (!current.editor) {
        return current;
      }
      return {
        ...current,
        editor: {
          ...current.editor,
          saving: true,
          savingTransferId: action.transferId,
          notice: null,
        },
      };
    }

    case 'editor-content-chunk': {
      const editor = current.editor;
      // Ignore a chunk for a field or transfer we are not currently loading;
      // it is stale by definition.
      if (
        !editor ||
        editor.fieldId !== action.fieldId ||
        editor.incoming?.transferId !== action.transferId ||
        action.index >= editor.incoming.chunkCount ||
        action.index !== editor.incoming.chunks.length
      ) {
        return current;
      }
      return {
        ...current,
        editor: {
          ...editor,
          incoming: {
            transferId: action.transferId,
            totalBytes: editor.incoming.totalBytes,
            chunkCount: editor.incoming.chunkCount,
            chunks: [...editor.incoming.chunks, action.data],
          },
        },
      };
    }

    case 'editor-content-complete': {
      const editor = current.editor;
      if (
        !editor ||
        editor.fieldId !== action.fieldId ||
        editor.incoming?.transferId !== action.transferId
      ) {
        return current;
      }

      const decoded =
        editor.incoming.chunks.length === editor.incoming.chunkCount
          ? decodeIncomingChunks(editor.incoming.chunks)
          : null;
      if (decoded === null || decoded.byteLength !== editor.incoming.totalBytes) {
        // Never show partially assembled content as if it were the field.
        return {
          ...current,
          editor: { ...editor, incoming: null, loadPhase: 'failed' },
        };
      }

      return {
        ...current,
        editor: {
          ...editor,
          incoming: null,
          loadPhase: 'ready',
          loaded: decoded.content,
          draft: decoded.content,
          authoritativeTransferId: action.transferId,
        },
      };
    }

    case 'editor-result': {
      const editor = current.editor;
      if (!editor) {
        return current;
      }
      const loadingMatch = editor.incoming?.transferId === action.transferId;
      const savingMatch = editor.savingTransferId === action.transferId;
      if (!loadingMatch && !savingMatch) {
        return current;
      }
      return {
        ...current,
        editor: {
          ...editor,
          incoming: loadingMatch && !action.ok ? null : editor.incoming,
          loadPhase: loadingMatch && !action.ok ? 'failed' : editor.loadPhase,
          saving: savingMatch ? false : editor.saving,
          savingTransferId: savingMatch ? null : editor.savingTransferId,
          notice: { ok: action.ok, code: action.code, detail: action.detail },
        },
      };
    }

    case 'editor-discard-draft': {
      if (!current.editor) {
        return current;
      }
      return {
        ...current,
        editor: { ...current.editor, draft: current.editor.loaded, notice: null },
      };
    }

    case 'prefer-classic':
      // Switching surfaces drops the draft. The UI is responsible for asking
      // first when the draft is dirty; by the time this lands, that is decided.
      return {
        ...current,
        preferClassic: true,
        pending: false,
        editor: null,
        ideaDraft: null,
      };

    case 'prefer-structured':
      return { ...current, preferClassic: false, fallback: null };

    case 'disconnected':
      return {
        ...initialOnboardingUiState,
        // A deliberate preference survives a reconnect within the session.
        preferClassic: current.preferClassic,
      };

    default:
      return current;
  }
}

/** True when the cinematic shell should replace the terminal surface. */
export function shouldShowOnboarding(state: OnboardingUiState): boolean {
  if (state.preferClassic || !state.state) {
    return false;
  }
  return state.phase !== 'playing' && state.phase !== 'offline';
}

/** Ordered creation steps used by the progress rail. */
export const creationSteps = [
  { id: 'name', label: 'Name', screens: ['name', 'name-confirm'] },
  { id: 'identity', label: 'Identity', screens: ['sex'] },
  { id: 'race', label: 'Ancestry', screens: ['race', 'race-detail'] },
  { id: 'class', label: 'Path', screens: ['class', 'class-detail'] },
  { id: 'build', label: 'Build', screens: ['build'] },
  { id: 'alignment', label: 'Alignment', screens: ['alignment'] },
  { id: 'finish', label: 'Finish', screens: ['preferences', 'roleplay-decision', 'handoff'] },
] as const;

export function activeCreationStep(screen: string): string | null {
  return creationSteps.find((step) => step.screens.includes(screen as never))?.id ?? null;
}
