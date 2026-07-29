/**
 * The generated short-description flow.
 *
 * The same flow serves two very different situations, and the difference is
 * server-authored: normally it is optional and cancellable, but the MUD can
 * also require a short description before the character may enter the world.
 * When `blocking` is set, no escape is offered except the classic terminal —
 * which stays reachable, as it must in every structured state.
 *
 * Short descriptions are assembled from server-supplied feature types and
 * adjectives. The player never free-edits the generated text, so this screen
 * offers choices and previews, never a text field.
 */

import { ChoiceGallery } from './ChoiceGallery.tsx';
import { PersistenceNotice } from './RoleplayPrimitives.tsx';
import type { ScreenProps } from './screen-props.ts';

/** Screens in this flow that present a catalog rather than a preview. */
const CHOICE_SCREENS = new Set([
  'short-desc-feature-1',
  'short-desc-adjective-1',
  'short-desc-feature-2',
  'short-desc-adjective-2',
]);

export function ShortDescriptionFlow(props: ScreenProps) {
  const { state, ui, onAction } = props;
  const required = state.blocking === true;

  return (
    <div className={`rp-short-desc${required ? ' rp-short-desc-required' : ''}`}>
      <PersistenceNotice result={state.persistenceResult} />

      {required ? (
        // Made visually and textually explicit: a forced gate that looked like
        // an ordinary optional step would read as a dead end.
        <p className="rp-required-banner" role="status">
          This world needs a short description before you can enter it.
        </p>
      ) : null}

      {/* The current generated description, as the server rendered it. */}
      {state.selection.name || state.help ? (
        <p className="rp-preview">{state.help ?? state.selection.name}</p>
      ) : null}

      {CHOICE_SCREENS.has(state.screen) ? (
        <ChoiceGallery
          {...props}
          layout="grid"
          emptyMessage="The world offered no descriptors for this character."
        />
      ) : null}

      {state.error ? (
        <p className="rp-error" role="alert">
          {state.error.message}
        </p>
      ) : null}

      <div className="rp-actions">
        {state.actions.includes('continue') ? (
          <button
            type="button"
            className="rp-primary"
            disabled={ui.pending}
            onClick={() => onAction('continue')}
          >
            Continue
          </button>
        ) : null}
        {state.actions.includes('confirm') ? (
          <button
            type="button"
            className="rp-primary"
            disabled={ui.pending}
            onClick={() => onAction('confirm')}
          >
            Keep this description
          </button>
        ) : null}
        {state.actions.includes('reselect') ? (
          <button type="button" disabled={ui.pending} onClick={() => onAction('reselect')}>
            Start over
          </button>
        ) : null}
        {/* Only offered when the server actually allows it; the forced gate
            simply does not include `cancel` in its action list. */}
        {!required && state.actions.includes('cancel') ? (
          <button type="button" disabled={ui.pending} onClick={() => onAction('cancel')}>
            Back to profile
          </button>
        ) : null}
      </div>
    </div>
  );
}
