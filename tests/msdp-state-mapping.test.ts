import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import { mapMsdpUpdate } from '../shared/msdp-state.ts';
import { loadMsdpFixtureCorpus } from './helpers/msdp-fixtures.ts';
import type { MsdpVariableMap, MudState, MudValue } from '../shared/mud.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);

test('maps metadata and character scalar fields', () => {
  assert.deepEqual(
    mapPairs([
      ['SERVER_ID', 'LuminariMUD'],
      ['SERVER_TIME', 1710000000],
      ['SNIPPET_VERSION', 8],
      ['CHARACTER_NAME', 'Fixture Tester'],
      ['TITLE', 'the Careful'],
      ['LEVEL', '17'],
      ['RACE', 'human'],
      ['CLASS', 'wizard'],
      ['STR', 10],
      ['DEX', 11],
      ['CON', 12],
      ['INT', 18],
      ['WIS', 16],
      ['CHA', 14],
      ['FORTITUDE', -2],
      ['REFLEX', 0],
      ['WILLPOWER', 12],
    ]),
    {
      serverId: 'LuminariMUD',
      serverTime: 1710000000,
      snippetVersion: 8,
      characterName: 'Fixture Tester',
      title: 'the Careful',
      level: 17,
      race: 'human',
      className: 'wizard',
      strength: 10,
      dexterity: 11,
      constitution: 12,
      intelligence: 18,
      wisdom: 16,
      charisma: 14,
      fortitude: -2,
      reflex: 0,
      willpower: 12,
    },
  );
});

test('maps resources, combat, economy, position, and zero values', () => {
  assert.deepEqual(
    mapPairs([
      ['HEALTH', '0'],
      ['HEALTH_MAX', 120],
      ['PSP', 34],
      ['PSP_MAX', 44],
      ['MOVEMENT', 91],
      ['MOVEMENT_MAX', 110],
      ['EXPERIENCE', 451200],
      ['EXPERIENCE_MAX', 500000],
      ['EXPERIENCE_TNL', 48800],
      ['ATTACK_BONUS', -2],
      ['AC', 0],
      ['OPPONENT_NAME', 'training dummy'],
      ['OPPONENT_HEALTH', 25],
      ['OPPONENT_HEALTH_MAX', 100],
      ['TANK_NAME', 'Shield Ally'],
      ['TANK_HEALTH', 80],
      ['TANK_HEALTH_MAX', 100],
      ['MONEY', 12345],
      ['PRACTICE', 7],
      ['POSITION', 'fighting'],
      ['ALIGNMENT', 'neutral good'],
    ]),
    {
      health: 0,
      healthMax: 120,
      psp: 34,
      pspMax: 44,
      movement: 91,
      movementMax: 110,
      experience: 451200,
      experienceMax: 500000,
      experienceTnl: 48800,
      attackBonus: -2,
      armorClass: 0,
      opponentName: 'training dummy',
      opponentHealth: 25,
      opponentHealthMax: 100,
      tankName: 'Shield Ally',
      tankHealth: 80,
      tankHealthMax: 100,
      money: 12345,
      practice: 7,
      position: 'fighting',
      alignment: 'neutral good',
    },
  );
});

test('maps core panel scalar fixture into confirmed MudState fields', async () => {
  const corpus = await loadMsdpFixtureCorpus();
  const fixture = corpus.fixtures.find((entry) => entry.id === 'core.panel.confirmed.scalars');

  assert.ok(fixture, 'core.panel.confirmed.scalars fixture should exist');
  assert.deepEqual(mapPairs(fixture.expectedPairs, defaultMap), {
    characterName: 'Fixture Hero',
    title: 'of the Test Keep',
    level: 17,
    race: 'Human',
    className: 'Wizard',
    position: 'fighting',
    alignment: 'neutral good',
    money: 0,
    practice: 3,
    health: 0,
    healthMax: 120,
    psp: 34,
    pspMax: 44,
    movement: 91,
    movementMax: 110,
    fortitude: -2,
    reflex: 0,
    willpower: 12,
    experience: 451200,
    experienceMax: 500000,
    experienceTnl: 48800,
    attackBonus: -2,
    armorClass: 0,
  });
});

