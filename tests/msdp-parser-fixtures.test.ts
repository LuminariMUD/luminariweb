import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMsdpPayload } from '../server/telnet-parser.ts';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import { mapMsdpUpdate } from '../shared/msdp-state.ts';
import { loadMsdpFixtureCorpus } from './helpers/msdp-fixtures.ts';
import {
  MsdpPayloadEncodingError,
  encodeMsdpPayloadTokens,
  validateMsdpPayloadTokens,
} from './helpers/msdp-payload-encoder.ts';
import type { MsdpFixture } from './helpers/msdp-fixtures.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);

test('encodes every manifest-listed fixture payload token stream', async () => {
  const corpus = await loadMsdpFixtureCorpus();

  assert.equal(corpus.fixtures.length, corpus.manifest.totals.fixtures);

  for (const fixture of corpus.fixtures) {
    assert.deepEqual(
      validateMsdpPayloadTokens(fixture.payloadTokens, { fixtureId: fixture.id }),
      [],
    );
    assert.ok(
      Buffer.isBuffer(encodeMsdpPayloadTokens(fixture.payloadTokens, { fixtureId: fixture.id })),
      `${fixture.id} should encode to a Buffer`,
    );
  }
});

test('reports unsupported payload token values with fixture and index paths', () => {
  assert.throws(
    () => encodeMsdpPayloadTokens(['VAR', 7, 'VAL'], { fixtureId: 'fixture.invalid.value' }),
    (error) => {
      assert.ok(error instanceof MsdpPayloadEncodingError);
      assert.deepEqual(error.issues, [
        {
          path: 'fixture.invalid.value.payloadTokens[1]',
          message: 'must be a string token, received number',
        },
      ]);
      return true;
    },
  );

  assert.deepEqual(validateMsdpPayloadTokens(['MSDP_VAR'], { fixtureId: 'fixture.bad.token' }), [
    {
      path: 'fixture.bad.token.payloadTokens[0]',
      message: 'unknown MSDP control token "MSDP_VAR"',
    },
  ]);
});

test('parses scalar fixtures and preserves integer-only numeric normalization', async () => {
  await assertFixturesByCoverage(['scalar', 'numeric-normalization']);
});

test('parses arrays and explicit empty collection values', async () => {
  await assertFixturesByCoverage(['array', 'empty-values']);
});

test('parses tables and nested table fixtures recursively', async () => {
  await assertFixturesByCoverage(['table', 'nested-table']);
});

test('parses mixed array/table, group, inventory, and affects fixtures with matching contracts', async () => {
  await assertFixturesByCoverage(['mixed-array-table', 'group', 'inventory', 'affects']);
});

test('parses malformed payload fixtures without throwing and with documented partial output', async () => {
  const corpus = await loadMsdpFixtureCorpus();
  const fixtures = findFixturesByCoverage(corpus.fixtures, ['malformed']);

  assert.equal(fixtures.length, 6);

  for (const fixture of fixtures) {
    assert.doesNotThrow(() => parseFixture(fixture), `${fixture.id} should not throw`);
    assert.deepEqual(parseFixture(fixture), fixture.expectedPairs, fixture.id);
  }
});

test('parses valid variables after malformed structured array members without stale output', () => {
  const payload = encodeMsdpPayloadTokens(
    [
      'VAR',
      'ACTIONS',
      'VAL',
      'ARRAY_OPEN',
      'VAL',
      'standard',
      'VAR',
      'bad-member',
      'VAL',
      'ignored',
      'ARRAY_CLOSE',
      'VAR',
      'HEALTH',
      'VAL',
      '5',
    ],
    { fixtureId: 'boundary.malformed-array-member' },
  );

  assert.deepEqual(parseMsdpPayload(payload), [
    ['ACTIONS', ['standard']],
    ['HEALTH', 5],
  ]);
});

test('maps parser-produced structured fixture values through Phase 00 state mapping', async () => {
  const corpus = await loadMsdpFixtureCorpus();

  for (const fixture of corpus.fixtures) {
    const parsedPairs = parseFixture(fixture);

    assert.deepEqual(
      parsedPairs.map(([variable, value]) => mapMsdpUpdate(variable, value, defaultMap)),
      fixture.expectedPairs.map(([variable, value]) => mapMsdpUpdate(variable, value, defaultMap)),
      fixture.id,
    );
  }
});

async function assertFixturesByCoverage(tags: readonly string[]) {
  const corpus = await loadMsdpFixtureCorpus();
  const fixtures = findFixturesByCoverage(corpus.fixtures, tags);

  assert.ok(fixtures.length > 0, `Expected fixture coverage for ${tags.join(', ')}`);

  for (const fixture of fixtures) {
    assert.deepEqual(parseFixture(fixture), fixture.expectedPairs, fixture.id);
  }
}

function findFixturesByCoverage(fixtures: readonly MsdpFixture[], tags: readonly string[]) {
  return fixtures.filter((fixture) => tags.some((tag) => fixture.coverage.includes(tag)));
}

function parseFixture(fixture: MsdpFixture) {
  return parseMsdpPayload(
    encodeMsdpPayloadTokens(fixture.payloadTokens, { fixtureId: fixture.id }),
  );
}
