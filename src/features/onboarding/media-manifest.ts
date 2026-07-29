/**
 * Versioned onboarding media manifest.
 *
 * The MUD owns the semantic key (`race/human`); the browser owns the files,
 * crops, formats, layers, alt text, and presentation. Every lookup resolves to
 * something renderable: a missing key degrades to its category fallback and
 * then to nothing at all, but it never blocks a screen.
 *
 * `generated-media-manifest.json` is produced by
 * `scripts/process-onboarding-media.mjs`. Do not hand-edit it.
 */

import generated from './generated-media-manifest.json' with { type: 'json' };

export interface MediaSource {
  format: string;
  width: number;
  height: number;
  src: string;
  bytes: number;
}

interface RenditionRecord {
  aspectRatio: number;
  sources: MediaSource[];
}

interface SpriteRecord {
  id: string;
  width: number;
  height: number;
  sources: MediaSource[];
}

interface GlyphRecord {
  id: string;
  src: string;
  author?: string | null;
}

interface AudioSourceRecord {
  format: string;
  mimeType: string;
  src: string;
  bytes: number;
}

interface ManifestAsset {
  key: string;
  category: string;
  type: 'image' | 'texture' | 'sprite-set' | 'layer' | 'glyph-set' | 'audio';
  version: string;
  alt?: string;
  decorative?: boolean;
  accent?: string;
  dominantColor?: string;
  placeholder?: string;
  preload?: 'eager' | 'lazy';
  renditions?: Record<string, RenditionRecord>;
  layers?: Record<string, RenditionRecord>;
  poster?: { rendition: string; width: number };
  sprites?: SpriteRecord[];
  glyphs?: GlyphRecord[];
  sources?: MediaSource[] | AudioSourceRecord[];
  emblem?: { src: string; bytes: number };
  loop?: boolean;
  durationSeconds?: number | null;
  tileable?: boolean;
  recolor?: boolean;
}

interface GeneratedManifest {
  schema: string;
  mediaVersion: string;
  assetCount: number;
  assets: ManifestAsset[];
}

const manifest = generated as GeneratedManifest;

export const mediaVersion = manifest.mediaVersion;

const assetsByKey = new Map<string, ManifestAsset>(
  manifest.assets.map((asset) => [asset.key, asset]),
);

/** Category-level fallbacks, matching the production manifest's fallback packs. */
const fallbackKeys: Record<string, string> = {
  race: 'race/fallback',
  class: 'class/fallback',
  background: 'background/fallback',
  region: 'region/fallback',
  faction: 'faction/fallback',
  hometown: 'hometown/fallback',
  deity: 'deity/fallback',
  account: 'shared/character-fallback',
};

/** Scene shown for each screen when the server does not name one itself. */
export const screenSceneKeys: Record<string, string> = {
  'account-name': 'scene/arrival',
  'account-name-confirm': 'scene/arrival',
  'account-password': 'scene/authentication',
  'account-new-password': 'scene/authentication',
  'account-confirm-password': 'scene/authentication',
  'account-menu': 'scene/account-lobby',
  'account-link': 'scene/account-lobby',
  'account-link-password': 'scene/authentication',
  name: 'scene/identity',
  'name-confirm': 'scene/identity',
  sex: 'scene/identity',
  race: 'scene/race-gallery',
  'race-detail': 'scene/race-gallery',
  class: 'scene/class-gallery',
  'class-detail': 'scene/class-gallery',
  build: 'scene/build-alignment',
  alignment: 'scene/build-alignment',
  preferences: 'scene/build-alignment',
  'roleplay-decision': 'scene/roleplay',
  motd: 'scene/handoff',
  'character-menu': 'scene/account-lobby',
  handoff: 'scene/handoff',
  // Protocol v2 role-play identity suite. The whole suite shares the role-play
  // backdrop; per-item art is carried by each choice's own `mediaKey`, so no
  // new scene asset is required (see the Phase 3 asset audit).
  'roleplay-hub': 'scene/roleplay',
  'short-desc-intro': 'scene/roleplay',
  'short-desc-feature-1': 'scene/roleplay',
  'short-desc-adjective-1': 'scene/roleplay',
  'short-desc-preview': 'scene/roleplay',
  'short-desc-review': 'scene/roleplay',
  'short-desc-feature-2': 'scene/roleplay',
  'short-desc-adjective-2': 'scene/roleplay',
  'long-description': 'scene/roleplay',
  'background-story': 'scene/roleplay',
  'background-catalog': 'scene/roleplay',
  'background-confirm': 'scene/roleplay',
  'goals-ideas': 'scene/roleplay',
  'goals-editor': 'scene/roleplay',
  'personality-ideas': 'scene/roleplay',
  'personality-editor': 'scene/roleplay',
  'ideals-ideas': 'scene/roleplay',
  'ideals-editor': 'scene/roleplay',
  'bonds-ideas': 'scene/roleplay',
  'bonds-editor': 'scene/roleplay',
  'flaws-ideas': 'scene/roleplay',
  'flaws-editor': 'scene/roleplay',
  'age-select': 'scene/roleplay',
  'region-catalog': 'scene/roleplay',
  'region-confirm': 'scene/roleplay',
  'faction-select': 'scene/roleplay',
  'hometown-select': 'scene/roleplay',
  'deity-select': 'scene/roleplay',
  'deity-confirm': 'scene/roleplay',
};

