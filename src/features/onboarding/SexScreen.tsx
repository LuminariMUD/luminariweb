import { ChoiceGallery } from './ChoiceGallery.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * Sex selection, rendered from whatever values the server currently emits. The
 * client never adds or implies options the MUD does not support.
 */
export function SexScreen(props: ScreenProps) {
  return (
    <ChoiceGallery
      {...props}
      variant="path"
      layout="pair"
      cardRendition="detail"
      allowInspect={false}
      emptyMessage="The server did not offer this choice."
    />
  );
}
