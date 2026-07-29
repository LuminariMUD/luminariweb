import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import { buildRoomDisplayModel, normalizeRoomExits } from '../shared/msdp-room-display.ts';
import type { MsdpVariableMap } from '../shared/mud.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);

test('builds present room identity with zero vnum and structured details', () => {
  const model = buildRoomDisplayModel(
    {
      roomName: 'Hall of Fixtures',
      areaName: 'Test Keep',
      roomVnum: 0,
      worldTime: 'Day 12',
      room: {
        terrain: 'stone',
        weather: 'windy',
      },
      roomExits: {
        south: 1003,
        north: 1002,
        portal: {
          destination: 'Astral Gate',
          status: 'uncertain',
          color: 'silver',
        },
      },
    },
    'connected',
    defaultMap,
  );

  assert.equal(model.state, 'present');
  assert.equal(
    model.identityFields.find((field) => field.id === 'roomName')?.valueText,
    'Hall of Fixtures',
  );
  assert.equal(model.identityFields.find((field) => field.id === 'roomVnum')?.valueText, '0');
  assert.deepEqual(
    model.details.map((detail) => [detail.label, detail.valueText]),
    [
      ['Terrain', 'stone'],
      ['Other', 'Weather: windy'],
    ],
  );
  assert.deepEqual(
    model.exits.map((exit) => exit.directionText),
    ['North', 'South', 'Portal'],
  );
  assert.equal(model.exits[2].destinationText, 'Astral Gate');
  assert.equal(model.exits[2].statusText, 'uncertain');
  assert.equal(model.exits[2].unknownFieldsText, 'Color: silver');
});

test('keeps blank identity fields distinct from zero and missing values', () => {
  const model = buildRoomDisplayModel(
    {
      roomName: '',
      areaName: 'Partial Keep',
      roomVnum: 0,
      worldTime: '',
    },
    'connected',
    defaultMap,
  );

  const roomName = model.identityFields.find((field) => field.id === 'roomName');
  const areaName = model.identityFields.find((field) => field.id === 'areaName');
  const roomVnum = model.identityFields.find((field) => field.id === 'roomVnum');
  const worldTime = model.identityFields.find((field) => field.id === 'worldTime');

  assert.equal(model.state, 'present');
  assert.equal(roomName?.availability.kind, 'empty');
  assert.equal(roomName?.valueText, 'Empty');
  assert.equal(areaName?.availability.kind, 'present');
  assert.equal(areaName?.valueText, 'Partial Keep');
  assert.equal(roomVnum?.availability.kind, 'present');
  assert.equal(roomVnum?.valueText, '0');
  assert.equal(worldTime?.availability.kind, 'empty');
});

test('uses structured ROOM fields as conservative identity fallback', () => {
  const model = buildRoomDisplayModel(
    {
      room: {
        name: 'Structured Room',
        area: 'Structured Area',
        vnum: 1001,
        terrain: 'stone',
        weather: 'windy',
      },
    },
    'connected',
    defaultMap,
  );

  assert.equal(model.state, 'present');
  assert.equal(
    model.identityFields.find((field) => field.id === 'roomName')?.valueText,
    'Structured Room',
  );
  assert.equal(
    model.identityFields.find((field) => field.id === 'areaName')?.valueText,
    'Structured Area',
  );
  assert.equal(model.identityFields.find((field) => field.id === 'roomVnum')?.valueText, '1,001');
  assert.deepEqual(
    model.details.map((detail) => detail.label),
    ['Terrain', 'Other'],
  );
  assert.equal(model.rawRoomText, undefined);
});

test('reports disabled, loading, offline, and error states distinctly', () => {
  const disabledMap: MsdpVariableMap = {
    ...defaultMap,
    room: '',
    roomName: '',
    areaName: '',
    roomVnum: '',
    roomExits: '',
    worldTime: '',
  };

  assert.equal(buildRoomDisplayModel({}, 'connected', disabledMap).state, 'disabled');
  assert.equal(buildRoomDisplayModel({}, 'connected', defaultMap).state, 'loading');
  assert.equal(buildRoomDisplayModel({}, 'idle', defaultMap).state, 'offline');
  assert.equal(buildRoomDisplayModel({}, 'disconnected', defaultMap).state, 'offline');
  assert.equal(buildRoomDisplayModel({}, 'error', defaultMap).state, 'error');
});

test('keeps raw room and malformed exit payloads bounded and explicit', () => {
  const longRawRoom = `room ${'x'.repeat(260)}`;
  const model = buildRoomDisplayModel(
    {
      room: longRawRoom,
      roomExits: 'north=??; east={vnum',
    },
    'connected',
    defaultMap,
  );

  assert.equal(model.state, 'raw');
  assert.ok(model.rawRoomText);
  assert.ok(model.rawRoomText.length <= 180);
  assert.equal(model.exits.length, 1);
  assert.equal(model.exits[0].kind, 'raw');
  assert.equal(model.exits[0].rawText, 'north=??; east={vnum');
});

test('normalizes string, array, table, object-like, scalar, and empty exits', () => {
  assert.deepEqual(
    normalizeRoomExits('east north portal down').map((exit) => exit.directionText),
    ['North', 'East', 'Down', 'Portal'],
  );

  assert.deepEqual(
    normalizeRoomExits(['west', { direction: 'south', vnum: 1002, status: 'open' }, 'north']).map(
      (exit) => [exit.directionText, exit.destinationText, exit.statusText],
    ),
    [
      ['North', undefined, undefined],
      ['South', '1,002', 'open'],
      ['West', undefined, undefined],
    ],
  );

  assert.deepEqual(
    normalizeRoomExits({
      down: 'closed',
      north: 1002,
      east: {
        vnum: 1003,
        door: 'open',
        color: 'blue',
      },
    }).map((exit) => [
      exit.directionText,
      exit.destinationText,
      exit.statusText,
      exit.unknownFieldsText,
    ]),
    [
      ['North', '1,002', undefined, undefined],
      ['East', '1,003', 'open', 'Color: blue'],
      ['Down', undefined, 'closed', undefined],
    ],
  );

  assert.deepEqual(normalizeRoomExits([]), []);
  assert.equal(normalizeRoomExits(42)[0].kind, 'raw');
});

test('room model reports explicit empty state for empty room context', () => {
  const model = buildRoomDisplayModel(
    {
      room: {},
      roomExits: [],
    },
    'connected',
    defaultMap,
  );

  assert.equal(model.state, 'empty');
  assert.equal(model.exitsAvailability.kind, 'empty');
});

test('exits can be disabled while identity fields remain present', () => {
  const exitsDisabledMap: MsdpVariableMap = { ...defaultMap, roomExits: '' };
  const model = buildRoomDisplayModel(
    {
      roomName: 'Hall of Fixtures',
      roomExits: {
        north: 1002,
      },
    },
    'connected',
    exitsDisabledMap,
  );

  assert.equal(model.state, 'present');
  assert.equal(model.exitsAvailability.kind, 'unavailable');
  assert.equal(model.exits[0].directionText, 'North');
});