/**
 * Media key for each hub item and editor field. Server-authored keys always
 * win; this is the default when the source names none.
 */
export const roleplayItemMediaKeys: Record<string, string> = {
  'profile/short-description': 'roleplay/short-description',
  'profile/long-description': 'roleplay/long-description',
  'profile/background-story': 'roleplay/background-story',
  'profile/goals': 'roleplay/goals',
  'profile/personality': 'roleplay/personality',
  'profile/ideals': 'roleplay/ideals',
  'profile/bonds': 'roleplay/bonds',
  'profile/flaws': 'roleplay/flaws',
  'profile/background': 'background/fallback',
  // Age has five real, fixed choices but intentionally no unknown-choice
  // fallback. The neutral hub art avoids implying a selection before the
  // source names the chosen age category.
  'profile/age': 'roleplay/profile-hub',
  'profile/region': 'region/fallback',
  'profile/faction': 'faction/fallback',
  'profile/hometown': 'hometown/fallback',
  'profile/deity': 'deity/fallback',
};

export interface ResolvedImage {
  key: string;
  /** True when the requested key was missing and a fallback was substituted. */
  isFallback: boolean;
  /** One `<source>` per format, newest format first. */
  sources: { type: string; srcSet: string }[];
  /** Last-resort `<img src>`; always a widely supported format. */
  src: string;
  width: number;
  height: number;
  alt: string;
  decorative: boolean;
  placeholder?: string;
  accent: string;
  preload: 'eager' | 'lazy';
}

const mimeTypes: Record<string, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
};

const formatPriority = ['avif', 'webp', 'png', 'jpeg', 'jpg'];

function buildSources(sources: MediaSource[]) {
  const byFormat = new Map<string, MediaSource[]>();
  for (const source of sources) {
    if (!byFormat.has(source.format)) {
      byFormat.set(source.format, []);
    }
    byFormat.get(source.format)!.push(source);
  }

  const ordered = [...byFormat.entries()].sort(
    (a, b) => formatPriority.indexOf(a[0]) - formatPriority.indexOf(b[0]),
  );

  return ordered.map(([format, entries]) => ({
    type: mimeTypes[format] ?? `image/${format}`,
    srcSet: entries
      .slice()
      .sort((a, b) => a.width - b.width)
      .map((entry) => `${entry.src} ${entry.width}w`)
      .join(', '),
    entries,
  }));
}

function lookup(key: string | undefined | null): ManifestAsset | undefined {
  if (!key) {
    return undefined;
  }
  return assetsByKey.get(key);
}

function fallbackFor(key: string): ManifestAsset | undefined {
  const category = key.split('/')[0];
  const fallbackKey = fallbackKeys[category];
  return fallbackKey ? assetsByKey.get(fallbackKey) : undefined;
}

/**
 * Resolve a semantic key to a renderable image, falling back by category.
 * Returns null only when neither the key nor its fallback has art yet, in
 * which case the caller renders its text-only card.
 */
export function resolveImage(
  key: string | undefined | null,
  renditionName = 'detail',
): ResolvedImage | null {
  if (!key) {
    return null;
  }

  let asset = lookup(key);
  let isFallback = false;
  if (!asset) {
    asset = fallbackFor(key);
    isFallback = Boolean(asset);
  }
  if (!asset || asset.type !== 'image' || !asset.renditions) {
    return null;
  }

  const rendition =
    asset.renditions[renditionName] ??
    asset.renditions[asset.poster?.rendition ?? ''] ??
    Object.values(asset.renditions)[0];
  if (!rendition || !rendition.sources.length) {
    return null;
  }

  const sources = buildSources(rendition.sources);
  // The `<img>` element itself must use a format every browser can decode.
  const fallbackEntries =
    sources.find((entry) => entry.type === 'image/png')?.entries ??
    sources.find((entry) => entry.type === 'image/webp')?.entries ??
    sources[sources.length - 1].entries;
  const largest = fallbackEntries[fallbackEntries.length - 1];

  return {
    key: asset.key,
    isFallback,
    sources: sources.map(({ type, srcSet }) => ({ type, srcSet })),
    src: largest.src,
    width: largest.width,
    height: largest.height,
    alt: asset.decorative ? '' : (asset.alt ?? ''),
    decorative: asset.decorative === true || !asset.alt,
    placeholder: asset.placeholder,
    accent: asset.accent ?? asset.dominantColor ?? '#1a1f27',
    preload: asset.preload ?? 'lazy',
  };
}

