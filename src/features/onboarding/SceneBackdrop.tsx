import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveScene, resolveSprites } from './media-manifest.ts';
import { prefersReducedData } from './media-preferences.ts';

interface SceneBackdropProps {
  sceneKey: string;
  /** Screen identifier; a change re-runs the scene transition. */
  transitionKey: string;
  reducedMotion: boolean;
}

interface Mote {
  id: string;
  src: string;
  left: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
  opacity: number;
}

/** Deterministic pseudo-random so the drift pattern is stable per scene. */
function seededRandom(seed: number) {
  let value = seed % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

const spriteSetForScene: Record<string, string> = {
  'scene/arrival': 'shared/stars',
  'scene/authentication': 'shared/motes-dust',
  'scene/account-lobby': 'shared/embers',
  'scene/identity': 'shared/motes-dust',
  'scene/race-gallery': 'shared/motes-dust',
  'scene/class-gallery': 'shared/embers',
  'scene/build-alignment': 'shared/stars',
  'scene/roleplay': 'shared/motes-dust',
  'scene/handoff': 'shared/embers',
};

const MOTE_COUNT = 14;

/**
 * The cinematic backdrop. Motion is produced entirely in the client by moving
 * and cross-fading still layers, so `prefers-reduced-motion` can drop back to
 * the static composite without losing any content.
 */
export function SceneBackdrop({ sceneKey, transitionKey, reducedMotion }: SceneBackdropProps) {
  const scene = resolveScene(sceneKey);
  const reducedData = prefersReducedData();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const motes = useMemo<Mote[]>(() => {
    if (reducedMotion || reducedData) {
      return [];
    }
    const spriteSet = resolveSprites(spriteSetForScene[sceneKey] ?? 'shared/motes-dust');
    if (!spriteSet || !spriteSet.sprites.length) {
      return [];
    }

    const random = seededRandom(hashString(sceneKey) + 17);
    return Array.from({ length: MOTE_COUNT }, (_, index) => {
      const sprite = spriteSet.sprites[index % spriteSet.sprites.length];
      return {
        id: `${sprite.id}-${index}`,
        src: sprite.src,
        left: random() * 100,
        size: 6 + random() * 20,
        delay: random() * 18,
        duration: 22 + random() * 26,
        drift: random() * 60 - 30,
        opacity: 0.18 + random() * 0.35,
      };
    });
  }, [reducedData, reducedMotion, sceneKey]);

  useEffect(() => {
    if (reducedMotion || reducedData || typeof window === 'undefined') {
      return;
    }

    let frame = 0;
    const handlePointer = (event: PointerEvent) => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        setParallax({ x, y });
      });
    };

    window.addEventListener('pointermove', handlePointer, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handlePointer);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [reducedData, reducedMotion]);

  if (!scene || reducedData) {
    return <div className="onboarding-scene onboarding-scene--empty" aria-hidden="true" />;
  }

  const depth = reducedMotion ? 0 : 1;

  return (
    <div
      className="onboarding-scene"
      ref={containerRef}
      aria-hidden="true"
      style={{ ['--scene-accent' as string]: scene.accent }}
    >
      <div
        key={`${scene.key}-${transitionKey}`}
        className="onboarding-scene__plate"
        style={{
          transform: `translate3d(${parallax.x * -14 * depth}px, ${parallax.y * -10 * depth}px, 0) scale(${
            reducedMotion ? 1 : 1.04
          })`,
          backgroundImage: scene.placeholder ? `url(${scene.placeholder})` : undefined,
        }}
      >
        <picture>
          {scene.breakpoints.map((breakpoint) =>
            breakpoint.sources.map((source) => (
              <source
                key={`${breakpoint.media}-${source.type}`}
                media={breakpoint.media}
                type={source.type}
                srcSet={source.srcSet}
              />
            )),
          )}
          <img src={scene.src} width={scene.width} height={scene.height} alt="" decoding="async" />
        </picture>
      </div>

      {scene.layers.map((layer, index) => (
        <div
          key={layer.name}
          className={`onboarding-scene__layer onboarding-scene__layer--${layer.name}`}
          style={{
            transform: `translate3d(${parallax.x * (index + 2) * -9 * depth}px, ${
              parallax.y * (index + 2) * -6 * depth
            }px, 0)`,
          }}
        >
          <picture>
            {layer.sources.map((source) => (
              <source key={source.type} type={source.type} srcSet={source.srcSet} />
            ))}
            <img src={layer.src} alt="" decoding="async" loading="lazy" />
          </picture>
        </div>
      ))}

      {motes.length > 0 ? (
        <div className="onboarding-scene__motes">
          {motes.map((mote) => (
            <img
              key={mote.id}
              src={mote.src}
              alt=""
              className="onboarding-scene__mote"
              loading="lazy"
              decoding="async"
              style={{
                left: `${mote.left}%`,
                width: `${mote.size}px`,
                height: `${mote.size}px`,
                opacity: mote.opacity,
                animationDelay: `${-mote.delay}s`,
                animationDuration: `${mote.duration}s`,
                ['--mote-drift' as string]: `${mote.drift}px`,
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="onboarding-scene__vignette" />
    </div>
  );
}
