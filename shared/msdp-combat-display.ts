import type { ConnectionStatus, MsdpVariableMap, MudState, MudValue } from './mud.ts';
import {
  clampPercentage,
  formatAvailabilityAriaLabel,
  formatDisplayNumber,
  formatSignedDisplayNumber,
  isMsdpVariableConfigured,
  normalizeDisplayNumber,
} from './msdp-display.ts';
import type { DisplayAvailabilityNotice } from './msdp-display.ts';

export type CombatParticipantId = 'opponent' | 'tank';

export type CombatParticipantModel = {
  id: CombatParticipantId;
  label: string;
  nameText: string;
  valueText: string;
  percentage: number;
  accentClass: string;
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type ActionEntryKind = 'text' | 'record' | 'raw';

export type ActionEntryModel = {
  id: string;
  label: string;
  valueText: string;
  detailText?: string;
  kind: ActionEntryKind;
  ariaLabel: string;
};

export type ActionEconomyModel = {
  entries: ActionEntryModel[];
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type DamageBonusCombatModel = {
  label: string;
  valueText: string;
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type CombatDisplayModel = {
  opponent: CombatParticipantModel;
  tank: CombatParticipantModel;
  actions: ActionEconomyModel;
  damageBonus: DamageBonusCombatModel;
};

const DAMAGE_BONUS_LABEL = 'Damage bonus';
const ACTION_NAME_KEYS = ['name', 'NAME', 'action', 'ACTION', 'label', 'LABEL', 'type', 'TYPE'];

type ParticipantHealthParts = {
  current?: number;
  max?: number;
};

export function buildDamageBonusCombatModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): DamageBonusCombatModel {
  const normalized = normalizeDisplayNumber(mudState.damageBonus);

  if (normalized !== undefined) {
    const valueText = formatSignedDisplayNumber(normalized) ?? String(normalized);
    const availability = createCombatAvailabilityNotice('present', {
      title: 'Damage bonus reported',
      detail: 'DAMAGE_BONUS arrived through an explicit override mapping.',
    });

    return {
      label: DAMAGE_BONUS_LABEL,
      valueText,
      availability,
      ariaLabel: `${DAMAGE_BONUS_LABEL} ${valueText}. Override reported.`,
    };
  }

  const availability = getMissingDamageBonusNotice(status, msdpVariables);

  return {
    label: DAMAGE_BONUS_LABEL,
    valueText: availability.title,
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

export function buildOpponentCombatModel(
  mudState: MudState,
  status: ConnectionStatus,
): CombatParticipantModel {
  return buildCombatParticipantModel(
    'opponent',
    status,
    mudState.opponentName,
    mudState.opponentHealth,
    mudState.opponentHealthMax,
  );
}

export function buildTankCombatModel(
  mudState: MudState,
  status: ConnectionStatus,
): CombatParticipantModel {
  return buildCombatParticipantModel(
    'tank',
    status,
    mudState.tankName,
    mudState.tankHealth,
    mudState.tankHealthMax,
  );
}

export function buildActionEconomyModel(
  value: MudValue | undefined,
  status: ConnectionStatus,
): ActionEconomyModel {
  if (value === undefined) {
    return buildMissingActionEconomyModel(status);
  }

  const entries = normalizeActionEntries(value);

  if (entries.length === 0) {
    const availability = createCombatAvailabilityNotice('empty', {
      title: 'No actions reported',
      detail: 'ACTIONS arrived as an empty or blank payload.',
    });

    return {
      entries: [],
      availability,
      ariaLabel: formatAvailabilityAriaLabel(availability),
    };
  }

  const availability = createCombatAvailabilityNotice('present', {
    title: 'Actions reported',
    detail: `${entries.length} ACTIONS ${entries.length === 1 ? 'entry is' : 'entries are'} available for display.`,
  });

  return {
    entries,
    availability,
    ariaLabel: `Actions reported. ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}.`,
  };
}

export function buildCombatDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): CombatDisplayModel {
  return {
    opponent: buildOpponentCombatModel(mudState, status),
    tank: buildTankCombatModel(mudState, status),
    actions: buildActionEconomyModel(mudState.actions, status),
    damageBonus: buildDamageBonusCombatModel(mudState, status, msdpVariables),
  };
}

export function buildMissingCombatParticipantModel(
  id: CombatParticipantId,
  status: ConnectionStatus,
): CombatParticipantModel {
  const label = id === 'opponent' ? 'Opponent' : 'Tank';
  const availability = getMissingCombatParticipantNotice(label, status);
  const valueText =
    availability.kind === 'offline'
      ? 'Offline'
      : availability.kind === 'error'
        ? 'Unavailable'
        : availability.kind === 'loading'
          ? 'Waiting'
          : 'Not reported';

  return {
    id,
    label,
    nameText: availability.title,
    valueText,
    percentage: 0,
    accentClass: id === 'opponent' ? 'bar-opponent' : 'bar-tank',
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function normalizeActionEntries(value: MudValue): ActionEntryModel[] {
  if (value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => createActionEntry(entry, index));
  }

  if (isMudRecord(value)) {
    return Object.entries(value).flatMap(([key, entryValue], index) =>
      createObjectActionEntry(key, entryValue, index),
    );
  }

  return createActionEntry(value, 0);
}

function createActionEntry(value: MudValue, index: number): ActionEntryModel[] {
  const fallbackLabel = `Action ${index + 1}`;

  if (value === null) {
    return [];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    return [
      {
        id: `action-${index}`,
        label: fallbackLabel,
        valueText: trimmed,
        kind: 'text',
        ariaLabel: `${fallbackLabel}: ${trimmed}.`,
      },
    ];
  }

  if (isMudRecord(value)) {
    const namedValue = readNamedActionValue(value);
    const detailText = formatActionRecordDetail(value, namedValue.key);
    const valueText = namedValue.text ?? formatMudValueAsText(value);

    if (!valueText && !detailText) {
      return [];
    }

    return [
      {
        id: `action-${index}`,
        label: fallbackLabel,
        valueText: valueText || 'Structured action',
        detailText: detailText || undefined,
        kind: 'record',
        ariaLabel: [fallbackLabel, valueText, detailText].filter(Boolean).join('. '),
      },
    ];
  }

  const valueText = formatMudValueAsText(value);

  return valueText
    ? [
        {
          id: `action-${index}`,
          label: fallbackLabel,
          valueText,
          kind: 'raw',
          ariaLabel: `${fallbackLabel}: ${valueText}.`,
        },
      ]
    : [];
}

function createObjectActionEntry(key: string, value: MudValue, index: number): ActionEntryModel[] {
  const valueText = formatMudValueAsText(value);
  if (!valueText) {
    return [];
  }

  const label = formatMudLabel(key) || `Action ${index + 1}`;

  return [
    {
      id: `action-${index}-${key}`,
      label,
      valueText,
      kind: 'record',
      ariaLabel: `${label}: ${valueText}.`,
    },
  ];
}

function readNamedActionValue(record: Record<string, MudValue>) {
  for (const key of ACTION_NAME_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return { key, text: value.trim() };
    }
  }

  return { key: undefined, text: undefined };
}

function formatActionRecordDetail(record: Record<string, MudValue>, nameKey: string | undefined) {
  const entries = Object.entries(record)
    .filter(([key]) => key !== nameKey)
    .map(([key, value]) => {
      const valueText = formatMudValueAsText(value);
      return valueText ? `${formatMudLabel(key)}: ${valueText}` : null;
    })
    .filter((entry): entry is string => Boolean(entry));

  return entries.join(' | ');
}

function formatMudValueAsText(value: MudValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
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
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isMudRecord(value: MudValue): value is Record<string, MudValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildCombatParticipantModel(
  id: CombatParticipantId,
  status: ConnectionStatus,
  name: string | undefined,
  current: number | undefined,
  max: number | undefined,
): CombatParticipantModel {
  const label = id === 'opponent' ? 'Opponent' : 'Tank';
  const normalizedName = normalizeCombatText(name);
  const normalizedCurrent = normalizeDisplayNumber(current);
  const normalizedMax = normalizeDisplayNumber(max);
  const hasReportedName = name !== undefined;
  const hasReportedHealth = normalizedCurrent !== undefined || normalizedMax !== undefined;

  if (!hasReportedName && !hasReportedHealth) {
    return buildMissingCombatParticipantModel(id, status);
  }

  if (!normalizedName && !hasReportedHealth) {
    return buildEmptyReportedParticipantModel(id, label);
  }

  const health: ParticipantHealthParts = {
    current: normalizedCurrent,
    max: normalizedMax,
  };
  const nameText = normalizedName ?? `Unknown ${label.toLowerCase()}`;
  const valueText = formatParticipantHealthValue(health);
  const percentage = clampPercentage(normalizedCurrent, normalizedMax);
  const availability = createCombatAvailabilityNotice('present', {
    title: `${label} reported`,
    detail: formatParticipantDetail(label, normalizedName, health),
  });

  return {
    id,
    label,
    nameText,
    valueText,
    percentage,
    accentClass: id === 'opponent' ? 'bar-opponent' : 'bar-tank',
    availability,
    ariaLabel: formatParticipantAriaLabel(label, nameText, health),
  };
}

function buildEmptyReportedParticipantModel(
  id: CombatParticipantId,
  label: string,
): CombatParticipantModel {
  const availability = createCombatAvailabilityNotice('empty', {
    title: `${label} empty`,
    detail: `The server reported a blank ${label.toLowerCase()} name and no health values.`,
  });

  return {
    id,
    label,
    nameText: availability.title,
    valueText: 'Not reported',
    percentage: 0,
    accentClass: id === 'opponent' ? 'bar-opponent' : 'bar-tank',
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

export function buildMissingActionEconomyModel(status: ConnectionStatus): ActionEconomyModel {
  const availability = getMissingActionEconomyNotice(status);

  return {
    entries: [],
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function formatParticipantHealthValue(health: ParticipantHealthParts) {
  const currentText = formatDisplayNumber(health.current);
  const maxText = formatDisplayNumber(health.max);

  if (health.current !== undefined && health.max !== undefined && health.max > 0) {
    return `${currentText ?? health.current} / ${maxText ?? health.max}`;
  }

  if (health.current !== undefined) {
    return currentText ?? String(health.current);
  }

  if (health.max !== undefined) {
    return `Max ${maxText ?? health.max}`;
  }

  return 'Name only';
}

function formatParticipantDetail(
  label: string,
  normalizedName: string | undefined,
  health: ParticipantHealthParts,
) {
  const nameDetail = normalizedName ? `${label} name is reported.` : `${label} name is missing.`;

  if (health.current !== undefined && health.max !== undefined && health.max > 0) {
    return `${nameDetail} Current and maximum health are reported.`;
  }

  if (health.current !== undefined) {
    return `${nameDetail} Current health is reported without a usable maximum.`;
  }

  if (health.max !== undefined) {
    return `${nameDetail} Maximum health is reported without current health.`;
  }

  return `${nameDetail} Health values are not reported.`;
}

function formatParticipantAriaLabel(
  label: string,
  nameText: string,
  health: ParticipantHealthParts,
) {
  if (health.current !== undefined && health.max !== undefined && health.max > 0) {
    return `${label} ${nameText}. Health ${formatDisplayNumber(health.current)} of ${formatDisplayNumber(
      health.max,
    )}.`;
  }

  if (health.current !== undefined) {
    return `${label} ${nameText}. Current health ${formatDisplayNumber(health.current)}. Maximum not reported.`;
  }

  if (health.max !== undefined) {
    return `${label} ${nameText}. Maximum health ${formatDisplayNumber(health.max)}. Current health not reported.`;
  }

  return `${label} ${nameText}. Health not reported.`;
}

function normalizeCombatText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function createCombatAvailabilityNotice(
  kind: DisplayAvailabilityNotice['kind'],
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): DisplayAvailabilityNotice {
  return {
    kind,
    ...notice,
  };
}

function getMissingDamageBonusNotice(
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): DisplayAvailabilityNotice {
  if (status === 'idle' || status === 'disconnected') {
    return createCombatAvailabilityNotice('offline', {
      title: 'Damage bonus offline',
      detail: 'Connect before damage bonus data can be evaluated.',
    });
  }

  if (status === 'error') {
    return createCombatAvailabilityNotice('error', {
      title: 'Damage bonus unavailable',
      detail: 'The connection ended before damage bonus data could be evaluated.',
    });
  }

  if (!isMsdpVariableConfigured(msdpVariables, 'damageBonus')) {
    return createCombatAvailabilityNotice('unavailable', {
      title: 'Damage bonus unconfirmed',
      detail: 'DAMAGE_BONUS is not reliably populated by the audited server source.',
    });
  }

  return createCombatAvailabilityNotice('loading', {
    title: 'Waiting for damage bonus',
    detail: 'A DAMAGE_BONUS override is configured, but no value has arrived.',
  });
}

function getMissingCombatParticipantNotice(
  label: string,
  status: ConnectionStatus,
): DisplayAvailabilityNotice {
  if (status === 'idle' || status === 'disconnected') {
    return createCombatAvailabilityNotice('offline', {
      title: `${label} offline`,
      detail: `Connect before ${label.toLowerCase()} data can be evaluated.`,
    });
  }

  if (status === 'error') {
    return createCombatAvailabilityNotice('error', {
      title: `${label} unavailable`,
      detail: `The connection ended before ${label.toLowerCase()} data could be evaluated.`,
    });
  }

  if (status === 'connecting') {
    return createCombatAvailabilityNotice('loading', {
      title: `Waiting for ${label.toLowerCase()}`,
      detail: `Waiting for ${label.toLowerCase()} data from source-confirmed MSDP fields.`,
    });
  }

  return createCombatAvailabilityNotice('empty', {
    title: `No ${label.toLowerCase()}`,
    detail: `${label} data has not been reported in this connected session.`,
  });
}

function getMissingActionEconomyNotice(status: ConnectionStatus): DisplayAvailabilityNotice {
  if (status === 'idle' || status === 'disconnected') {
    return createCombatAvailabilityNotice('offline', {
      title: 'Actions offline',
      detail: 'Connect before ACTIONS data can be evaluated.',
    });
  }

  if (status === 'error') {
    return createCombatAvailabilityNotice('error', {
      title: 'Actions unavailable',
      detail: 'The connection ended before ACTIONS data could be evaluated.',
    });
  }

  return createCombatAvailabilityNotice('loading', {
    title: 'Waiting for actions',
    detail: 'Waiting for ACTIONS data from source-confirmed MSDP fields.',
  });
}
