import { MediaImage } from './MediaImage.tsx';
import { TextEntryForm } from './TextEntryForm.tsx';
import type { ScreenProps } from './screen-props.ts';

const submitLabels: Record<string, string> = {
  'account-name': 'Continue',
  'account-password': 'Sign in',
  'account-new-password': 'Set password',
  'account-confirm-password': 'Confirm password',
  'account-link': 'Look up character',
  'account-link-password': 'Verify ownership',
};

const inputLabels: Record<string, string> = {
  'account-name': 'Enter account name',
};

const supportingArt: Record<string, string> = {
  'account-name': 'account/connected',
  'account-password': 'account/private-input',
  'account-new-password': 'account/new-account',
  'account-confirm-password': 'account/new-account',
  'account-name-confirm': 'account/new-account',
  'account-link': 'account/link-character',
  'account-link-password': 'account/private-input',
};

/**
 * Account identity and password states.
 *
 * The MUD verifies the account, enforces its own bad-attempt policy, and owns
 * site bans and creation locks. This screen only presents what the server asked
 * for and reports back what it says.
 */
export function AccountLoginScreen(props: ScreenProps) {
  const { state, ui, onAction } = props;
  const isConfirmation = state.inputKind === 'confirm' || state.screen === 'account-name-confirm';

  return (
    <div className="onboarding-panel onboarding-panel--form">
      <div className="onboarding-panel__art">
        <MediaImage mediaKey={supportingArt[state.screen]} rendition="detail" />
      </div>

      <div className="onboarding-panel__body">
        {state.help ? <p className="onboarding-panel__help">{state.help}</p> : null}

        {isConfirmation ? (
          <div className="onboarding-actions">
            <button
              type="button"
              className="onboarding-button onboarding-button--primary"
              disabled={ui.pending}
              onClick={() => onAction('confirm')}
            >
              Yes, that is correct
            </button>
            <button
              type="button"
              className="onboarding-button"
              disabled={ui.pending}
              onClick={() => onAction('reselect')}
            >
              No, let me retype it
            </button>
          </div>
        ) : (
          <>
            <TextEntryForm
              state={state}
              ui={ui}
              onAction={onAction}
              submitLabel={submitLabels[state.screen]}
              inputLabel={inputLabels[state.screen]}
            />
            {state.screen === 'account-link' && state.actions.includes('cancel') ? (
              <div className="onboarding-actions onboarding-actions--secondary">
                <button
                  type="button"
                  className="onboarding-button"
                  disabled={ui.pending}
                  onClick={() => onAction('cancel')}
                >
                  Back
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
