import { characterMenuChoiceIds } from '../../../shared/onboarding.ts';
import { MediaImage } from './MediaImage.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * The menu for the character already selected in the account lobby.
 *
 * Protocol v1 reports the selected character through `selection` and leaves
 * `characters` empty because this is no longer the account lobby. The proxy
 * maps these stable IDs to the existing terminal menu's safe navigation
 * values after verifying the exact server screen and revision. Protocol v2
 * also exposes the role-play profile entry on this same authoritative menu.
 */
export function CharacterMenuScreen({ state, ui, onAction }: ScreenProps) {
  const selectedName = state.selection.name ?? 'Selected character';
  const identity = [
    state.selection.race,
    state.selection.className,
    state.selection.alignment,
  ].filter(Boolean);

  return (
    <div className="onboarding-panel onboarding-panel--character-menu">
      <div className="onboarding-panel__art">
        <MediaImage mediaKey="account/selected-character-menu" rendition="detail" />
      </div>

      <div className="onboarding-panel__body">
        <p className="onboarding-character-menu__eyebrow">Ready to play</p>
        <h2 className="onboarding-character-menu__name">{selectedName}</h2>
        {identity.length ? (
          <p className="onboarding-character-menu__details">{identity.join(' · ')}</p>
        ) : null}
        <p className="onboarding-panel__help">
          Enter the world, review this character's role-play profile, or choose another character.
        </p>

        <div className="onboarding-actions">
          {state.actions.includes('select') ? (
            <>
              <button
                type="button"
                className="onboarding-button onboarding-button--primary"
                disabled={ui.pending}
                onClick={() => onAction('select', { choiceId: characterMenuChoiceIds.enterGame })}
              >
                Enter the world
              </button>
              <button
                type="button"
                className="onboarding-button"
                disabled={ui.pending}
                onClick={() =>
                  onAction('select', { choiceId: characterMenuChoiceIds.roleplayProfile })
                }
                hidden={state.version < 2}
              >
                Role-play profile
              </button>
              <button
                type="button"
                className="onboarding-button"
                disabled={ui.pending}
                onClick={() => onAction('select', { choiceId: characterMenuChoiceIds.accountMenu })}
              >
                Choose another character
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
