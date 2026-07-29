import type { ConnectionStatus, MsdpVariableMap, MudState, MudValue } from './mud.ts';
import {
  formatAvailabilityAriaLabel,
  formatDisplayNumber,
  isMsdpVariableConfigured,
  normalizeDisplayNumber,
} from './msdp-display.ts';
import type { DisplayAvailabilityNotice } from './msdp-display.ts';

export type RoomDisplayState =
  | 'present'
  | 'raw'
  | 'empty'
  | 'loading'
  | 'offline'
  | 'error'
  | 'disabled';

export type RoomIdentityFieldId = 'roomName' | 'areaName' | 'roomVnum' | 'worldTime';

export type RoomIdentityFieldModel = {
  id: RoomIdentityFieldId;
  label: string;
  valueText: string;
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type RoomDetailModel = {
  id: string;
  label: string;
  valueText: string;
  ariaLabel: string;
};

export type RoomExitKind = 'exit' | 'raw';

export type RoomExitModel = {
  id: string;
  kind: RoomExitKind;
  directionText: string;
  isDirectionMissing: boolean;
  destinationText?: string;
  statusText?: string;
  rawText?: string;
  unknownFieldsText?: string;
  ariaLabel: string;
};

export type RoomDisplayModel = {
  state: RoomDisplayState;
  identityFields: RoomIdentityFieldModel[];
  details: RoomDetailModel[];
  exits: RoomExitModel[];
  availability: DisplayAvailabilityNotice;
  exitsAvailability: DisplayAvailabilityNotice;
  rawRoomText?: string;
  ariaLabel: string;
};

type MudRecord = Record<string, MudValue>;

type FieldDescriptor = {
  id: RoomIdentityFieldId;
  key: keyof Pick<MudState, 'roomName' | 'areaName' | 'roomVnum' | 'worldTime'>;
  label: string;
  variableKey: keyof Pick<MsdpVariableMap, 'roomName' | 'areaName' | 'roomVnum' | 'worldTime'>;
};

type ExitSortEntry = RoomExitModel & {
  sortLabel: string;
  sourceIndex: number;
};

const ROOM_NAME_KEYS = ['name', 'NAME', 'room_name', 'ROOM_NAME', 'roomName', 'ROOMNAME'] as const;
const AREA_NAME_KEYS = ['area', 'AREA', 'area_name', 'AREA_NAME', 'areaName', 'AREANAME'] as const;
const ROOM_VNUM_KEYS = ['vnum', 'VNUM', 'room_vnum', 'ROOM_VNUM', 'roomVnum', 'ROOMVNUM'] as const;
const WORLD_TIME_KEYS = [
  'world_time',
  'WORLD_TIME',
  'worldTime',
  'WORLDTIME',
  'time',
  'TIME',
] as const;
const ROOM_DETAIL_KEYS = [
  'terrain',
  'TERRAIN',
  'sector',
  'SECTOR',
  'sector_type',
  'SECTOR_TYPE',
  'environment',
  'ENVIRONMENT',
] as const;
const EXIT_DIRECTION_KEYS = [
  'direction',
  'DIRECTION',
  'dir',
  'DIR',
  'name',
  'NAME',
  'label',
  'LABEL',
] as const;
const EXIT_DESTINATION_KEYS = [
  'destination',
  'DESTINATION',
  'dest',
  'DEST',
  'to',
  'TO',
  'room',
  'ROOM',
  'vnum',
  'VNUM',
  'room_vnum',
  'ROOM_VNUM',
  'roomVnum',
  'ROOMVNUM',
] as const;
const EXIT_STATUS_KEYS = [
  'status',
  'STATUS',
  'state',
  'STATE',
  'door',
  'DOOR',
  'flags',
  'FLAGS',
  'condition',
  'CONDITION',
] as const;
const IDENTITY_FIELD_DESCRIPTORS: FieldDescriptor[] = [
  { id: 'roomName', key: 'roomName', label: 'Room', variableKey: 'roomName' },
  { id: 'areaName', key: 'areaName', label: 'Area', variableKey: 'areaName' },
  { id: 'roomVnum', key: 'roomVnum', label: 'VNUM', variableKey: 'roomVnum' },
  { id: 'worldTime', key: 'worldTime', label: 'World time', variableKey: 'worldTime' },
];
const COMPASS_ORDER = [
  ['n', 'north'],
  ['ne', 'northeast', 'north east'],
  ['e', 'east'],
  ['se', 'southeast', 'south east'],
  ['s', 'south'],
  ['sw', 'southwest', 'south west'],
  ['w', 'west'],
  ['nw', 'northwest', 'north west'],
  ['u', 'up'],
  ['d', 'down'],
  ['in'],
  ['out'],
] as const;
const DIRECTION_ORDER = new Map<string, number>(
  COMPASS_ORDER.flatMap((group, index) => group.map((entry) => [normalizeSortKey(entry), index])),
);
const RECOGNIZED_ROOM_KEYS = new Set(
  [
    ...ROOM_NAME_KEYS,
    ...AREA_NAME_KEYS,
    ...ROOM_VNUM_KEYS,
    ...WORLD_TIME_KEYS,
    ...ROOM_DETAIL_KEYS,
    'exits',
    'EXITS',
    'room_exits',
    'ROOM_EXITS',
    'roomExits',
    'ROOMEXITS',
    'coords',
    'COORDS',
    'coordinates',
    'COORDINATES',
  ].map(normalizeFieldKey),
);
const RECOGNIZED_EXIT_KEYS = new Set(
  [...EXIT_DIRECTION_KEYS, ...EXIT_DESTINATION_KEYS, ...EXIT_STATUS_KEYS].map(normalizeFieldKey),
);
const ROOM_FIELD_PLACEHOLDER = 'Waiting';
const UNKNOWN_FIELD_LIMIT = 3;
const UNKNOWN_FIELD_TEXT_LIMIT = 96;
const RAW_TEXT_LIMIT = 180;

export function buildRoomDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): RoomDisplayModel {
  if (status === 'idle' || status === 'disconnected') {
    return buildUnavailableRoomModel('offline', {
      title: 'Room offline',
      detail: 'Connect before room context can be evaluated.',
    });
  }

  if (status === 'error') {
    return buildUnavailableRoomModel('error', {
      title: 'Room unavailable',
      detail: 'The connection ended before room context could be evaluated.',
    });
  }

  const anyRoomMappingConfigured = hasAnyRoomMapping(msdpVariables);
  if (!anyRoomMappingConfigured) {
    return buildUnavailableRoomModel('disabled', {
      title: 'Room mappings disabled',
      detail: 'Room MSDP variables are not currently requested by the client settings.',
    });
  }

  const roomRecord = isMudRecord(mudState.room) ? mudState.room : null;
  const identityFields = buildRoomIdentityFields(mudState, status, msdpVariables, roomRecord);
  const details = roomRecord ? buildRoomDetails(roomRecord) : [];
  const rawRoomText =
    mudState.room !== undefined && details.length === 0
      ? buildRawRoomText(mudState.room)
      : undefined;
  const exits = mudState.roomExits === undefined ? [] : normalizeRoomExits(mudState.roomExits);
  const exitsAvailability = buildRoomExitsAvailability(
    mudState.roomExits,
    exits,
    status,
    msdpVariables,
  );
  const hasAnyPayload = hasAnyRoomPayload(mudState);
  const hasPresentIdentity = identityFields.some((field) => field.availability.kind === 'present');
  const hasPresentExit = exits.some((exit) => exit.kind === 'exit');
  const hasRawData =
    Boolean(rawRoomText) || exits.some((exit) => exit.kind === 'raw') || details.length > 0;

  if (!hasAnyPayload) {
    return {
      state: 'loading',
      identityFields,
      details: [],
      exits: [],
      availability: createRoomNotice('loading', {
        title: 'Waiting for room',
        detail:
          'Room MSDP variables are requested, but no room payload has arrived in this session.',
      }),
      exitsAvailability,
      ariaLabel: 'Waiting for room context.',
    };
  }

  if (!hasPresentIdentity && !hasPresentExit && !hasRawData) {
    return {
      state: 'empty',
      identityFields,
      details: [],
      exits: [],
      availability: createRoomNotice('empty', {
        title: 'Room context empty',
        detail:
          'The server reported room context values, but no displayable room details were present.',
      }),
      exitsAvailability,
      ariaLabel: 'Room context empty.',
    };
  }

  const state: RoomDisplayState = hasPresentIdentity || hasPresentExit ? 'present' : 'raw';
  const availability = createRoomNotice(state === 'raw' ? 'present' : 'present', {
    title: state === 'raw' ? 'Raw room context reported' : 'Room context reported',
    detail: formatRoomAvailabilityDetail(identityFields, details, exits, rawRoomText),
  });

  return {
    state,
    identityFields,
    details,
    exits,
    availability,
    exitsAvailability,
    rawRoomText,
    ariaLabel: formatRoomAriaLabel(state, identityFields, exits, rawRoomText),
  };
}

