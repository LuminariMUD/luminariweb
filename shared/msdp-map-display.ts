import type { ConnectionStatus, MsdpVariableMap, MudState } from './mud.ts';
import { formatAvailabilityAriaLabel, isMsdpVariableConfigured } from './msdp-display.ts';
import type { DisplayAvailabilityNotice } from './msdp-display.ts';
import { buildRoomDisplayModel } from './msdp-room-display.ts';
import type {
  RoomDisplayModel,
  RoomExitModel,
  RoomIdentityFieldModel,
} from './msdp-room-display.ts';

export type MapDisplayState =
  | 'liveOverride'
  | 'fallback'
  | 'empty'
  | 'loading'
  | 'offline'
  | 'error'
  | 'disabled';

export type MapDisplaySource = 'minimapOverride' | 'roomFallback' | 'none';

export type MapMapperSourceField = 'room' | 'roomName' | 'areaName' | 'roomVnum' | 'roomExits';

export type MapMapperBranchPlacement =
  | 'north'
  | 'northeast'
  | 'east'
  | 'southeast'
  | 'south'
  | 'southwest'
  | 'west'
  | 'northwest'
  | 'up'
  | 'down'
  | 'in'
  | 'out'
  | 'other';

export type MapMapperCurrentRoomNode = {
  id: 'current-room';
  kind: 'currentRoom';
  labelText: string;
  detailText?: string;
  sourceFields: MapMapperSourceField[];
  ariaLabel: string;
};

export type MapMapperBranch = {
  id: string;
  kind: 'directionalExit';
  source: 'roomExits';
  placement: MapMapperBranchPlacement;
  directionText: string;
  destinationText?: string;
  statusText?: string;
  unknownFieldsText?: string;
  ariaLabel: string;
};

export type MapMapperModel = {
  source: 'roomFallback';
  sourceFields: MapMapperSourceField[];
  currentRoom: MapMapperCurrentRoomNode;
  branches: MapMapperBranch[];
  summaryText: string;
  ariaLabel: string;
};

export type MapFallbackIdentityField = {
  id: string;
  label: string;
  valueText: string;
  ariaLabel: string;
};

export type MapFallbackExit = {
  id: string;
  kind: 'exit' | 'raw';
  directionText: string;
  destinationText?: string;
  statusText?: string;
  rawText?: string;
  unknownFieldsText?: string;
  ariaLabel: string;
};

export type MapFallbackModel = {
  headingText: string;
  summaryText: string;
  mapper?: MapMapperModel;
  identityFields: MapFallbackIdentityField[];
  exits: MapFallbackExit[];
  rawRoomText?: string;
  ariaLabel: string;
};

export type MapDisplayModel = {
  state: MapDisplayState;
  source: MapDisplaySource;
  availability: DisplayAvailabilityNotice;
  minimapText?: string;
  fallback?: MapFallbackModel;
  ariaLabel: string;
};

export function buildMapDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): MapDisplayModel {
  if (status === 'idle' || status === 'disconnected') {
    return buildUnavailableMapModel('offline', {
      title: 'Map offline',
      detail: 'Connect before room or minimap data can be evaluated.',
    });
  }

  if (status === 'error') {
    return buildUnavailableMapModel('error', {
      title: 'Map unavailable',
      detail: 'The connection ended before map data could be evaluated.',
    });
  }

  const minimapConfigured = isMsdpVariableConfigured(msdpVariables, 'minimap');
  const minimapText = normalizeMinimapText(mudState.minimap);

  if (minimapConfigured && minimapText) {
    const availability = createMapNotice('present', {
      title: 'Live MINIMAP',
      detail: 'Source-backed MINIMAP produced server map text.',
    });

    return {
      state: 'liveOverride',
      source: 'minimapOverride',
      availability,
      minimapText,
      ariaLabel: formatAvailabilityAriaLabel(availability),
    };
  }

  const roomDisplay = buildRoomDisplayModel(pickRoomState(mudState), status, msdpVariables);

  if (roomDisplay.state === 'present' || roomDisplay.state === 'raw') {
    const fallback = buildMapFallback(roomDisplay);
    const availability = createMapNotice('present', {
      title: 'Room/exits map fallback',
      detail: 'Using source-confirmed room identity and exits while live MINIMAP is unavailable.',
    });

    return {
      state: 'fallback',
      source: 'roomFallback',
      availability,
      fallback,
      ariaLabel: fallback.ariaLabel,
    };
  }

  const roomMappingsConfigured = hasAnyRoomMapMapping(msdpVariables);

  if (!roomMappingsConfigured && !minimapConfigured) {
    return buildUnavailableMapModel('disabled', {
      title: 'Map data disabled',
      detail: 'Room MSDP mappings and MINIMAP are not currently requested.',
    });
  }

  if (minimapConfigured && mudState.minimap !== undefined && !minimapText) {
    return buildUnavailableMapModel('empty', {
      title: 'Minimap empty',
      detail: 'The source MINIMAP value arrived, but it did not contain displayable text.',
    });
  }

  if (roomDisplay.state === 'empty') {
    return buildUnavailableMapModel('empty', {
      title: 'Map fallback empty',
      detail:
        'Room MSDP values arrived, but no displayable room identity, exits, or raw room text were present.',
    });
  }

  if (!roomMappingsConfigured && minimapConfigured) {
    return buildUnavailableMapModel('loading', {
      title: 'Waiting for MINIMAP',
      detail: 'MINIMAP is requested, but no live map payload has arrived.',
    });
  }

  return buildUnavailableMapModel('loading', {
    title: 'Waiting for room map data',
    detail:
      'Room MSDP variables are requested, but no room or exit payload has arrived in this session.',
  });
}

