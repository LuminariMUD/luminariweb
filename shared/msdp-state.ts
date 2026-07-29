import type { MsdpVariableKey, MsdpVariableMap, MudState, MudValue } from './mud.ts';

export function getConfiguredMsdpVariables(msdpVariables: MsdpVariableMap) {
  return [
    ...new Set(
      Object.values(msdpVariables)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export function resolveMsdpVariableKey(
  variable: string,
  msdpVariables: MsdpVariableMap,
): MsdpVariableKey | null {
  const normalizedVariable = variable.trim();

  for (const [key, configuredVariable] of Object.entries(msdpVariables)) {
    const normalizedConfiguredVariable = configuredVariable.trim();
    if (normalizedConfiguredVariable && normalizedConfiguredVariable === normalizedVariable) {
      return key as MsdpVariableKey;
    }
  }

  return null;
}

export function mapMsdpUpdate(
  variable: string,
  value: MudValue,
  msdpVariables: MsdpVariableMap,
): Partial<MudState> {
  const key = resolveMsdpVariableKey(variable, msdpVariables);
  if (!key) {
    return {};
  }

  const partial: Partial<MudState> = {};

  switch (key) {
    case 'serverId':
      partial.serverId = toOptionalString(value);
      break;
    case 'serverTime':
      partial.serverTime = toOptionalNumber(value);
      break;
    case 'snippetVersion':
      partial.snippetVersion = toOptionalNumber(value);
      break;
    case 'characterName':
      partial.characterName = toOptionalString(value);
      break;
    case 'title':
      partial.title = toOptionalString(value);
      break;
    case 'level':
      partial.level = toOptionalNumber(value);
      break;
    case 'race':
      partial.race = toOptionalString(value);
      break;
    case 'className':
      partial.className = toOptionalString(value);
      break;
    case 'health':
      partial.health = toOptionalNumber(value);
      break;
    case 'healthMax':
      partial.healthMax = toOptionalNumber(value);
      break;
    case 'psp':
      partial.psp = toOptionalNumber(value);
      break;
    case 'pspMax':
      partial.pspMax = toOptionalNumber(value);
      break;
    case 'movement':
      partial.movement = toOptionalNumber(value);
      break;
    case 'movementMax':
      partial.movementMax = toOptionalNumber(value);
      break;
    case 'experience':
      partial.experience = toOptionalNumber(value);
      break;
    case 'experienceMax':
      partial.experienceMax = toOptionalNumber(value);
      break;
    case 'experienceTnl':
      partial.experienceTnl = toOptionalNumber(value);
      break;
    case 'strength':
      partial.strength = toOptionalNumber(value);
      break;
    case 'dexterity':
      partial.dexterity = toOptionalNumber(value);
      break;
    case 'constitution':
      partial.constitution = toOptionalNumber(value);
      break;
    case 'intelligence':
      partial.intelligence = toOptionalNumber(value);
      break;
    case 'wisdom':
      partial.wisdom = toOptionalNumber(value);
      break;
    case 'charisma':
      partial.charisma = toOptionalNumber(value);
      break;
    case 'practice':
      partial.practice = toOptionalNumber(value);
      break;
    case 'fortitude':
      partial.fortitude = toOptionalNumber(value);
      break;
    case 'reflex':
      partial.reflex = toOptionalNumber(value);
      break;
    case 'willpower':
      partial.willpower = toOptionalNumber(value);
      break;
    case 'attackBonus':
      partial.attackBonus = toOptionalNumber(value);
      break;
    case 'damageBonus':
      partial.damageBonus = toOptionalNumber(value);
      break;
    case 'armorClass':
      partial.armorClass = toOptionalNumber(value);
      break;
    case 'alignment':
      partial.alignment = toOptionalString(value);
      break;
    case 'money':
      partial.money = toOptionalNumber(value);
      break;
    case 'position':
      partial.position = toOptionalString(value);
      break;
    case 'room':
      partial.room = toStructuredValue(value);
      break;
    case 'areaName':
      partial.areaName = toOptionalString(value);
      break;
    case 'roomName':
      partial.roomName = toOptionalString(value);
      break;
    case 'roomVnum':
      partial.roomVnum = toOptionalNumber(value);
      break;
    case 'roomExits':
      partial.roomExits = toStructuredValue(value);
      break;
    case 'worldTime':
      partial.worldTime = toOptionalString(value);
      break;
    case 'actions':
      partial.actions = toListLikeValue(value);
      break;
    case 'inventory':
      partial.inventory = toListLikeValue(value);
      break;
    case 'minimap':
      partial.minimap = toOptionalString(value);
      break;
    case 'affects':
      partial.affects = toListLikeValue(value);
      break;
    case 'group':
      partial.group = toListLikeValue(value);
      break;
    case 'questInfo':
      partial.questInfo = toStructuredValue(value);
      break;
    case 'opponentName':
      partial.opponentName = toOptionalString(value);
      break;
    case 'opponentHealth':
      partial.opponentHealth = toOptionalNumber(value);
      break;
    case 'opponentHealthMax':
      partial.opponentHealthMax = toOptionalNumber(value);
      break;
    case 'tankName':
      partial.tankName = toOptionalString(value);
      break;
    case 'tankHealth':
      partial.tankHealth = toOptionalNumber(value);
      break;
    case 'tankHealthMax':
      partial.tankHealthMax = toOptionalNumber(value);
      break;
    default:
      assertNever(key);
  }

  return partial;
}

function toOptionalNumber(value: MudValue) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return Number(value);
  }

  return undefined;
}

function toOptionalString(value: MudValue) {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return undefined;
}

function toStructuredValue(value: MudValue) {
  return value;
}

function toListLikeValue(value: MudValue) {
  return value;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled MSDP variable key: ${String(value)}`);
}
