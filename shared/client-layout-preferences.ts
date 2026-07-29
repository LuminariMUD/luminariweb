export const CLIENT_LAYOUT_PREFERENCES_VERSION = 1;
export const CLIENT_LAYOUT_PREFERENCES_STORAGE_KEY = 'lwc.layout';

export const INSPECTOR_TAB_IDS = [
  'map',
  'room',
  'character',
  'combat',
  'group',
  'inventory',
  'affects',
  'quests',
  'protocol',
] as const;

export const INSPECTOR_DENSITIES = ['comfortable', 'compact'] as const;

export type InspectorTabId = (typeof INSPECTOR_TAB_IDS)[number];
export type InspectorDensity = (typeof INSPECTOR_DENSITIES)[number];

export type ClientLayoutPreferences = {
  version: typeof CLIENT_LAYOUT_PREFERENCES_VERSION;
  activeInspectorTab: InspectorTabId;
  inspectorCollapsed: boolean;
  density: InspectorDensity;
};

export const DEFAULT_CLIENT_LAYOUT_PREFERENCES: ClientLayoutPreferences = {
  version: CLIENT_LAYOUT_PREFERENCES_VERSION,
  activeInspectorTab: 'map',
  inspectorCollapsed: false,
  density: 'comfortable',
};

export function parseClientLayoutPreferencesJson(
  rawValue: string | null | undefined,
): ClientLayoutPreferences {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return DEFAULT_CLIENT_LAYOUT_PREFERENCES;
  }

  try {
    return parseClientLayoutPreferencesPayload(JSON.parse(rawValue) as unknown);
  } catch {
    return DEFAULT_CLIENT_LAYOUT_PREFERENCES;
  }
}

export function parseClientLayoutPreferencesPayload(value: unknown): ClientLayoutPreferences {
  if (!isObjectRecord(value)) {
    return DEFAULT_CLIENT_LAYOUT_PREFERENCES;
  }

  if ('version' in value && value.version !== CLIENT_LAYOUT_PREFERENCES_VERSION) {
    return DEFAULT_CLIENT_LAYOUT_PREFERENCES;
  }

  return {
    version: CLIENT_LAYOUT_PREFERENCES_VERSION,
    activeInspectorTab: isInspectorTabId(value.activeInspectorTab)
      ? value.activeInspectorTab
      : DEFAULT_CLIENT_LAYOUT_PREFERENCES.activeInspectorTab,
    inspectorCollapsed:
      typeof value.inspectorCollapsed === 'boolean'
        ? value.inspectorCollapsed
        : DEFAULT_CLIENT_LAYOUT_PREFERENCES.inspectorCollapsed,
    density: isInspectorDensity(value.density)
      ? value.density
      : DEFAULT_CLIENT_LAYOUT_PREFERENCES.density,
  };
}

export function serializeClientLayoutPreferences(preferences: ClientLayoutPreferences): string {
  return JSON.stringify(parseClientLayoutPreferencesPayload(preferences));
}

export function isInspectorTabId(value: unknown): value is InspectorTabId {
  return typeof value === 'string' && (INSPECTOR_TAB_IDS as readonly string[]).includes(value);
}

export function isInspectorDensity(value: unknown): value is InspectorDensity {
  return typeof value === 'string' && (INSPECTOR_DENSITIES as readonly string[]).includes(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