function pickRoomState(mudState: MudState): MudState {
  return {
    room: mudState.room,
    roomName: mudState.roomName,
    areaName: mudState.areaName,
    roomVnum: mudState.roomVnum,
    roomExits: mudState.roomExits,
    worldTime: mudState.worldTime,
  };
}

function buildMapFallback(roomDisplay: RoomDisplayModel): MapFallbackModel {
  const presentFields = roomDisplay.identityFields
    .filter((field) => field.availability.kind === 'present')
    .map(toMapIdentityField);
  const exits = roomDisplay.exits.map(toMapExit);
  const mapper = buildMapperModel(presentFields, exits, roomDisplay.rawRoomText);
  const roomName = readFieldText(roomDisplay.identityFields, 'roomName');
  const areaName = readFieldText(roomDisplay.identityFields, 'areaName');
  const roomVnum = readFieldText(roomDisplay.identityFields, 'roomVnum');
  const worldTime = readFieldText(roomDisplay.identityFields, 'worldTime');
  const headingText = [roomName, areaName].filter(Boolean).join(' - ') || 'Room context';
  const summaryLines = [
    headingText,
    roomVnum ? `Room #${roomVnum}` : undefined,
    worldTime ? `World time: ${worldTime}` : undefined,
    exits.length > 0 ? `Exits: ${exits.map(formatExitSummary).join(', ')}` : undefined,
    roomDisplay.rawRoomText,
  ].filter((line): line is string => Boolean(line));
  const summaryText = summaryLines.join('\n');
  const ariaLabelParts = [
    'Room map fallback.',
    roomName ? `Room ${roomName}.` : undefined,
    areaName ? `Area ${areaName}.` : undefined,
    exits.length > 0
      ? `${exits.length} ${exits.length === 1 ? 'exit' : 'exits'} available.`
      : undefined,
  ].filter(Boolean);

  return {
    headingText,
    summaryText,
    mapper,
    identityFields: presentFields,
    exits,
    rawRoomText: roomDisplay.rawRoomText,
    ariaLabel: ariaLabelParts.join(' '),
  };
}

function toMapIdentityField(field: RoomIdentityFieldModel): MapFallbackIdentityField {
  return {
    id: field.id,
    label: field.label,
    valueText: field.valueText,
    ariaLabel: field.ariaLabel,
  };
}

function toMapExit(exit: RoomExitModel): MapFallbackExit {
  return {
    id: exit.id,
    kind: exit.kind,
    directionText: exit.directionText,
    destinationText: exit.destinationText,
    statusText: exit.statusText,
    rawText: exit.rawText,
    unknownFieldsText: exit.unknownFieldsText,
    ariaLabel: exit.ariaLabel,
  };
}

function readFieldText(fields: RoomIdentityFieldModel[], id: RoomIdentityFieldModel['id']) {
  const field = fields.find((entry) => entry.id === id && entry.availability.kind === 'present');
  return field?.valueText;
}

function formatExitSummary(exit: MapFallbackExit) {
  if (exit.kind === 'raw') {
    return exit.rawText ? `${exit.directionText}: ${exit.rawText}` : exit.directionText;
  }

  const detail = [exit.destinationText, exit.statusText].filter(Boolean).join(', ');
  return detail ? `${exit.directionText} (${detail})` : exit.directionText;
}

