import type { ConnectionStatus, MsdpVariableMap, MudState, MudValue } from './mud.ts';
import {
  formatAvailabilityAriaLabel,
  formatDisplayNumber,
  isMsdpVariableConfigured,
  normalizeDisplayNumber,
} from './msdp-display.ts';
import type { DisplayAvailabilityNotice } from './msdp-display.ts';

export type CollectionDisplayState =
  | 'present'
  | 'raw'
  | 'empty'
  | 'loading'
  | 'offline'
  | 'error'
  | 'disabled';

export type AffectRowKind = 'effect' | 'raw';

export type AffectRowModel = {
  id: string;
  kind: AffectRowKind;
  nameText: string;
  isNameMissing: boolean;
  durationText?: string;
  isDurationMissing: boolean;
  modifierText?: string;
  statusText?: string;
  unknownFieldsText?: string;
  rawText?: string;
  ariaLabel: string;
};

export type AffectsDisplayModel = {
  state: CollectionDisplayState;
  rows: AffectRowModel[];
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type InventoryItemKind = 'item' | 'count' | 'raw';

export type InventoryItemModel = {
  id: string;
  kind: InventoryItemKind;
  nameText: string;
  isNameMissing: boolean;
  countText?: string;
  locationText?: string;
  detailText?: string;
  unknownFieldsText?: string;
  rawText?: string;
  ariaLabel: string;
};

export type InventoryGroupModel = {
  id: string;
  label: string;
  items: InventoryItemModel[];
  ariaLabel: string;
};

export type InventoryDisplayModel = {
  state: CollectionDisplayState;
  groups: InventoryGroupModel[];
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

type MudRecord = Record<string, MudValue>;

const AFFECT_NAME_KEYS = [
  'name',
  'NAME',
  'affect',
  'AFFECT',
  'effect',
  'EFFECT',
  'spell',
  'SPELL',
  'label',
  'LABEL',
] as const;
const AFFECT_DURATION_KEYS = [
  'duration',
  'DURATION',
  'time',
  'TIME',
  'rounds',
  'ROUNDS',
  'ticks',
  'TICKS',
  'expires_in',
  'EXPIRES_IN',
  'expiresIn',
  'EXPIRESIN',
] as const;
const AFFECT_MODIFIER_KEYS = [
  'modifier',
  'MODIFIER',
  'modifiers',
  'MODIFIERS',
  'mod',
  'MOD',
  'bonus',
  'BONUS',
  'penalty',
  'PENALTY',
] as const;
const AFFECT_STATUS_KEYS = ['status', 'STATUS', 'state', 'STATE', 'source', 'SOURCE'] as const;
const INVENTORY_NAME_KEYS = [
  'name',
  'NAME',
  'item',
  'ITEM',
  'item_name',
  'ITEM_NAME',
  'itemName',
  'ITEMNAME',
  'label',
  'LABEL',
] as const;
const INVENTORY_COUNT_KEYS = [
  'count',
  'COUNT',
  'quantity',
  'QUANTITY',
  'qty',
  'QTY',
  'amount',
  'AMOUNT',
  'number',
  'NUMBER',
] as const;
const INVENTORY_LOCATION_KEYS = [
  'location',
  'LOCATION',
  'slot',
  'SLOT',
  'container',
  'CONTAINER',
  'place',
  'PLACE',
  'worn',
  'WORN',
  'equipped',
  'EQUIPPED',
] as const;
const INVENTORY_DETAIL_KEYS = [
  'detail',
  'DETAIL',
  'description',
  'DESCRIPTION',
  'type',
  'TYPE',
] as const;

const RECOGNIZED_AFFECT_KEYS = new Set(
  [
    ...AFFECT_NAME_KEYS,
    ...AFFECT_DURATION_KEYS,
    ...AFFECT_MODIFIER_KEYS,
    ...AFFECT_STATUS_KEYS,
  ].map(normalizeFieldKey),
);
const RECOGNIZED_INVENTORY_KEYS = new Set(
  [
    ...INVENTORY_NAME_KEYS,
    ...INVENTORY_COUNT_KEYS,
    ...INVENTORY_LOCATION_KEYS,
    ...INVENTORY_DETAIL_KEYS,
  ].map(normalizeFieldKey),
);
const UNKNOWN_FIELD_LIMIT = 3;
const UNKNOWN_FIELD_TEXT_LIMIT = 96;
const RAW_TEXT_LIMIT = 180;

export function buildAffectsDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): AffectsDisplayModel {
  const unavailable = getUnavailableCollectionNotice(
    'Affects',
    'AFFECTS',
    'affects',
    mudState.affects,
    status,
    msdpVariables,
  );

  if (unavailable) {
    return buildUnavailableAffectsModel(unavailable.state, unavailable.notice);
  }

  const rows = normalizeAffectRows(mudState.affects as MudValue);

  if (rows.length === 0) {
    return buildUnavailableAffectsModel('empty', {
      kind: 'empty',
      title: 'No active affects',
      detail: 'The server reported an empty affects collection.',
    });
  }

  const state = rows.every((row) => row.kind === 'raw') ? 'raw' : 'present';
  const availability = createCollectionNotice('present', {
    title: state === 'raw' ? 'Raw affects reported' : 'Affects reported',
    detail: `${rows.length} ${rows.length === 1 ? 'affect entry is' : 'affect entries are'} available for display.`,
  });

  return {
    state,
    rows,
    availability,
    ariaLabel: `Affects reported. ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}.`,
  };
}

export function buildInventoryDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): InventoryDisplayModel {
  const unavailable = getUnavailableCollectionNotice(
    'Inventory',
    'INVENTORY',
    'inventory',
    mudState.inventory,
    status,
    msdpVariables,
  );

  if (unavailable) {
    return buildUnavailableInventoryModel(unavailable.state, unavailable.notice);
  }

  const groups = normalizeInventoryGroups(mudState.inventory as MudValue);
  const itemCount = countInventoryItems(groups);

  if (itemCount === 0) {
    return buildUnavailableInventoryModel('empty', {
      kind: 'empty',
      title: 'Inventory empty',
      detail: 'The server reported an empty inventory collection.',
    });
  }

  const state = groups.every((group) => group.items.every((item) => item.kind === 'raw'))
    ? 'raw'
    : 'present';
  const availability = createCollectionNotice('present', {
    title: state === 'raw' ? 'Raw inventory reported' : 'Inventory reported',
    detail: `${itemCount} ${itemCount === 1 ? 'inventory entry is' : 'inventory entries are'} available for display.`,
  });

  return {
    state,
    groups,
    availability,
    ariaLabel: `Inventory reported. ${itemCount} ${itemCount === 1 ? 'entry' : 'entries'}.`,
  };
}

