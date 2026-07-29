import type {
  AliasDefinition,
  AutomationIdFactory,
  TriggerDefinition,
} from './client-automation.ts';
import { normalizeAliases, normalizeTriggers } from './client-automation.ts';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from './mud.ts';
import type { MsdpVariableMap } from './mud.ts';

export const CLIENT_CONFIG_STORAGE_KEY = 'lwc.config';
export const CLIENT_CONFIG_VERSION = 1;
export const CLIENT_CONFIG_TYPE = 'luminari-web-client-config';
export const ALIASES_COOKIE_NAME = 'lwc.aliases';
export const TRIGGERS_COOKIE_NAME = 'lwc.triggers';
export const CLIENT_SETTINGS_COOKIE_NAME = 'lwc.settings';

export type SidebarFontFamily = 'sans' | 'mono' | 'serif';

export type ClientSettings = {
  terminal: {
    fontSize: number;
    lineHeight: number;
    autoScroll: boolean;
    wrapLines: boolean;
  };
  minimap: {
    fontSize: number;
    paneHeight: number;
  };
  sidebar: {
    fontFamily: SidebarFontFamily;
    fontSize: number;
  };
  msdp: MsdpVariableMap;
};

export type ClientConfigState = {
  settings: ClientSettings;
  aliases: AliasDefinition[];
  triggers: TriggerDefinition[];
};

export type ClientConfigPayload = ClientConfigState & {
  type: typeof CLIENT_CONFIG_TYPE;
  version: typeof CLIENT_CONFIG_VERSION;
};

export type LegacyCookieMigrationResult = {
  payload: ClientConfigState;
  migratedCookieNames: string[];
  issues: string[];
};

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = {
  terminal: {
    fontSize: 14,
    lineHeight: 1.55,
    autoScroll: true,
    wrapLines: true,
  },
  minimap: {
    fontSize: 14,
    paneHeight: 16,
  },
  sidebar: {
    fontFamily: 'mono',
    fontSize: 13,
  },
  msdp: normalizeMsdpVariableMap(defaultMsdpVariables),
};

export const DEFAULT_CLIENT_CONFIG_STATE: ClientConfigState = {
  settings: DEFAULT_CLIENT_SETTINGS,
  aliases: [],
  triggers: [],
};

export function buildClientConfigPayload(state: ClientConfigState): ClientConfigPayload {
  return {
    type: CLIENT_CONFIG_TYPE,
    version: CLIENT_CONFIG_VERSION,
    settings: normalizeClientSettings(state.settings),
    aliases: normalizeStoredAliases(state.aliases),
    triggers: normalizeStoredTriggers(state.triggers),
  };
}

export function serializeClientConfigPayload(state: ClientConfigState) {
  return JSON.stringify(buildClientConfigPayload(state));
}

export function parseStoredClientConfigJson(
  rawValue: string | null | undefined,
  options?: { idFactory?: AutomationIdFactory },
): ClientConfigState {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return DEFAULT_CLIENT_CONFIG_STATE;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return parseStoredClientConfigPayload(parsed, options);
  } catch {
    return DEFAULT_CLIENT_CONFIG_STATE;
  }
}

export function parseStoredClientConfigPayload(
  value: unknown,
  options?: { idFactory?: AutomationIdFactory },
): ClientConfigState {
  if (!isObjectRecord(value)) {
    return DEFAULT_CLIENT_CONFIG_STATE;
  }

  if ('version' in value && value.version !== CLIENT_CONFIG_VERSION) {
    return DEFAULT_CLIENT_CONFIG_STATE;
  }

  try {
    return {
      settings: normalizeClientSettings(value.settings),
      aliases: normalizeStoredAliases(value.aliases, options?.idFactory),
      triggers: normalizeStoredTriggers(value.triggers, options?.idFactory),
    };
  } catch {
    return DEFAULT_CLIENT_CONFIG_STATE;
  }
}

