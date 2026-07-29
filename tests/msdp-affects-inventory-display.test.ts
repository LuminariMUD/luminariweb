import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import type { MsdpVariableMap, MudValue } from '../shared/mud.ts';
import {
  buildAffectsDisplayModel,
  buildInventoryDisplayModel,
  normalizeAffectRows,
  normalizeInventoryGroups,
} from '../shared/msdp-affects-inventory-display.ts';
import { loadMsdpFixtureCorpus } from './helpers/msdp-fixtures.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);

test('builds full affect rows with durations, modifiers, zero values, and unknown fields', async () => {
  const affects = await readCollectionFixtureValue('collections.affects.full.modifiers', 'AFFECTS');
  const model = buildAffectsDisplayModel({ affects }, 'connected', defaultMap);

  assert.equal(model.state, 'present');
  assert.equal(model.availability.kind, 'present');
  assert.equal(model.rows.length, 2);

  assert.equal(model.rows[0].nameText, 'bless');
  assert.equal(model.rows[0].durationText, '12 rounds');
  assert.match(model.rows[0].modifierText ?? '', /Modifier: \+1 attack/);
  assert.match(model.rows[0].unknownFieldsText ?? '', /School: enchantment/);

  assert.equal(model.rows[1].nameText, 'stone skin');
  assert.equal(model.rows[1].durationText, '0 rounds');
  assert.match(model.rows[1].modifierText ?? '', /Modifier: \+4 AC/);
  assert.match(model.rows[1].statusText ?? '', /Source: synthetic fixture/);
});

test('preserves partial affect records, missing names, aliases, and raw fallback entries', () => {
  const rows = normalizeAffectRows([
    {
      spell: 'heroism',
      ticks: '1',
      bonus: '+2 saves',
      note: 'synthetic alias field',
    },
    {
      name: '',
      duration: -1,
      magnitude: 2,
    },
    'raw concentration note',
  ]);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].nameText, 'heroism');
  assert.equal(rows[0].durationText, '1 round');
  assert.match(rows[0].modifierText ?? '', /Bonus: \+2 saves/);
  assert.match(rows[0].unknownFieldsText ?? '', /Note: synthetic alias field/);

  assert.equal(rows[1].nameText, 'Unknown affect 2');
  assert.equal(rows[1].isNameMissing, true);
  assert.equal(rows[1].durationText, '-1 round');
  assert.match(rows[1].unknownFieldsText ?? '', /Magnitude: 2/);

  assert.equal(rows[2].kind, 'raw');
  assert.equal(rows[2].rawText, 'raw concentration note');
});

test('keeps empty, loading, disabled, offline, error, and raw affects states distinct', async () => {
  const emptyAffects = await readCollectionFixtureValue('collections.empty.values', 'AFFECTS');
  const disabledMap: MsdpVariableMap = { ...defaultMap, affects: '' };

  assert.equal(
    buildAffectsDisplayModel({ affects: emptyAffects }, 'connected', defaultMap).state,
    'empty',
  );
  assert.equal(buildAffectsDisplayModel({}, 'connected', defaultMap).state, 'loading');
  assert.equal(buildAffectsDisplayModel({}, 'connected', disabledMap).state, 'disabled');
  assert.equal(buildAffectsDisplayModel({}, 'idle', defaultMap).state, 'offline');
  assert.equal(buildAffectsDisplayModel({}, 'disconnected', defaultMap).state, 'offline');
  assert.equal(buildAffectsDisplayModel({}, 'error', defaultMap).state, 'error');
  assert.equal(
    buildAffectsDisplayModel({ affects: 'raw affects text' }, 'connected', defaultMap).state,
    'raw',
  );
});

test('normalizes object-like affects conservatively', async () => {
  const affects = await readCollectionFixtureValue('collections.affects.object.payload', 'AFFECTS');
  const model = buildAffectsDisplayModel({ affects }, 'connected', defaultMap);

  assert.equal(model.state, 'present');
  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0].nameText, 'Bless');
  assert.equal(model.rows[0].durationText, '12 rounds');
  assert.match(model.rows[0].modifierText ?? '', /Modifier: \+1 attack/);
  assert.equal(model.rows[1].kind, 'raw');
  assert.equal(model.rows[1].nameText, 'Ambient');
  assert.equal(model.rows[1].rawText, 'warm glow');
});