export function normalizeAffectRows(value: MudValue): AffectRowModel[] {
  if (value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => createAffectEntry(entry, index));
  }

  if (isMudRecord(value)) {
    if (looksLikeAffectRecord(value)) {
      return [createAffectRow(value, 0)];
    }

    return Object.entries(value).flatMap(([key, entry], index) =>
      createObjectAffectEntry(key, entry, index),
    );
  }

  return createRawAffectEntry(value, 0);
}

export function normalizeInventoryGroups(value: MudValue): InventoryGroupModel[] {
  if (value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return createInventoryGroup(
      'inventory',
      'Inventory',
      value.flatMap((entry, index) => createInventoryEntry(entry, index)),
    );
  }

  if (isMudRecord(value)) {
    if (looksLikeInventoryItemRecord(value)) {
      return createInventoryGroup('inventory', 'Inventory', [createInventoryRecordItem(value, 0)]);
    }

    const groups: InventoryGroupModel[] = [];
    const looseItems: InventoryItemModel[] = [];

    Object.entries(value).forEach(([key, entry], index) => {
      const label = formatMudLabel(key) || `Group ${index + 1}`;

      if (entry === null) {
        return;
      }

      if (Array.isArray(entry)) {
        groups.push(
          ...createInventoryGroup(
            `group-${index}-${normalizeIdPart(key)}`,
            label,
            entry.flatMap((item, itemIndex) => createInventoryEntry(item, itemIndex)),
          ),
        );
        return;
      }

      if (isMudRecord(entry)) {
        if (looksLikeInventoryItemRecord(entry)) {
          groups.push(
            ...createInventoryGroup(`group-${index}-${normalizeIdPart(key)}`, label, [
              createInventoryRecordItem(entry, index),
            ]),
          );
          return;
        }

        groups.push(
          ...createInventoryGroup(
            `group-${index}-${normalizeIdPart(key)}`,
            label,
            Object.entries(entry).flatMap(([itemKey, itemValue], itemIndex) =>
              createObjectInventoryEntry(itemKey, itemValue, itemIndex),
            ),
          ),
        );
        return;
      }

      looseItems.push(...createObjectInventoryEntry(key, entry, index));
    });

    if (looseItems.length > 0) {
      groups.unshift(...createInventoryGroup('inventory', 'Inventory', looseItems));
    }

    return groups;
  }

  return createInventoryGroup('raw', 'Raw inventory', createRawInventoryEntry(value, 0));
}

