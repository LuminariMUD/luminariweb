import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import type { MsdpVariableMap } from '../shared/mud.ts';
import { buildQuestDisplayModel, normalizeQuestInfoValue } from '../shared/msdp-quest-display.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);
const configuredMap: MsdpVariableMap = { ...defaultMap, questInfo: 'QUEST_INFO' };

test('reports QUEST_INFO unavailable by default', () => {
  const model = buildQuestDisplayModel({}, 'connected', defaultMap);

  assert.equal(model.state, 'unsupported');
  assert.equal(model.availability.kind, 'unavailable');
  assert.match(model.availability.detail ?? '', /does not emit QUEST_INFO/);
});

test('keeps configured waiting, empty, offline, and error quest states distinct', () => {
  assert.equal(buildQuestDisplayModel({}, 'connected', configuredMap).state, 'loading');
  assert.equal(
    buildQuestDisplayModel({ questInfo: [] }, 'connected', configuredMap).state,
    'empty',
  );
  assert.equal(
    buildQuestDisplayModel({ questInfo: '' }, 'connected', configuredMap).state,
    'empty',
  );
  assert.equal(buildQuestDisplayModel({}, 'idle', configuredMap).state, 'offline');
  assert.equal(buildQuestDisplayModel({}, 'disconnected', configuredMap).state, 'offline');
  assert.equal(buildQuestDisplayModel({}, 'error', configuredMap).state, 'error');
});

test('normalizes structured override JSON without parsing free-form quest prose', () => {
  const jsonValue = '[{"name":"Fixture Quest","progress":{"completed":1,"required":3}}]';
  const model = buildQuestDisplayModel({ questInfo: jsonValue }, 'connected', configuredMap);
  const proseModel = buildQuestDisplayModel(
    { questInfo: 'Quest: defeat ten rats and return.' },
    'connected',
    configuredMap,
  );

  assert.equal(model.state, 'present');
  assert.equal(model.overrideKind, 'structured');
  assert.deepEqual(model.value, [
    {
      name: 'Fixture Quest',
      progress: {
        completed: 1,
        required: 3,
      },
    },
  ]);
  assert.equal(proseModel.state, 'present');
  assert.equal(proseModel.overrideKind, 'scalar');
  assert.equal(proseModel.value, 'Quest: defeat ten rats and return.');
});

test('supports structured object and scalar override payloads', () => {
  const structured = buildQuestDisplayModel(
    {
      questInfo: {
        name: 'Object Quest',
        targets: ['alpha', 'beta'],
      },
    },
    'connected',
    configuredMap,
  );
  const scalar = buildQuestDisplayModel({ questInfo: 0 }, 'connected', configuredMap);

  assert.equal(structured.state, 'present');
  assert.equal(structured.overrideKind, 'structured');
  assert.equal(scalar.state, 'present');
  assert.equal(scalar.overrideKind, 'scalar');
  assert.equal(scalar.value, 0);
});

test('leaves invalid JSON-looking quest strings as escaped scalar data', () => {
  const raw = '{"name":';

  assert.equal(normalizeQuestInfoValue(raw), raw);

  const model = buildQuestDisplayModel({ questInfo: raw }, 'connected', configuredMap);
  assert.equal(model.state, 'present');
  assert.equal(model.overrideKind, 'scalar');
  assert.equal(model.value, raw);
});
