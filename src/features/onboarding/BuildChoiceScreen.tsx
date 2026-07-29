import { ChoiceGallery } from './ChoiceGallery.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * Premade versus custom. Both paths are presented with equal visual weight so
 * neither reads as the wrong answer.
 */
export function BuildChoiceScreen(props: ScreenProps) {
  return (
    <ChoiceGallery
      {...props}
      variant="path"
      layout="pair"
      cardRendition="detail"
      allowInspect={false}
      emptyMessage="The server did not offer a build choice for this character."
    />
  );
}
