import { ChoiceGallery } from './ChoiceGallery.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * Recommended settings. The bundle is inspectable rather than opaque, and
 * declining it is an equal choice.
 */
export function PreferencesScreen(props: ScreenProps) {
  return (
    <ChoiceGallery
      {...props}
      variant="path"
      layout="pair"
      cardRendition="detail"
      allowInspect
      emptyMessage="The server did not offer preference settings at this step."
    />
  );
}
