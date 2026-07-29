import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import type { MsdpVariableMap, MudValue } from '../shared/mud.ts';
import { buildGroupDisplayModel, normalizeGroupMembers } from '../shared/msdp-group-display.ts';
import type { GroupMemberModel, GroupResourceId } from '../shared/msdp-group-display.ts';
import { loadMsdpFixtureCorpus } from './helpers/msdp-fixtures.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);

test('builds full group member rows from fixture data', async () => {
  const group = await readGroupFixtureValue('group.full.members');
  const model = buildGroupDisplayModel({ group }, 'connected', defaultMap);

  assert.equal(model.state, 'present');
  assert.equal(model.availability.kind, 'present');
  assert.equal(model.members.length, 2);

  const leader = model.members[0];
  assert.equal(leader.nameText, 'Leader One');
  assert.equal(leader.isLeader, true);
  assert.equal(leader.leaderText, 'Leader');
  assert.equal(leader.statusText, 'ready');
  assert.equal(findResource(leader, 'health').valueText, '90 / 100');
  assert.equal(findResource(leader, 'health').percentage, 90);
  assert.equal(findResource(leader, 'movement').valueText, '70 / 120');
  assert.equal(Math.round(findResource(leader, 'movement').percentage), 58);

  const scout = model.members[1];
  assert.equal(scout.nameText, 'Scout Two');
  assert.equal(scout.isLeader, false);
  assert.equal(scout.statusText, 'scouting');
  assert.equal(findResource(scout, 'health').valueText, '64 / 80');
  assert.equal(findResource(scout, 'movement').valueText, '95 / 100');
});

test('preserves partial member data, missing names, and zero values', async () => {
  const group = await readGroupFixtureValue('group.partial.member');
  const model = buildGroupDisplayModel({ group }, 'connected', defaultMap);

  assert.equal(model.state, 'present');
  assert.equal(model.members.length, 2);

  const named = model.members[0];
  assert.equal(named.nameText, 'Partial Member');
  assert.equal(findResource(named, 'health').valueText, '42');
  assert.equal(findResource(named, 'movement').valueText, 'Not reported');

  const missingName = model.members[1];
  assert.equal(missingName.nameText, 'Unknown member 2');
  assert.equal(missingName.isNameMissing, true);
  assert.equal(missingName.isLeader, false);
  assert.equal(missingName.statusText, undefined);
  assert.equal(findResource(missingName, 'health').valueText, '0');
  assert.equal(findResource(missingName, 'movement').valueText, '0');
});

test('keeps empty, loading, disabled, offline, and error group states distinct', async () => {
  const emptyGroup = await readGroupFixtureValue('group.empty.collection');
  const disabledMap: MsdpVariableMap = { ...defaultMap, group: '' };

  assert.equal(
    buildGroupDisplayModel({ group: emptyGroup }, 'connected', defaultMap).state,
    'empty',
  );
  assert.equal(buildGroupDisplayModel({}, 'connected', defaultMap).state, 'loading');
  assert.equal(buildGroupDisplayModel({}, 'connected', disabledMap).state, 'disabled');
  assert.equal(buildGroupDisplayModel({}, 'idle', defaultMap).state, 'offline');
  assert.equal(buildGroupDisplayModel({}, 'disconnected', defaultMap).state, 'offline');
  assert.equal(buildGroupDisplayModel({}, 'error', defaultMap).state, 'error');
});

test('summarizes unknown fields and handles object-like group payloads', async () => {
  const unknownFields = await readGroupFixtureValue('group.unknown.fields');
  const unknownModel = buildGroupDisplayModel({ group: unknownFields }, 'connected', defaultMap);
  const mysteryMember = unknownModel.members[0];

  assert.equal(mysteryMember.nameText, 'Mystery Member');
  assert.equal(mysteryMember.statusText, 'guarding');
  assert.equal(findResource(mysteryMember, 'health').valueText, '0 / 100');
  assert.equal(findResource(mysteryMember, 'movement').valueText, '15 / 40');
  assert.match(mysteryMember.unknownFieldsText ?? '', /Formation: front/);
  assert.match(mysteryMember.unknownFieldsText ?? '', /Note: synthetic unknown field/);

  const objectPayload = await readGroupFixtureValue('group.object.payload');
  const objectModel = buildGroupDisplayModel({ group: objectPayload }, 'connected', defaultMap);

  assert.equal(objectModel.members.length, 2);
  assert.equal(objectModel.members[0].nameText, 'Object Leader');
  assert.equal(objectModel.members[0].isLeader, true);
  assert.equal(findResource(objectModel.members[0], 'health').valueText, '55 / 50');
  assert.equal(findResource(objectModel.members[0], 'health').percentage, 100);
  assert.equal(findResource(objectModel.members[0], 'movement').valueText, '20');
  assert.equal(findResource(objectModel.members[0], 'movement').percentage, 0);
  assert.equal(objectModel.members[1].kind, 'raw');
  assert.equal(objectModel.members[1].nameText, 'Raw Slot');
  assert.equal(objectModel.members[1].rawText, 'loose entry');
});

test('supports representative alias keys and raw fallback entries', () => {
  const members = normalizeGroupMembers([
    {
      CHARACTER_NAME: 'Alias Hero',
      IS_LEADER: 'true',
      HEALTH: '5',
      HEALTH_MAX: '10',
      MOVE: '3',
      MOVE_MAX: '6',
      STATUS: 'resting',
    },
    'raw group note',
  ]);

  assert.equal(members.length, 2);
  assert.equal(members[0].nameText, 'Alias Hero');
  assert.equal(members[0].isLeader, true);
  assert.equal(members[0].statusText, 'resting');
  assert.equal(findResource(members[0], 'health').valueText, '5 / 10');
  assert.equal(findResource(members[0], 'movement').valueText, '3 / 6');
  assert.equal(members[1].kind, 'raw');
  assert.equal(members[1].rawText, 'raw group note');

  const rawModel = buildGroupDisplayModel(
    { group: 'standalone group text' },
    'connected',
    defaultMap,
  );
  assert.equal(rawModel.state, 'present');
  assert.equal(rawModel.members[0].rawText, 'standalone group text');
});

async function readGroupFixtureValue(fixtureId: string): Promise<MudValue> {
  const corpus = await loadMsdpFixtureCorpus();
  const fixture = corpus.fixtures.find((entry) => entry.id === fixtureId);
  assert.ok(fixture, `${fixtureId} fixture should exist`);
  const groupPair = fixture.expectedPairs.find(([variable]) => variable === 'GROUP');
  assert.ok(groupPair, `${fixtureId} should contain a GROUP expected pair`);
  return groupPair[1];
}

function findResource(member: GroupMemberModel, id: GroupResourceId) {
  const resource = member.resources.find((entry) => entry.id === id);
  assert.ok(resource, `Expected ${id} resource`);
  return resource;
}
