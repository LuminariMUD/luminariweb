import type {
  OnboardingActionMessage,
  OnboardingFallbackMessage,
  OnboardingStateMessage,
  SensitiveInputMessage,
} from './onboarding.ts';
import type {
  EditorContentChunkMessage,
  EditorContentCompleteMessage,
  EditorTransferClientMessage,
  EditorTransferResultMessage,
} from './onboarding-transfer.ts';

export type MudValue =
  | string
  | number
  | boolean
  | null
  | MudValue[]
  | {
      [key: string]: MudValue;
    };

export interface MudState {
  characterName?: string;
  title?: string;
  serverId?: string;
  serverTime?: number;
  snippetVersion?: number;
  level?: number;
  race?: string;
  className?: string;
  health?: number;
  healthMax?: number;
  psp?: number;
  pspMax?: number;
  movement?: number;
  movementMax?: number;
  experience?: number;
  experienceMax?: number;
  experienceTnl?: number;
  attackBonus?: number;
  damageBonus?: number;
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
  fortitude?: number;
  reflex?: number;
  willpower?: number;
  armorClass?: number;
  alignment?: string;
  practice?: number;
  money?: number;
  position?: string;
  room?: MudValue;
  roomName?: string;
  areaName?: string;
  roomVnum?: number;
  roomExits?: MudValue;
  roomCoords?: {
    x?: number;
    y?: number;
    z?: number;
  };
  roomTerrain?: string;
  roomEnvironment?: string;
  automap?: string;
  minimap?: string;
  worldTime?: string;
  actions?: MudValue;
  inventory?: MudValue;
  affects?: MudValue;
  group?: MudValue;
  questInfo?: MudValue;
  opponentName?: string;
  opponentHealth?: number;
  opponentHealthMax?: number;
  tankName?: string;
  tankHealth?: number;
  tankHealthMax?: number;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type TerminalDimensions = {
  columns: number;
  rows: number;
};

export const terminalDimensionBounds = {
  columns: {
    min: 20,
    max: 65535,
  },
  rows: {
    min: 5,
    max: 65535,
  },
} as const;

export const defaultMsdpVariables = {
  serverId: 'SERVER_ID',
  serverTime: 'SERVER_TIME',
  snippetVersion: 'SNIPPET_VERSION',
  characterName: 'CHARACTER_NAME',
  title: 'TITLE',
  level: 'LEVEL',
  race: 'RACE',
  className: 'CLASS',
  position: 'POSITION',
  alignment: 'ALIGNMENT',
  money: 'MONEY',
  practice: 'PRACTICE',
  health: 'HEALTH',
  healthMax: 'HEALTH_MAX',
  psp: 'PSP',
  pspMax: 'PSP_MAX',
  movement: 'MOVEMENT',
  movementMax: 'MOVEMENT_MAX',
  experience: 'EXPERIENCE',
  experienceMax: 'EXPERIENCE_MAX',
  experienceTnl: 'EXPERIENCE_TNL',
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
  fortitude: 'FORTITUDE',
  reflex: 'REFLEX',
  willpower: 'WILLPOWER',
  attackBonus: 'ATTACK_BONUS',
  damageBonus: '',
  armorClass: 'AC',
  room: 'ROOM',
  areaName: 'AREA_NAME',
  roomName: 'ROOM_NAME',
  roomVnum: 'ROOM_VNUM',
  roomExits: 'ROOM_EXITS',
  worldTime: 'WORLD_TIME',
  actions: 'ACTIONS',
  inventory: 'INVENTORY',
  affects: 'AFFECTS',
  group: 'GROUP',
  minimap: 'MINIMAP',
  questInfo: '',
  opponentName: 'OPPONENT_NAME',
  opponentHealth: 'OPPONENT_HEALTH',
  opponentHealthMax: 'OPPONENT_HEALTH_MAX',
  tankName: 'TANK_NAME',
  tankHealth: 'TANK_HEALTH',
  tankHealthMax: 'TANK_HEALTH_MAX',
} as const;

export type MsdpVariableKey = keyof typeof defaultMsdpVariables;
export type MsdpVariableMap = Record<MsdpVariableKey, string>;

export const msdpVariableKeys = Object.keys(defaultMsdpVariables) as MsdpVariableKey[];

export const confirmedMsdpVariableKeys = [
  'serverId',
  'serverTime',
  'snippetVersion',
  'characterName',
  'title',
  'level',
  'race',
  'className',
  'position',
  'alignment',
  'money',
  'practice',
  'health',
  'healthMax',
  'psp',
  'pspMax',
  'movement',
  'movementMax',
  'experience',
  'experienceMax',
  'experienceTnl',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
  'fortitude',
  'reflex',
  'willpower',
  'attackBonus',
  'armorClass',
  'room',
  'areaName',
  'roomName',
  'roomVnum',
  'roomExits',
  'worldTime',
  'actions',
  'inventory',
  'affects',
  'group',
  'minimap',
  'opponentName',
  'opponentHealth',
  'opponentHealthMax',
  'tankName',
  'tankHealth',
  'tankHealthMax',
] as const satisfies readonly MsdpVariableKey[];

export const optionalMsdpVariableKeys = [
  'title',
  'fortitude',
  'reflex',
  'willpower',
  'practice',
  'room',
  'areaName',
  'roomName',
  'roomVnum',
  'roomExits',
  'worldTime',
  'actions',
  'inventory',
  'affects',
  'group',
  'minimap',
] as const satisfies readonly MsdpVariableKey[];

export const overrideOnlyMsdpVariableKeys = [
  'damageBonus',
  'questInfo',
] as const satisfies readonly MsdpVariableKey[];

export function normalizeMsdpVariableMap(value: unknown): MsdpVariableMap {
  const raw = isObjectRecord(value) ? value : {};
  const normalized = {} as MsdpVariableMap;

  for (const key of msdpVariableKeys) {
    normalized[key] = normalizeMsdpVariableValue(raw[key], defaultMsdpVariables[key]);
  }

  return normalized;
}

function normalizeMsdpVariableValue(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (trimmed) {
    return trimmed;
  }

  return fallback === '' ? '' : fallback;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type ClientMessage =
  | {
      type: 'connect';
      host: string;
      port: number;
      msdpVariables: MsdpVariableMap;
    }
  | {
      type: 'disconnect';
    }
  | {
      type: 'input';
      text: string;
    }
  | {
      type: 'resize';
      columns: number;
      rows: number;
    }
  | {
      type: 'msdp-config';
      msdpVariables: MsdpVariableMap;
    }
  | {
      type: 'heartbeat';
    }
  | OnboardingActionMessage
  | EditorTransferClientMessage;

export type ServerMessage =
  | {
      type: 'connection-status';
      status: ConnectionStatus;
      detail: string;
    }
  | {
      type: 'terminal';
      text: string;
    }
  | {
      type: 'state';
      state: Partial<MudState>;
    }
  | OnboardingStateMessage
  | OnboardingFallbackMessage
  | SensitiveInputMessage
  | {
      type: 'onboarding-rejected';
      code: string;
      detail: string;
    }
  | EditorContentChunkMessage
  | EditorContentCompleteMessage
  | EditorTransferResultMessage;
