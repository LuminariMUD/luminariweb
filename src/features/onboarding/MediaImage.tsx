import { useState } from 'react';
import { resolveImage } from './media-manifest.ts';
import { prefersReducedData } from './media-preferences.ts';

interface MediaImageProps {
  mediaKey: string | undefined | null;
  rendition?: string;
  /**
   * Alt text authored for this context. Omit for decorative art; pass an empty
   * string to force decorative treatment even when the manifest has alt text.
   */
  alt?: string;
  className?: string;
  sizes?: string;
  eager?: boolean;
}

/**
 * Renders a manifest-resolved image as a `<picture>` with modern formats and a
 * universally decodable fallback. Missing art renders nothing at all rather
 * than a broken frame, so the surrounding card stays usable.
 */
export function MediaImage({
  mediaKey,
  rendition = 'detail',
  alt,
  className,
  sizes,
  eager = false,
}: MediaImageProps) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveImage(mediaKey, rendition);

  // Catalog labels, summaries, facts, and controls remain fully usable when a
  // player asks the browser to conserve data; images are always supplemental.
  if (prefersReducedData() || !resolved || failed) {
    return null;
  }

  const resolvedAlt = alt ?? (resolved.decorative ? '' : resolved.alt);

  return (
    <picture className={className}>
      {resolved.sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={sizes} />
      ))}
      <img
        src={resolved.src}
        width={resolved.width}
        height={resolved.height}
        alt={resolvedAlt}
        loading={eager || resolved.preload === 'eager' ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'high' : 'auto'}
        onError={() => setFailed(true)}
        style={
          resolved.placeholder ? { backgroundImage: `url(${resolved.placeholder})` } : undefined
        }
      />
    </picture>
  );
}
