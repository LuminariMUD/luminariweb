import type { ConnectionStatus, MsdpVariableKey, MsdpVariableMap, MudState } from './mud.ts';

export type DisplayAvailabilityKind =
  | 'present'
  | 'empty'
  | 'loading'
  | 'offline'
  | 'error'
  | 'unavailable';

export type DisplayAvailabilityNotice = {
  kind: DisplayAvailabilityKind;
  title: string;
  detail?: string;
  ariaLabel?: string;
};

export type HudBarId = 'health' | 'psp' | 'movement' | 'experience';

export type HudBarModel = {
  id: HudBarId;
  label: string;
  valueText: string;
  percentage: number;
  accentClass: string;
  availability: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type CharacterFieldModel = {
  id: string;
  label: string;
  valueText: string;
  notice?: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type CharacterIdentityModel = {
  headingText: string;
  profileText: string;
  titleNotice?: DisplayAvailabilityNotice;
  ariaLabel: string;
};

export type CharacterDisplayModel = {
  identity: CharacterIdentityModel;
  abilityScores: CharacterFieldModel[];
  savingThrows: CharacterFieldModel[];
  stats: CharacterFieldModel[];
};

export type CoreDisplayModel = {
  hudBars: HudBarModel[];
  character: CharacterDisplayModel;
};

type OptionalFieldDescriptor = {
  key: MsdpVariableKey;
  label: string;
  unsupported: Omit<DisplayAvailabilityNotice, 'kind'>;
  waiting: Omit<DisplayAvailabilityNotice, 'kind'>;
  empty: Omit<DisplayAvailabilityNotice, 'kind'>;
  offline: Omit<DisplayAvailabilityNotice, 'kind'>;
  error: Omit<DisplayAvailabilityNotice, 'kind'>;
};

type NumberFieldOptions = {
  signed?: boolean;
};

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

const OPTIONAL_FIELD_DESCRIPTORS = {
  title: {
    key: 'title',
    label: 'Title',
    unsupported: {
      title: 'Title mapping disabled',
      detail: 'TITLE is source-backed, but the client is not currently requesting it.',
    },
    waiting: {
      title: 'Waiting for title',
      detail: 'TITLE is requested, but no title value has arrived in this session.',
    },
    empty: {
      title: 'Title empty',
      detail: 'The source reported a blank title.',
    },
    offline: {
      title: 'Title offline',
      detail: 'Connect before title data can be evaluated.',
    },
    error: {
      title: 'Title unavailable',
      detail: 'The connection ended before title data could be evaluated.',
    },
  },
  fortitude: createSavingThrowDescriptor('fortitude', 'Fortitude', 'FORTITUDE'),
  reflex: createSavingThrowDescriptor('reflex', 'Reflex', 'REFLEX'),
  willpower: createSavingThrowDescriptor('willpower', 'Willpower', 'WILLPOWER'),
  damageBonus: {
    key: 'damageBonus',
    label: 'Damage bonus',
    unsupported: {
      title: 'Damage bonus unconfirmed',
      detail: 'DAMAGE_BONUS is not reliably populated by the audited server source.',
    },
    waiting: {
      title: 'Waiting for damage bonus',
      detail: 'A DAMAGE_BONUS override is configured, but no value has arrived.',
    },
    empty: {
      title: 'Damage bonus empty',
      detail: 'The server reported a blank damage bonus.',
    },
    offline: {
      title: 'Damage bonus offline',
      detail: 'Connect before damage bonus data can be evaluated.',
    },
    error: {
      title: 'Damage bonus unavailable',
      detail: 'The connection ended before damage bonus data could be evaluated.',
    },
  },
} as const satisfies Record<
  'title' | 'fortitude' | 'reflex' | 'willpower' | 'damageBonus',
  OptionalFieldDescriptor
>;

export function buildCoreDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): CoreDisplayModel {
  return {
    hudBars: buildHudBarModels(mudState, status),
    character: buildCharacterDisplayModel(mudState, status, msdpVariables),
  };
}

export function buildHudBarModels(mudState: MudState, status: ConnectionStatus): HudBarModel[] {
  return [
    buildResourceBar('health', 'HP', mudState.health, mudState.healthMax, status, 'bar-health'),
    buildResourceBar('psp', 'PSP', mudState.psp, mudState.pspMax, status, 'bar-psp'),
    buildResourceBar(
      'movement',
      'Move',
      mudState.movement,
      mudState.movementMax,
      status,
      'bar-movement',
    ),
    buildExperienceBar(mudState, status),
  ];
}

export function buildCharacterDisplayModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): CharacterDisplayModel {
  return {
    identity: buildCharacterIdentityModel(mudState, status, msdpVariables),
    abilityScores: [
      buildSourceNumberField('strength', 'STR', mudState.strength, status),
      buildSourceNumberField('dexterity', 'DEX', mudState.dexterity, status),
      buildSourceNumberField('constitution', 'CON', mudState.constitution, status),
      buildSourceNumberField('intelligence', 'INT', mudState.intelligence, status),
      buildSourceNumberField('wisdom', 'WIS', mudState.wisdom, status),
      buildSourceNumberField('charisma', 'CHA', mudState.charisma, status),
    ],
    savingThrows: [
      buildOptionalNumberField(
        'fortitude',
        'Fort',
        mudState.fortitude,
        OPTIONAL_FIELD_DESCRIPTORS.fortitude,
        status,
        msdpVariables,
        { signed: true },
      ),
      buildOptionalNumberField(
        'reflex',
        'Refl',
        mudState.reflex,
        OPTIONAL_FIELD_DESCRIPTORS.reflex,
        status,
        msdpVariables,
        { signed: true },
      ),
      buildOptionalNumberField(
        'willpower',
        'Will',
        mudState.willpower,
        OPTIONAL_FIELD_DESCRIPTORS.willpower,
        status,
        msdpVariables,
        { signed: true },
      ),
    ],
    stats: [
      buildSourceTextField('position', 'Position', mudState.position, status),
      buildSourceTextField('alignment', 'Alignment', mudState.alignment, status),
      buildSourceNumberField('money', 'Money', mudState.money, status),
      buildSourceNumberField('practice', 'Practice', mudState.practice, status),
      buildSourceNumberField('attackBonus', 'Attack', mudState.attackBonus, status, {
        signed: true,
      }),
      buildOptionalNumberField(
        'damageBonus',
        'Damage',
        mudState.damageBonus,
        OPTIONAL_FIELD_DESCRIPTORS.damageBonus,
        status,
        msdpVariables,
        { signed: true },
      ),
      buildSourceNumberField('armorClass', 'Armor Class', mudState.armorClass, status),
    ],
  };
}

