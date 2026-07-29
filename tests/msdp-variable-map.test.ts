import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmedMsdpVariableKeys,
  defaultMsdpVariables,
  msdpVariableKeys,
  normalizeMsdpVariableMap,
  overrideOnlyMsdpVariableKeys,
} from '../shared/mud.ts';
import { getConfiguredMsdpVariables } from '../shared/msdp-state.ts';
import type { MsdpVariableMap } from '../shared/mud.ts';

test('normalizes source-backed default MSDP variables', () => {
  const normalized = normalizeMsdpVariableMap(defaultMsdpVariables);

  for (const key of confirmedMsdpVariableKeys) {
    assert.equal(normalized[key], defaultMsdpVariables[key]);
    assert.notEqual(normalized[key], '');
  }
});

test('keeps override-only defaults blank unless configured', () => {
  const normalized = normalizeMsdpVariableMap(defaultMsdpVariables);

  for (const key of overrideOnlyMsdpVariableKeys) {
    assert.equal(normalized[key], '');
  }
});

test('falls back to defaults when input is invalid', () => {
  assert.deepEqual(normalizeMsdpVariableMap(null), normalizeMsdpVariableMap(defaultMsdpVariables));
  assert.deepEqual(
    normalizeMsdpVariableMap(['HEALTH']),
    normalizeMsdpVariableMap(defaultMsdpVariables),
  );
});

test('trims string inputs and preserves user overrides', () => {
  const normalized = normalizeMsdpVariableMap({
    health: ' HP ',
    healthMax: ' HP_MAX ',
    title: ' TITLE ',
    fortitude: ' FORTITUDE ',
    movement: '',
    minimap: '   ',
  });

  assert.equal(normalized.health, 'HP');
  assert.equal(normalized.healthMax, 'HP_MAX');
  assert.equal(normalized.title, 'TITLE');
  assert.equal(normalized.fortitude, 'FORTITUDE');
  assert.equal(normalized.movement, defaultMsdpVariables.movement);
  assert.equal(normalized.minimap, defaultMsdpVariables.minimap);
});

test('filters blank configured variables and prevents duplicate requests', () => {
  const variables = createBlankMsdpVariableMap({
    health: 'VITALS',
    healthMax: ' VITALS ',
    psp: 'PSP',
    title: '',
    fortitude: ' FORTITUDE ',
    minimap: '   ',
  });

  assert.deepEqual(getConfiguredMsdpVariables(variables), ['VITALS', 'PSP', 'FORTITUDE']);
});

function createBlankMsdpVariableMap(overrides: Partial<MsdpVariableMap>) {
  const variables = Object.fromEntries(msdpVariableKeys.map((key) => [key, ''])) as MsdpVariableMap;

  return {
    ...variables,
    ...overrides,
  };
}