function buildUnavailableAffectsModel(
  state: Exclude<CollectionDisplayState, 'present' | 'raw'>,
  availability: DisplayAvailabilityNotice,
): AffectsDisplayModel {
  return {
    state,
    rows: [],
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function buildUnavailableInventoryModel(
  state: Exclude<CollectionDisplayState, 'present' | 'raw'>,
  availability: DisplayAvailabilityNotice,
): InventoryDisplayModel {
  return {
    state,
    groups: [],
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function getUnavailableCollectionNotice(
  label: 'Affects' | 'Inventory',
  variableName: 'AFFECTS' | 'INVENTORY',
  key: 'affects' | 'inventory',
  value: MudValue | undefined,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): {
  state: Exclude<CollectionDisplayState, 'present' | 'raw' | 'empty'>;
  notice: DisplayAvailabilityNotice;
} | null {
  const labelLower = label.toLowerCase();

  if (status === 'idle' || status === 'disconnected') {
    return {
      state: 'offline',
      notice: createCollectionNotice('offline', {
        title: `${label} offline`,
        detail: `Connect before ${labelLower} data can be evaluated.`,
      }),
    };
  }

  if (status === 'error') {
    return {
      state: 'error',
      notice: createCollectionNotice('error', {
        title: `${label} unavailable`,
        detail: `The connection ended before ${labelLower} data could be evaluated.`,
      }),
    };
  }

  if (!isMsdpVariableConfigured(msdpVariables, key)) {
    return {
      state: 'disabled',
      notice: createCollectionNotice('unavailable', {
        title: `${label} mapping disabled`,
        detail: `${variableName} is not currently requested by the client settings.`,
      }),
    };
  }

  if (value === undefined) {
    return {
      state: 'loading',
      notice: createCollectionNotice('loading', {
        title: `Waiting for ${labelLower}`,
        detail: `${variableName} is requested, but no ${labelLower} payload has arrived in this session.`,
      }),
    };
  }

  return null;
}

function createAffectEntry(value: MudValue, index: number): AffectRowModel[] {
  if (value === null) {
    return [];
  }

  if (isMudRecord(value)) {
    return [createAffectRow(value, index)];
  }

  return createRawAffectEntry(value, index);
}

function createObjectAffectEntry(key: string, value: MudValue, index: number): AffectRowModel[] {
  const label = formatMudLabel(key) || `Affect ${index + 1}`;

  if (value === null) {
    return [];
  }

  if (isMudRecord(value)) {
    return [createAffectRow(value, index, label)];
  }

  return createRawAffectEntry(value, index, label);
}

function createAffectRow(record: MudRecord, index: number, fallbackName?: string): AffectRowModel {
  const name = normalizeTextValue(readAnyKey(record, AFFECT_NAME_KEYS));
  const nameText = name ?? fallbackName ?? `Unknown affect ${index + 1}`;
  const duration = formatDurationText(readAnyKey(record, AFFECT_DURATION_KEYS));
  const modifierText = formatKnownValues(record, AFFECT_MODIFIER_KEYS);
  const statusText = formatKnownValues(record, AFFECT_STATUS_KEYS);
  const unknownFieldsText = formatUnknownFields(record, RECOGNIZED_AFFECT_KEYS);

  return {
    id: `affect-${index}`,
    kind: 'effect',
    nameText,
    isNameMissing: name === undefined,
    durationText: duration.text,
    isDurationMissing: duration.isMissing,
    modifierText,
    statusText,
    unknownFieldsText,
    ariaLabel: formatAffectAriaLabel(
      index,
      nameText,
      name === undefined,
      duration.text,
      duration.isMissing,
      modifierText,
      statusText,
      unknownFieldsText,
    ),
  };
}

function createRawAffectEntry(
  value: MudValue,
  index: number,
  fallbackLabel?: string,
): AffectRowModel[] {
  const rawText = truncateText(formatMudValueAsText(value), RAW_TEXT_LIMIT);

  if (!rawText) {
    return [];
  }

  const nameText = fallbackLabel ?? `Affect entry ${index + 1}`;

  return [
    {
      id: `raw-affect-${index}`,
      kind: 'raw',
      nameText,
      isNameMissing: false,
      isDurationMissing: true,
      rawText,
      ariaLabel: `${nameText}: ${rawText}.`,
    },
  ];
}

function createInventoryEntry(value: MudValue, index: number): InventoryItemModel[] {
  if (value === null) {
    return [];
  }

  if (isMudRecord(value)) {
    return [createInventoryRecordItem(value, index)];
  }

  return createRawInventoryEntry(value, index);
}

function createObjectInventoryEntry(
  key: string,
  value: MudValue,
  index: number,
): InventoryItemModel[] {
  const label = formatMudLabel(key) || `Item ${index + 1}`;

  if (value === null) {
    return [];
  }

  if (isMudRecord(value)) {
    return [createInventoryRecordItem(value, index, label)];
  }

  if (typeof value === 'number') {
    return [createInventoryCountItem(label, value, index)];
  }

  const normalizedNumber = normalizeDisplayNumber(value);
  if (normalizedNumber !== undefined && String(value).trim() !== '') {
    return [createInventoryCountItem(label, normalizedNumber, index)];
  }

  return createRawInventoryEntry(value, index, label);
}

function createInventoryRecordItem(
  record: MudRecord,
  index: number,
  fallbackName?: string,
): InventoryItemModel {
  const name = normalizeTextValue(readAnyKey(record, INVENTORY_NAME_KEYS));
  const nameText = name ?? fallbackName ?? `Unknown item ${index + 1}`;
  const countText = formatCountText(readAnyKey(record, INVENTORY_COUNT_KEYS));
  const locationText = normalizeTextValue(readAnyKey(record, INVENTORY_LOCATION_KEYS));
  const detailText = formatKnownValues(record, INVENTORY_DETAIL_KEYS);
  const unknownFieldsText = formatUnknownFields(record, RECOGNIZED_INVENTORY_KEYS);

  return {
    id: `item-${index}`,
    kind: 'item',
    nameText,
    isNameMissing: name === undefined,
    countText,
    locationText,
    detailText,
    unknownFieldsText,
    ariaLabel: formatInventoryAriaLabel(
      index,
      nameText,
      name === undefined,
      countText,
      locationText,
      detailText,
      unknownFieldsText,
    ),
  };
}

function createInventoryCountItem(label: string, count: number, index: number): InventoryItemModel {
  const countText = formatDisplayNumber(count) ?? String(count);

  return {
    id: `count-${index}-${normalizeIdPart(label)}`,
    kind: 'count',
    nameText: label,
    isNameMissing: false,
    countText,
    ariaLabel: `${label}. Count ${countText}.`,
  };
}

function createRawInventoryEntry(
  value: MudValue,
  index: number,
  fallbackLabel?: string,
): InventoryItemModel[] {
  const rawText = truncateText(formatMudValueAsText(value), RAW_TEXT_LIMIT);

  if (!rawText) {
    return [];
  }

  const nameText = fallbackLabel ?? `Inventory entry ${index + 1}`;

  return [
    {
      id: `raw-item-${index}`,
      kind: 'raw',
      nameText,
      isNameMissing: false,
      rawText,
      ariaLabel: `${nameText}: ${rawText}.`,
    },
  ];
}

function createInventoryGroup(
  id: string,
  label: string,
  items: InventoryItemModel[],
): InventoryGroupModel[] {
  if (items.length === 0) {
    return [];
  }

  return [
    {
      id,
      label,
      items,
      ariaLabel: `${label}. ${items.length} ${items.length === 1 ? 'entry' : 'entries'}.`,
    },
  ];
}

function countInventoryItems(groups: InventoryGroupModel[]) {
  return groups.reduce((count, group) => count + group.items.length, 0);
}

function looksLikeAffectRecord(record: MudRecord) {
  return Object.entries(record).some(
    ([key, value]) => RECOGNIZED_AFFECT_KEYS.has(normalizeFieldKey(key)) && isScalarMudValue(value),
  );
}

function looksLikeInventoryItemRecord(record: MudRecord) {
  return Object.entries(record).some(
    ([key, value]) =>
      RECOGNIZED_INVENTORY_KEYS.has(normalizeFieldKey(key)) && isScalarMudValue(value),
  );
}

function formatDurationText(value: MudValue | undefined) {
  if (value === undefined || value === null) {
    return {
      text: 'Duration not reported',
      isMissing: true,
    };
  }

  const normalized = normalizeDisplayNumber(value);
  if (normalized !== undefined) {
    const valueText = formatDisplayNumber(normalized) ?? String(normalized);
    return {
      text: `${valueText} ${Math.abs(normalized) === 1 ? 'round' : 'rounds'}`,
      isMissing: false,
    };
  }

  const text = normalizeTextValue(value);
  return {
    text: text ?? 'Duration not reported',
    isMissing: text === undefined,
  };
}

function formatCountText(value: MudValue | undefined) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = normalizeDisplayNumber(value);
  if (normalized !== undefined) {
    return formatDisplayNumber(normalized) ?? String(normalized);
  }

  return normalizeTextValue(value);
}

function formatKnownValues(record: MudRecord, keys: readonly string[]) {
  const values = keys
    .map((key) => {
      if (!(key in record)) {
        return null;
      }

      const valueText = truncateText(formatMudValueAsText(record[key]), UNKNOWN_FIELD_TEXT_LIMIT);
      return valueText ? `${formatMudLabel(key)}: ${valueText}` : null;
    })
    .filter((entry): entry is string => Boolean(entry));

  return values.length > 0 ? values.join(' | ') : undefined;
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

function formatAffectAriaLabel(
  index: number,
  nameText: string,
  isNameMissing: boolean,
  durationText: string,
  isDurationMissing: boolean,
  modifierText: string | undefined,
  statusText: string | undefined,
  unknownFieldsText: string | undefined,
) {
  const parts = [
    isNameMissing
      ? `Affect ${index + 1}, name missing, shown as ${nameText}`
      : `Affect ${index + 1}, ${nameText}`,
    isDurationMissing ? 'Duration not reported' : `Duration ${durationText}`,
    modifierText ? `Modifiers ${modifierText}` : undefined,
    statusText ? `Status ${statusText}` : undefined,
    unknownFieldsText ? `Other fields ${unknownFieldsText}` : undefined,
  ];

  return `${parts.filter(Boolean).join('. ')}.`;
}

function formatInventoryAriaLabel(
  index: number,
  nameText: string,
  isNameMissing: boolean,
  countText: string | undefined,
  locationText: string | undefined,
  detailText: string | undefined,
  unknownFieldsText: string | undefined,
) {
  const parts = [
    isNameMissing
      ? `Item ${index + 1}, name missing, shown as ${nameText}`
      : `Item ${index + 1}, ${nameText}`,
    countText ? `Count ${countText}` : undefined,
    locationText ? `Location ${locationText}` : undefined,
    detailText ? `Details ${detailText}` : undefined,
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

function createCollectionNotice(
  kind: DisplayAvailabilityNotice['kind'],
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): DisplayAvailabilityNotice {
  return {
    kind,
    ...notice,
  };
}
