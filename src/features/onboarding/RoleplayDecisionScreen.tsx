import { ChoiceGallery } from './ChoiceGallery.tsx';
import type { ScreenProps } from './screen-props.ts';

/**
 * Role-player, non-role-player, or decide later. All three are equal paths
 * into the game.
 */
export function RoleplayDecisionScreen(props: ScreenProps) {
  return (
    <ChoiceGallery
      {...props}
      variant="path"
      layout="wide"
      cardRendition="detail"
      allowInspect={false}
      emptyMessage="The server did not offer a role-play choice at this step."
    />
  );
}
