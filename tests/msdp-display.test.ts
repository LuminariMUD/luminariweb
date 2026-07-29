import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCharacterDisplayModel,
  buildCoreDisplayModel,
  buildHudBarModels,
  clampPercentage,
  formatDisplayNumber,
  formatSignedDisplayNumber,
  normalizeDisplayNumber,
} from '../shared/msdp-display.ts';
import { buildActionEconomyModel, buildCombatDisplayModel } from '../shared/msdp-combat-display.ts';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import type { MudState } from '../shared/mud.ts';

const defaultMap = normalizeMsdpVariableMap(defaultMsdpVariables);

test('normalizes finite integers while rejecting missing and invalid numeric values', () => {
  assert.equal(normalizeDisplayNumber(0), 0);
  assert.equal(normalizeDisplayNumber(-7), -7);
  assert.equal(normalizeDisplayNumber('42'), 42);
  assert.equal(normalizeDisplayNumber('-13'), -13);
  assert.equal(normalizeDisplayNumber('not-a-number'), undefined);
  assert.equal(normalizeDisplayNumber('3.14'), undefined);
  assert.equal(normalizeDisplayNumber(Number.NaN), undefined);
  assert.equal(normalizeDisplayNumber(Number.POSITIVE_INFINITY), undefined);
  assert.equal(normalizeDisplayNumber(undefined), undefined);
});

test('formats unsigned and signed display numbers deterministically', () => {
  assert.equal(formatDisplayNumber(0), '0');
  assert.equal(formatDisplayNumber(12345), '12,345');
  assert.equal(formatSignedDisplayNumber(7), '+7');
  assert.equal(formatSignedDisplayNumber(0), '0');
  assert.equal(formatSignedDisplayNumber(-2), '-2');
  assert.equal(formatSignedDisplayNumber('bad'), undefined);
});

test('clamps percentages for zero, negative, missing, and over-max values', () => {
  assert.equal(clampPercentage(0, 100), 0);
  assert.equal(clampPercentage(-10, 100), 0);
  assert.equal(clampPercentage(25, 100), 25);
  assert.equal(clampPercentage(150, 100), 100);
  assert.equal(clampPercentage(25, 0), 0);
  assert.equal(clampPercentage(25, undefined), 0);
  assert.equal(clampPercentage(undefined, 100), 0);
});

test('builds HUD bars with zero values, missing max values, and XP/TNL progress', () => {
  const bars = buildHudBarModels(
    {
      health: 0,
      healthMax: 120,
      psp: 34,
      movement: 91,
      movementMax: 110,
      experience: 451200,
      experienceMax: 500000,
      experienceTnl: 48800,
    },
    'connected',
  );

  assert.deepEqual(
    bars.map((bar) => ({
      id: bar.id,
      valueText: bar.valueText,
      percentage: Math.round(bar.percentage),
      kind: bar.availability.kind,
    })),
    [
      { id: 'health', valueText: '0 / 120', percentage: 0, kind: 'present' },
      { id: 'psp', valueText: '34', percentage: 0, kind: 'present' },
      { id: 'movement', valueText: '91 / 110', percentage: 83, kind: 'present' },
      {
        id: 'experience',
        valueText: '451,200 / 500,000 (48,800 TNL)',
        percentage: 90,
        kind: 'present',
      },
    ],
  );
  assert.match(bars[1].ariaLabel, /Maximum not reported/);
});

test('uses explicit loading, offline, and error states for missing HUD values', () => {
  assert.equal(buildHudBarModels({}, 'connected')[0].valueText, 'Waiting');
  assert.equal(buildHudBarModels({}, 'connected')[0].availability.kind, 'loading');
  assert.equal(buildHudBarModels({}, 'disconnected')[0].valueText, 'Offline');
  assert.equal(buildHudBarModels({}, 'disconnected')[0].availability.kind, 'offline');
  assert.equal(buildHudBarModels({}, 'error')[0].valueText, 'Unavailable');
  assert.equal(buildHudBarModels({}, 'error')[0].availability.kind, 'error');
});

