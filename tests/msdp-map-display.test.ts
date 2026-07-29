import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import type { MsdpVariableMap } from '../shared/mud.ts';
import { buildMapDisplayModel } from '../shared/msdp-map-display.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);

test('builds a deterministic room and exits fallback when MINIMAP is absent', () => {
  const model = buildMapDisplayModel(
    {
      roomName: 'Hall of Fixtures',
      areaName: 'Test Keep',
      roomVnum: 1001,
      worldTime: 'Day 12',
      roomExits: {
        south: 1003,
        north: 1002,
        portal: {
          destination: 'Astral Gate',
          status: 'uncertain',
        },
      },
    },
    'connected',
    defaultMap,
  );

  assert.equal(model.state, 'fallback');
  assert.equal(model.source, 'roomFallback');
  assert.equal(model.availability.kind, 'present');
  assert.equal(model.fallback?.headingText, 'Hall of Fixtures - Test Keep');
  assert.deepEqual(
    model.fallback?.identityFields.map((field) => [field.id, field.valueText]),
    [
      ['roomName', 'Hall of Fixtures'],
      ['areaName', 'Test Keep'],
      ['roomVnum', '1,001'],
      ['worldTime', 'Day 12'],
    ],
  );
  assert.deepEqual(
    model.fallback?.exits.map((exit) => [
      exit.directionText,
      exit.destinationText,
      exit.statusText,
    ]),
    [
      ['North', '1,002', undefined],
      ['South', '1,003', undefined],
      ['Portal', 'Astral Gate', 'uncertain'],
    ],
  );
  assert.match(model.fallback?.summaryText ?? '', /Exits: North \(1,002\), South \(1,003\)/);
  assert.equal(model.fallback?.mapper?.currentRoom.labelText, 'Hall of Fixtures');
  assert.equal(model.fallback?.mapper?.currentRoom.detailText, 'Area: Test Keep | Room #1,001');
  assert.deepEqual(model.fallback?.mapper?.sourceFields, [
    'roomName',
    'areaName',
    'roomVnum',
    'roomExits',
  ]);
  assert.deepEqual(
    model.fallback?.mapper?.branches.map((branch) => [
      branch.directionText,
      branch.placement,
      branch.destinationText,
      branch.statusText,
    ]),
    [
      ['North', 'north', '1,002', undefined],
      ['South', 'south', '1,003', undefined],
      ['Portal', 'other', 'Astral Gate', 'uncertain'],
    ],
  );
  assert.match(model.fallback?.mapper?.ariaLabel ?? '', /3 directional exits available/);
});

test('uses source-backed live MINIMAP when default mapping provides text', () => {
  const disabledMinimapMap: MsdpVariableMap = { ...defaultMap, minimap: '' };
  const disabled = buildMapDisplayModel(
    {
      minimap: 'server minimap',
    },
    'connected',
    disabledMinimapMap,
  );
  const sourceBacked = buildMapDisplayModel(
    {
      minimap: 'server minimap\n  north',
    },
    'connected',
    defaultMap,
  );

  assert.notEqual(disabled.state, 'liveOverride');
  assert.equal(disabled.state, 'loading');
  assert.equal(disabled.fallback, undefined);
  assert.equal(sourceBacked.state, 'liveOverride');
  assert.equal(sourceBacked.source, 'minimapOverride');
  assert.equal(sourceBacked.minimapText, 'server minimap\n  north');
  assert.equal(sourceBacked.fallback, undefined);
});

test('keeps disabled, loading, empty, offline, and error map states distinct', () => {
  const disabledMap: MsdpVariableMap = {
    ...defaultMap,
    room: '',
    roomName: '',
    areaName: '',
    roomVnum: '',
    roomExits: '',
    worldTime: '',
    minimap: '',
  };
  const minimapOnlyMap: MsdpVariableMap = {
    ...disabledMap,
    minimap: 'MINIMAP',
  };

  assert.equal(buildMapDisplayModel({}, 'connected', disabledMap).state, 'disabled');
  assert.equal(buildMapDisplayModel({}, 'connected', defaultMap).state, 'loading');
  assert.equal(
    buildMapDisplayModel({ minimap: '   ' }, 'connected', minimapOnlyMap).state,
    'empty',
  );
  assert.equal(
    buildMapDisplayModel({ room: {}, roomExits: [] }, 'connected', defaultMap).state,
    'empty',
  );
  assert.equal(buildMapDisplayModel({}, 'idle', defaultMap).state, 'offline');
  assert.equal(buildMapDisplayModel({}, 'disconnected', defaultMap).state, 'offline');
  assert.equal(buildMapDisplayModel({}, 'error', defaultMap).state, 'error');
});

test('preserves raw room and malformed exit fallback text without treating it as MINIMAP', () => {
  const model = buildMapDisplayModel(
    {
      room: 'Raw room description',
      roomExits: 'north=??; east={vnum',
    },
    'connected',
    defaultMap,
  );

  assert.equal(model.state, 'fallback');
  assert.equal(model.source, 'roomFallback');
  assert.equal(model.fallback?.rawRoomText, 'Raw room description');
  assert.equal(model.fallback?.exits.length, 1);
  assert.equal(model.fallback?.exits[0].kind, 'raw');
  assert.equal(model.fallback?.exits[0].rawText, 'north=??; east={vnum');
  assert.deepEqual(model.fallback?.mapper?.sourceFields, ['room']);
  assert.equal(model.fallback?.mapper?.currentRoom.labelText, 'Current room');
  assert.equal(model.fallback?.mapper?.branches.length, 0);
});

test('builds mapper branches for partial identity and preserves unknown exit fields', () => {
  const model = buildMapDisplayModel(
    {
      areaName: 'Border Hills',
      roomExits: [
        'east',
        'up',
        'out',
        {
          direction: 'southwest',
          destination: 'Ravine Trail',
          marker: 'Hidden crack',
        },
        'north=??; east={vnum',
      ],
    },
    'connected',
    defaultMap,
  );

  assert.equal(model.state, 'fallback');
  assert.equal(model.fallback?.mapper?.currentRoom.labelText, 'Current room');
  assert.equal(model.fallback?.mapper?.currentRoom.detailText, 'Area: Border Hills');
  assert.deepEqual(model.fallback?.mapper?.sourceFields, ['areaName', 'roomExits']);
  assert.deepEqual(
    model.fallback?.mapper?.branches.map((branch) => [
      branch.directionText,
      branch.placement,
      branch.destinationText,
      branch.unknownFieldsText,
    ]),
    [
      ['East', 'east', undefined, undefined],
      ['Southwest', 'southwest', 'Ravine Trail', 'Marker: Hidden crack'],
      ['Up', 'up', undefined, undefined],
      ['Out', 'out', undefined, undefined],
    ],
  );
  assert.equal(model.fallback?.exits.at(-1)?.kind, 'raw');
  assert.equal(model.fallback?.exits.at(-1)?.rawText, 'north=??; east={vnum');
});
