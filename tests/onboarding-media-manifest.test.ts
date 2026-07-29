import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  hasMedia,
  listAssetKeys,
  resolveAudio,
  resolveGlyph,
  resolveImage,
  resolveScene,
  resolveSprites,
  resolveTexture,
  screenSceneKeys,
} from '../src/features/onboarding/media-manifest.ts';
import { screenEnterCues } from '../src/features/onboarding/onboarding-audio.ts';
import { connectionPrefersReducedData } from '../src/features/onboarding/media-preferences.ts';
import { onboardingScreens, roleplayScreens } from '../shared/onboarding.ts';

const manifest = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'src/features/onboarding/generated-media-manifest.json'),
    'utf8',
  ),
) as {
  schema: string;
  mediaVersion: string;
  distribution: string;
  assetCount: number;
  assets: Array<Record<string, unknown>>;
};

test('the public distribution declares an empty media catalog', () => {
  assert.equal(manifest.schema, 'luminari.onboarding.media/1');
  assert.equal(manifest.mediaVersion, 'v1');
  assert.equal(manifest.distribution, 'media-free-public-snapshot');
  assert.equal(manifest.assetCount, 0);
  assert.deepEqual(manifest.assets, []);
  assert.deepEqual(listAssetKeys(), []);
});

test('the public manifest contains no embedded media payloads', () => {
  assert.doesNotMatch(JSON.stringify(manifest), /data:(?:image|audio|video|font)\/[^;]+;base64,/);
});

test('missing media degrades safely instead of returning broken asset URLs', () => {
  assert.equal(resolveImage('race/human', 'thumb'), null);
  assert.equal(resolveImage(undefined), null);
  assert.equal(resolveImage(null), null);
  assert.equal(resolveScene('scene/arrival'), null);
  assert.equal(resolveAudio('music/arrival'), null);
  assert.equal(resolveGlyph('shared/glyph-abilities', 'strength'), null);
  assert.equal(resolveSprites('shared/motes-arcane'), null);
  assert.equal(resolveTexture('shared/texture-dark-stone'), null);
});

test('every onboarding scene and audio cue remains optional without bundled media', () => {
  for (const screen of onboardingScreens) {
    const sceneKey = screenSceneKeys[screen];
    assert.ok(sceneKey, `no semantic scene key mapped for ${screen}`);
    assert.equal(hasMedia(sceneKey), false);
    assert.equal(resolveScene(sceneKey), null);
  }

  for (const screen of roleplayScreens) {
    const cue = screenEnterCues[screen];
    assert.ok(cue, `no semantic audio cue mapped for ${screen}`);
    assert.equal(resolveAudio(cue), null);
  }
});

test('an explicit reduced-data preference still selects text-only presentation', () => {
  assert.equal(connectionPrefersReducedData(undefined), false);
  assert.equal(connectionPrefersReducedData({ saveData: false }), false);
  assert.equal(connectionPrefersReducedData({ saveData: true }), true);
});
