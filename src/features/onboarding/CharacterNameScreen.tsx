import { MediaImage } from './MediaImage.tsx';
import { TextEntryForm } from './TextEntryForm.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * Character naming and its confirmation step. Uniqueness, length, reserved
 * words, and validity are all decided by the server; the guidance panel only
 * explains what it will check.
 */
export function CharacterNameScreen(props: ScreenProps) {
  const { state, ui, onAction } = props;
  const isConfirm = state.screen === 'name-confirm' || state.inputKind === 'confirm';

  return (
    <div className="onboarding-panel onboarding-panel--form">
      <div className="onboarding-panel__art">
        <MediaImage
          mediaKey={isConfirm ? 'identity/name-confirmed' : 'identity/name'}
          rendition="detail"
        />
      </div>

      <div className="onboarding-panel__body">
        {state.help ? (
          <p className="onboarding-panel__help">{state.help}</p>
        ) : (
          <p className="onboarding-panel__help">
            The server checks length, spelling, reserved words, and whether the name is already
            taken. It will tell you if a name cannot be used.
          </p>
        )}

        {isConfirm ? (
          <>
            {state.selection.name ? (
              <p className="onboarding-panel__echo">
                <span className="onboarding-panel__echo-label">Name</span>
                <strong>{state.selection.name}</strong>
              </p>
            ) : null}
            <div className="onboarding-actions">
              <button
                type="button"
                className="onboarding-button onboarding-button--primary"
                disabled={ui.pending}
                onClick={() => onAction('confirm')}
              >
                Keep this name
              </button>
              <button
                type="button"
                className="onboarding-button"
                disabled={ui.pending}
                onClick={() => onAction('reselect')}
              >
                Choose another name
              </button>
            </div>
          </>
        ) : (
          <TextEntryForm
            state={state}
            ui={ui}
            onAction={onAction}
            inputLabel="Character name"
            submitLabel="Claim this name"
          />
        )}
      </div>
    </div>
  );
}
