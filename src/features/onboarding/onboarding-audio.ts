/**
 * Onboarding audio.
 *
 * Sound is on by default and can be muted or rebalanced per channel from the
 * shell. It stays strictly optional in the sense that matters: no cue ever
 * carries information that is not already visible on screen, and failure and
 * password screens deliberately have no startling cue.
 */

import { resolveAudio } from './media-manifest.ts';
import { prefersReducedData } from './media-preferences.ts';

export type AudioChannel = 'music' | 'ambience' | 'sfx';

export interface AudioPreferences {
  enabled: boolean;
  volumes: Record<AudioChannel, number>;
}

/**
 * Sound is on by default. Browsers still refuse to start playback before the
 * player has interacted with the page, so `OnboardingAudio` retries the
 * pending loop on the first gesture rather than staying silent.
 */
export const defaultAudioPreferences: AudioPreferences = {
  enabled: true,
  volumes: { music: 0.4, ambience: 0.35, sfx: 0.6 },
};

const AUDIO_PREFERENCES_STORAGE_KEY = 'luminari.onboarding.audio';
const CROSSFADE_MS = 600;
const CROSSFADE_STEPS = 12;

/** Cues that must never play, because they would startle or mislead. */
const suppressedCues = new Set(['sfx/private-input-enter', 'sfx/private-input-exit']);

export function loadAudioPreferences(): AudioPreferences {
  if (typeof window === 'undefined') {
    return defaultAudioPreferences;
  }
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return defaultAudioPreferences;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return defaultAudioPreferences;
    }
    const record = parsed as Partial<AudioPreferences>;
    return {
      enabled: record.enabled === true,
      volumes: {
        music: clampVolume(record.volumes?.music, defaultAudioPreferences.volumes.music),
        ambience: clampVolume(record.volumes?.ambience, defaultAudioPreferences.volumes.ambience),
        sfx: clampVolume(record.volumes?.sfx, defaultAudioPreferences.volumes.sfx),
      },
    };
  } catch {
    return defaultAudioPreferences;
  }
}

export function saveAudioPreferences(preferences: AudioPreferences) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(AUDIO_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage being unavailable must not break the experience.
  }
}

function clampVolume(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

export class OnboardingAudio {
  private preferences: AudioPreferences = defaultAudioPreferences;
  private readonly oneShots = new Map<string, HTMLAudioElement>();
  private loops = new Map<AudioChannel, { key: string; element: HTMLAudioElement }>();
  private hidden = false;
  /** Loops the browser refused to start until the player interacts. */
  private readonly blockedLoops = new Map<AudioChannel, string>();
  private gestureListenerAttached = false;

  /**
   * Autoplay is blocked until the page has been interacted with. Rather than
   * failing silently, remember what could not start and try again on the first
   * gesture. Registered lazily so nothing is attached when audio is muted.
   */
  private waitForGesture() {
    if (this.gestureListenerAttached || typeof window === 'undefined') {
      return;
    }

    this.gestureListenerAttached = true;
    const resume = () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      this.gestureListenerAttached = false;

      const pending = [...this.blockedLoops.entries()];
      this.blockedLoops.clear();
      for (const [channel, key] of pending) {
        this.setLoop(channel, key);
      }
    };

    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  setPreferences(preferences: AudioPreferences) {
    const wasEnabled = this.preferences.enabled;
    this.preferences = preferences;

    if (!preferences.enabled) {
      this.stopAll();
      return;
    }

    for (const [channel, loop] of this.loops) {
      loop.element.volume = preferences.volumes[channel];
    }

    if (!wasEnabled) {
      // Nothing resumes automatically; the next scene change starts audio.
      return;
    }
  }

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    for (const [, loop] of this.loops) {
      if (hidden) {
        loop.element.pause();
      } else if (this.preferences.enabled) {
        void loop.element.play().catch(() => undefined);
      }
    }
  }

  /** Short, nonverbal interface cue. Never required to understand state. */
  play(key: string, isRetry = false) {
    if (!this.preferences.enabled || this.hidden || suppressedCues.has(key)) {
      return;
    }

    const audio = this.resolveOneShot(key);
    if (!audio) {
      return;
    }

    audio.volume = this.preferences.volumes.sfx;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // A cue started during a remount is aborted by the teardown that caused
      // it. One retry on the next tick recovers it; anything else is dropped,
      // because no cue is ever load-bearing.
      if (!isRetry && typeof setTimeout !== 'undefined') {
        setTimeout(() => this.play(key, true), 0);
      }
    });
  }

  /**
   * Cross-fade a looping channel. Loops never stack, and only the active
   * scene's loop stays decoded.
   */
  setLoop(channel: AudioChannel, key: string | null) {
    const existing = this.loops.get(channel);
    if (existing?.key === key) {
      return;
    }

    if (existing) {
      this.fadeOutAndStop(existing.element);
      this.loops.delete(channel);
    }

    this.blockedLoops.delete(channel);

    if (!key || !this.preferences.enabled || prefersReducedData()) {
      return;
    }

    const resolved = resolveAudio(key);
    if (!resolved) {
      return;
    }

    const element = this.createElement(resolved.sources);
    if (!element) {
      return;
    }

    element.loop = true;
    element.volume = 0;
    this.loops.set(channel, { key, element });
    void element.play().then(
      () => {
        this.fadeTo(element, this.preferences.volumes[channel]);
      },
      () => {
        // Usually an autoplay refusal; retry once the player interacts.
        this.loops.delete(channel);
        this.blockedLoops.set(channel, key);
        this.waitForGesture();
      },
    );
  }

  stopAll() {
    this.blockedLoops.clear();
    for (const [, loop] of this.loops) {
      loop.element.pause();
      loop.element.src = '';
    }
    this.loops = new Map();
    for (const [, audio] of this.oneShots) {
      audio.pause();
    }
    // Elements are kept: their src stays valid, so a cue can be replayed
    // without re-fetching it.
    this.oneShots.clear();
  }

  private resolveOneShot(key: string) {
    const cached = this.oneShots.get(key);
    if (cached) {
      return cached;
    }

    const resolved = resolveAudio(key);
    if (!resolved) {
      return null;
    }

    const element = this.createElement(resolved.sources);
    if (element) {
      this.oneShots.set(key, element);
    }
    return element;
  }

  private createElement(sources: { src: string; type: string }[]) {
    if (typeof Audio === 'undefined' || !sources.length) {
      return null;
    }

    const element = new Audio();
    const playable =
      sources.find((source) => element.canPlayType(source.type.split(';')[0]) !== '') ?? sources[0];
    element.src = playable.src;
    element.preload = 'auto';
    return element;
  }

  private fadeTo(element: HTMLAudioElement, target: number) {
    const start = element.volume;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      const ratio = step / CROSSFADE_STEPS;
      element.volume = Math.min(1, Math.max(0, start + (target - start) * ratio));
      if (step >= CROSSFADE_STEPS) {
        clearInterval(timer);
      }
    }, CROSSFADE_MS / CROSSFADE_STEPS);
  }

  private fadeOutAndStop(element: HTMLAudioElement) {
    const start = element.volume;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      element.volume = Math.max(0, start * (1 - step / CROSSFADE_STEPS));
      if (step >= CROSSFADE_STEPS) {
        clearInterval(timer);
        element.pause();
        element.src = '';
      }
    }, CROSSFADE_MS / CROSSFADE_STEPS);
  }
}

