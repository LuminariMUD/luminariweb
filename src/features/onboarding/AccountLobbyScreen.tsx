import { MediaImage } from './MediaImage.tsx';
import { truncateClassSummary } from './onboarding-display.ts';
import type { ScreenProps } from './screen-props.ts';

/**
 * The account lobby.
 *
 * Character cards are composed from race art, class emblems, and the shared
 * anonymous fallback, so a multiclass or prestige character still renders even
 * though no prestige art exists.
 */
export function AccountLobbyScreen({ state, ui, onAction }: ScreenProps) {
  const characters = state.characters;
  const canCreate = state.actions.includes('create-character');
  const canLink = state.actions.includes('link-character');

  return (
    <div className="onboarding-lobby">
      {characters.length === 0 ? (
        <div className="onboarding-lobby__empty">
          <MediaImage mediaKey="account/empty-lobby" rendition="detail" />
          <div>
            <h3>No characters yet</h3>
            <p>
              This account has no characters. Create your first one to begin, or return to the
              classic terminal at any time.
            </p>
          </div>
        </div>
      ) : (
        <ul className="onboarding-lobby__grid">
          {characters.map((character) => {
            const classSummary = truncateClassSummary(character.classSummary);
            const metadata = [
              character.level !== undefined ? `Level ${character.level}` : null,
              character.race,
              classSummary,
            ]
              .filter(Boolean)
              .join(' - ');
            const fullMetadata = [
              character.level !== undefined ? `Level ${character.level}` : null,
              character.race,
              character.classSummary,
            ]
              .filter(Boolean)
              .join(' - ');

            return (
              <li key={character.id} className="onboarding-character">
                <button
                  type="button"
                  className="onboarding-character__button"
                  disabled={ui.pending}
                  onClick={() => onAction('select', { choiceId: character.id })}
                >
                  <span className="onboarding-character__art">
                    {/* Decorative: the character's name, level, race, and class
                        below are the accessible name for this button. */}
                    <MediaImage
                      mediaKey={character.raceMediaKey ?? 'shared/character-fallback'}
                      rendition="thumb"
                      alt=""
                      sizes="(max-width: 599px) 45vw, 220px"
                    />
                    {character.classMediaKeys?.length ? (
                      <span className="onboarding-character__emblems">
                        {character.classMediaKeys.slice(0, 3).map((key) => (
                          <MediaImage key={key} mediaKey={key} rendition="square" alt="" />
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="onboarding-character__identity">
                    <span className="onboarding-character__name">{character.name}</span>
                    <span
                      className="onboarding-character__meta"
                      title={metadata === fullMetadata ? undefined : fullMetadata}
                    >
                      {metadata}
                    </span>
                    {character.status ? (
                      <span className="onboarding-character__status">{character.status}</span>
                    ) : null}
                    {character.incomplete ? (
                      <span className="onboarding-character__status onboarding-character__status--warn">
                        Onboarding incomplete
                      </span>
                    ) : null}
                  </span>
                  <span className="onboarding-character__play">Play</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="onboarding-actions onboarding-actions--lobby">
        {canCreate ? (
          <button
            type="button"
            className="onboarding-button onboarding-button--primary"
            disabled={ui.pending}
            onClick={() => onAction('create-character')}
          >
            Create a character
          </button>
        ) : null}
        {canLink ? (
          <button
            type="button"
            className="onboarding-button"
            disabled={ui.pending}
            onClick={() => onAction('link-character')}
          >
            Link an existing character
          </button>
        ) : null}
        {state.actions.includes('quit') ? (
          <button
            type="button"
            className="onboarding-button onboarding-button--quiet"
            disabled={ui.pending}
            onClick={() => onAction('quit')}
          >
            Quit
          </button>
        ) : null}
      </div>
    </div>
  );
}