type MapperDirectionDescriptor = {
  placement: Exclude<MapMapperBranchPlacement, 'other'>;
  labels: readonly string[];
};

const MAPPER_DIRECTION_DESCRIPTORS: MapperDirectionDescriptor[] = [
  { placement: 'north', labels: ['n', 'north'] },
  { placement: 'northeast', labels: ['ne', 'northeast', 'north east'] },
  { placement: 'east', labels: ['e', 'east'] },
  { placement: 'southeast', labels: ['se', 'southeast', 'south east'] },
  { placement: 'south', labels: ['s', 'south'] },
  { placement: 'southwest', labels: ['sw', 'southwest', 'south west'] },
  { placement: 'west', labels: ['w', 'west'] },
  { placement: 'northwest', labels: ['nw', 'northwest', 'north west'] },
  { placement: 'up', labels: ['u', 'up'] },
  { placement: 'down', labels: ['d', 'down'] },
  { placement: 'in', labels: ['in'] },
  { placement: 'out', labels: ['out'] },
];
const MAPPER_PLACEMENT_BY_DIRECTION = new Map<string, MapMapperBranchPlacement>(
  MAPPER_DIRECTION_DESCRIPTORS.flatMap((descriptor) =>
    descriptor.labels.map((label) => [normalizeMapperDirectionKey(label), descriptor.placement]),
  ),
);
const MAPPER_SOURCE_FIELD_ORDER: MapMapperSourceField[] = [
  'room',
  'roomName',
  'areaName',
  'roomVnum',
  'roomExits',
];
const MAPPER_BRANCH_SUMMARY_LIMIT = 8;

function buildMapperModel(
  identityFields: MapFallbackIdentityField[],
  exits: MapFallbackExit[],
  rawRoomText: string | undefined,
): MapMapperModel | undefined {
  const branches = exits.flatMap(toMapperBranch);
  const sourceFields = collectMapperSourceFields(identityFields, rawRoomText, branches);

  if (sourceFields.length === 0 && branches.length === 0) {
    return undefined;
  }

  const currentRoom = buildCurrentRoomNode(identityFields, sourceFields);
  const summaryText = formatMapperSummary(currentRoom, branches);
  const ariaLabel = formatMapperAriaLabel(currentRoom, branches);

  return {
    source: 'roomFallback',
    sourceFields,
    currentRoom,
    branches,
    summaryText,
    ariaLabel,
  };
}

function collectMapperSourceFields(
  identityFields: MapFallbackIdentityField[],
  rawRoomText: string | undefined,
  branches: MapMapperBranch[],
) {
  const sourceFields = new Set<MapMapperSourceField>();

  if (rawRoomText) {
    sourceFields.add('room');
  }

  for (const field of identityFields) {
    const sourceField = mapIdentityFieldSource(field.id);
    if (sourceField) {
      sourceFields.add(sourceField);
    }
  }

  if (branches.length > 0) {
    sourceFields.add('roomExits');
  }

  return MAPPER_SOURCE_FIELD_ORDER.filter((field) => sourceFields.has(field));
}

function mapIdentityFieldSource(id: string): MapMapperSourceField | undefined {
  switch (id) {
    case 'roomName':
      return 'roomName';
    case 'areaName':
      return 'areaName';
    case 'roomVnum':
      return 'roomVnum';
    case 'worldTime':
      return undefined;
    default:
      return undefined;
  }
}

function buildCurrentRoomNode(
  identityFields: MapFallbackIdentityField[],
  sourceFields: MapMapperSourceField[],
): MapMapperCurrentRoomNode {
  const roomName = readFallbackField(identityFields, 'roomName');
  const areaName = readFallbackField(identityFields, 'areaName');
  const roomVnum = readFallbackField(identityFields, 'roomVnum');
  const labelText = roomName ?? (roomVnum ? `Room #${roomVnum}` : 'Current room');
  const detailParts = [
    areaName ? `Area: ${areaName}` : undefined,
    roomName && roomVnum ? `Room #${roomVnum}` : undefined,
  ].filter((part): part is string => Boolean(part));
  const currentRoomSourceFields = sourceFields.filter((field) => field !== 'roomExits');

  return {
    id: 'current-room',
    kind: 'currentRoom',
    labelText,
    detailText: detailParts.length > 0 ? detailParts.join(' | ') : undefined,
    sourceFields: currentRoomSourceFields,
    ariaLabel: formatCurrentRoomAriaLabel(labelText, areaName, roomVnum),
  };
}

