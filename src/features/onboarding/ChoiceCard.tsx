import type { OnboardingChoice } from '../../../shared/onboarding.ts';
import { Glyph } from './Glyph.tsx';
import { MediaImage } from './MediaImage.tsx';
import { resolveImage } from './media-manifest.ts';

/** Initials used when a catalog entry has no artwork yet. */
function monogram(label: string) {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

export type ChoiceCardVariant = 'gallery' | 'emblem' | 'path' | 'seal';

interface ChoiceCardProps {
  choice: OnboardingChoice;
  variant?: ChoiceCardVariant;
  selected?: boolean;
  busy?: boolean;
  rendition?: string;
  onSelect: (choice: OnboardingChoice) => void;
  onInspect?: (choice: OnboardingChoice) => void;
}

/**
 * A selectable catalog card. It is a real button first and an illustration
 * second: selection, locking, and focus are all conveyed with text and shape as
 * well as color, so the card works without art, without color, and without
 * motion.
 */
export function ChoiceCard({
  choice,
  variant = 'gallery',
  selected = false,
  busy = false,
  rendition = 'thumb',
  onSelect,
  onInspect,
}: ChoiceCardProps) {
  const locked = !choice.enabled;
  const classNames = [
    'onboarding-card',
    `onboarding-card--${variant}`,
    selected ? 'is-selected' : '',
    locked ? 'is-locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const describedBy = `${choice.id}-summary`;
  const hasArt = resolveImage(choice.mediaKey, rendition) !== null;

  return (
    <div className={classNames}>
      <button
        type="button"
        className="onboarding-card__button"
        disabled={locked || busy}
        aria-pressed={selected}
        aria-describedby={choice.summary || choice.lockReason ? describedBy : undefined}
        onClick={() => onSelect(choice)}
      >
        <span className="onboarding-card__art">
          {hasArt ? (
            <>
              {/* Decorative inside the button: the visible label and summary
                  below are the accessible name and description, so repeating
                  the art's own alt text here would bury the choice in prose. */}
              <MediaImage
                mediaKey={choice.mediaKey}
                rendition={rendition}
                alt=""
                sizes="(max-width: 599px) 45vw, (max-width: 1023px) 30vw, 260px"
              />
              <span className="onboarding-card__scrim" aria-hidden="true" />
            </>
          ) : (
            // A catalog entry with no artwork yet still gets a deliberate,
            // legible frame rather than an empty rectangle.
            <span className="onboarding-card__monogram" aria-hidden="true">
              {monogram(choice.label)}
            </span>
          )}
        </span>

        <span className="onboarding-card__body">
          <span className="onboarding-card__label">{choice.label}</span>
          {selected ? <span className="onboarding-card__state">Selected</span> : null}
          {locked ? <span className="onboarding-card__state">Locked</span> : null}
        </span>

        {choice.badges?.length ? (
          <span className="onboarding-card__badges">
            {choice.badges.map((badge) => (
              <span key={badge} className="onboarding-card__badge">
                {badge}
              </span>
            ))}
          </span>
        ) : null}
      </button>

      {choice.summary || choice.lockReason ? (
        <p className="onboarding-card__summary" id={describedBy}>
          {locked && choice.lockReason ? choice.lockReason : choice.summary}
          {locked && choice.unlockCost ? ` Unlock cost: ${choice.unlockCost}.` : ''}
        </p>
      ) : null}

      {choice.facts?.length ? (
        <ul className="onboarding-card__facts">
          {choice.facts.slice(0, 6).map((fact) => (
            <li key={`${fact.label}-${fact.value}`}>
              <Glyph name={fact.glyph} />
              <span className="onboarding-card__fact-label">{fact.label}</span>
              <span className="onboarding-card__fact-value">{fact.value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {onInspect ? (
        <button
          type="button"
          className="onboarding-card__inspect"
          onClick={() => onInspect(choice)}
          disabled={busy}
        >
          Details<span className="onboarding-visually-hidden"> about {choice.label}</span>
        </button>
      ) : null}
    </div>
  );
}
