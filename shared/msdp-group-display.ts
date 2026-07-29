import type { ConnectionStatus, MsdpVariableMap, MudState, MudValue } from './mud.ts';
import {
  clampPercentage,
  formatAvailabilityAriaLabel,
  formatDisplayNumber,
  isMsdpVariableConfigured,
  normalizeDisplayNumber,
} from './msdp-display.ts';
import type { DisplayAvailabilityNotice } from './msdp-display.ts';

export type GroupAvailabilityState =
  | 'present'
  | 'empty'
  | 'loading'
  | 'offline'
  | 'error'
  | 'disabled';

export type GroupEntryKind = 'member' | 'raw';
export type GroupResourceId = 'health' | 'movement';

export type GroupResourceModel = {
  id: GroupResourceId;
  label: string;
  valueText: string;
  percentage: number;
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type GroupMemberModel = {
  id: string;
  kind: GroupEntryKind;
  nameText: string;
  isNameMissing: boolean;
  isLeader: boolean;
  leaderText?: string;
  statusText?: string;
  resources: GroupResourceModel[];
  unknownFieldsText?: string;
  rawText?: string;
  ariaLabel: string;
};

export type GroupDisplayModel = {
  state: GroupAvailabilityState;
  members: GroupMemberModel[];
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

type MudRecord = Record<string, MudValue>;

const GROUP_NAME_KEYS = [
  'name',
  'NAME',
  'member_name',
  'MEMBER_NAME',
  'memberName',
  'MEMBERNAME',
  'character_name',
  'CHARACTER_NAME',
  'characterName',
  'CHARACTERNAME',
] as const;
const GROUP_LEADER_KEYS = ['leader', 'LEADER', 'is_leader', 'IS_LEADER', 'isLeader'] as const;
const GROUP_HEALTH_KEYS = [
  'health',
  'HEALTH',
  'hp',
  'HP',
  'current_health',
  'CURRENT_HEALTH',
] as const;
const GROUP_HEALTH_MAX_KEYS = [
  'healthMax',
  'health_max',
  'HEALTH_MAX',
  'max_health',
  'MAX_HEALTH',
  'maxHealth',
  'MAXHEALTH',
] as const;
const GROUP_MOVEMENT_KEYS = ['movement', 'MOVEMENT', 'move', 'MOVE', 'moves', 'MOVES'] as const;
const GROUP_MOVEMENT_MAX_KEYS = [
  'movementMax',
  'movement_max',
  'MOVEMENT_MAX',
  'moveMax',
  'move_max',
  'MOVE_MAX',
  'max_movement',
  'MAX_MOVEMENT',
  'maxMove',
  'MAXMOVE',
] as const;
const GROUP_STATUS_KEYS = [
  'status',
  'STATUS',
  'state',
  'STATE',
  'condition',
  'CONDITION',
  'group_status',
  'GROUP_STATUS',
] as const;
const RECOGNIZED_MEMBER_KEYS = new Set(
  [
    ...GROUP_NAME_KEYS,
    ...GROUP_LEADER_KEYS,
    ...GROUP_HEALTH_KEYS,
    ...GROUP_HEALTH_MAX_KEYS,
    ...GROUP_MOVEMENT_KEYS,
    ...GROUP_MOVEMENT_MAX_KEYS,
    ...GROUP_STATUS_KEYS,
  ].map(normalizeMemberKey),
);
const UNKNOWN_FIELD_LIMIT = 3;
const UNKNOWN_FIELD_TEXT_LIMIT = 96;

export function buildGroupDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): GroupDisplayModel {
  if (status === 'idle' || status === 'disconnected') {
    return buildUnavailableGroupModel('offline', {
      title: 'Group offline',
      detail: 'Connect before group data can be evaluated.',
    });
  }

  if (status === 'error') {
    return buildUnavailableGroupModel('error', {
      title: 'Group unavailable',
      detail: 'The connection ended before group data could be evaluated.',
    });
  }

  if (!isMsdpVariableConfigured(msdpVariables, 'group')) {
    return buildUnavailableGroupModel('disabled', {
      title: 'Group mapping disabled',
      detail: 'GROUP is not currently requested by the client settings.',
    });
  }

  if (mudState.group === undefined) {
    return buildUnavailableGroupModel('loading', {
      title: 'Waiting for group',
      detail: 'GROUP is requested, but no group payload has arrived in this session.',
    });
  }

  const members = normalizeGroupMembers(mudState.group);

  if (members.length === 0) {
    return buildUnavailableGroupModel('empty', {
      title: 'No group members',
      detail: 'The server reported an empty group collection.',
    });
  }

  const availability = createGroupNotice('present', {
    title: 'Group reported',
    detail: `${members.length} ${members.length === 1 ? 'entry is' : 'entries are'} available for display.`,
  });

  return {
    state: 'present',
    members,
    availability,
    ariaLabel: `Group reported. ${members.length} ${members.length === 1 ? 'entry' : 'entries'}.`,
  };
}

export function normalizeGroupMembers(value: MudValue): GroupMemberModel[] {
  if (value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => createGroupEntry(entry, index));
  }

  if (isMudRecord(value)) {
    if (looksLikeMemberRecord(value)) {
      return [createMemberModel(value, 0)];
    }

    return Object.entries(value).flatMap(([key, entry], index) =>
      createObjectGroupEntry(key, entry, index),
    );
  }

  return createRawGroupEntry(value, 0);
}

