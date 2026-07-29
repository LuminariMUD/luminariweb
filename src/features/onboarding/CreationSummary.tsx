import type { OnboardingState } from '../../../shared/onboarding.ts';
import { MediaImage } from './MediaImage.tsx';

interface CreationSummaryProps {
  state: OnboardingState;
}

const persistenceCopy: Record<string, { label: string; detail: string; art: string }> = {
  none: { label: 'Not started', detail: 'Nothing has been saved yet.', art: '' },
  draft: {
    label: 'Draft',
    detail: 'These choices are not saved on the server yet.',
    art: 'state/onboarding-incomplete',
  },
  pending: {
    label: 'Saving',
    detail: 'The server is writing this character now.',
    art: 'state/save-pending',
  },
  saved: {
    label: 'Saved',
    detail: 'The server confirmed this character was saved.',
    art: 'state/save-confirmed',
  },
  failed: {
    label: 'Not saved',
    detail: 'The server could not save this character. Your choices are preserved.',
    art: 'state/save-failed',
  },
};

/**
 * Running summary of the choices the server has accepted so far.
 *
 * It deliberately offers no editing controls: the current server flow supports
 * confirm and reselect at specific points, not arbitrary backtracking, and a
 * browser-only edit would be a lie.
 */
export function CreationSummary({ state }: CreationSummaryProps) {
  const { selection, persistence } = state;
  const rows = [
    { label: 'Name', value: selection.name },
    { label: 'Sex', value: selection.sex },
    { label: 'Ancestry', value: selection.race, mediaKey: selection.raceMediaKey },
    { label: 'Path', value: selection.className, mediaKey: selection.classMediaKey },
    { label: 'Build', value: selection.build },
    { label: 'Alignment', value: selection.alignment },
  ].filter((row) => Boolean(row.value));

  if (!rows.length && persistence === 'none') {
    return null;
  }

  const status = persistenceCopy[persistence] ?? persistenceCopy.none;

  return (
    <aside className="onboarding-summary" aria-label="Character so far">
      <h2 className="onboarding-summary__title">Your character</h2>
      <dl className="onboarding-summary__rows">
        {rows.map((row) => (
          <div key={row.label} className="onboarding-summary__row">
            <dt>{row.label}</dt>
            <dd>
              {row.mediaKey ? (
                <MediaImage
                  mediaKey={row.mediaKey}
                  rendition="square"
                  alt=""
                  className="onboarding-summary__emblem"
                />
              ) : null}
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {persistence !== 'none' ? (
        <p className={`onboarding-summary__status is-${persistence}`}>
          {status.art ? <MediaImage mediaKey={status.art} rendition="square" alt="" /> : null}
          <span>
            <strong>{status.label}.</strong> {status.detail}
          </span>
        </p>
      ) : null}
    </aside>
  );
}