test('maps combat participant fixture variants without dropping partial or empty values', async () => {
  const corpus = await loadMsdpFixtureCorpus();
  const fixtureIds = [
    'combat.opponent.and.tank',
    'combat.opponent.partial.zero',
    'combat.empty.names',
  ];

  const mappedByFixture = Object.fromEntries(
    fixtureIds.map((fixtureId) => {
      const fixture = corpus.fixtures.find((entry) => entry.id === fixtureId);
      assert.ok(fixture, `${fixtureId} fixture should exist`);
      return [fixtureId, mapPairs(fixture.expectedPairs, defaultMap)];
    }),
  );

  assert.deepEqual(mappedByFixture['combat.opponent.and.tank'], {
    opponentName: 'training dummy',
    opponentHealth: 25,
    opponentHealthMax: 100,
    tankName: 'Shield Ally',
    tankHealth: 80,
    tankHealthMax: 100,
    attackBonus: 7,
    armorClass: -4,
  });
  assert.deepEqual(mappedByFixture['combat.opponent.partial.zero'], {
    opponentName: 'sparring shade',
    opponentHealth: 0,
    tankName: 'Front Line',
    tankHealth: 50,
  });
  assert.deepEqual(mappedByFixture['combat.empty.names'], {
    opponentName: '',
    tankName: '',
  });
});

test('maps nonnumeric numeric values to undefined fields', () => {
  assert.deepEqual(mapMsdpUpdate('HEALTH', 'bad-value', defaultMap), { health: undefined });
  assert.deepEqual(mapMsdpUpdate('SERVER_TIME', { time: 1 }, defaultMap), {
    serverTime: undefined,
  });
});

test('maps ACTIONS arrays, empty collections, mixed entries, and object payloads conservatively', () => {
  const emptyActions: MudValue = [];
  const mixedActions: MudValue = ['standard', { name: 'quick draw', cost: 1 }];
  const objectActions: MudValue = { standard: 'available', move: 'spent' };

  assert.deepEqual(mapMsdpUpdate('ACTIONS', emptyActions, defaultMap), {
    actions: emptyActions,
  });
  assert.deepEqual(mapMsdpUpdate('ACTIONS', mixedActions, defaultMap), {
    actions: mixedActions,
  });
  assert.deepEqual(mapMsdpUpdate('ACTIONS', objectActions, defaultMap), {
    actions: objectActions,
  });
  assert.deepEqual(mapMsdpUpdate('DAMAGE_BONUS', 3, defaultMap), {});
});

test('preserves structured room and collection payloads without lossy coercion', () => {
  const room = {
    name: 'Hall of Fixtures',
    exits: {
      north: 1002,
      east: 'closed',
    },
  };
  const exits = {
    north: 1002,
    down: 'closed',
  };
  const actions = ['standard', { name: 'quick draw', cost: 1 }];
  const inventory = {
    worn: ['practice robe'],
    carried: {
      torch: 2,
    },
  };
  const affects = [
    {
      name: 'haste',
      duration: 3,
    },
  ];
  const group = [
    {
      name: 'Fixture Ally',
      health: 42,
    },
  ];
  const questInfo = {
    title: 'Synthetic Quest',
    steps: ['start', 'finish'],
  };
  const overrideMap = withOverrides({ questInfo: 'QUEST_INFO' });

  assert.deepEqual(mapMsdpUpdate('ROOM', room, defaultMap), { room });
  assert.deepEqual(mapMsdpUpdate('ROOM_EXITS', exits, defaultMap), { roomExits: exits });
  assert.deepEqual(mapMsdpUpdate('ACTIONS', actions, defaultMap), { actions });
  assert.deepEqual(mapMsdpUpdate('INVENTORY', inventory, defaultMap), { inventory });
  assert.deepEqual(mapMsdpUpdate('AFFECTS', affects, defaultMap), { affects });
  assert.deepEqual(mapMsdpUpdate('GROUP', group, defaultMap), { group });
  assert.deepEqual(mapMsdpUpdate('QUEST_INFO', questInfo, overrideMap), { questInfo });
});