export function parseClientConfigImport(
  content: string,
  currentState: ClientConfigState,
  options?: { idFactory?: AutomationIdFactory },
): ClientConfigState {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error('Configuration file is not valid JSON.');
  }

  if (!isObjectRecord(parsed)) {
    throw new Error('Configuration file must be a JSON object.');
  }

  if (typeof parsed.version === 'number' && parsed.version > CLIENT_CONFIG_VERSION) {
    throw new Error(`Configuration version ${parsed.version} is not supported.`);
  }

  const type = parsed.type;
  if ('settings' in parsed || type === CLIENT_CONFIG_TYPE) {
    return {
      settings: normalizeClientSettings(
        parsed.settings,
        'Configuration file must contain a settings object.',
      ),
      aliases: normalizeAliases(extractImportedEntries(parsed, 'aliases'), {
        emptyStateMessage: 'Configuration file must contain an aliases array.',
        idFactory: options?.idFactory,
      }),
      triggers: normalizeTriggers(extractImportedEntries(parsed, 'triggers'), {
        emptyStateMessage: 'Configuration file must contain a triggers array.',
        idFactory: options?.idFactory,
      }),
    };
  }

  if (type === 'luminari-web-client-aliases' || ('aliases' in parsed && !('triggers' in parsed))) {
    return {
      settings: currentState.settings,
      aliases: normalizeAliases(extractImportedEntries(parsed, 'aliases'), {
        emptyStateMessage: 'Alias file must contain an aliases array.',
        idFactory: options?.idFactory,
      }),
      triggers: currentState.triggers,
    };
  }

  if (type === 'luminari-web-client-triggers' || ('triggers' in parsed && !('aliases' in parsed))) {
    return {
      settings: currentState.settings,
      aliases: currentState.aliases,
      triggers: normalizeTriggers(extractImportedEntries(parsed, 'triggers'), {
        emptyStateMessage: 'Trigger file must contain a triggers array.',
        idFactory: options?.idFactory,
      }),
    };
  }

  throw new Error('Configuration file must include settings, aliases, and triggers.');
}

export function parseLegacyClientConfigFromCookieHeader(
  cookieHeader: string,
  options?: { idFactory?: AutomationIdFactory },
): LegacyCookieMigrationResult | null {
  const migratedCookieNames: string[] = [];
  const issues: string[] = [];
  let settings = DEFAULT_CLIENT_SETTINGS;
  let aliases: AliasDefinition[] = [];
  let triggers: TriggerDefinition[] = [];

  const settingsValue = readLegacyChunkedCookie(cookieHeader, CLIENT_SETTINGS_COOKIE_NAME);
  if (settingsValue !== null) {
    try {
      settings = normalizeClientSettings(JSON.parse(settingsValue) as unknown);
      migratedCookieNames.push(CLIENT_SETTINGS_COOKIE_NAME);
    } catch {
      issues.push('Legacy settings cookie could not be migrated.');
    }
  }

  const aliasesValue = readLegacyChunkedCookie(cookieHeader, ALIASES_COOKIE_NAME);
  if (aliasesValue !== null) {
    try {
      aliases = normalizeAliases(JSON.parse(aliasesValue) as unknown, {
        idFactory: options?.idFactory,
      });
      migratedCookieNames.push(ALIASES_COOKIE_NAME);
    } catch {
      issues.push('Legacy aliases cookie could not be migrated.');
    }
  }

  const triggersValue = readLegacyChunkedCookie(cookieHeader, TRIGGERS_COOKIE_NAME);
  if (triggersValue !== null) {
    try {
      triggers = normalizeTriggers(JSON.parse(triggersValue) as unknown, {
        idFactory: options?.idFactory,
      });
      migratedCookieNames.push(TRIGGERS_COOKIE_NAME);
    } catch {
      issues.push('Legacy triggers cookie could not be migrated.');
    }
  }

  if (migratedCookieNames.length === 0) {
    return null;
  }

  return {
    payload: { settings, aliases, triggers },
    migratedCookieNames,
    issues,
  };
}

export function readLegacyChunkedCookie(cookieHeader: string, name: string) {
  const cookies = parseCookieMap(cookieHeader);
  const singleValue = cookies.get(name);
  if (singleValue !== undefined) {
    return decodeCookieValue(singleValue);
  }

  const countText = cookies.get(`${name}.count`);
  if (!countText) {
    return null;
  }

  const count = Number(countText);
  if (!Number.isInteger(count) || count < 1) {
    return null;
  }

  let combined = '';
  for (let index = 0; index < count; index += 1) {
    const chunk = cookies.get(`${name}.${index}`);
    if (chunk === undefined) {
      return null;
    }

    combined += chunk;
  }

  return decodeCookieValue(combined);
}