export function normalizeDisplayNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }

  return undefined;
}

export function hasDisplayNumber(value: unknown): boolean {
  return normalizeDisplayNumber(value) !== undefined;
}

export function formatDisplayNumber(value: unknown): string | undefined {
  const normalized = normalizeDisplayNumber(value);
  return normalized === undefined ? undefined : NUMBER_FORMATTER.format(normalized);
}

export function formatSignedDisplayNumber(value: unknown): string | undefined {
  const normalized = normalizeDisplayNumber(value);
  if (normalized === undefined) {
    return undefined;
  }

  if (normalized > 0) {
    return `+${formatDisplayNumber(normalized)}`;
  }

  return formatDisplayNumber(normalized);
}

export function clampPercentage(current: unknown, max: unknown): number {
  const normalizedCurrent = normalizeDisplayNumber(current);
  const normalizedMax = normalizeDisplayNumber(max);

  if (normalizedCurrent === undefined || normalizedMax === undefined || normalizedMax <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (normalizedCurrent / normalizedMax) * 100));
}

export function isMsdpVariableConfigured(msdpVariables: MsdpVariableMap, key: MsdpVariableKey) {
  return msdpVariables[key].trim().length > 0;
}

export function formatAvailabilityAriaLabel(notice: DisplayAvailabilityNotice) {
  return notice.ariaLabel ?? [notice.title, notice.detail].filter(Boolean).join('. ');
}

