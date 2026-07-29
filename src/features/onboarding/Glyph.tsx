import { resolveGlyph } from './media-manifest.ts';

const glyphSets = [
  'shared/glyph-class-mechanics',
  'shared/glyph-race-traits',
  'shared/glyph-abilities',
  'shared/glyph-session-state',
  'shared/glyph-audio-controls',
];

interface GlyphProps {
  name: string | undefined;
  className?: string;
}

/**
 * A functional glyph. It is always decorative in the accessibility tree: the
 * adjacent text label carries the mechanical value or session state, never the
 * image on its own.
 */
export function Glyph({ name, className }: GlyphProps) {
  if (!name) {
    return null;
  }

  for (const set of glyphSets) {
    const src = resolveGlyph(set, name);
    if (src) {
      return (
        <img
          className={className ? `onboarding-glyph ${className}` : 'onboarding-glyph'}
          src={src}
          alt=""
          aria-hidden="true"
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
        />
      );
    }
  }

  return null;
}
