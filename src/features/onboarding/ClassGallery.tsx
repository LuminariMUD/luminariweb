import { ChoiceGallery } from './ChoiceGallery.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * Path selection. The list already reflects the chosen ancestry and the
 * account's unlocks, because the server filtered it; the browser never
 * recomputes compatibility.
 */
export function ClassGallery(props: ScreenProps) {
  return (
    <ChoiceGallery
      {...props}
      variant="emblem"
      layout="grid"
      cardRendition="thumb"
      detailRendition="detail"
      allowInspect
      emptyMessage="The server has not offered any paths for this ancestry."
    />
  );
}