function buildResourceBar(
  id: HudBarId,
  label: string,
  current: number | undefined,
  max: number | undefined,
  status: ConnectionStatus,
  accentClass: string,
): HudBarModel {
  const normalizedCurrent = normalizeDisplayNumber(current);
  const normalizedMax = normalizeDisplayNumber(max);

  if (normalizedCurrent === undefined) {
    return buildMissingHudBar(id, label, status, accentClass);
  }

  const hasUsableMax = normalizedMax !== undefined && normalizedMax > 0;
  const currentText = formatDisplayNumber(normalizedCurrent) ?? String(normalizedCurrent);
  const maxText = formatDisplayNumber(normalizedMax);
  const valueText = hasUsableMax && maxText ? `${currentText} / ${maxText}` : currentText;
  const maxLabel = hasUsableMax && maxText ? ` of ${maxText}` : '. Maximum not reported';
  const availability = createAvailabilityNotice('present', {
    title: `${label} reported`,
    detail: hasUsableMax
      ? `${label} has current and maximum values.`
      : `${label} has no usable maximum value.`,
  });

  return {
    id,
    label,
    valueText,
    percentage: clampPercentage(normalizedCurrent, normalizedMax),
    accentClass,
    availability,
    ariaLabel: `${label} ${currentText}${maxLabel}.`,
  };
}

function buildExperienceBar(mudState: MudState, status: ConnectionStatus): HudBarModel {
  const experience = normalizeDisplayNumber(mudState.experience);
  const experienceMax = normalizeDisplayNumber(mudState.experienceMax);
  const experienceTnl = normalizeDisplayNumber(mudState.experienceTnl);

  if (experience === undefined && experienceMax === undefined && experienceTnl === undefined) {
    return buildMissingHudBar('experience', 'XP', status, 'bar-exp');
  }

  const hasUsableMax = experienceMax !== undefined && experienceMax > 0;
  const normalizedTnl = experienceTnl === undefined ? undefined : Math.max(0, experienceTnl);
  const progress =
    hasUsableMax && normalizedTnl !== undefined
      ? Math.min(Math.max(experienceMax - normalizedTnl, 0), experienceMax)
      : experience;
  const percent = hasUsableMax ? clampPercentage(progress, experienceMax) : 0;
  const valueText = formatExperienceValueText(experience, experienceMax, normalizedTnl, progress);
  const availability = createAvailabilityNotice('present', {
    title: 'XP reported',
    detail:
      hasUsableMax && normalizedTnl !== undefined
        ? 'Experience progress uses maximum experience and experience to next level.'
        : 'Experience progress is partial because maximum or TNL data is missing.',
  });

  return {
    id: 'experience',
    label: 'XP',
    valueText,
    percentage: percent,
    accentClass: 'bar-exp',
    availability,
    ariaLabel: formatExperienceAriaLabel(experience, experienceMax, normalizedTnl, progress),
  };
}

function formatExperienceValueText(
  experience: number | undefined,
  experienceMax: number | undefined,
  experienceTnl: number | undefined,
  progress: number | undefined,
) {
  if (experienceMax !== undefined && experienceMax > 0 && experienceTnl !== undefined) {
    const progressText = formatDisplayNumber(progress) ?? '0';
    const tnlText = formatDisplayNumber(experienceTnl) ?? '0';
    return `${progressText} / ${formatDisplayNumber(experienceMax)} (${tnlText} TNL)`;
  }

  if (experience !== undefined && experienceMax !== undefined && experienceMax > 0) {
    return `${formatDisplayNumber(experience)} / ${formatDisplayNumber(experienceMax)}`;
  }

  if (experience !== undefined) {
    return `${formatDisplayNumber(experience)} XP`;
  }

  if (experienceMax !== undefined && experienceTnl !== undefined) {
    const progressText = formatDisplayNumber(progress) ?? '0';
    return `${progressText} / ${formatDisplayNumber(experienceMax)}`;
  }

  if (experienceTnl !== undefined) {
    return `${formatDisplayNumber(experienceTnl)} TNL`;
  }

  return 'Waiting';
}

