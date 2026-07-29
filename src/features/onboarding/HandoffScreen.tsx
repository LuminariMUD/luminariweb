import { MediaImage } from './MediaImage.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * MOTD and the final handoff into play.
 *
 * The success treatment only appears once the server reports a confirmed save.
 * The MOTD text itself is live server output; it is never rasterised into art.
 */
export function HandoffScreen({ state, ui, onAction }: ScreenProps) {
  const confirmed = state.persistence === 'saved' || state.screen === 'motd';

  return (
    <div className="onboarding-panel onboarding-panel--handoff">
      <div className="onboarding-panel__art">
        <MediaImage
          mediaKey={confirmed ? 'state/save-confirmed' : 'state/save-pending'}
          rendition="detail"
        />
      </div>

      <div className="onboarding-panel__body">
        {state.help ? <pre className="onboarding-motd">{state.help}</pre> : null}

        <div className="onboarding-actions">
          {state.actions.includes('confirm') ? (
            <button
              type="button"
              className="onboarding-button onboarding-button--primary"
              disabled={ui.pending}
              onClick={() => onAction('confirm')}
            >
              Enter the world
            </button>
          ) : null}
          {state.actions.includes('submit') ? (
            <button
              type="button"
              className="onboarding-button onboarding-button--primary"
              disabled={ui.pending}
              onClick={() => onAction('submit', { value: ' ' })}
            >
              Continue
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
