import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import { mapMsdpUpdate, resolveMsdpVariableKey } from '../shared/msdp-state.ts';
import { getExpectedPairs, loadMsdpFixtureCorpus } from './helpers/msdp-fixtures.ts';
import type { MsdpVariableKey, MudState, MudValue } from '../shared/mud.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);

test('loads every manifest-listed MSDP fixture file without live MUD access', async () => {
  const corpus = await loadMsdpFixtureCorpus();

  assert.equal(corpus.manifest.totals.fixtureFiles, 7);
  assert.equal(corpus.manifest.totals.fixtures, 46);
  assert.equal(corpus.manifest.totals.realCaptureFixtures, 0);
  assert.equal(corpus.fixtures.length, corpus.manifest.totals.fixtures);
  assert.ok(corpus.fixtures.every((fixture) => fixture.sanitized));
});

test('maps configured fixture expected pairs into MudState partials', async () => {
  const corpus = await loadMsdpFixtureCorpus();
  const pairs = getExpectedPairs(corpus.fixtures);

  assert.ok(pairs.length > 0);

  for (const { fixture, variable, value } of pairs) {
    const key = resolveMsdpVariableKey(variable, defaultMap);

    assert.ok(key, `${fixture.id} uses ${variable}, which should be configured by default`);
    assert.deepEqual(
      mapMsdpUpdate(variable, value, defaultMap),
      createExpectedPartial(key, value),
      `${fixture.id} should map ${variable} into ${key}`,
    );
  }
});

function createExpectedPartial(key: MsdpVariableKey, value: MudValue): Partial<MudState> {
  return {
    [key]: value,
  } as Partial<MudState>;
}
