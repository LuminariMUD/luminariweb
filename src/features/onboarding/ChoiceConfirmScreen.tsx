import { MediaImage } from './MediaImage.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * The server's confirm-or-reselect step after an ancestry or path is picked.
 *
 * These screens carry no choice list - the MUD is asking a yes/no question
 * about the selection it already holds - so they must never be rendered as an
 * empty gallery. The two actions here are the only way forward in the current
 * server flow.
 */
export function ChoiceConfirmScreen({ state, ui, onAction }: ScreenProps) {
  const isRace = state.screen === 'race-detail';
  const label = isRace ? state.selection.race : state.selection.className;
  const mediaKey =
    state.mediaKey ?? (isRace ? state.selection.raceMediaKey : state.selection.classMediaKey);

  return (
    <div className="onboarding-panel onboarding-panel--confirm">
      <div className="onboarding-panel__art">
        <MediaImage mediaKey={mediaKey} rendition="detail" alt="" />
      </div>

      <div className="onboarding-panel__body">
        {label ? (
          <p className="onboarding-panel__echo">
            <span className="onboarding-panel__echo-label">{isRace ? 'Ancestry' : 'Path'}</span>
            <strong>{label}</strong>
          </p>
        ) : null}

        {state.help ? <p className="onboarding-panel__help">{state.help}</p> : null}

        <div className="onboarding-actions">
          <button
            type="button"
            className="onboarding-button onboarding-button--primary"
            disabled={ui.pending}
            onClick={() => onAction('confirm')}
          >
            {label ? `Keep ${label}` : 'Keep this choice'}
          </button>
          <button
            type="button"
            className="onboarding-button"
            disabled={ui.pending}
            onClick={() => onAction('reselect')}
          >
            Choose another
          </button>
        </div>
      </div>
    </div>
  );
}