test('preserves room fixture variants and ignores disabled room mappings', async () => {
  const corpus = await loadMsdpFixtureCorpus();
  const scalarIdentity = readFixturePairs(corpus.fixtures, 'room.scalar.identity');
  const partialIdentity = readFixturePairs(corpus.fixtures, 'room.partial.identity');
  const stringExits = readFixturePairValue(corpus.fixtures, 'room.exits.string', 'ROOM_EXITS');
  const arrayExits = readFixturePairValue(corpus.fixtures, 'room.exits.array', 'ROOM_EXITS');
  const tableExits = readFixturePairValue(corpus.fixtures, 'room.exits.table', 'ROOM_EXITS');
  const objectExits = readFixturePairValue(
    corpus.fixtures,
    'room.exits.object.unknown',
    'ROOM_EXITS',
  );
  const emptyRoom = readFixturePairValue(corpus.fixtures, 'room.empty.values', 'ROOM');
  const emptyExits = readFixturePairValue(corpus.fixtures, 'room.empty.values', 'ROOM_EXITS');
  const roomUnknown = readFixturePairValue(corpus.fixtures, 'room.room.partial.unknown', 'ROOM');
  const malformedScalar = readFixturePairValue(
    corpus.fixtures,
    'room.exits.malformed.scalar',
    'ROOM_EXITS',
  );
  const minimap = readFixturePairValue(corpus.fixtures, 'room.minimap.scalar', 'MINIMAP');
  const disabledMap: MsdpVariableMap = {
    ...defaultMap,
    room: '',
    areaName: '',
    roomName: '',
    roomVnum: '',
    roomExits: '',
    worldTime: '',
    minimap: '',
  };

  assert.deepEqual(mapPairs(scalarIdentity, defaultMap), {
    roomName: 'Hall of Fixtures',
    areaName: 'Test Keep',
    roomVnum: 1001,
  });
  assert.deepEqual(mapPairs(partialIdentity, defaultMap), {
    roomName: '',
    areaName: 'Partial Keep',
    roomVnum: 0,
    worldTime: '',
  });
  assert.deepEqual(mapMsdpUpdate('ROOM_EXITS', stringExits, defaultMap), {
    roomExits: stringExits,
  });
  assert.deepEqual(mapMsdpUpdate('ROOM_EXITS', arrayExits, defaultMap), {
    roomExits: arrayExits,
  });
  assert.deepEqual(mapMsdpUpdate('ROOM_EXITS', tableExits, defaultMap), {
    roomExits: tableExits,
  });
  assert.deepEqual(mapMsdpUpdate('ROOM_EXITS', objectExits, defaultMap), {
    roomExits: objectExits,
  });
  assert.deepEqual(mapMsdpUpdate('ROOM', emptyRoom, defaultMap), { room: emptyRoom });
  assert.deepEqual(mapMsdpUpdate('ROOM_EXITS', emptyExits, defaultMap), { roomExits: emptyExits });
  assert.deepEqual(mapMsdpUpdate('ROOM', roomUnknown, defaultMap), { room: roomUnknown });
  assert.deepEqual(mapMsdpUpdate('ROOM_EXITS', malformedScalar, defaultMap), {
    roomExits: malformedScalar,
  });
  assert.deepEqual(mapMsdpUpdate('MINIMAP', minimap, defaultMap), { minimap });
  assert.deepEqual(mapPairs(scalarIdentity, disabledMap), {});
  assert.deepEqual(mapMsdpUpdate('ROOM_EXITS', objectExits, disabledMap), {});
  assert.deepEqual(mapMsdpUpdate('MINIMAP', minimap, disabledMap), {});
});

