import { ChoiceGallery } from './ChoiceGallery.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * Ancestry selection. Card art depicts an ancestry as a broad possibility; it
 * never prescribes the player's own appearance, and the description text is the
 * authoritative summary.
 */
export function RaceGallery(props: ScreenProps) {
  return (
    <ChoiceGallery
      {...props}
      variant="gallery"
      layout="grid"
      cardRendition="thumb"
      detailRendition="detail"
      allowInspect
      emptyMessage="The server has not offered any ancestries for this character."
    />
  );
}
