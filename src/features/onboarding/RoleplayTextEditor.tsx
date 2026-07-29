/**
 * The structured multiline editor for the seven role-play text fields.
 *
 * Two rules drive the whole component:
 *
 * 1. The field is never editable until its complete content transfer has
 *    arrived and verified. Rendering a partially assembled value would invite
 *    the player to overwrite text they never saw.
 * 2. Nothing here claims a save. The transfer result only reports that content
 *    reached the MUD; durable success arrives later as a state carrying
 *    `persistenceResult="saved"`.
 *
 * The draft lives in reducer memory only — never local storage, never a
 * service-worker cache.
 */

import { useEffect, useRef } from 'react';
import { ByteCounter, PersistenceNotice } from './RoleplayPrimitives.tsx';
import type { ScreenProps } from './screen-props.ts';

export function RoleplayTextEditor({
  state,
  ui,
  onAction,
  onEditorDraftChange,
  onEditorSave,
  onEditorCancel,
}: ScreenProps) {
  const editor = ui.editor;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const meta = state.editor;

  // Move focus into the field as soon as it becomes genuinely editable, not
  // when the screen first mounts — until then there is nothing safe to type on.
  const ready = editor?.loadPhase === 'ready';
  useEffect(() => {
    if (ready) {
      textareaRef.current?.focus();
    }
  }, [ready]);

  if (!editor || !meta) {
    return <p className="rp-empty">This editor is not available right now.</p>;
  }

  const draftBytes = new TextEncoder().encode(editor.draft).byteLength;
  const overLimit = draftBytes > editor.maxBytes;
  const dirty = editor.draft !== editor.loaded;
  const busy = ui.pending || editor.saving || editor.loadPhase === 'loading';

  return (
    <div className="rp-editor">
      <PersistenceNotice result={state.persistenceResult} />

      {editor.loadPhase === 'loading' ? (
        <p className="rp-editor-loading" role="status">
          Loading what you wrote before…
        </p>
      ) : null}

      {editor.loadPhase === 'failed' ? (
        <p className="rp-editor-failed" role="alert">
          Your existing text could not be loaded, so this field has been left closed rather than
          risk overwriting it. Return to the profile and try again, or use the classic terminal.
        </p>
      ) : null}

      <label className="rp-editor-label" htmlFor={`editor-${meta.fieldId}`}>
        {state.inputLabel ?? state.title}
      </label>
      <textarea
        id={`editor-${meta.fieldId}`}
        ref={textareaRef}
        className="rp-editor-field"
        value={editor.draft}
        // Read-only rather than disabled while loading: the player can still
        // focus and read the region, and screen readers keep announcing it.
        readOnly={!ready}
        rows={14}
        spellCheck
        // Private profile text must not be captured by browser autofill or
        // suggestion history.
        autoComplete="off"
        autoCorrect="off"
        data-1p-ignore="true"
        onChange={(event) => onEditorDraftChange?.(event.target.value)}
        aria-describedby={`editor-${meta.fieldId}-count`}
        aria-invalid={overLimit || undefined}
      />

      <div id={`editor-${meta.fieldId}-count`}>
        <ByteCounter value={editor.draft} maxBytes={editor.maxBytes} />
      </div>

      {/* Transfer outcomes and server errors are announced, not just shown. */}
      <div className="rp-live" role="status" aria-live="polite">
        {editor.notice ? editor.notice.detail : ''}
        {state.error ? state.error.message : ''}
      </div>

      <div className="rp-actions">
        <button
          type="button"
          className="rp-primary"
          // Disabled while a transfer, validation, or save is pending, and
          // whenever the draft cannot legally be saved.
          disabled={busy || overLimit || !ready}
          onClick={() => onEditorSave?.()}
        >
          {editor.saving ? 'Saving…' : 'Save'}
        </button>

        {state.actions.includes('cancel-editor') ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              // Discarding is explicit: a dirty draft is never dropped by a
              // stray click without the player confirming it.
              if (
                dirty &&
                typeof window !== 'undefined' &&
                !window.confirm('Discard your unsaved changes to this field?')
              ) {
                return;
              }
              onEditorCancel?.();
              onAction('cancel-editor');
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