export function buildRoomIdentityFields(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
  roomRecord: MudRecord | null = isMudRecord(mudState.room) ? mudState.room : null,
): RoomIdentityFieldModel[] {
  return IDENTITY_FIELD_DESCRIPTORS.map((descriptor) => {
    const scalarValue = mudState[descriptor.key];
    const structuredValue = readStructuredIdentityValue(descriptor.id, roomRecord);
    const value = scalarValue ?? structuredValue;
    return buildRoomIdentityField(descriptor, value, status, msdpVariables);
  });
}

export function normalizeRoomExits(value: MudValue): RoomExitModel[] {
  const rows = normalizeRoomExitsWithSort(value);
  return sortExitRows(rows).map(stripExitSortFields);
}

function buildUnavailableRoomModel(
  state: Exclude<RoomDisplayState, 'present' | 'raw'>,
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): RoomDisplayModel {
  const kind = state === 'disabled' ? 'unavailable' : state;
  const availability = createRoomNotice(kind, notice);

  return {
    state,
    identityFields: [],
    details: [],
    exits: [],
    availability,
    exitsAvailability: availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function hasAnyRoomMapping(msdpVariables: MsdpVariableMap) {
  return (
    isMsdpVariableConfigured(msdpVariables, 'room') ||
    isMsdpVariableConfigured(msdpVariables, 'roomName') ||
    isMsdpVariableConfigured(msdpVariables, 'areaName') ||
    isMsdpVariableConfigured(msdpVariables, 'roomVnum') ||
    isMsdpVariableConfigured(msdpVariables, 'roomExits') ||
    isMsdpVariableConfigured(msdpVariables, 'worldTime')
  );
}

function hasAnyRoomPayload(mudState: MudState) {
  return (
    mudState.room !== undefined ||
    mudState.roomName !== undefined ||
    mudState.areaName !== undefined ||
    mudState.roomVnum !== undefined ||
    mudState.roomExits !== undefined ||
    mudState.worldTime !== undefined
  );
}

function buildRoomIdentityField(
  descriptor: FieldDescriptor,
  value: MudValue | undefined,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): RoomIdentityFieldModel {
  const availability = getRoomFieldAvailability(descriptor, value, status, msdpVariables);
  const valueText =
    availability.kind === 'present'
      ? (normalizeFieldValueText(descriptor.id, value) ?? ROOM_FIELD_PLACEHOLDER)
      : availability.kind === 'empty'
        ? 'Empty'
        : availability.kind === 'unavailable'
          ? 'Disabled'
          : availability.kind === 'offline'
            ? 'Offline'
            : availability.kind === 'error'
              ? 'Unavailable'
              : ROOM_FIELD_PLACEHOLDER;

  return {
    id: descriptor.id,
    label: descriptor.label,
    valueText,
    availability,
    ariaLabel:
      availability.kind === 'present'
        ? `${descriptor.label} ${valueText}.`
        : formatAvailabilityAriaLabel(availability),
  };
}

function getRoomFieldAvailability(
  descriptor: FieldDescriptor,
  value: MudValue | undefined,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): DisplayAvailabilityNotice {
  const normalizedText = normalizeFieldValueText(descriptor.id, value);
  if (normalizedText !== undefined) {
    return createRoomNotice('present', {
      title: `${descriptor.label} reported`,
      detail: `${descriptor.label} is available from MSDP room context.`,
    });
  }

  if (value !== undefined) {
    return createRoomNotice('empty', {
      title: `${descriptor.label} empty`,
      detail: `The server reported a blank ${descriptor.label.toLowerCase()} value.`,
    });
  }

  if (status === 'idle' || status === 'disconnected') {
    return createRoomNotice('offline', {
      title: `${descriptor.label} offline`,
      detail: `Connect before ${descriptor.label.toLowerCase()} can be evaluated.`,
    });
  }

  if (status === 'error') {
    return createRoomNotice('error', {
      title: `${descriptor.label} unavailable`,
      detail: `The connection ended before ${descriptor.label.toLowerCase()} could be evaluated.`,
    });
  }

  if (!isMsdpVariableConfigured(msdpVariables, descriptor.variableKey)) {
    return createRoomNotice('unavailable', {
      title: `${descriptor.label} mapping disabled`,
      detail: `${msdpVariablesLabel(descriptor.variableKey)} is not currently requested by the client settings.`,
    });
  }

  return createRoomNotice('loading', {
    title: `Waiting for ${descriptor.label.toLowerCase()}`,
    detail: `${msdpVariablesLabel(descriptor.variableKey)} is requested, but no value has arrived in this session.`,
  });
}

function readStructuredIdentityValue(id: RoomIdentityFieldId, record: MudRecord | null) {
  if (!record) {
    return undefined;
  }

  switch (id) {
    case 'roomName':
      return readAnyKey(record, ROOM_NAME_KEYS);
    case 'areaName':
      return readAnyKey(record, AREA_NAME_KEYS);
    case 'roomVnum':
      return readAnyKey(record, ROOM_VNUM_KEYS);
    case 'worldTime':
      return readAnyKey(record, WORLD_TIME_KEYS);
    default:
      assertNever(id);
  }
}

function normalizeFieldValueText(id: RoomIdentityFieldId, value: MudValue | undefined) {
  if (id === 'roomVnum') {
    const normalized = normalizeDisplayNumber(value);
    return normalized === undefined
      ? undefined
      : (formatDisplayNumber(normalized) ?? String(normalized));
  }

  return normalizeTextValue(value);
}

function buildRoomDetails(record: MudRecord): RoomDetailModel[] {
  const details = ROOM_DETAIL_KEYS.flatMap((key) => {
    if (!(key in record)) {
      return [];
    }

    const valueText = truncateText(formatMudValueAsText(record[key]), UNKNOWN_FIELD_TEXT_LIMIT);
    if (!valueText) {
      return [];
    }

    return [
      {
        id: `detail-${normalizeIdPart(key)}`,
        label: formatMudLabel(key),
        valueText,
        ariaLabel: `${formatMudLabel(key)} ${valueText}.`,
      },
    ];
  });
  const unknownFieldsText = formatUnknownFields(record, RECOGNIZED_ROOM_KEYS);

  if (!unknownFieldsText) {
    return details;
  }

  return [
    ...details,
    {
      id: 'detail-other',
      label: 'Other',
      valueText: unknownFieldsText,
      ariaLabel: `Other room fields ${unknownFieldsText}.`,
    },
  ];
}

function buildRawRoomText(value: MudValue) {
  const text = truncateText(formatMudValueAsText(value), RAW_TEXT_LIMIT);
  return text || undefined;
}

function buildRoomExitsAvailability(
  roomExits: MudValue | undefined,
  exits: RoomExitModel[],
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): DisplayAvailabilityNotice {
  if (status === 'idle' || status === 'disconnected') {
    return createRoomNotice('offline', {
      title: 'Exits offline',
      detail: 'Connect before room exits can be evaluated.',
    });
  }

  if (status === 'error') {
    return createRoomNotice('error', {
      title: 'Exits unavailable',
      detail: 'The connection ended before room exits could be evaluated.',
    });
  }

  if (!isMsdpVariableConfigured(msdpVariables, 'roomExits')) {
    return createRoomNotice('unavailable', {
      title: 'Exit mapping disabled',
      detail: 'ROOM_EXITS is not currently requested by the client settings.',
    });
  }

  if (roomExits === undefined) {
    return createRoomNotice('loading', {
      title: 'Waiting for exits',
      detail: 'ROOM_EXITS is requested, but no exit payload has arrived in this session.',
    });
  }

  if (exits.length === 0) {
    return createRoomNotice('empty', {
      title: 'No exits reported',
      detail: 'The server reported an empty exit payload.',
    });
  }

  return createRoomNotice('present', {
    title: exits.every((exit) => exit.kind === 'raw') ? 'Raw exits reported' : 'Exits reported',
    detail: `${exits.length} ${exits.length === 1 ? 'exit entry is' : 'exit entries are'} available for display.`,
  });
}

function normalizeRoomExitsWithSort(value: MudValue): ExitSortEntry[] {
  if (value === null) {
    return [];
  }

  if (typeof value === 'string') {
    return normalizeStringExitRows(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => createArrayExitEntry(entry, index));
  }

  if (isMudRecord(value)) {
    if (looksLikeExitRecord(value)) {
      return [createExitRowFromRecord(value, 0)];
    }

    return Object.entries(value).flatMap(([key, entry], index) =>
      createObjectExitEntry(key, entry, index),
    );
  }

  return [createRawExitEntry(value, 0)];
}

function normalizeStringExitRows(value: string): ExitSortEntry[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const tokens = trimmed
    .split(/[\s,;|/]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const canRenderAsDirections =
    tokens.length > 0 && tokens.every((token) => isSimpleDirectionToken(token));

  if (!canRenderAsDirections) {
    return [createRawExitEntry(value, 0)];
  }

  return tokens.map((token, index) => createDirectionExitRow(token, index));
}

function createArrayExitEntry(value: MudValue, index: number): ExitSortEntry[] {
  if (value === null) {
    return [];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    return isSimpleDirectionToken(trimmed)
      ? [createDirectionExitRow(trimmed, index)]
      : [createRawExitEntry(value, index)];
  }

  if (isMudRecord(value)) {
    return [createExitRowFromRecord(value, index)];
  }

  return [createRawExitEntry(value, index)];
}

function createObjectExitEntry(key: string, value: MudValue, index: number): ExitSortEntry[] {
  const direction = formatMudLabel(key) || `Exit ${index + 1}`;

  if (value === null) {
    return [];
  }

  if (isMudRecord(value)) {
    return [createExitRowFromRecord(value, index, direction)];
  }

  const scalarText = normalizeTextValue(value);
  if (!scalarText) {
    return [];
  }

  const destinationText = normalizeDisplayNumber(value) !== undefined ? scalarText : undefined;
  const statusText = destinationText ? undefined : scalarText;
  return [
    withExitSort(
      {
        id: `exit-${normalizeIdPart(key)}-${index}`,
        kind: 'exit',
        directionText: direction,
        isDirectionMissing: false,
        destinationText,
        statusText,
        ariaLabel: formatExitAriaLabel(direction, false, destinationText, statusText, undefined),
      },
      direction,
      index,
    ),
  ];
}

function createExitRowFromRecord(
  record: MudRecord,
  index: number,
  fallbackDirection?: string,
): ExitSortEntry {
  const direction = normalizeTextValue(readAnyKey(record, EXIT_DIRECTION_KEYS));
  const directionText = direction
    ? formatMudLabel(direction)
    : (fallbackDirection ?? `Exit ${index + 1}`);
  const isDirectionMissing = direction === undefined && fallbackDirection === undefined;
  const destinationText = normalizeTextValue(readAnyKey(record, EXIT_DESTINATION_KEYS));
  const statusText = normalizeTextValue(readAnyKey(record, EXIT_STATUS_KEYS));
  const unknownFieldsText = formatUnknownFields(record, RECOGNIZED_EXIT_KEYS);

  return withExitSort(
    {
      id: `exit-${normalizeIdPart(directionText)}-${index}`,
      kind: 'exit',
      directionText,
      isDirectionMissing,
      destinationText,
      statusText,
      unknownFieldsText,
      ariaLabel: formatExitAriaLabel(
        directionText,
        isDirectionMissing,
        destinationText,
        statusText,
        unknownFieldsText,
      ),
    },
    directionText,
    index,
  );
}

function createDirectionExitRow(direction: string, index: number): ExitSortEntry {
  const directionText = formatMudLabel(direction) || `Exit ${index + 1}`;
  return withExitSort(
    {
      id: `exit-${normalizeIdPart(direction)}-${index}`,
      kind: 'exit',
      directionText,
      isDirectionMissing: false,
      ariaLabel: `${directionText} exit reported.`,
    },
    directionText,
    index,
  );
}

function createRawExitEntry(value: MudValue, index: number): ExitSortEntry {
  const rawText =
    truncateText(formatMudValueAsText(value), RAW_TEXT_LIMIT) || 'Unprintable exit value';
  const directionText = `Raw exit ${index + 1}`;

  return withExitSort(
    {
      id: `exit-raw-${index}`,
      kind: 'raw',
      directionText,
      isDirectionMissing: true,
      rawText,
      ariaLabel: `${directionText}. ${rawText}.`,
    },
    directionText,
    index,
  );
}

function withExitSort(row: RoomExitModel, sortLabel: string, sourceIndex: number): ExitSortEntry {
  return {
    ...row,
    sortLabel,
    sourceIndex,
  };
}

function sortExitRows(rows: ExitSortEntry[]) {
  return [...rows].sort((left, right) => {
    const leftOrder = DIRECTION_ORDER.get(normalizeSortKey(left.sortLabel));
    const rightOrder = DIRECTION_ORDER.get(normalizeSortKey(right.sortLabel));

    if (leftOrder !== undefined || rightOrder !== undefined) {
      if (leftOrder === undefined) {
        return 1;
      }

      if (rightOrder === undefined) {
        return -1;
      }

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    }

    const labelCompare = left.sortLabel.localeCompare(right.sortLabel, 'en', {
      sensitivity: 'base',
    });
    return labelCompare === 0 ? left.sourceIndex - right.sourceIndex : labelCompare;
  });
}

function stripExitSortFields(entry: ExitSortEntry): RoomExitModel {
  return {
    id: entry.id,
    kind: entry.kind,
    directionText: entry.directionText,
    isDirectionMissing: entry.isDirectionMissing,
    destinationText: entry.destinationText,
    statusText: entry.statusText,
    rawText: entry.rawText,
    unknownFieldsText: entry.unknownFieldsText,
    ariaLabel: entry.ariaLabel,
  };
}

function looksLikeExitRecord(record: MudRecord) {
  return Object.keys(record).some((key) => RECOGNIZED_EXIT_KEYS.has(normalizeFieldKey(key)));
}

function isSimpleDirectionToken(value: string) {
  const normalized = normalizeSortKey(value);
  return (
    DIRECTION_ORDER.has(normalized) ||
    (/^[a-z][a-z0-9_-]{0,31}$/i.test(value) && !/[=:{}[\]()]/.test(value))
  );
}

function formatRoomAvailabilityDetail(
  fields: RoomIdentityFieldModel[],
  details: RoomDetailModel[],
  exits: RoomExitModel[],
  rawRoomText: string | undefined,
) {
  const presentFields = fields.filter((field) => field.availability.kind === 'present').length;
  const parts = [
    presentFields > 0
      ? `${presentFields} identity ${presentFields === 1 ? 'field' : 'fields'}`
      : null,
    exits.length > 0 ? `${exits.length} ${exits.length === 1 ? 'exit' : 'exits'}` : null,
    details.length > 0
      ? `${details.length} structured ${details.length === 1 ? 'detail' : 'details'}`
      : null,
    rawRoomText ? 'raw room fallback' : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0
    ? `${parts.join(', ')} available.`
    : 'Room context is available for display.';
}

function formatRoomAriaLabel(
  state: RoomDisplayState,
  fields: RoomIdentityFieldModel[],
  exits: RoomExitModel[],
  rawRoomText: string | undefined,
) {
  const presentValues = fields
    .filter((field) => field.availability.kind === 'present')
    .map((field) => `${field.label} ${field.valueText}`);
  const exitSummary =
    exits.length > 0 ? `${exits.length} ${exits.length === 1 ? 'exit' : 'exits'} reported` : null;
  const rawSummary = rawRoomText ? 'raw room fallback available' : null;
  const parts = [
    state === 'raw' ? 'Raw room context' : 'Room context',
    ...presentValues,
    exitSummary,
    rawSummary,
  ].filter((part): part is string => Boolean(part));

  return `${parts.join('. ')}.`;
}

function formatExitAriaLabel(
  directionText: string,
  isDirectionMissing: boolean,
  destinationText: string | undefined,
  statusText: string | undefined,
  unknownFieldsText: string | undefined,
) {
  const parts = [
    isDirectionMissing ? `Direction missing, shown as ${directionText}` : `${directionText} exit`,
    destinationText ? `Destination ${destinationText}` : undefined,
    statusText ? `Status ${statusText}` : undefined,
    unknownFieldsText ? `Other fields ${unknownFieldsText}` : undefined,
  ];

  return `${parts.filter(Boolean).join('. ')}.`;
}

function normalizeTextValue(value: MudValue | undefined) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = formatMudValueAsText(value).trim();
  return text || undefined;
}

function readAnyKey(record: MudRecord, keys: readonly string[]) {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function formatUnknownFields(record: MudRecord, recognizedKeys: ReadonlySet<string>) {
  const summaries = Object.entries(record)
    .filter(([key]) => !recognizedKeys.has(normalizeFieldKey(key)))
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

function normalizeFieldKey(key: string) {
  return key.replace(/[_-]+/g, '').toLowerCase();
}

function normalizeSortKey(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeIdPart(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entry'
  );
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function msdpVariablesLabel(key: keyof MsdpVariableMap) {
  switch (key) {
    case 'room':
      return 'ROOM';
    case 'roomName':
      return 'ROOM_NAME';
    case 'areaName':
      return 'AREA_NAME';
    case 'roomVnum':
      return 'ROOM_VNUM';
    case 'roomExits':
      return 'ROOM_EXITS';
    case 'worldTime':
      return 'WORLD_TIME';
    default:
      return String(key).toUpperCase();
  }
}

function isMudRecord(value: MudValue | undefined): value is MudRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createRoomNotice(
  kind: DisplayAvailabilityNotice['kind'],
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): DisplayAvailabilityNotice {
  return {
    kind,
    ...notice,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled room display value: ${String(value)}`);
}
