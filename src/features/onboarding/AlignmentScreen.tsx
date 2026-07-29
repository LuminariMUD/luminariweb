import type { OnboardingChoice } from '../../../shared/onboarding.ts';
import { ChoiceCard } from './ChoiceCard.tsx';
import { ChoiceGallery } from './ChoiceGallery.tsx';
import { MediaImage } from './MediaImage.tsx';
import type { ScreenProps } from './screen-props.ts';

/** Compass cells in reading order: law-to-chaos across, good-to-evil down. */
const compassOrder = [
  ['lawful', 'good'],
  ['neutral', 'good'],
  ['chaotic', 'good'],
  ['lawful', 'neutral'],
  ['neutral', 'neutral'],
  ['chaotic', 'neutral'],
  ['lawful', 'evil'],
  ['neutral', 'evil'],
  ['chaotic', 'evil'],
] as const;

function cellFor(choice: OnboardingChoice): number {
  const label = `${choice.mediaKey ?? ''} ${choice.label}`.toLowerCase();
  const isTrueNeutral = label.includes('true neutral') || label.includes('true-neutral');
  const order = label.includes('lawful')
    ? 'lawful'
    : label.includes('chaotic')
      ? 'chaotic'
      : 'neutral';
  const morality = label.includes('good') ? 'good' : label.includes('evil') ? 'evil' : 'neutral';

  if (isTrueNeutral) {
    return 4;
  }

  return compassOrder.findIndex((cell) => cell[0] === order && cell[1] === morality);
}

/**
 * Alignment as a compass plate. Only server-supplied, valid alignments appear;
 * position and colour are supporting cues only, because each seal is labelled
 * and described in text.
 */
export function AlignmentScreen(props: ScreenProps) {
  const { state, ui, onAction } = props;

  const placements = new Map<number, OnboardingChoice>();
  let placeable = state.choices.length > 0;
  for (const choice of state.choices) {
    const cell = cellFor(choice);
    if (cell < 0 || placements.has(cell)) {
      placeable = false;
      break;
    }
    placements.set(cell, choice);
  }

  // If the server's alignment names do not map cleanly onto the compass, show
  // the plain grid rather than guessing at positions.
  if (!placeable) {
    return <ChoiceGallery {...props} variant="seal" layout="grid" cardRendition="thumb" />;
  }

  return (
    <div className="onboarding-compass" role="group" aria-label={state.title}>
      <div className="onboarding-compass__axis onboarding-compass__axis--x" aria-hidden="true">
        <span>Lawful</span>
        <span>Neutral</span>
        <span>Chaotic</span>
      </div>
      <div className="onboarding-compass__axis onboarding-compass__axis--y" aria-hidden="true">
        <span>Good</span>
        <span>Neutral</span>
        <span>Evil</span>
      </div>
      <div className="onboarding-compass__plate">
        <MediaImage
          mediaKey="alignment/compass"
          rendition="square"
          alt=""
          className="onboarding-compass__backdrop"
          sizes="(max-width: 599px) 100vw, 34rem"
        />
        {compassOrder.map((cell, index) => {
          const choice = placements.get(index);
          if (!choice) {
            return (
              <div
                key={`${cell[0]}-${cell[1]}`}
                className="onboarding-compass__cell onboarding-compass__cell--empty"
              >
                <span className="onboarding-visually-hidden">
                  {cell[0]} {cell[1]} is not available for this character.
                </span>
              </div>
            );
          }

          return (
            <div key={choice.id} className="onboarding-compass__cell">
              <ChoiceCard
                choice={choice}
                variant="seal"
                rendition="square"
                busy={ui.pending}
                selected={state.selection.alignment === choice.label}
                onSelect={() => onAction('select', { choiceId: choice.id })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