test('builds character fields from confirmed values and preserves zero and negative numbers', () => {
  const character = buildCharacterDisplayModel(
    {
      characterName: 'Fixture Hero',
      level: 17,
      race: 'Human',
      className: 'Wizard',
      position: 'fighting',
      alignment: 'neutral good',
      money: 0,
      practice: 3,
      attackBonus: -2,
      armorClass: 0,
      strength: 10,
      dexterity: 11,
      constitution: 12,
      intelligence: 18,
      wisdom: 16,
      charisma: 14,
    },
    'connected',
    defaultMap,
  );

  assert.equal(character.identity.headingText, 'Fixture Hero');
  assert.equal(character.identity.profileText, 'Level 17 | Human | Wizard');
  assert.equal(findField(character.stats, 'Money').valueText, '0');
  assert.equal(findField(character.stats, 'Attack').valueText, '-2');
  assert.equal(findField(character.stats, 'Armor Class').valueText, '0');
  assert.equal(findField(character.abilityScores, 'INT').valueText, '18');
});

test('keeps missing selected values and deferred damage bonus explicit by default', () => {
  const character = buildCoreDisplayModel(
    { characterName: 'Fixture Hero' },
    'connected',
    defaultMap,
  ).character;

  assert.equal(character.identity.titleNotice?.kind, 'loading');
  assert.equal(character.identity.titleNotice?.title, 'Waiting for title');
  assert.equal(findField(character.savingThrows, 'Fort').notice?.kind, 'loading');
  assert.equal(findField(character.savingThrows, 'Refl').notice?.kind, 'loading');
  assert.equal(findField(character.savingThrows, 'Will').notice?.kind, 'loading');
  assert.equal(findField(character.stats, 'Damage').notice?.kind, 'unavailable');
});

test('keeps disabled selected mappings distinct from configured deferred overrides', () => {
  const disabledSelectedMap = {
    ...defaultMap,
    title: '',
    fortitude: '',
    reflex: '',
    willpower: '',
    damageBonus: 'DAMAGE_BONUS',
  };
  const character = buildCharacterDisplayModel({}, 'connected', disabledSelectedMap);

  assert.equal(character.identity.titleNotice?.kind, 'unavailable');
  assert.equal(character.identity.titleNotice?.title, 'Title mapping disabled');
  assert.equal(findField(character.savingThrows, 'Fort').notice?.kind, 'unavailable');
  assert.equal(findField(character.stats, 'Damage').notice?.kind, 'loading');
});

test('renders reported selected and override-only values when present', () => {
  const overrideState: MudState = {
    title: 'the Brave',
    fortitude: 9,
    damageBonus: 4,
  };
  const character = buildCharacterDisplayModel(overrideState, 'connected', defaultMap);

  assert.equal(character.identity.headingText, 'the Brave');
  assert.equal(character.identity.titleNotice, undefined);
  assert.equal(findField(character.savingThrows, 'Fort').valueText, '+9');
  assert.equal(findField(character.stats, 'Damage').valueText, '+4');
});

test('builds combat participant models from opponent and tank values', () => {
  const combat = buildCombatDisplayModel(
    {
      opponentName: 'training dummy',
      opponentHealth: 0,
      opponentHealthMax: 100,
      tankName: 'Shield Ally',
      tankHealth: 150,
      tankHealthMax: 100,
    },
    'connected',
    defaultMap,
  );

  assert.equal(combat.opponent.nameText, 'training dummy');
  assert.equal(combat.opponent.valueText, '0 / 100');
  assert.equal(combat.opponent.percentage, 0);
  assert.equal(combat.opponent.availability.kind, 'present');
  assert.equal(combat.tank.nameText, 'Shield Ally');
  assert.equal(combat.tank.valueText, '150 / 100');
  assert.equal(combat.tank.percentage, 100);
});