export interface ResolvedScene {
  key: string;
  accent: string;
  placeholder?: string;
  alt: string;
  /** Ordered smallest-first so the browser can pick by viewport. */
  breakpoints: {
    media: string;
    sources: { type: string; srcSet: string }[];
  }[];
  src: string;
  width: number;
  height: number;
  layers: { name: string; sources: { type: string; srcSet: string }[]; src: string }[];
}

/**
 * Scenes are art-directed rather than merely responsive: the mobile crop is a
 * different composition, so each breakpoint gets its own `<source media>`.
 */
export function resolveScene(key: string | undefined | null): ResolvedScene | null {
  const asset = lookup(key);
  if (!asset || asset.type !== 'image' || !asset.renditions) {
    return null;
  }

  const breakpoints: ResolvedScene['breakpoints'] = [];
  const mobile = asset.renditions.mobile;
  const tablet = asset.renditions.tablet;
  const desktop = asset.renditions.desktop ?? asset.renditions.landscape ?? asset.renditions.detail;

  if (mobile) {
    breakpoints.push({ media: '(max-width: 599px)', sources: buildSources(mobile.sources) });
  }
  if (tablet) {
    breakpoints.push({ media: '(max-width: 1023px)', sources: buildSources(tablet.sources) });
  }
  if (!desktop) {
    return null;
  }
  const desktopSources = buildSources(desktop.sources);
  breakpoints.push({ media: '(min-width: 0px)', sources: desktopSources });

  const fallbackEntries =
    desktopSources.find((entry) => entry.type === 'image/webp')?.entries ??
    desktopSources[desktopSources.length - 1].entries;
  const largest = fallbackEntries[fallbackEntries.length - 1];

  const layers = Object.entries(asset.layers ?? {}).map(([name, layer]) => {
    const layerSources = buildSources(layer.sources);
    const entries = layerSources[layerSources.length - 1].entries;
    return {
      name,
      sources: layerSources.map(({ type, srcSet }) => ({ type, srcSet })),
      src: entries[entries.length - 1].src,
    };
  });

  return {
    key: asset.key,
    accent: asset.accent ?? asset.dominantColor ?? '#12161d',
    placeholder: asset.placeholder,
    // Scene backdrops are decorative: the screen's own text carries meaning.
    alt: '',
    breakpoints,
    src: largest.src,
    width: largest.width,
    height: largest.height,
    layers,
  };
}

export interface ResolvedSprites {
  key: string;
  sprites: { id: string; src: string; width: number; height: number }[];
  recolor: boolean;
}

/** Particle and fog layers the client animates with CSS. */
export function resolveSprites(key: string): ResolvedSprites | null {
  const asset = lookup(key);
  if (!asset || (asset.type !== 'sprite-set' && asset.type !== 'layer') || !asset.sprites) {
    return null;
  }

  return {
    key: asset.key,
    recolor: asset.recolor === true,
    sprites: asset.sprites.map((sprite) => {
      const preferred =
        sprite.sources.find((source) => source.format === 'webp') ?? sprite.sources[0];
      return {
        id: sprite.id,
        src: preferred.src,
        width: sprite.width,
        height: sprite.height,
      };
    }),
  };
}

/** Tiling surface texture URL for a CSS `background-image`. */
export function resolveTexture(key: string): string | null {
  const asset = lookup(key);
  if (!asset || asset.type !== 'texture' || !asset.sources) {
    return null;
  }
  const sources = asset.sources as MediaSource[];
  const preferred = sources.find((source) => source.format === 'webp') ?? sources[0];
  return preferred?.src ?? null;
}

/**
 * Functional glyphs. A glyph is always paired with a text label in the UI, so
 * a missing glyph is a cosmetic loss and never an information loss.
 */
export function resolveGlyph(setKey: string, id: string): string | null {
  const asset = lookup(setKey);
  if (!asset || asset.type !== 'glyph-set' || !asset.glyphs) {
    return null;
  }
  return asset.glyphs.find((glyph) => glyph.id === id)?.src ?? null;
}

export interface ResolvedAudio {
  key: string;
  loop: boolean;
  durationSeconds: number | null;
  sources: { src: string; type: string }[];
}

export function resolveAudio(key: string): ResolvedAudio | null {
  const asset = lookup(key);
  if (!asset || asset.type !== 'audio' || !asset.sources) {
    return null;
  }
  const sources = asset.sources as AudioSourceRecord[];
  return {
    key: asset.key,
    loop: asset.loop === true,
    durationSeconds: asset.durationSeconds ?? null,
    sources: sources.map((source) => ({ src: source.src, type: source.mimeType })),
  };
}

export function hasMedia(key: string | undefined | null): boolean {
  return Boolean(key && assetsByKey.has(key));
}

export function listAssetKeys(): string[] {
  return [...assetsByKey.keys()];
}