test('preserves GROUP fixture variants and ignores disabled GROUP mappings', async () => {
  const corpus = await loadMsdpFixtureCorpus();
  const fullMembers = readFixtureValue(corpus.fixtures, 'group.full.members');
  const partialMembers = readFixtureValue(corpus.fixtures, 'group.partial.member');
  const emptyGroup = readFixtureValue(corpus.fixtures, 'group.empty.collection');
  const objectPayload = readFixtureValue(corpus.fixtures, 'group.object.payload');
  const disabledMap: MsdpVariableMap = { ...defaultMap, group: '' };

  assert.deepEqual(mapMsdpUpdate('GROUP', fullMembers, defaultMap), { group: fullMembers });
  assert.deepEqual(mapMsdpUpdate('GROUP', partialMembers, defaultMap), { group: partialMembers });
  assert.deepEqual(mapMsdpUpdate('GROUP', emptyGroup, defaultMap), { group: emptyGroup });
  assert.deepEqual(mapMsdpUpdate('GROUP', objectPayload, defaultMap), { group: objectPayload });
  assert.deepEqual(mapMsdpUpdate('GROUP', fullMembers, disabledMap), {});
});

test('preserves AFFECTS and INVENTORY fixture variants and ignores disabled mappings', async () => {
  const corpus = await loadMsdpFixtureCorpus();
  const fullAffects = readFixturePairValue(
    corpus.fixtures,
    'collections.affects.full.modifiers',
    'AFFECTS',
  );
  const partialAffects = readFixturePairValue(
    corpus.fixtures,
    'collections.affects.partial.unknown',
    'AFFECTS',
  );
  const objectAffects = readFixturePairValue(
    corpus.fixtures,
    'collections.affects.object.payload',
    'AFFECTS',
  );
  const emptyAffects = readFixturePairValue(corpus.fixtures, 'collections.empty.values', 'AFFECTS');
  const itemInventory = readFixturePairValue(
    corpus.fixtures,
    'collections.inventory.items.array',
    'INVENTORY',
  );
  const objectInventory = readFixturePairValue(
    corpus.fixtures,
    'collections.inventory.object.unknown',
    'INVENTORY',
  );
  const rawInventory = readFixturePairValue(
    corpus.fixtures,
    'collections.inventory.raw.string',
    'INVENTORY',
  );
  const emptyInventory = readFixturePairValue(
    corpus.fixtures,
    'collections.empty.values',
    'INVENTORY',
  );
  const disabledMap: MsdpVariableMap = { ...defaultMap, affects: '', inventory: '' };

  assert.deepEqual(mapMsdpUpdate('AFFECTS', fullAffects, defaultMap), { affects: fullAffects });
  assert.deepEqual(mapMsdpUpdate('AFFECTS', partialAffects, defaultMap), {
    affects: partialAffects,
  });
  assert.deepEqual(mapMsdpUpdate('AFFECTS', objectAffects, defaultMap), {
    affects: objectAffects,
  });
  assert.deepEqual(mapMsdpUpdate('AFFECTS', emptyAffects, defaultMap), { affects: emptyAffects });
  assert.deepEqual(mapMsdpUpdate('AFFECTS', 'raw affects text', defaultMap), {
    affects: 'raw affects text',
  });
  assert.deepEqual(mapMsdpUpdate('AFFECTS', fullAffects, disabledMap), {});

  assert.deepEqual(mapMsdpUpdate('INVENTORY', itemInventory, defaultMap), {
    inventory: itemInventory,
  });
  assert.deepEqual(mapMsdpUpdate('INVENTORY', objectInventory, defaultMap), {
    inventory: objectInventory,
  });
  assert.deepEqual(mapMsdpUpdate('INVENTORY', rawInventory, defaultMap), {
    inventory: rawInventory,
  });
  assert.deepEqual(mapMsdpUpdate('INVENTORY', emptyInventory, defaultMap), {
    inventory: emptyInventory,
  });
  assert.deepEqual(mapMsdpUpdate('INVENTORY', itemInventory, disabledMap), {});
});