/** Interface cue for a screen transition, chosen from the delivered catalog. */
export const screenEnterCues: Record<string, string> = {
  'account-name': 'sfx/connection-ready',
  'account-password': 'sfx/panel-open',
  'account-new-password': 'sfx/panel-open',
  'account-confirm-password': 'sfx/panel-open',
  'account-menu': 'sfx/lobby-reveal',
  'account-link': 'sfx/panel-open',
  name: 'sfx/create-character',
  'name-confirm': 'sfx/name-ink',
  sex: 'sfx/step-forward',
  race: 'sfx/step-forward',
  'race-detail': 'sfx/race-preview',
  class: 'sfx/step-forward',
  'class-detail': 'sfx/class-preview',
  build: 'sfx/panel-open',
  alignment: 'sfx/alignment-move',
  preferences: 'sfx/panel-open',
  'roleplay-decision': 'sfx/editor-open',
  'roleplay-hub': 'sfx/editor-open',
  'short-desc-intro': 'sfx/editor-open',
  'short-desc-feature-1': 'sfx/roleplay-choice',
  'short-desc-adjective-1': 'sfx/roleplay-choice',
  'short-desc-preview': 'sfx/modal-open',
  'short-desc-review': 'sfx/editor-open',
  'short-desc-feature-2': 'sfx/roleplay-choice',
  'short-desc-adjective-2': 'sfx/roleplay-choice',
  'long-description': 'sfx/editor-open',
  'background-story': 'sfx/editor-open',
  'background-catalog': 'sfx/roleplay-choice',
  'background-confirm': 'sfx/modal-open',
  'goals-ideas': 'sfx/editor-open',
  'goals-editor': 'sfx/editor-open',
  'personality-ideas': 'sfx/editor-open',
  'personality-editor': 'sfx/editor-open',
  'ideals-ideas': 'sfx/editor-open',
  'ideals-editor': 'sfx/editor-open',
  'bonds-ideas': 'sfx/editor-open',
  'bonds-editor': 'sfx/editor-open',
  'flaws-ideas': 'sfx/editor-open',
  'flaws-editor': 'sfx/editor-open',
  'age-select': 'sfx/roleplay-choice',
  'region-catalog': 'sfx/roleplay-choice',
  'region-confirm': 'sfx/region-preview',
  'faction-select': 'sfx/faction-preview',
  'hometown-select': 'sfx/roleplay-choice',
  'deity-select': 'sfx/deity-preview',
  'deity-confirm': 'sfx/deity-preview',
  motd: 'sfx/step-forward',
  'character-menu': 'sfx/character-card-open',
  handoff: 'sfx/onboarding-handoff',
};

/** Ambience loop per scene. Resolves to nothing until ambience art lands. */
export const sceneAmbienceCues: Record<string, string> = {
  'scene/arrival': 'ambience/arrival-harbor',
  'scene/authentication': 'ambience/auth-gatehouse',
  'scene/account-lobby': 'ambience/account-lobby',
  'scene/identity': 'ambience/identity-scriptorium',
  'scene/race-gallery': 'ambience/race-gallery',
  'scene/class-gallery': 'ambience/class-gallery',
  'scene/build-alignment': 'ambience/loom-chamber',
  'scene/roleplay': 'ambience/roleplay-room',
};

export const sceneMusicCues: Record<string, string> = {
  'scene/arrival': 'music/arrival-theme',
  'scene/authentication': 'music/arrival-theme',
  'scene/account-lobby': 'music/account-lobby',
  'scene/identity': 'music/identity',
  'scene/race-gallery': 'music/origins',
  'scene/class-gallery': 'music/paths',
  'scene/build-alignment': 'music/loom',
  'scene/roleplay': 'music/roleplay',
  'scene/handoff': 'music/handoff',
};

/** Persistence cue, only ever played after the server confirms the outcome. */
export const persistenceCues: Record<string, string> = {
  pending: 'sfx/save-pending',
  saved: 'sfx/save-confirmed',
  failed: 'sfx/save-failed',
};