export function normalizeClientSettings(
  value: unknown,
  emptyStateMessage?: string,
): ClientSettings {
  if (!isObjectRecord(value)) {
    if (emptyStateMessage) {
      throw new Error(emptyStateMessage);
    }

    return DEFAULT_CLIENT_SETTINGS;
  }

  const terminalValue = value.terminal;
  if (!isObjectRecord(terminalValue)) {
    if (emptyStateMessage) {
      throw new Error('Configuration settings must include a terminal object.');
    }

    return DEFAULT_CLIENT_SETTINGS;
  }

  const minimapRecord = isObjectRecord(value.minimap) ? value.minimap : null;
  const sidebarRecord = isObjectRecord(value.sidebar) ? value.sidebar : null;

  return {
    terminal: {
      fontSize: clampNumber(
        readNumericSetting(terminalValue.fontSize),
        10,
        32,
        DEFAULT_CLIENT_SETTINGS.terminal.fontSize,
      ),
      lineHeight: clampNumber(
        readNumericSetting(terminalValue.lineHeight),
        1.2,
        2.2,
        DEFAULT_CLIENT_SETTINGS.terminal.lineHeight,
      ),
      autoScroll:
        typeof terminalValue.autoScroll === 'boolean'
          ? terminalValue.autoScroll
          : DEFAULT_CLIENT_SETTINGS.terminal.autoScroll,
      wrapLines:
        typeof terminalValue.wrapLines === 'boolean'
          ? terminalValue.wrapLines
          : DEFAULT_CLIENT_SETTINGS.terminal.wrapLines,
    },
    minimap: {
      fontSize: clampNumber(
        readNumericSetting(minimapRecord?.fontSize),
        10,
        32,
        DEFAULT_CLIENT_SETTINGS.minimap.fontSize,
      ),
      paneHeight: clampNumber(
        readNumericSetting(minimapRecord?.paneHeight),
        10,
        32,
        DEFAULT_CLIENT_SETTINGS.minimap.paneHeight,
      ),
    },
    sidebar: {
      fontFamily: isSidebarFontFamily(sidebarRecord?.fontFamily)
        ? sidebarRecord.fontFamily
        : DEFAULT_CLIENT_SETTINGS.sidebar.fontFamily,
      fontSize: clampNumber(
        readNumericSetting(sidebarRecord?.fontSize),
        8,
        32,
        DEFAULT_CLIENT_SETTINGS.sidebar.fontSize,
      ),
    },
    msdp: normalizeMsdpVariableMap(value.msdp),
  };
}

export function isSidebarFontFamily(value: unknown): value is SidebarFontFamily {
  return value === 'sans' || value === 'mono' || value === 'serif';
}

function normalizeStoredAliases(
  value: unknown,
  idFactory: AutomationIdFactory = defaultIdFactory,
): AliasDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isObjectRecord(entry)) {
      return [];
    }

    return [
      {
        id: readOptionalString(entry, ['id'])?.trim() || idFactory('alias'),
        pattern: readOptionalString(entry, ['pattern', 'name']) ?? '',
        expansion: readOptionalString(entry, ['expansion', 'value', 'command']) ?? '',
        enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
      },
    ];
  });
}

function normalizeStoredTriggers(
  value: unknown,
  idFactory: AutomationIdFactory = defaultIdFactory,
): TriggerDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isObjectRecord(entry)) {
      return [];
    }

    return [
      {
        id: readOptionalString(entry, ['id'])?.trim() || idFactory('trigger'),
        pattern: readOptionalString(entry, ['pattern', 'match']) ?? '',
        action: readOptionalString(entry, ['action', 'command', 'expansion']) ?? '',
        enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
      },
    ];
  });
}

function defaultIdFactory(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractImportedEntries(parsed: Record<string, unknown>, key: 'aliases' | 'triggers') {
  const nestedEntries = parsed[key];
  if (Array.isArray(nestedEntries)) {
    return nestedEntries;
  }

  throw new Error(
    key === 'aliases'
      ? 'Alias file must contain an aliases array.'
      : 'Trigger file must contain a triggers array.',
  );
}

function parseCookieMap(cookieHeader: string) {
  const cookies = new Map<string, string>();
  if (!cookieHeader.trim()) {
    return cookies;
  }

  for (const entry of cookieHeader.split(/;\s*/)) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex);
    const value = entry.slice(separatorIndex + 1);
    cookies.set(key, value);
  }

  return cookies;
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function readNumericSetting(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function readOptionalString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function clampNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (value === undefined) {
    return fallback;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
