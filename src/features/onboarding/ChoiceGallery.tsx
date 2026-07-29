import { useCallback, useRef } from 'react';
import type { OnboardingChoice } from '../../../shared/onboarding.ts';
import { ChoiceCard, type ChoiceCardVariant } from './ChoiceCard.tsx';
import { Glyph } from './Glyph.tsx';
import { MediaImage } from './MediaImage.tsx';
import type { ScreenProps } from './screen-props.ts';

interface ChoiceGalleryProps extends ScreenProps {
  variant?: ChoiceCardVariant;
  /** Grid density class suffix: `wide`, `grid`, `pair`, or `compass`. */
  layout?: 'wide' | 'grid' | 'pair' | 'compass';
  cardRendition?: string;
  detailRendition?: string;
  /** Render a detail panel for the inspected choice. */
  allowInspect?: boolean;
  emptyMessage?: string;
}

/**
 * The shared engine behind every catalog screen. Every option, its enabled
 * state, its lock reason, and its wire value come from the server; this
 * component only decides how they are presented.
 */
export function ChoiceGallery({
  state,
  ui,
  onAction,
  onInspect,
  variant = 'gallery',
  layout = 'grid',
  cardRendition = 'thumb',
  detailRendition = 'detail',
  allowInspect = false,
  emptyMessage = 'The server offered no choices for this step.',
}: ChoiceGalleryProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  const inspected = allowInspect
    ? (state.choices.find((choice) => choice.id === ui.inspectedChoiceId) ?? null)
    : null;

  const handleSelect = useCallback(
    (choice: OnboardingChoice) => {
      onAction('select', { choiceId: choice.id });
    },
    [onAction],
  );

  const handleInspect = useCallback(
    (choice: OnboardingChoice) => {
      onInspect(choice.id === ui.inspectedChoiceId ? null : choice.id);
    },
    [onInspect, ui.inspectedChoiceId],
  );

  /** Arrow keys move between cards; Tab order still works unchanged. */
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || !gridRef.current) {
      return;
    }

    const buttons = [
      ...gridRef.current.querySelectorAll<HTMLButtonElement>('.onboarding-card__button'),
    ].filter((button) => !button.disabled);
    if (!buttons.length) {
      return;
    }

    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) {
      return;
    }

    const style = window.getComputedStyle(gridRef.current);
    const columns = Math.max(1, style.gridTemplateColumns.split(' ').filter(Boolean).length);

    let nextIndex: number;
    if (event.key === 'ArrowRight') {
      nextIndex = Math.min(buttons.length - 1, currentIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === 'ArrowDown') {
      nextIndex = Math.min(buttons.length - 1, currentIndex + columns);
    } else if (event.key === 'ArrowUp') {
      nextIndex = Math.max(0, currentIndex - columns);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else {
      nextIndex = buttons.length - 1;
    }

    if (nextIndex !== currentIndex) {
      event.preventDefault();
      buttons[nextIndex].focus();
    }
  }, []);

  if (!state.choices.length) {
    return <p className="onboarding-empty">{emptyMessage}</p>;
  }

  const selectedId = state.choices.find(
    (choice) =>
      choice.label.toLowerCase() === (state.selection.race ?? '').toLowerCase() ||
      choice.label.toLowerCase() === (state.selection.className ?? '').toLowerCase(),
  )?.id;

  return (
    <div className="onboarding-gallery">
      <div
        ref={gridRef}
        className={`onboarding-gallery__grid onboarding-gallery__grid--${layout}`}
        role="group"
        aria-label={state.title}
        onKeyDown={handleKeyDown}
      >
        {state.choices.map((choice) => (
          <ChoiceCard
            key={choice.id}
            choice={choice}
            variant={variant}
            rendition={cardRendition}
            selected={choice.id === selectedId}
            busy={ui.pending}
            onSelect={handleSelect}
            onInspect={allowInspect ? handleInspect : undefined}
          />
        ))}
      </div>

      {inspected ? (
        <aside className="onboarding-detail" aria-live="polite">
          <div className="onboarding-detail__art">
            <MediaImage
              mediaKey={inspected.mediaKey}
              rendition={detailRendition}
              sizes="(max-width: 1023px) 90vw, 420px"
            />
          </div>
          <div className="onboarding-detail__body">
            <h3>{inspected.label}</h3>
            {inspected.description ? <p>{inspected.description}</p> : null}
            {!inspected.description && inspected.summary ? <p>{inspected.summary}</p> : null}
            {inspected.facts?.length ? (
              <dl className="onboarding-detail__facts">
                {inspected.facts.map((fact) => (
                  <div key={`${fact.label}-${fact.value}`}>
                    <dt>
                      <Glyph name={fact.glyph} />
                      {fact.label}
                    </dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {inspected.lockReason ? (
              <p className="onboarding-detail__locked">{inspected.lockReason}</p>
            ) : null}
            <div className="onboarding-detail__actions">
              <button
                type="button"
                className="onboarding-button onboarding-button--primary"
                disabled={!inspected.enabled || ui.pending}
                onClick={() => onAction('select', { choiceId: inspected.id })}
              >
                Choose {inspected.label}
              </button>
              <button
                type="button"
                className="onboarding-button"
                onClick={() => onInspect(null)}
                disabled={ui.pending}
              >
                Close details
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