function toMapperBranch(exit: MapFallbackExit): MapMapperBranch[] {
  if (exit.kind !== 'exit') {
    return [];
  }

  const placement = resolveMapperBranchPlacement(exit.directionText);

  return [
    {
      id: `mapper-${exit.id}`,
      kind: 'directionalExit',
      source: 'roomExits',
      placement,
      directionText: exit.directionText,
      destinationText: exit.destinationText,
      statusText: exit.statusText,
      unknownFieldsText: exit.unknownFieldsText,
      ariaLabel: formatMapperBranchAriaLabel(
        exit.directionText,
        placement,
        exit.destinationText,
        exit.statusText,
        exit.unknownFieldsText,
      ),
    },
  ];
}

function resolveMapperBranchPlacement(directionText: string): MapMapperBranchPlacement {
  return MAPPER_PLACEMENT_BY_DIRECTION.get(normalizeMapperDirectionKey(directionText)) ?? 'other';
}

function readFallbackField(fields: MapFallbackIdentityField[], id: string) {
  return fields.find((field) => field.id === id)?.valueText;
}

function formatMapperSummary(currentRoom: MapMapperCurrentRoomNode, branches: MapMapperBranch[]) {
  const visibleBranches = branches.slice(0, MAPPER_BRANCH_SUMMARY_LIMIT).map(formatBranchSummary);
  const remainingBranches = branches.length - visibleBranches.length;
  const branchText =
    branches.length === 0
      ? 'No directional exits reported.'
      : `Exits: ${[
          ...visibleBranches,
          remainingBranches > 0 ? `${remainingBranches} more` : undefined,
        ]
          .filter((part): part is string => Boolean(part))
          .join(', ')}.`;

  return `${currentRoom.ariaLabel} ${branchText}`;
}

function formatMapperAriaLabel(currentRoom: MapMapperCurrentRoomNode, branches: MapMapperBranch[]) {
  const branchSummary =
    branches.length === 0
      ? 'No directional exits available.'
      : `${branches.length} ${branches.length === 1 ? 'directional exit' : 'directional exits'} available.`;
  return `Bounded room mapper. ${currentRoom.ariaLabel} ${branchSummary}`;
}

function formatCurrentRoomAriaLabel(
  labelText: string,
  areaName: string | undefined,
  roomVnum: string | undefined,
) {
  const details = [
    `Current room ${labelText}`,
    areaName ? `Area ${areaName}` : undefined,
    roomVnum && labelText !== `Room #${roomVnum}` ? `Room number ${roomVnum}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return `${details.join('. ')}.`;
}

function formatMapperBranchAriaLabel(
  directionText: string,
  placement: MapMapperBranchPlacement,
  destinationText: string | undefined,
  statusText: string | undefined,
  unknownFieldsText: string | undefined,
) {
  const placementText = placement === 'other' ? 'other branch' : `${placement} branch`;
  const parts = [
    `${directionText} exit, ${placementText}`,
    destinationText ? `Destination ${destinationText}` : undefined,
    statusText ? `Status ${statusText}` : undefined,
    unknownFieldsText ? `Other fields ${unknownFieldsText}` : undefined,
  ];

  return `${parts.filter(Boolean).join('. ')}.`;
}

function formatBranchSummary(branch: MapMapperBranch) {
  const detail = [branch.destinationText, branch.statusText].filter(Boolean).join(', ');
  return detail ? `${branch.directionText} (${detail})` : branch.directionText;
}

function normalizeMapperDirectionKey(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeMinimapText(value: string | undefined) {
  const text = value?.trimEnd();
  return text && text.trim().length > 0 ? text : undefined;
}

function hasAnyRoomMapMapping(msdpVariables: MsdpVariableMap) {
  return (
    isMsdpVariableConfigured(msdpVariables, 'room') ||
    isMsdpVariableConfigured(msdpVariables, 'roomName') ||
    isMsdpVariableConfigured(msdpVariables, 'areaName') ||
    isMsdpVariableConfigured(msdpVariables, 'roomVnum') ||
    isMsdpVariableConfigured(msdpVariables, 'roomExits') ||
    isMsdpVariableConfigured(msdpVariables, 'worldTime')
  );
}

function buildUnavailableMapModel(
  state: Exclude<MapDisplayState, 'liveOverride' | 'fallback'>,
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): MapDisplayModel {
  const kind = state === 'disabled' ? 'unavailable' : state;
  const availability = createMapNotice(kind, notice);

  return {
    state,
    source: 'none',
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function createMapNotice(
  kind: DisplayAvailabilityNotice['kind'],
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): DisplayAvailabilityNotice {
  return {
    kind,
    ...notice,
  };
}
