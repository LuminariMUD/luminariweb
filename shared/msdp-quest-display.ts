import type { ConnectionStatus, MsdpVariableMap, MudState, MudValue } from './mud.ts';
import { formatAvailabilityAriaLabel, isMsdpVariableConfigured } from './msdp-display.ts';
import type { DisplayAvailabilityNotice } from './msdp-display.ts';

export type QuestDisplayState =
  | 'present'
  | 'empty'
  | 'loading'
  | 'offline'
  | 'error'
  | 'unsupported';

export type QuestOverrideKind = 'structured' | 'scalar';

export type QuestDisplayModel = {
  state: QuestDisplayState;
  availability: DisplayAvailabilityNotice;
  value?: MudValue;
  overrideKind?: QuestOverrideKind;
  ariaLabel: string;
};

export function buildQuestDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): QuestDisplayModel {
  if (status === 'idle' || status === 'disconnected') {
    return buildUnavailableQuestModel('offline', {
      title: 'Quests offline',
      detail: 'Connect before structured quest data can be evaluated.',
    });
  }

  if (status === 'error') {
    return buildUnavailableQuestModel('error', {
      title: 'Quests unavailable',
      detail: 'The connection ended before quest data could be evaluated.',
    });
  }

  if (!isMsdpVariableConfigured(msdpVariables, 'questInfo')) {
    return buildUnavailableQuestModel('unsupported', {
      title: 'Structured quests unavailable',
      detail:
        'Current Luminari-Source does not emit QUEST_INFO. Configure an override only for servers that do.',
    });
  }

  if (mudState.questInfo === undefined) {
    return buildUnavailableQuestModel('loading', {
      title: 'Waiting for quests',
      detail: 'A QUEST_INFO override is configured, but no structured quest payload has arrived.',
    });
  }

  const value = normalizeQuestInfoValue(mudState.questInfo);

  if (isEmptyMudValue(value)) {
    return buildUnavailableQuestModel('empty', {
      title: 'No structured quests',
      detail: 'The server reported an empty quest collection.',
    });
  }

  const overrideKind: QuestOverrideKind = isStructuredMudValue(value) ? 'structured' : 'scalar';
  const availability = createQuestNotice('present', {
    title: 'Structured quest override',
    detail:
      overrideKind === 'structured'
        ? 'A configured QUEST_INFO override produced structured quest data.'
        : 'A configured QUEST_INFO override produced scalar quest data.',
  });

  return {
    state: 'present',
    availability,
    value,
    overrideKind,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

export function normalizeQuestInfoValue(value: MudValue): MudValue {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!looksLikeJsonContainer(trimmed)) {
    return value;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isMudValue(parsed)) {
      return parsed;
    }
  } catch {
    return value;
  }

  return value;
}

function buildUnavailableQuestModel(
  state: Exclude<QuestDisplayState, 'present'>,
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): QuestDisplayModel {
  const kind = state === 'unsupported' ? 'unavailable' : state;
  const availability = createQuestNotice(kind, notice);

  return {
    state,
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function looksLikeJsonContainer(value: string) {
  return (
    (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))
  );
}

function isEmptyMudValue(value: MudValue) {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (isMudRecord(value)) {
    return Object.keys(value).length === 0;
  }

  return false;
}

function isStructuredMudValue(value: MudValue) {
  return Array.isArray(value) || isMudRecord(value);
}

function isMudValue(value: unknown): value is MudValue {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isMudValue(entry));
  }

  if (isUnknownRecord(value)) {
    return Object.values(value).every((entry) => isMudValue(entry));
  }

  return false;
}

function isMudRecord(value: MudValue): value is Record<string, MudValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createQuestNotice(
  kind: DisplayAvailabilityNotice['kind'],
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): DisplayAvailabilityNotice {
  return {
    kind,
    ...notice,
  };
}