function buildUnavailableGroupModel(
  state: Exclude<GroupAvailabilityState, 'present'>,
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): GroupDisplayModel {
  const kind = state === 'disabled' ? 'unavailable' : state;
  const availability = createGroupNotice(kind, notice);

  return {
    state,
    members: [],
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function createGroupEntry(value: MudValue, index: number): GroupMemberModel[] {
  if (value === null) {
    return [];
  }

  if (isMudRecord(value)) {
    return [createMemberModel(value, index)];
  }

  return createRawGroupEntry(value, index);
}

function createObjectGroupEntry(key: string, value: MudValue, index: number): GroupMemberModel[] {
  const label = formatMudLabel(key) || `Group entry ${index + 1}`;

  if (value === null) {
    return [];
  }

  if (isMudRecord(value)) {
    return [createMemberModel(value, index, label)];
  }

  return createRawGroupEntry(value, index, label);
}

function createMemberModel(
  record: MudRecord,
  index: number,
  fallbackName?: string,
): GroupMemberModel {
  const name = normalizeTextValue(readAnyKey(record, GROUP_NAME_KEYS));
  const nameText = name ?? fallbackName ?? `Unknown member ${index + 1}`;
  const isNameMissing = name === undefined;
  const isLeader = normalizeBoolean(readAnyKey(record, GROUP_LEADER_KEYS)) ?? false;
  const statusText = normalizeTextValue(readAnyKey(record, GROUP_STATUS_KEYS));
  const resources = [
    buildGroupResourceModel(
      'health',
      'HP',
      readAnyKey(record, GROUP_HEALTH_KEYS),
      readAnyKey(record, GROUP_HEALTH_MAX_KEYS),
    ),
    buildGroupResourceModel(
      'movement',
      'Move',
      readAnyKey(record, GROUP_MOVEMENT_KEYS),
      readAnyKey(record, GROUP_MOVEMENT_MAX_KEYS),
    ),
  ];
  const unknownFieldsText = formatUnknownFields(record);

  return {
    id: `member-${index}`,
    kind: 'member',
    nameText,
    isNameMissing,
    isLeader,
    leaderText: isLeader ? 'Leader' : undefined,
    statusText,
    resources,
    unknownFieldsText,
    ariaLabel: formatMemberAriaLabel(
      index,
      nameText,
      isNameMissing,
      isLeader,
      statusText,
      resources,
    ),
  };
}

function createRawGroupEntry(
  value: MudValue,
  index: number,
  fallbackLabel?: string,
): GroupMemberModel[] {
  const valueText = formatMudValueAsText(value);

  if (!valueText) {
    return [];
  }

  const nameText = fallbackLabel ?? `Group entry ${index + 1}`;

  return [
    {
      id: `raw-${index}`,
      kind: 'raw',
      nameText,
      isNameMissing: false,
      isLeader: false,
      resources: [],
      rawText: valueText,
      ariaLabel: `${nameText}: ${valueText}.`,
    },
  ];
}

function buildGroupResourceModel(
  id: GroupResourceId,
  label: string,
  currentValue: MudValue | undefined,
  maxValue: MudValue | undefined,
): GroupResourceModel {
  const current = normalizeDisplayNumber(currentValue);
  const max = normalizeDisplayNumber(maxValue);
  const hasUsableMax = max !== undefined && max > 0;

  if (current === undefined && max === undefined) {
    const availability = createGroupNotice('empty', {
      title: `${label} not reported`,
      detail: `${label} was not included in this group member payload.`,
    });

    return {
      id,
      label,
      valueText: 'Not reported',
      percentage: 0,
      availability,
      ariaLabel: formatAvailabilityAriaLabel(availability),
    };
  }

  const valueText = formatResourceValue(current, max);
  const availability = createGroupNotice('present', {
    title: `${label} reported`,
    detail: formatResourceDetail(label, current, max),
  });

  return {
    id,
    label,
    valueText,
    percentage: hasUsableMax ? clampPercentage(current, max) : 0,
    availability,
    ariaLabel: formatResourceAriaLabel(label, current, max),
  };
}

function formatResourceValue(current: number | undefined, max: number | undefined) {
  const currentText = formatDisplayNumber(current);
  const maxText = formatDisplayNumber(max);

  if (current !== undefined && max !== undefined && max > 0) {
    return `${currentText ?? current} / ${maxText ?? max}`;
  }

  if (current !== undefined) {
    return currentText ?? String(current);
  }

  if (max !== undefined) {
    return `Max ${maxText ?? max}`;
  }

  return 'Not reported';
}

function formatResourceDetail(label: string, current: number | undefined, max: number | undefined) {
  if (current !== undefined && max !== undefined && max > 0) {
    return `${label} has current and maximum values.`;
  }

  if (current !== undefined && max !== undefined) {
    return `${label} has a current value and no usable maximum value.`;
  }

  if (current !== undefined) {
    return `${label} has a current value without a maximum value.`;
  }

  return `${label} has a maximum value without a current value.`;
}

function formatResourceAriaLabel(
  label: string,
  current: number | undefined,
  max: number | undefined,
) {
  if (current !== undefined && max !== undefined && max > 0) {
    return `${label} ${formatDisplayNumber(current)} of ${formatDisplayNumber(max)}.`;
  }

  if (current !== undefined) {
    return `${label} ${formatDisplayNumber(current)}. Maximum not reported.`;
  }

  if (max !== undefined) {
    return `${label} maximum ${formatDisplayNumber(max)}. Current value not reported.`;
  }

  return `${label} not reported.`;
}

function formatMemberAriaLabel(
  index: number,
  nameText: string,
  isNameMissing: boolean,
  isLeader: boolean,
  statusText: string | undefined,
  resources: GroupResourceModel[],
) {
  const parts = [
    isNameMissing
      ? `Member ${index + 1}, name missing, shown as ${nameText}`
      : `Member ${index + 1}, ${nameText}`,
    isLeader ? 'Leader' : undefined,
    statusText ? `Status ${statusText}` : undefined,
    ...resources.map((resource) => `${resource.label} ${resource.valueText}`),
  ];

  return `${parts.filter(Boolean).join('. ')}.`;
}

function formatUnknownFields(record: MudRecord) {
  const summaries = Object.entries(record)
    .filter(([key]) => !isRecognizedMemberKey(key))
    .map(([key, value]) => {
      const valueText = truncateText(formatMudValueAsText(value), UNKNOWN_FIELD_TEXT_LIMIT);
      return valueText ? `${formatMudLabel(key)}: ${valueText}` : null;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (summaries.length === 0) {
    return undefined;
  }

  const visible = summaries.slice(0, UNKNOWN_FIELD_LIMIT);
  const remaining = summaries.length - visible.length;

  if (remaining > 0) {
    visible.push(`${remaining} more`);
  }

  return visible.join(' | ');
}

function looksLikeMemberRecord(record: MudRecord) {
  return Object.entries(record).some(
    ([key, value]) => isRecognizedMemberKey(key) && isScalarMudValue(value),
  );
}

function readAnyKey(record: MudRecord, keys: readonly string[]) {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function normalizeTextValue(value: MudValue | undefined) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = formatMudValueAsText(value).trim();
  return text || undefined;
}

function normalizeBoolean(value: MudValue | undefined) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y') {
      return true;
    }

    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'n') {
      return false;
    }
  }

  return undefined;
}

function formatMudValueAsText(value: MudValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    return formatDisplayNumber(value) ?? String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => formatMudValueAsText(entry))
      .filter(Boolean)
      .join(', ');
  }

  return Object.entries(value)
    .map(([key, entryValue]) => {
      const valueText = formatMudValueAsText(entryValue);
      return valueText ? `${formatMudLabel(key)}: ${valueText}` : null;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join(' | ');
}

function formatMudLabel(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function isRecognizedMemberKey(key: string) {
  return RECOGNIZED_MEMBER_KEYS.has(normalizeMemberKey(key));
}

function normalizeMemberKey(key: string) {
  return key.replace(/[_-]+/g, '').toLowerCase();
}

function isMudRecord(value: MudValue): value is MudRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isScalarMudValue(value: MudValue) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function createGroupNotice(
  kind: DisplayAvailabilityNotice['kind'],
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): DisplayAvailabilityNotice {
  return {
    kind,
    ...notice,
  };
}