test('keeps partial and empty combat participant states explicit', () => {
  const partial = buildCombatDisplayModel(
    {
      opponentName: 'sparring shade',
      opponentHealth: 0,
      tankHealth: 50,
    },
    'connected',
    defaultMap,
  );

  assert.equal(partial.opponent.nameText, 'sparring shade');
  assert.equal(partial.opponent.valueText, '0');
  assert.equal(partial.opponent.percentage, 0);
  assert.equal(partial.tank.nameText, 'Unknown tank');
  assert.equal(partial.tank.valueText, '50');
  assert.equal(partial.tank.availability.kind, 'present');

  const emptyNames = buildCombatDisplayModel(
    {
      opponentName: '',
      tankName: '',
    },
    'connected',
    defaultMap,
  );

  assert.equal(emptyNames.opponent.availability.kind, 'empty');
  assert.equal(emptyNames.tank.availability.kind, 'empty');
});

test('uses quiet inactive, offline, and error combat availability states', () => {
  assert.equal(
    buildCombatDisplayModel({}, 'connected', defaultMap).opponent.availability.kind,
    'empty',
  );
  assert.equal(
    buildCombatDisplayModel({}, 'connected', defaultMap).tank.availability.kind,
    'empty',
  );
  assert.equal(
    buildCombatDisplayModel({}, 'disconnected', defaultMap).opponent.valueText,
    'Offline',
  );
  assert.equal(
    buildCombatDisplayModel({}, 'disconnected', defaultMap).actions.availability.kind,
    'offline',
  );
  assert.equal(buildCombatDisplayModel({}, 'error', defaultMap).tank.valueText, 'Unavailable');
  assert.equal(buildCombatDisplayModel({}, 'error', defaultMap).actions.availability.kind, 'error');
});

test('builds action economy entries for arrays, mixed records, objects, and raw values', () => {
  const mixed = buildActionEconomyModel(
    ['standard', { name: 'quick draw', cost: 1 }, 3, true],
    'connected',
  );

  assert.equal(mixed.availability.kind, 'present');
  assert.deepEqual(
    mixed.entries.map((entry) => ({
      label: entry.label,
      valueText: entry.valueText,
      detailText: entry.detailText,
      kind: entry.kind,
    })),
    [
      { label: 'Action 1', valueText: 'standard', detailText: undefined, kind: 'text' },
      { label: 'Action 2', valueText: 'quick draw', detailText: 'Cost: 1', kind: 'record' },
      { label: 'Action 3', valueText: '3', detailText: undefined, kind: 'raw' },
      { label: 'Action 4', valueText: 'Yes', detailText: undefined, kind: 'raw' },
    ],
  );

  const object = buildActionEconomyModel({ standard: 'available', move: 'spent' }, 'connected');

  assert.deepEqual(
    object.entries.map((entry) => [entry.label, entry.valueText]),
    [
      ['Standard', 'available'],
      ['Move', 'spent'],
    ],
  );
});

test('keeps empty and missing action payloads distinct', () => {
  assert.equal(buildActionEconomyModel(undefined, 'connected').availability.kind, 'loading');
  assert.equal(buildActionEconomyModel([], 'connected').availability.kind, 'empty');
  assert.equal(buildActionEconomyModel('', 'connected').availability.kind, 'empty');
  assert.equal(buildActionEconomyModel(null, 'connected').availability.kind, 'empty');
});

test('keeps combat damage bonus override-only by default', () => {
  const defaultCombat = buildCombatDisplayModel({}, 'connected', defaultMap);
  assert.equal(defaultCombat.damageBonus.availability.kind, 'unavailable');
  assert.equal(defaultCombat.damageBonus.valueText, 'Damage bonus unconfirmed');

  const overrideMap = normalizeMsdpVariableMap({
    ...defaultMsdpVariables,
    damageBonus: 'DAMAGE_BONUS',
  });
  const waitingCombat = buildCombatDisplayModel({}, 'connected', overrideMap);
  assert.equal(waitingCombat.damageBonus.availability.kind, 'loading');

  const reportedCombat = buildCombatDisplayModel({ damageBonus: 4 }, 'connected', overrideMap);
  assert.equal(reportedCombat.damageBonus.availability.kind, 'present');
  assert.equal(reportedCombat.damageBonus.valueText, '+4');
});

function findField(fields: Array<{ label: string }>, label: string) {
  const field = fields.find((entry) => entry.label === label);
  assert.ok(field, `Expected field ${label}`);
  return field as (typeof fields)[number] & {
    valueText: string;
    notice?: { kind: string };
  };
}