test('builds inventory item rows with counts, locations, long names, and unknown fields', async () => {
  const inventory = await readCollectionFixtureValue(
    'collections.inventory.items.array',
    'INVENTORY',
  );
  const model = buildInventoryDisplayModel({ inventory }, 'connected', defaultMap);

  assert.equal(model.state, 'present');
  assert.equal(model.availability.kind, 'present');
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].label, 'Inventory');
  assert.equal(model.groups[0].items.length, 2);

  const potion = model.groups[0].items[0];
  assert.equal(potion.nameText, 'healing potion');
  assert.equal(potion.countText, '2');
  assert.equal(potion.locationText, 'backpack');
  assert.match(potion.unknownFieldsText ?? '', /Weight: 1/);

  const longName = model.groups[0].items[1];
  assert.equal(longName.nameText, 'very long synthetic item name for wrapping checks');
  assert.equal(longName.countText, '0');
});

test('normalizes grouped and counted inventory tables deterministically', async () => {
  const inventory = await readCollectionFixtureValue('collections.inventory.table', 'INVENTORY');
  const model = buildInventoryDisplayModel({ inventory }, 'connected', defaultMap);

  assert.equal(model.state, 'present');
  assert.deepEqual(
    model.groups.map((group) => group.label),
    ['Worn', 'Carried'],
  );
  assert.equal(model.groups[0].items[0].rawText, 'practice robe');
  assert.equal(model.groups[0].items[1].rawText, 'utility belt');
  assert.equal(model.groups[1].items[0].nameText, 'Torch');
  assert.equal(model.groups[1].items[0].countText, '2');
  assert.equal(model.groups[1].items[1].nameText, 'Ration');
  assert.equal(model.groups[1].items[1].countText, '5');
});

test('handles object-like inventory, aliases, raw values, and connection states', async () => {
  const inventory = await readCollectionFixtureValue(
    'collections.inventory.object.unknown',
    'INVENTORY',
  );
  const model = buildInventoryDisplayModel({ inventory }, 'connected', defaultMap);
  const disabledMap: MsdpVariableMap = { ...defaultMap, inventory: '' };

  assert.equal(model.state, 'present');
  assert.deepEqual(
    model.groups.map((group) => group.label),
    ['Inventory', 'Backpack', 'Worn'],
  );
  assert.equal(model.groups[0].items[0].nameText, 'Coins');
  assert.equal(model.groups[0].items[0].countText, '42');
  assert.equal(model.groups[1].items[0].nameText, 'iron ration');
  assert.equal(model.groups[1].items[0].countText, '5');
  assert.equal(model.groups[1].items[0].locationText, 'side pouch');

  assert.equal(
    buildInventoryDisplayModel(
      { inventory: await readCollectionFixtureValue('collections.empty.values', 'INVENTORY') },
      'connected',
      defaultMap,
    ).state,
    'empty',
  );
  assert.equal(buildInventoryDisplayModel({}, 'connected', defaultMap).state, 'loading');
  assert.equal(buildInventoryDisplayModel({}, 'connected', disabledMap).state, 'disabled');
  assert.equal(buildInventoryDisplayModel({}, 'idle', defaultMap).state, 'offline');
  assert.equal(buildInventoryDisplayModel({}, 'error', defaultMap).state, 'error');
  assert.equal(
    buildInventoryDisplayModel({ inventory: 'unparsed inventory text' }, 'connected', defaultMap)
      .state,
    'raw',
  );
});

test('supports representative inventory alias keys and bounded unknown summaries', () => {
  const groups = normalizeInventoryGroups([
    {
      ITEM_NAME: 'Alias Blade',
      QTY: '1',
      SLOT: 'belt',
      DESCRIPTION: 'synthetic weapon',
      custom_one: 'alpha',
      custom_two: 'beta',
      custom_three: 'gamma',
      custom_four: 'delta',
    },
  ]);
  const item = groups[0].items[0];

  assert.equal(item.nameText, 'Alias Blade');
  assert.equal(item.countText, '1');
  assert.equal(item.locationText, 'belt');
  assert.match(item.detailText ?? '', /Description: synthetic weapon/);
  assert.match(item.unknownFieldsText ?? '', /Custom One: alpha/);
  assert.match(item.unknownFieldsText ?? '', /1 more/);
});

async function readCollectionFixtureValue(
  fixtureId: string,
  variableName: 'AFFECTS' | 'INVENTORY',
): Promise<MudValue> {
  const corpus = await loadMsdpFixtureCorpus();
  const fixture = corpus.fixtures.find((entry) => entry.id === fixtureId);
  assert.ok(fixture, `${fixtureId} fixture should exist`);
  const pair = fixture.expectedPairs.find(([variable]) => variable === variableName);
  assert.ok(pair, `${fixtureId} should contain a ${variableName} expected pair`);
  return pair[1];
}