function formatExperienceAriaLabel(
  experience: number | undefined,
  experienceMax: number | undefined,
  experienceTnl: number | undefined,
  progress: number | undefined,
) {
  const parts = [];

  if (experience !== undefined) {
    parts.push(`${formatDisplayNumber(experience)} experience`);
  }

  if (progress !== undefined && experienceMax !== undefined && experienceMax > 0) {
    parts.push(
      `${formatDisplayNumber(progress)} of ${formatDisplayNumber(experienceMax)} progress`,
    );
  }

  if (experienceTnl !== undefined) {
    parts.push(`${formatDisplayNumber(experienceTnl)} to next level`);
  }

  return parts.length > 0 ? `XP ${parts.join(', ')}.` : 'XP waiting for data.';
}

function buildMissingHudBar(
  id: HudBarId,
  label: string,
  status: ConnectionStatus,
  accentClass: string,
): HudBarModel {
  const availability = createMissingConfirmedNotice(label, status);

  return {
    id,
    label,
    valueText:
      availability.kind === 'offline'
        ? 'Offline'
        : availability.kind === 'error'
          ? 'Unavailable'
          : 'Waiting',
    percentage: 0,
    accentClass,
    availability,
    ariaLabel: formatAvailabilityAriaLabel(availability),
  };
}

function buildCharacterIdentityModel(
  mudState: MudState,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
): CharacterIdentityModel {
  const titleNotice = getOptionalTextNotice(
    mudState.title,
    OPTIONAL_FIELD_DESCRIPTORS.title,
    status,
    msdpVariables,
  );
  const headingText = formatCharacterHeading(mudState.characterName, mudState.title);
  const profileParts = [
    normalizeDisplayNumber(mudState.level) !== undefined
      ? `Level ${formatDisplayNumber(mudState.level)}`
      : undefined,
    normalizeDisplayText(mudState.race),
    normalizeDisplayText(mudState.className),
  ].filter((part): part is string => Boolean(part));
  const profileText =
    profileParts.length > 0 ? profileParts.join(' | ') : formatMissingProfileText(status);

  return {
    headingText,
    profileText,
    titleNotice: titleNotice ?? undefined,
    ariaLabel: `${headingText}. ${profileText}.`,
  };
}

function buildSourceTextField(
  id: string,
  label: string,
  value: string | undefined,
  status: ConnectionStatus,
): CharacterFieldModel {
  const normalized = normalizeDisplayText(value);
  if (normalized !== undefined) {
    return {
      id,
      label,
      valueText: normalized,
      ariaLabel: `${label} ${normalized}.`,
    };
  }

  const notice =
    value === undefined
      ? createMissingConfirmedNotice(label, status)
      : createAvailabilityNotice('empty', {
          title: 'Empty',
          detail: `The server reported an empty ${label.toLowerCase()} value.`,
        });

  return createNoticeField(id, label, notice);
}

function buildSourceNumberField(
  id: string,
  label: string,
  value: number | undefined,
  status: ConnectionStatus,
  options: NumberFieldOptions = {},
): CharacterFieldModel {
  const normalized = normalizeDisplayNumber(value);
  if (normalized !== undefined) {
    const valueText = options.signed
      ? formatSignedDisplayNumber(normalized)
      : formatDisplayNumber(normalized);
    return {
      id,
      label,
      valueText: valueText ?? String(normalized),
      ariaLabel: `${label} ${valueText ?? normalized}.`,
    };
  }

  return createNoticeField(id, label, createMissingConfirmedNotice(label, status));
}

function buildOptionalNumberField(
  id: string,
  label: string,
  value: number | undefined,
  descriptor: OptionalFieldDescriptor,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
  options: NumberFieldOptions = {},
): CharacterFieldModel {
  const normalized = normalizeDisplayNumber(value);
  if (normalized !== undefined) {
    const valueText = options.signed
      ? formatSignedDisplayNumber(normalized)
      : formatDisplayNumber(normalized);
    return {
      id,
      label,
      valueText: valueText ?? String(normalized),
      ariaLabel: `${label} ${valueText ?? normalized}.`,
    };
  }

  return createNoticeField(id, label, getMissingOptionalNotice(descriptor, status, msdpVariables));
}

