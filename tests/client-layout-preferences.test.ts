import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CLIENT_LAYOUT_PREFERENCES,
  INSPECTOR_TAB_IDS,
  parseClientLayoutPreferencesJson,
  parseClientLayoutPreferencesPayload,
  serializeClientLayoutPreferences,
} from '../shared/client-layout-preferences.ts';

test('uses default layout preferences for missing, empty, and corrupt storage values', () => {
  assert.deepEqual(parseClientLayoutPreferencesJson(null), DEFAULT_CLIENT_LAYOUT_PREFERENCES);
  assert.deepEqual(parseClientLayoutPreferencesJson(''), DEFAULT_CLIENT_LAYOUT_PREFERENCES);
  assert.deepEqual(parseClientLayoutPreferencesJson('not json'), DEFAULT_CLIENT_LAYOUT_PREFERENCES);
  assert.deepEqual(parseClientLayoutPreferencesPayload([]), DEFAULT_CLIENT_LAYOUT_PREFERENCES);
  assert.deepEqual(parseClientLayoutPreferencesPayload('bad'), DEFAULT_CLIENT_LAYOUT_PREFERENCES);
});

test('accepts valid saved layout preferences', () => {
  const parsed = parseClientLayoutPreferencesPayload({
    version: 1,
    activeInspectorTab: 'inventory',
    inspectorCollapsed: true,
    density: 'compact',
  });

  assert.deepEqual(parsed, {
    version: 1,
    activeInspectorTab: 'inventory',
    inspectorCollapsed: true,
    density: 'compact',
  });
});

test('accepts the Protocol inspector tab as a stored layout preference', () => {
  assert.ok(INSPECTOR_TAB_IDS.includes('protocol'));

  const parsed = parseClientLayoutPreferencesPayload({
    version: 1,
    activeInspectorTab: 'protocol',
    inspectorCollapsed: false,
    density: 'comfortable',
  });

  assert.deepEqual(parsed, {
    version: 1,
    activeInspectorTab: 'protocol',
    inspectorCollapsed: false,
    density: 'comfortable',
  });
});

test('defaults unknown tabs while preserving other valid fields', () => {
  const parsed = parseClientLayoutPreferencesPayload({
    version: 1,
    activeInspectorTab: 'not-a-tab',
    inspectorCollapsed: true,
    density: 'compact',
  });

  assert.deepEqual(parsed, {
    ...DEFAULT_CLIENT_LAYOUT_PREFERENCES,
    inspectorCollapsed: true,
    density: 'compact',
  });
});

test('defaults invalid density while preserving other valid fields', () => {
  const parsed = parseClientLayoutPreferencesPayload({
    version: 1,
    activeInspectorTab: 'room',
    inspectorCollapsed: true,
    density: 'dense',
  });

  assert.deepEqual(parsed, {
    ...DEFAULT_CLIENT_LAYOUT_PREFERENCES,
    activeInspectorTab: 'room',
    inspectorCollapsed: true,
  });
});

test('fills missing fields with defaults for current-version payloads', () => {
  const parsed = parseClientLayoutPreferencesPayload({
    version: 1,
    activeInspectorTab: 'combat',
  });

  assert.deepEqual(parsed, {
    ...DEFAULT_CLIENT_LAYOUT_PREFERENCES,
    activeInspectorTab: 'combat',
  });
});

test('rejects future layout preference versions', () => {
  const parsed = parseClientLayoutPreferencesPayload({
    version: 2,
    activeInspectorTab: 'quests',
    inspectorCollapsed: true,
    density: 'compact',
  });

  assert.deepEqual(parsed, DEFAULT_CLIENT_LAYOUT_PREFERENCES);
});

test('serializes storage-safe normalized layout preferences', () => {
  const serialized = serializeClientLayoutPreferences({
    version: 1,
    activeInspectorTab: 'protocol',
    inspectorCollapsed: true,
    density: 'compact',
  });

  assert.deepEqual(parseClientLayoutPreferencesJson(serialized), {
    version: 1,
    activeInspectorTab: 'protocol',
    inspectorCollapsed: true,
    density: 'compact',
  });
});