test('maps selected source-backed variables and ignores deferred defaults', () => {
  assert.deepEqual(mapMsdpUpdate('UNKNOWN_VARIABLE', 1, defaultMap), {});
  assert.deepEqual(mapMsdpUpdate('TITLE', 'the brave', defaultMap), { title: 'the brave' });
  assert.deepEqual(mapMsdpUpdate('FORTITUDE', 10, defaultMap), { fortitude: 10 });
  assert.deepEqual(mapMsdpUpdate('REFLEX', 0, defaultMap), { reflex: 0 });
  assert.deepEqual(mapMsdpUpdate('WILLPOWER', -1, defaultMap), { willpower: -1 });
  assert.deepEqual(mapMsdpUpdate('MINIMAP', 'map text', defaultMap), { minimap: 'map text' });
  assert.deepEqual(mapMsdpUpdate('DAMAGE_BONUS', 3, defaultMap), {});
  assert.deepEqual(mapMsdpUpdate('QUEST_INFO', { title: 'ignored' }, defaultMap), {});
});

test('maps deferred variables when settings explicitly configure them', () => {
  const overrideMap = withOverrides({
    damageBonus: 'DAMAGE_BONUS',
    questInfo: 'QUEST_INFO',
  });
  const questInfo = {
    title: 'Override Quest',
    complete: false,
  };

  assert.deepEqual(
    mapPairs(
      [
        ['DAMAGE_BONUS', 4],
        ['QUEST_INFO', questInfo],
      ],
      overrideMap,
    ),
    {
      damageBonus: 4,
      questInfo,
    },
  );
});

function mapPairs(
  pairs: Array<readonly [string, MudValue]>,
  variables = defaultMap,
): Partial<MudState> {
  return Object.assign(
    {},
    ...pairs.map(([variable, value]) => mapMsdpUpdate(variable, value, variables)),
  ) as Partial<MudState>;
}

function withOverrides(overrides: Partial<MsdpVariableMap>) {
  return normalizeMsdpVariableMap({
    ...defaultMsdpVariables,
    ...overrides,
  });
}

function readFixtureValue(
  fixtures: Awaited<ReturnType<typeof loadMsdpFixtureCorpus>>['fixtures'],
  fixtureId: string,
) {
  const fixture = fixtures.find((entry) => entry.id === fixtureId);
  assert.ok(fixture, `${fixtureId} fixture should exist`);
  const groupPair = fixture.expectedPairs.find(([variable]) => variable === 'GROUP');
  assert.ok(groupPair, `${fixtureId} should contain a GROUP expected pair`);
  return groupPair[1];
}

function readFixturePairs(
  fixtures: Awaited<ReturnType<typeof loadMsdpFixtureCorpus>>['fixtures'],
  fixtureId: string,
) {
  const fixture = fixtures.find((entry) => entry.id === fixtureId);
  assert.ok(fixture, `${fixtureId} fixture should exist`);
  return fixture.expectedPairs;
}

function readFixturePairValue(
  fixtures: Awaited<ReturnType<typeof loadMsdpFixtureCorpus>>['fixtures'],
  fixtureId: string,
  variableName: string,
) {
  const fixture = fixtures.find((entry) => entry.id === fixtureId);
  assert.ok(fixture, `${fixtureId} fixture should exist`);
  const pair = fixture.expectedPairs.find(([variable]) => variable === variableName);
  assert.ok(pair, `${fixtureId} should contain a ${variableName} expected pair`);
  return pair[1];
}