function createNoticeField(
  id: string,
  label: string,
  notice: DisplayAvailabilityNotice,
): CharacterFieldModel {
  return {
    id,
    label,
    valueText: notice.title,
    notice,
    ariaLabel: formatAvailabilityAriaLabel(notice),
  };
}

function normalizeDisplayText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatCharacterHeading(characterName?: string, title?: string) {
  const trimmedName = normalizeDisplayText(characterName);
  const trimmedTitle = normalizeDisplayText(title);

  if (!trimmedTitle) {
    return trimmedName || 'Unknown adventurer';
  }

  if (!trimmedName) {
    return trimmedTitle;
  }

  const normalizedName = trimmedName.toLowerCase();
  const normalizedTitle = trimmedTitle.toLowerCase();

  if (normalizedTitle.includes(normalizedName)) {
    return trimmedTitle;
  }

  return `${trimmedName} ${trimmedTitle}`;
}

function formatMissingProfileText(status: ConnectionStatus) {
  if (status === 'idle' || status === 'disconnected') {
    return 'Profile offline';
  }

  if (status === 'error') {
    return 'Profile unavailable';
  }

  return 'Awaiting MSDP profile';
}

function getOptionalTextNotice(
  value: string | undefined,
  descriptor: OptionalFieldDescriptor,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
) {
  if (value === undefined) {
    return getMissingOptionalNotice(descriptor, status, msdpVariables);
  }

  if (!value.trim()) {
    return createAvailabilityNotice('empty', descriptor.empty);
  }

  return null;
}

function getMissingOptionalNotice(
  descriptor: OptionalFieldDescriptor,
  status: ConnectionStatus,
  msdpVariables: MsdpVariableMap,
) {
  if (status === 'idle' || status === 'disconnected') {
    return createAvailabilityNotice('offline', descriptor.offline);
  }

  if (status === 'error') {
    return createAvailabilityNotice('error', descriptor.error);
  }

  if (!isMsdpVariableConfigured(msdpVariables, descriptor.key)) {
    return createAvailabilityNotice('unavailable', descriptor.unsupported);
  }

  return createAvailabilityNotice('loading', descriptor.waiting);
}

function createMissingConfirmedNotice(label: string, status: ConnectionStatus) {
  if (status === 'idle' || status === 'disconnected') {
    return createAvailabilityNotice('offline', {
      title: `${label} offline`,
      detail: `Connect before ${label.toLowerCase()} data can be evaluated.`,
    });
  }

  if (status === 'error') {
    return createAvailabilityNotice('error', {
      title: `${label} unavailable`,
      detail: `The connection ended before ${label.toLowerCase()} data could be evaluated.`,
    });
  }

  return createAvailabilityNotice('loading', {
    title: `Waiting for ${label}`,
    detail: `Waiting for ${label.toLowerCase()} from source-confirmed MSDP data.`,
  });
}

function createAvailabilityNotice(
  kind: DisplayAvailabilityKind,
  notice: Omit<DisplayAvailabilityNotice, 'kind'>,
): DisplayAvailabilityNotice {
  return {
    kind,
    ...notice,
  };
}

function createSavingThrowDescriptor(
  key: MsdpVariableKey,
  label: string,
  variableName: string,
): OptionalFieldDescriptor {
  return {
    key,
    label,
    unsupported: {
      title: `${label} mapping disabled`,
      detail: `${variableName} is source-backed, but the client is not currently requesting it.`,
    },
    waiting: {
      title: `Waiting for ${label.toLowerCase()}`,
      detail: `${variableName} is requested, but no ${label.toLowerCase()} value has arrived.`,
    },
    empty: {
      title: `${label} empty`,
      detail: `The source reported a blank ${label.toLowerCase()} value.`,
    },
    offline: {
      title: 'Offline',
      detail: `Connect before ${label.toLowerCase()} can be evaluated.`,
    },
    error: {
      title: 'Unavailable',
      detail: `The connection ended before ${label.toLowerCase()} could be evaluated.`,
    },
  };
}
