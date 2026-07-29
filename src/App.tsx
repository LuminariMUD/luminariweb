import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  CSSProperties,
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import type { ReactNode } from 'react';
import { appSettings } from '../shared/app-settings.ts';
import type { AppSettings } from '../shared/app-settings.ts';
import type { OnboardingActionName } from '../shared/onboarding.ts';
import { OnboardingShell } from './features/onboarding/OnboardingShell.tsx';
import { chunkEditorContent, editorContentDigest } from '../shared/onboarding-transfer.ts';
import {
  initialOnboardingUiState,
  onboardingReducer,
  shouldShowOnboarding,
} from './features/onboarding/onboarding-reducer.ts';
import type { OnboardingActionPayload } from './features/onboarding/screen-props.ts';
import {
  CLIENT_LAYOUT_PREFERENCES_STORAGE_KEY,
  DEFAULT_CLIENT_LAYOUT_PREFERENCES,
  INSPECTOR_TAB_IDS,
  parseClientLayoutPreferencesJson,
  parseClientLayoutPreferencesPayload,
  serializeClientLayoutPreferences,
} from '../shared/client-layout-preferences.ts';
import type {
  ClientLayoutPreferences,
  InspectorDensity,
  InspectorTabId,
} from '../shared/client-layout-preferences.ts';
import {
  consumeTriggerText,
  createEmptyAlias,
  createEmptyTrigger,
  expandAliasCommands,
  previewAliasExpansion,
  previewTriggerConsumption,
  validateAlias,
  validateTrigger,
} from '../shared/client-automation.ts';
import type {
  AliasDefinition,
  AutomationField,
  AutomationLimitNotice,
  AutomationValidationIssue,
  TriggerDefinition,
} from '../shared/client-automation.ts';
import {
  CLIENT_CONFIG_STORAGE_KEY,
  DEFAULT_CLIENT_CONFIG_STATE,
  DEFAULT_CLIENT_SETTINGS,
  buildClientConfigPayload,
  isSidebarFontFamily,
  parseClientConfigImport,
  parseLegacyClientConfigFromCookieHeader,
  parseStoredClientConfigJson,
  serializeClientConfigPayload,
} from '../shared/client-config-persistence.ts';
import type {
  ClientConfigState,
  ClientSettings,
  SidebarFontFamily,
} from '../shared/client-config-persistence.ts';
import { buildNetworkStatusMessage } from '../shared/pwa-support.ts';
import {
  buildAffectsDisplayModel,
  buildInventoryDisplayModel,
} from '../shared/msdp-affects-inventory-display.ts';
import type {
  AffectRowModel,
  AffectsDisplayModel,
  InventoryDisplayModel,
  InventoryGroupModel,
  InventoryItemModel,
} from '../shared/msdp-affects-inventory-display.ts';
import { buildCombatDisplayModel } from '../shared/msdp-combat-display.ts';
import type {
  ActionEconomyModel,
  ActionEntryModel,
  CombatDisplayModel,
  CombatParticipantModel,
  DamageBonusCombatModel,
} from '../shared/msdp-combat-display.ts';
import { buildCoreDisplayModel, formatAvailabilityAriaLabel } from '../shared/msdp-display.ts';
import type {
  CharacterFieldModel,
  DisplayAvailabilityNotice,
  HudBarModel,
} from '../shared/msdp-display.ts';
import { buildGroupDisplayModel } from '../shared/msdp-group-display.ts';
import type {
  GroupDisplayModel,
  GroupMemberModel,
  GroupResourceModel,
} from '../shared/msdp-group-display.ts';
import { buildMapDisplayModel } from '../shared/msdp-map-display.ts';
import type {
  MapDisplayModel,
  MapFallbackExit,
  MapFallbackIdentityField,
  MapFallbackModel,
  MapMapperBranch,
  MapMapperBranchPlacement,
  MapMapperCurrentRoomNode,
  MapMapperModel,
} from '../shared/msdp-map-display.ts';
import { buildQuestDisplayModel } from '../shared/msdp-quest-display.ts';
import type { QuestDisplayModel } from '../shared/msdp-quest-display.ts';
import { buildRoomDisplayModel } from '../shared/msdp-room-display.ts';
import type {
  RoomDetailModel,
  RoomDisplayModel,
  RoomExitModel,
  RoomIdentityFieldModel,
} from '../shared/msdp-room-display.ts';
import {
  defaultMsdpVariables,
  normalizeMsdpVariableMap,
  overrideOnlyMsdpVariableKeys,
  terminalDimensionBounds,
} from '../shared/mud.ts';
import type {
  ClientMessage,
  ConnectionStatus,
  MsdpVariableKey,
  MudState,
  MudValue,
  ServerMessage,
  TerminalDimensions,
} from '../shared/mud.ts';
import {
  PROTOCOL_FEATURE_STATUS_LABELS,
  PROTOCOL_FEATURE_STATUSES,
  PROTOCOL_FOLLOW_UP_LABELS,
  getProtocolFeaturesByGroup,
  getProtocolStatusCounts,
} from '../shared/protocol-feature-status.ts';
import type {
  ProtocolEvidenceKind,
  ProtocolFeatureRecord,
  ProtocolFeatureStatus,
} from '../shared/protocol-feature-status.ts';
import {
  convertLuminariColorCodes,
  createMudHtmlStreamConverter,
  renderMudHtml,
  renderMudStreamHtml,
} from './terminal/render-mud-html.ts';
import { XtermTerminalSpike } from './terminal/XtermTerminalSpike.tsx';
import { isXtermSpikeRenderer, parseTerminalRendererMode } from './terminal/xterm-spike-options.ts';
import './App.css';

const DEFAULT_HOST = appSettings.connection.defaultHost;
const DEFAULT_PORT = appSettings.connection.defaultPort;
const CUSTOM_MUD_VALUE = '__custom__';
const TERMINAL_CHUNK_LIMIT = 500;
const COMMAND_HISTORY_LIMIT = 100;
const DEFAULT_TERMINAL_DIMENSIONS: TerminalDimensions = {
  columns: 120,
  rows: 40,
};
const INITIAL_TERMINAL_TEXT = 'Connect to a LuminariMUD-compatible server to begin.';
const CONNECTED_TERMINAL_TEXT = 'Connected. Waiting for room text and MSDP updates...';
const TERMINAL_CELL_MEASUREMENT_SAMPLE = 'MMMMMMMMMM';
const TERMINAL_RESIZE_DEBOUNCE_MS = 75;
const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 30_000;
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, 'g');
const MOVEMENT_COMMANDS = new Set([
  'n',
  'north',
  's',
  'south',
  'e',
  'east',
  'w',
  'west',
  'ne',
  'northeast',
  'nw',
  'northwest',
  'se',
  'southeast',
  'sw',
  'southwest',
  'u',
  'up',
  'd',
  'down',
  'in',
  'out',
]);
const NUMPAD_COMMANDS: Record<string, string> = {
  Numpad1: 'sw',
  Numpad2: 's',
  Numpad3: 'se',
  Numpad4: 'w',
  Numpad5: 'look',
  Numpad6: 'e',
  Numpad7: 'nw',
  Numpad8: 'n',
  Numpad9: 'ne',
  NumpadAdd: 'down',
  NumpadSubtract: 'up',
  Numpad0: 'in',
  NumpadDecimal: 'out',
};

type InspectorTab = {
  id: InspectorTabId;
  label: string;
  shortLabel: string;
};

type AutomationNotice = {
  kind: 'success' | 'error';
  text: string;
};

type AutomationMenuId = 'aliases' | 'triggers' | 'msdpVars' | 'settings';

type PendingAutomationDelete = {
  kind: 'alias' | 'trigger';
  id: string;
};

type AvailabilityNotice = DisplayAvailabilityNotice;

const OUTPUT_FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18, 20, 22, 24];
const OUTPUT_LINE_HEIGHT_OPTIONS = [
  { value: 1.35, label: 'Compact' },
  { value: 1.55, label: 'Normal' },
  { value: 1.75, label: 'Relaxed' },
];
const SIDEBAR_FONT_OPTIONS: Array<{ value: SidebarFontFamily; label: string }> = [
  { value: 'sans', label: 'Sans serif' },
  { value: 'mono', label: 'Monospace' },
  { value: 'serif', label: 'Serif' },
];
const SIDEBAR_FONT_FAMILIES: Record<SidebarFontFamily, string> = {
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'var(--mono)',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
};
const OVERRIDE_ONLY_MSDP_VARIABLE_KEYS = new Set<MsdpVariableKey>(overrideOnlyMsdpVariableKeys);
const MSDP_FIELD_SUPPORT_NOTES: Partial<Record<MsdpVariableKey, string>> = {
  title: 'Source-backed in current Luminari-Source; older servers may omit it.',
  fortitude: 'Source-backed in current Luminari-Source; older servers may omit it.',
  reflex: 'Source-backed in current Luminari-Source; older servers may omit it.',
  willpower: 'Source-backed in current Luminari-Source; older servers may omit it.',
  damageBonus: 'Unconfirmed live data; use only with a server override.',
  minimap: 'Source-backed in current Luminari-Source; room fallback remains supported.',
  questInfo: 'Structured quest data requires future server support or an override.',
};
const MSDP_VARIABLE_GROUPS: Array<{
  title: string;
  description: string;
  fields: Array<{ key: MsdpVariableKey; label: string }>;
}> = [
  {
    title: 'Server and character',
    description:
      'Source-confirmed server metadata and character profile variables, including title.',
    fields: [
      { key: 'serverId', label: 'Server ID' },
      { key: 'serverTime', label: 'Server time' },
      { key: 'snippetVersion', label: 'Snippet version' },
      { key: 'characterName', label: 'Character name' },
      { key: 'title', label: 'Title' },
      { key: 'level', label: 'Level' },
      { key: 'race', label: 'Race' },
      { key: 'className', label: 'Class' },
      { key: 'position', label: 'Position' },
      { key: 'alignment', label: 'Alignment' },
      { key: 'money', label: 'Money' },
      { key: 'practice', label: 'Practice' },
    ],
  },
  {
    title: 'Resources and attributes',
    description:
      'Source-confirmed bars, ability scores, saving throws, and combat summary variables; damage bonus needs an override.',
    fields: [
      { key: 'health', label: 'Health' },
      { key: 'healthMax', label: 'Health max' },
      { key: 'psp', label: 'PSP' },
      { key: 'pspMax', label: 'PSP max' },
      { key: 'movement', label: 'Movement' },
      { key: 'movementMax', label: 'Movement max' },
      { key: 'experience', label: 'Experience' },
      { key: 'experienceMax', label: 'Experience max' },
      { key: 'experienceTnl', label: 'Experience to next level' },
      { key: 'strength', label: 'Strength' },
      { key: 'dexterity', label: 'Dexterity' },
      { key: 'constitution', label: 'Constitution' },
      { key: 'intelligence', label: 'Intelligence' },
      { key: 'wisdom', label: 'Wisdom' },
      { key: 'charisma', label: 'Charisma' },
      { key: 'fortitude', label: 'Fortitude' },
      { key: 'reflex', label: 'Reflex' },
      { key: 'willpower', label: 'Willpower' },
      { key: 'attackBonus', label: 'Attack bonus' },
      { key: 'damageBonus', label: 'Damage bonus' },
      { key: 'armorClass', label: 'Armor class' },
    ],
  },
  {
    title: 'Room and world',
    description: 'Source-confirmed room context with source-backed minimap and room fallback.',
    fields: [
      { key: 'room', label: 'Room' },
      { key: 'areaName', label: 'Area name' },
      { key: 'roomName', label: 'Room name' },
      { key: 'roomVnum', label: 'Room VNUM' },
      { key: 'roomExits', label: 'Room exits' },
      { key: 'worldTime', label: 'World time' },
      { key: 'minimap', label: 'Minimap' },
    ],
  },
  {
    title: 'Collections',
    description:
      'Structured source-confirmed collection variables and the future quest override slot.',
    fields: [
      { key: 'actions', label: 'Actions' },
      { key: 'inventory', label: 'Inventory' },
      { key: 'affects', label: 'Affects' },
      { key: 'group', label: 'Group' },
      { key: 'questInfo', label: 'Quest info' },
    ],
  },
  {
    title: 'Combat targets',
    description: 'Opponent and tank data shown in the status bars.',
    fields: [
      { key: 'opponentName', label: 'Opponent name' },
      { key: 'opponentHealth', label: 'Opponent health' },
      { key: 'opponentHealthMax', label: 'Opponent health max' },
      { key: 'tankName', label: 'Tank name' },
      { key: 'tankHealth', label: 'Tank health' },
      { key: 'tankHealthMax', label: 'Tank health max' },
    ],
  },
];

const INSPECTOR_TAB_METADATA: Record<InspectorTabId, InspectorTab> = {
  map: { id: 'map', label: 'Map', shortLabel: 'Map' },
  room: { id: 'room', label: 'Room', shortLabel: 'Room' },
  character: { id: 'character', label: 'Character', shortLabel: 'Char' },
  combat: { id: 'combat', label: 'Combat', shortLabel: 'Combat' },
  group: { id: 'group', label: 'Group', shortLabel: 'Group' },
  inventory: { id: 'inventory', label: 'Inventory', shortLabel: 'Inv' },
  affects: { id: 'affects', label: 'Affects', shortLabel: 'Affects' },
  quests: { id: 'quests', label: 'Quests', shortLabel: 'Quests' },
  protocol: { id: 'protocol', label: 'Protocol', shortLabel: 'Proto' },
};
const INSPECTOR_TABS: InspectorTab[] = INSPECTOR_TAB_IDS.map(
  (tabId) => INSPECTOR_TAB_METADATA[tabId],
);
const INSPECTOR_DENSITY_LABELS: Record<InspectorDensity, string> = {
  comfortable: 'Comfort',
  compact: 'Compact',
};
const PROTOCOL_GROUPED_FEATURES = getProtocolFeaturesByGroup();
const PROTOCOL_STATUS_COUNTS = getProtocolStatusCounts();
const REPOSITORY_BLOB_BASE_URL = 'https://github.com/LuminariMUD/luminariweb/blob/main/';

function App() {
  const [uiSettings, setUiSettings] = useState<AppSettings>(appSettings);
  const [mudState, setMudState] = useState<MudState>({});
  const [host, setHost] = useState(DEFAULT_HOST);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [selectedMudId, setSelectedMudId] = useState(
    findMatchingMudPresetId(appSettings.connection.muds, DEFAULT_HOST, DEFAULT_PORT) ??
      CUSTOM_MUD_VALUE,
  );
  const [command, setCommand] = useState('');
  const [onboardingUi, dispatchOnboarding] = useReducer(
    onboardingReducer,
    initialOnboardingUiState,
  );
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState('');
  const [initialClientConfig] = useState<ClientConfigState>(() =>
    loadClientConfigFromLocalStorage(),
  );
  const [aliases, setAliases] = useState<AliasDefinition[]>(initialClientConfig.aliases);
  const [triggers, setTriggers] = useState<TriggerDefinition[]>(initialClientConfig.triggers);
  const [clientSettings, setClientSettings] = useState<ClientSettings>(
    initialClientConfig.settings,
  );
  const [automationNotice, setAutomationNotice] = useState<AutomationNotice | null>(null);
  const [aliasPreviewInputs, setAliasPreviewInputs] = useState<Record<string, string>>({});
  const [triggerPreviewInputs, setTriggerPreviewInputs] = useState<Record<string, string>>({});
  const [pendingAutomationDelete, setPendingAutomationDelete] =
    useState<PendingAutomationDelete | null>(null);
  const [terminalChunks, setTerminalChunks] = useState<string[]>([
    `<span class="terminal-muted">${INITIAL_TERMINAL_TEXT}</span>`,
  ]);
  const [terminalRawChunks, setTerminalRawChunks] = useState<string[]>([INITIAL_TERMINAL_TEXT]);
  const [terminalResetKey, setTerminalResetKey] = useState(0);
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [proxyReady, setProxyReady] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [statusDetail, setStatusDetail] = useState('Awaiting connection.');
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [openAutomationMenu, setOpenAutomationMenu] = useState<AutomationMenuId | null>(null);
  const [layoutPreferences, setLayoutPreferences] = useState<ClientLayoutPreferences>(() =>
    loadClientLayoutPreferencesFromLocalStorage(),
  );
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const inspectorTabButtonRefs = useRef(new Map<InspectorTabId, HTMLButtonElement>());
  const terminalResizeTimeoutRef = useRef<number | null>(null);
  const pendingTerminalDimensionsRef = useRef<TerminalDimensions | null>(null);
  const lastSentTerminalDimensionsRef = useRef<TerminalDimensions | null>(null);
  const configFileInputRef = useRef<HTMLInputElement | null>(null);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const ansiConverterRef = useRef(createMudHtmlStreamConverter());
  const triggerBufferRef = useRef('');
  const triggerBatchDispatchingRef = useRef(false);
  const statusRef = useRef<ConnectionStatus>('idle');
  const aliasesRef = useRef<AliasDefinition[]>(aliases);
  const triggersRef = useRef<TriggerDefinition[]>(triggers);
  const terminalRendererMode = useMemo(() => parseTerminalRendererMode(window.location.search), []);
  const useXtermSpike = isXtermSpikeRenderer(terminalRendererMode);
  const connected = status === 'connected';
  const connectionInFlight = status === 'connecting';
  const canStartConnection = browserOnline && proxyReady && !connectionInFlight && !connected;
  const canConnect = connected || canStartConnection;
  const networkStatus = useMemo(
    () =>
      buildNetworkStatusMessage({
        browserOnline,
        proxyReady,
        connectionStatus: status,
        statusDetail,
      }),
    [browserOnline, proxyReady, status, statusDetail],
  );
  const aliasValidationById = useMemo(
    () => new Map(aliases.map((alias) => [alias.id, validateAlias(alias)])),
    [aliases],
  );
  const triggerValidationById = useMemo(
    () => new Map(triggers.map((trigger) => [trigger.id, validateTrigger(trigger)])),
    [triggers],
  );
  const resetAutomationMenuState = useCallback((nextMenu: AutomationMenuId | null) => {
    if (nextMenu !== 'aliases') {
      setAliasPreviewInputs({});
    }

    if (nextMenu !== 'triggers') {
      setTriggerPreviewInputs({});
    }

    setPendingAutomationDelete(null);
  }, []);

  useEffect(() => {
    document.title = uiSettings.personalization.browserTitle;
  }, [uiSettings.personalization.browserTitle]);

  useEffect(() => {
    function updateBrowserOnline() {
      setBrowserOnline(navigator.onLine);
    }

    updateBrowserOnline();
    window.addEventListener('online', updateBrowserOnline);
    window.addEventListener('offline', updateBrowserOnline);
    return () => {
      window.removeEventListener('online', updateBrowserOnline);
      window.removeEventListener('offline', updateBrowserOnline);
    };
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    aliasesRef.current = aliases;
  }, [aliases]);

  useEffect(() => {
    triggersRef.current = triggers;
  }, [triggers]);

  useEffect(() => {
    saveClientConfigToLocalStorage({ settings: clientSettings, aliases, triggers });
  }, [aliases, clientSettings, triggers]);

  useEffect(() => {
    saveClientLayoutPreferencesToLocalStorage(layoutPreferences);
  }, [layoutPreferences]);

  useEffect(() => {
    if (!openAutomationMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && menuBarRef.current?.contains(event.target)) {
        return;
      }

      setOpenAutomationMenu(null);
      resetAutomationMenuState(null);
      if (connected) {
        focusCommandInput(commandInputRef.current);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenAutomationMenu(null);
        resetAutomationMenuState(null);
        if (connected) {
          focusCommandInput(commandInputRef.current);
        }
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [connected, openAutomationMenu, resetAutomationMenuState]);

  useEffect(() => {
    let active = true;

    async function loadSettings() {
      try {
        const response = await fetch(getSettingsUrl());
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const settings = (await response.json()) as AppSettings;
        if (!active) {
          return;
        }

        setUiSettings(settings);
        setHost(settings.connection.defaultHost);
        setPort(settings.connection.defaultPort);
        setSelectedMudId(
          findMatchingMudPresetId(
            settings.connection.muds,
            settings.connection.defaultHost,
            settings.connection.defaultPort,
          ) ?? CUSTOM_MUD_VALUE,
        );
      } catch (error) {
        console.error('Failed to load app settings from /api/settings', error);
      }
    }

    void loadSettings();

    return () => {
      active = false;
    };
  }, []);

  const sendMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      statusRef.current = 'error';
      setStatus('error');
      setStatusDetail('The local WebSocket proxy is unavailable.');
      setIsHeaderVisible(true);
      return;
    }

    socket.send(JSON.stringify(message));
  }, []);

  const sendInputLine = useCallback(
    (text: string) => {
      if (statusRef.current !== 'connected') {
        return;
      }

      sendMessage({ type: 'input', text });
    },
    [sendMessage],
  );

  const clearPendingTerminalResize = useCallback(() => {
    if (terminalResizeTimeoutRef.current !== null) {
      window.clearTimeout(terminalResizeTimeoutRef.current);
      terminalResizeTimeoutRef.current = null;
    }

    pendingTerminalDimensionsRef.current = null;
  }, []);

  const isWebSocketOpen = useCallback(() => {
    const socket = socketRef.current;
    return Boolean(socket && socket.readyState === WebSocket.OPEN);
  }, []);

  const sendTerminalResize = useCallback(
    (dimensions: TerminalDimensions) => {
      if (
        !isWebSocketOpen() ||
        areTerminalDimensionsEqual(dimensions, lastSentTerminalDimensionsRef.current)
      ) {
        return;
      }

      lastSentTerminalDimensionsRef.current = dimensions;
      sendMessage({
        type: 'resize',
        columns: dimensions.columns,
        rows: dimensions.rows,
      });
    },
    [isWebSocketOpen, sendMessage],
  );

  const queueTerminalResize = useCallback(
    (dimensions: TerminalDimensions, options?: { immediate?: boolean }) => {
      const normalizedDimensions = normalizeTerminalDimensions(dimensions);
      const pendingDimensions = pendingTerminalDimensionsRef.current;

      if (
        !options?.immediate &&
        (areTerminalDimensionsEqual(normalizedDimensions, pendingDimensions) ||
          (!pendingDimensions &&
            areTerminalDimensionsEqual(
              normalizedDimensions,
              lastSentTerminalDimensionsRef.current,
            )))
      ) {
        return;
      }

      if (options?.immediate) {
        clearPendingTerminalResize();
        sendTerminalResize(normalizedDimensions);
        return;
      }

      pendingTerminalDimensionsRef.current = normalizedDimensions;
      if (terminalResizeTimeoutRef.current !== null) {
        return;
      }

      terminalResizeTimeoutRef.current = window.setTimeout(() => {
        const nextDimensions = pendingTerminalDimensionsRef.current;
        terminalResizeTimeoutRef.current = null;
        pendingTerminalDimensionsRef.current = null;

        if (nextDimensions) {
          sendTerminalResize(nextDimensions);
        }
      }, TERMINAL_RESIZE_DEBOUNCE_MS);
    },
    [clearPendingTerminalResize, sendTerminalResize],
  );

  const measureAndQueueTerminalResize = useCallback(
    (options?: { immediate?: boolean }) => {
      if (!isWebSocketOpen()) {
        return;
      }

      const terminalElement = terminalRef.current;
      if (!terminalElement) {
        return;
      }

      queueTerminalResize(measureTerminalDimensions(terminalElement), options);
    },
    [isWebSocketOpen, queueTerminalResize],
  );

  const rememberCommand = useCallback((text: string) => {
    const normalized = text.trim().toLowerCase();
    if (!normalized || MOVEMENT_COMMANDS.has(normalized)) {
      return;
    }

    setCommandHistory((current) => [...current, text].slice(-COMMAND_HISTORY_LIMIT));
  }, []);

  const dispatchInputText = useCallback(
    (text: string, options?: { rememberInHistory?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      if (options?.rememberInHistory ?? true) {
        rememberCommand(trimmed);
      }

      const expansion = expandAliasCommands(trimmed, aliasesRef.current);
      if (expansion.notices.length > 0) {
        setAutomationNotice({
          kind: 'error',
          text: formatAutomationNotices(expansion.notices),
        });
      }

      for (const expandedCommand of expansion.commands) {
        sendInputLine(expandedCommand);
      }
    },
    [rememberCommand, sendInputLine],
  );

  /**
   * Typed onboarding actions go straight to the proxy, which validates them
   * against the latest server state and translates them to the line the MUD
   * already accepts. They deliberately bypass command history, aliases, and
   * triggers.
   */
  const sendOnboardingAction = useCallback(
    (action: OnboardingActionName, payload?: OnboardingActionPayload) => {
      const state = onboardingUi.state;
      if (!state) {
        return;
      }

      dispatchOnboarding({ type: 'action-sent', action });
      sendMessage({
        type: 'onboarding-action',
        flowId: state.flowId,
        revision: state.revision,
        action,
        choiceId: payload?.choiceId,
        value: payload?.value,
      });
    },
    [onboardingUi.state, sendMessage],
  );

  const handleInspectChoice = useCallback((choiceId: string | null) => {
    dispatchOnboarding({ type: 'inspect-choice', choiceId });
  }, []);

  const handleUseClassicTerminal = useCallback(() => {
    dispatchOnboarding({ type: 'prefer-classic' });
  }, []);

  const handleEditorDraftChange = useCallback((draft: string) => {
    dispatchOnboarding({ type: 'editor-draft-changed', draft });
  }, []);

  const handleEditorCancel = useCallback(() => {
    dispatchOnboarding({ type: 'editor-discard-draft' });
  }, []);

  /**
   * Upload the current draft as a bounded begin/chunk/commit sequence. The
   * digest is computed over the exact bytes being sent, so the gateway and the
   * MUD can both prove nothing was altered in transit. The draft itself is
   * never written anywhere persistent.
   */
  const handleEditorSave = useCallback(() => {
    const state = onboardingUi.state;
    const editor = onboardingUi.editor;
    if (!state || !editor || editor.loadPhase !== 'ready') {
      return;
    }

    const content = editor.draft;
    const totalBytes = new TextEncoder().encode(content).byteLength;
    if (totalBytes > editor.maxBytes) {
      return;
    }

    void (async () => {
      const chunks = chunkEditorContent(content);
      const digest = await editorContentDigest(content);
      // A transfer ID only has to be unique within this session; it is matched
      // against the session's single active transfer, not looked up globally.
      const transferId = `editor-${state.revision}-${Date.now()}`;

      dispatchOnboarding({ type: 'editor-save-started', transferId });

      sendMessage({
        type: 'onboarding-editor-begin',
        flowId: state.flowId,
        revision: state.revision,
        fieldId: editor.fieldId,
        transferId,
        totalBytes,
        chunkCount: chunks.length,
        digest,
      });

      for (const [index, data] of chunks.entries()) {
        sendMessage({ type: 'onboarding-editor-chunk', transferId, index, data });
      }

      sendMessage({
        type: 'onboarding-editor-commit',
        flowId: state.flowId,
        revision: state.revision,
        transferId,
      });
    })();
  }, [onboardingUi.editor, onboardingUi.state, sendMessage]);

  useEffect(() => {
    return () => {
      clearPendingTerminalResize();
    };
  }, [clearPendingTerminalResize]);

  useEffect(() => {
    const terminalElement = terminalRef.current;
    if (!terminalElement) {
      return;
    }

    measureAndQueueTerminalResize({ immediate: true });

    if (typeof ResizeObserver === 'undefined') {
      const handleWindowResize = () => {
        measureAndQueueTerminalResize();
      };

      window.addEventListener('resize', handleWindowResize);
      return () => {
        window.removeEventListener('resize', handleWindowResize);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      measureAndQueueTerminalResize();
    });
    resizeObserver.observe(terminalElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [measureAndQueueTerminalResize]);

  useEffect(() => {
    measureAndQueueTerminalResize({ immediate: true });
  }, [
    clientSettings.terminal.fontSize,
    clientSettings.terminal.lineHeight,
    clientSettings.terminal.wrapLines,
    measureAndQueueTerminalResize,
    proxyReady,
    status,
  ]);

  useEffect(() => {
    const socket = new WebSocket(getWebSocketUrl());
    socketRef.current = socket;
    let heartbeatInterval: number | null = null;
    const isCurrentSocket = () => socketRef.current === socket;

    socket.addEventListener('open', () => {
      if (!isCurrentSocket()) {
        return;
      }

      setProxyReady(true);
      lastSentTerminalDimensionsRef.current = null;
      measureAndQueueTerminalResize({ immediate: true });
      setStatusDetail((current) =>
        current === 'Awaiting connection.' ? 'Proxy ready. Connect to start playing.' : current,
      );
      heartbeatInterval = window.setInterval(() => {
        if (isCurrentSocket() && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'heartbeat' } satisfies ClientMessage));
        }
      }, WEBSOCKET_HEARTBEAT_INTERVAL_MS);
    });

    socket.addEventListener('close', () => {
      if (!isCurrentSocket()) {
        return;
      }

      setProxyReady(false);
      lastSentTerminalDimensionsRef.current = null;
      clearPendingTerminalResize();
      statusRef.current = 'error';
      setStatus('error');
      setStatusDetail('The local WebSocket proxy is unavailable.');
      setIsHeaderVisible(true);
      setMudState({});
      triggerBufferRef.current = '';
      if (heartbeatInterval !== null) {
        window.clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    });

    socket.addEventListener('message', (event) => {
      if (!isCurrentSocket()) {
        return;
      }

      const message = parseServerMessage(event.data);
      if (!message) {
        return;
      }

      if (message.type === 'terminal') {
        if (triggerBatchDispatchingRef.current) {
          setAutomationNotice({
            kind: 'error',
            text: 'Skipped trigger automation while another trigger batch was still processing.',
          });
        } else {
          const triggerResult = consumeTriggerText(
            stripMudFormatting(message.text),
            triggerBufferRef.current,
            triggersRef.current,
            aliasesRef.current,
          );
          triggerBufferRef.current = triggerResult.buffer;
          if (triggerResult.notices.length > 0) {
            setAutomationNotice({
              kind: 'error',
              text: formatAutomationNotices(triggerResult.notices),
            });
          }

          triggerBatchDispatchingRef.current = triggerResult.commands.length > 0;
          try {
            for (const triggerCommand of triggerResult.commands) {
              sendInputLine(triggerCommand);
            }
          } finally {
            triggerBatchDispatchingRef.current = false;
          }
        }

        const html = renderMudStreamHtml(message.text, ansiConverterRef.current);
        setTerminalChunks((current) => {
          const next = [...current, html];
          return next.slice(-TERMINAL_CHUNK_LIMIT);
        });
        setTerminalRawChunks((current) => {
          const next = [...current, message.text];
          return next.slice(-TERMINAL_CHUNK_LIMIT);
        });
        return;
      }

      if (message.type === 'onboarding-state') {
        dispatchOnboarding({ type: 'server-state', state: message.state, phase: message.phase });
        return;
      }

      if (message.type === 'onboarding-fallback') {
        dispatchOnboarding({
          type: 'server-fallback',
          reason: message.reason,
          detail: message.detail,
        });
        return;
      }

      if (message.type === 'onboarding-rejected') {
        dispatchOnboarding({ type: 'rejected', code: message.code, detail: message.detail });
        return;
      }

      if (message.type === 'onboarding-editor-content') {
        dispatchOnboarding({
          type: 'editor-content-chunk',
          transferId: message.transferId,
          fieldId: message.fieldId,
          index: message.index,
          data: message.data,
        });
        return;
      }

      if (message.type === 'onboarding-editor-content-complete') {
        dispatchOnboarding({
          type: 'editor-content-complete',
          transferId: message.transferId,
          fieldId: message.fieldId,
        });
        return;
      }

      if (message.type === 'onboarding-editor-result') {
        dispatchOnboarding({
          type: 'editor-result',
          transferId: message.transferId,
          ok: message.ok,
          code: message.code,
          detail: message.detail,
        });
        return;
      }

      if (message.type === 'sensitive-input') {
        dispatchOnboarding({ type: 'sensitive-input', sensitive: message.sensitive });
        if (message.sensitive) {
          // Anything already typed could be the start of a password and must
          // not survive into a masked field or the history buffer.
          setCommand('');
          setHistoryDraft('');
          setHistoryIndex(null);
        }
        return;
      }

      if (message.type === 'connection-status') {
        statusRef.current = message.status;
        setStatus(message.status);
        setStatusDetail(message.detail);
        setIsHeaderVisible(message.status !== 'connected');

        if (message.status !== 'connected') {
          setMudState({});
          dispatchOnboarding({ type: 'disconnected' });
        }

        if (message.status === 'connected') {
          ansiConverterRef.current = createMudHtmlStreamConverter();
          triggerBufferRef.current = '';
          setTerminalChunks([`<span class="terminal-muted">${CONNECTED_TERMINAL_TEXT}</span>`]);
          setTerminalRawChunks([CONNECTED_TERMINAL_TEXT]);
          setTerminalResetKey((current) => current + 1);
        } else {
          triggerBufferRef.current = '';
        }

        return;
      }

      setMudState((current) => ({ ...current, ...message.state }));
    });

    return () => {
      if (heartbeatInterval !== null) {
        window.clearInterval(heartbeatInterval);
      }
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      socket.close();
    };
  }, [clearPendingTerminalResize, measureAndQueueTerminalResize, sendInputLine]);

  useEffect(() => {
    if (terminalRef.current && clientSettings.terminal.autoScroll) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [clientSettings.terminal.autoScroll, terminalChunks]);

  const activeMsdpVariables = useMemo(
    () => normalizeMsdpVariableMap(clientSettings.msdp),
    [clientSettings.msdp],
  );
  const startConnection = useCallback(() => {
    if (!canStartConnection) {
      return;
    }

    statusRef.current = 'connecting';
    setStatus('connecting');
    setStatusDetail(`Connecting to ${host}:${port}...`);
    sendMessage({ type: 'connect', host, port, msdpVariables: activeMsdpVariables });
  }, [activeMsdpVariables, canStartConnection, host, port, sendMessage]);
  const coreDisplay = useMemo(
    () => buildCoreDisplayModel(mudState, status, activeMsdpVariables),
    [activeMsdpVariables, mudState, status],
  );
  const combatDisplay = useMemo(
    () => buildCombatDisplayModel(mudState, status, activeMsdpVariables),
    [activeMsdpVariables, mudState, status],
  );
  const groupDisplay = useMemo(
    () => buildGroupDisplayModel({ group: mudState.group }, status, activeMsdpVariables),
    [activeMsdpVariables, mudState.group, status],
  );
  const roomDisplay = useMemo(
    () =>
      buildRoomDisplayModel(
        {
          room: mudState.room,
          roomName: mudState.roomName,
          areaName: mudState.areaName,
          roomVnum: mudState.roomVnum,
          roomExits: mudState.roomExits,
          worldTime: mudState.worldTime,
        },
        status,
        activeMsdpVariables,
      ),
    [
      activeMsdpVariables,
      mudState.areaName,
      mudState.room,
      mudState.roomExits,
      mudState.roomName,
      mudState.roomVnum,
      mudState.worldTime,
      status,
    ],
  );
  const affectsDisplay = useMemo(
    () => buildAffectsDisplayModel({ affects: mudState.affects }, status, activeMsdpVariables),
    [activeMsdpVariables, mudState.affects, status],
  );
  const inventoryDisplay = useMemo(
    () =>
      buildInventoryDisplayModel({ inventory: mudState.inventory }, status, activeMsdpVariables),
    [activeMsdpVariables, mudState.inventory, status],
  );
  const terminalOutputStyle = useMemo<CSSProperties>(
    () => ({
      fontSize: `${clientSettings.terminal.fontSize}px`,
      lineHeight: clientSettings.terminal.lineHeight,
      whiteSpace: clientSettings.terminal.wrapLines ? 'pre-wrap' : 'pre',
      wordBreak: clientSettings.terminal.wrapLines ? 'break-word' : 'normal',
    }),
    [
      clientSettings.terminal.fontSize,
      clientSettings.terminal.lineHeight,
      clientSettings.terminal.wrapLines,
    ],
  );
  const minimapStyle = useMemo<CSSProperties>(
    () => ({
      fontSize: `${clientSettings.minimap.fontSize}px`,
      height: `${clientSettings.minimap.paneHeight}rem`,
      minHeight: `${clientSettings.minimap.paneHeight}rem`,
    }),
    [clientSettings.minimap.fontSize, clientSettings.minimap.paneHeight],
  );
  const sidebarPanelStyle = useMemo<CSSProperties>(
    () => ({
      fontFamily: SIDEBAR_FONT_FAMILIES[clientSettings.sidebar.fontFamily],
      fontSize: `${clientSettings.sidebar.fontSize}px`,
    }),
    [clientSettings.sidebar.fontFamily, clientSettings.sidebar.fontSize],
  );
  const activeInspectorTab = layoutPreferences.activeInspectorTab;
  const activeInspectorLabel = INSPECTOR_TAB_METADATA[activeInspectorTab].label;
  const inspectorCollapsed = layoutPreferences.inspectorCollapsed;
  const inspectorDensity = layoutPreferences.density;
  const layoutClassName = [
    'layout',
    inspectorCollapsed ? 'layout-inspector-collapsed' : 'layout-inspector-expanded',
    `layout-density-${inspectorDensity}`,
  ].join(' ');
  const sidebarClassName = [
    'sidebar',
    'inspector-sidebar',
    inspectorCollapsed ? 'inspector-sidebar-collapsed' : 'inspector-sidebar-expanded',
    `inspector-density-${inspectorDensity}`,
  ].join(' ');

  const mapDisplay = useMemo(
    () =>
      buildMapDisplayModel(
        {
          room: mudState.room,
          roomName: mudState.roomName,
          areaName: mudState.areaName,
          roomVnum: mudState.roomVnum,
          roomExits: mudState.roomExits,
          worldTime: mudState.worldTime,
          minimap: mudState.minimap,
        },
        status,
        activeMsdpVariables,
      ),
    [
      activeMsdpVariables,
      mudState.areaName,
      mudState.minimap,
      mudState.room,
      mudState.roomExits,
      mudState.roomName,
      mudState.roomVnum,
      mudState.worldTime,
      status,
    ],
  );
  const selectedMudPreset = useMemo(
    () => uiSettings.connection.muds.find((mud) => mud.id === selectedMudId),
    [selectedMudId, uiSettings.connection.muds],
  );
  const questDisplay = useMemo(
    () => buildQuestDisplayModel({ questInfo: mudState.questInfo }, status, activeMsdpVariables),
    [activeMsdpVariables, mudState.questInfo, status],
  );
  const handleXtermFitDimensions = useCallback(
    (dimensions: TerminalDimensions) => {
      queueTerminalResize(dimensions);
    },
    [queueTerminalResize],
  );
  const updateLayoutPreferences = useCallback(
    (updates: Partial<Omit<ClientLayoutPreferences, 'version'>>) => {
      setLayoutPreferences((current) =>
        parseClientLayoutPreferencesPayload({
          ...current,
          ...updates,
        }),
      );
    },
    [],
  );
  const setInspectorTabButtonRef = useCallback(
    (tabId: InspectorTabId, element: HTMLButtonElement | null) => {
      if (element) {
        inspectorTabButtonRefs.current.set(tabId, element);
        return;
      }

      inspectorTabButtonRefs.current.delete(tabId);
    },
    [],
  );
  const selectInspectorTab = useCallback(
    (tabId: InspectorTabId, focusTarget: 'command' | 'tab') => {
      updateLayoutPreferences({ activeInspectorTab: tabId });
      requestAnimationFrame(() => {
        if (focusTarget === 'tab') {
          inspectorTabButtonRefs.current.get(tabId)?.focus({ preventScroll: true });
          return;
        }

        focusCommandInput(commandInputRef.current);
      });
    },
    [updateLayoutPreferences],
  );
  const handleInspectorTabClick = useCallback(
    (tabId: InspectorTabId) => {
      selectInspectorTab(tabId, 'command');
    },
    [selectInspectorTab],
  );
  const handleInspectorTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, tabId: InspectorTabId) => {
      const nextTabId = getKeyboardInspectorTabId(tabId, event.key);
      if (!nextTabId) {
        return;
      }

      event.preventDefault();
      selectInspectorTab(nextTabId, 'tab');
    },
    [selectInspectorTab],
  );
  const handleInspectorCollapsedChange = useCallback(
    (collapsed: boolean) => {
      updateLayoutPreferences({ inspectorCollapsed: collapsed });
      requestAnimationFrame(() => {
        focusCommandInput(commandInputRef.current);
      });
    },
    [updateLayoutPreferences],
  );
  const handleInspectorDensityChange = useCallback(
    (density: InspectorDensity) => {
      updateLayoutPreferences({ density });
      requestAnimationFrame(() => {
        focusCommandInput(commandInputRef.current);
      });
    },
    [updateLayoutPreferences],
  );

  useEffect(() => {
    if (!proxyReady) {
      return;
    }

    focusCommandInput(commandInputRef.current);
  }, [connected, proxyReady]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target === commandInputRef.current || shouldPreservePointerFocus(event.target)) {
        return;
      }

      focusCommandInput(commandInputRef.current);
    }

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [connected]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    sendMessage({ type: 'msdp-config', msdpVariables: activeMsdpVariables });
  }, [activeMsdpVariables, connected, sendMessage]);

  useEffect(() => {
    measureAndQueueTerminalResize();
  }, [activeInspectorTab, inspectorCollapsed, inspectorDensity, measureAndQueueTerminalResize]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const command = NUMPAD_COMMANDS[event.code];
      if (!command) {
        return;
      }

      event.preventDefault();
      setHistoryIndex(null);
      setHistoryDraft('');
      setCommand('');
      dispatchInputText(command);
      focusCommandInput(commandInputRef.current);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [connected, dispatchInputText]);

  function handleConnectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (connected) {
      sendMessage({ type: 'disconnect' });
      return;
    }

    startConnection();
  }

  function handleMudPresetChange(mudId: string) {
    setSelectedMudId(mudId);
    if (mudId === CUSTOM_MUD_VALUE) {
      return;
    }

    const preset = uiSettings.connection.muds.find((mud) => mud.id === mudId);
    if (!preset) {
      return;
    }

    setHost(preset.host);
    setPort(preset.port);
  }

  function handleHostChange(nextHost: string) {
    setHost(nextHost);
    setSelectedMudId(
      findMatchingMudPresetId(uiSettings.connection.muds, nextHost, port) ?? CUSTOM_MUD_VALUE,
    );
  }

  function handlePortChange(nextPort: number) {
    setPort(nextPort);
    setSelectedMudId(
      findMatchingMudPresetId(uiSettings.connection.muds, host, nextPort) ?? CUSTOM_MUD_VALUE,
    );
  }

  function handleCommandSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!networkStatus.canSendCommand) {
      return;
    }

    const trimmedCommand = command.trim();

    setHistoryIndex(null);
    setHistoryDraft('');

    if (!trimmedCommand) {
      sendInputLine('');
    } else if (onboardingUi.sensitive) {
      // Sensitive input never enters command history, alias expansion, or
      // trigger automation, and is not retained anywhere after this call.
      sendInputLine(command);
    } else {
      dispatchInputText(command);
    }

    setCommand('');
    focusCommandInput(commandInputRef.current);
  }

  function handleHistoryPrevious() {
    // Recalling history into a masked field risks sending an old command as a
    // password, so history is unavailable while input is sensitive.
    if (!connected || onboardingUi.sensitive || commandHistory.length === 0) {
      return;
    }

    if (historyIndex === null) {
      setHistoryDraft(command);
      setHistoryIndex(commandHistory.length - 1);
      setCommand(commandHistory[commandHistory.length - 1]);
      focusCommandInput(commandInputRef.current);
      return;
    }

    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setCommand(commandHistory[historyIndex - 1]);
    }

    focusCommandInput(commandInputRef.current);
  }

  function handleHistoryNext() {
    if (
      !connected ||
      onboardingUi.sensitive ||
      commandHistory.length === 0 ||
      historyIndex === null
    ) {
      return;
    }

    if (historyIndex < commandHistory.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setCommand(commandHistory[historyIndex + 1]);
      focusCommandInput(commandInputRef.current);
      return;
    }

    setHistoryIndex(null);
    setCommand(historyDraft);
    focusCommandInput(commandInputRef.current);
  }

  function handleCommandKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    // History recall and tab completion are suspended while the MUD is asking
    // for a password.
    if (onboardingUi.sensitive) {
      return;
    }

    if (event.key === 'Tab') {
      const prefix = command.trim().toLowerCase();
      if (!prefix) {
        return;
      }

      const matchingCommands = commandHistory.filter((entry) =>
        entry.trim().toLowerCase().startsWith(prefix),
      );
      if (matchingCommands.length === 0) {
        return;
      }

      event.preventDefault();
      const completedCommand = matchingCommands[matchingCommands.length - 1];
      setCommand(completedCommand);
      setHistoryIndex(null);
      setHistoryDraft(completedCommand);
      return;
    }

    if (event.key === 'ArrowUp') {
      if (commandHistory.length === 0) {
        return;
      }

      event.preventDefault();

      if (historyIndex === null) {
        setHistoryDraft(command);
        setHistoryIndex(commandHistory.length - 1);
        setCommand(commandHistory[commandHistory.length - 1]);
        return;
      }

      if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        setCommand(commandHistory[historyIndex - 1]);
      }

      return;
    }

    if (event.key !== 'ArrowDown' || historyIndex === null) {
      return;
    }

    event.preventDefault();

    if (historyIndex < commandHistory.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setCommand(commandHistory[historyIndex + 1]);
      return;
    }

    setHistoryIndex(null);
    setCommand(historyDraft);
  }

  function updateAlias(aliasId: string, updates: Partial<AliasDefinition>) {
    setAliases((current) =>
      current.map((alias) => (alias.id === aliasId ? { ...alias, ...updates } : alias)),
    );
    setAutomationNotice(null);
  }

  function updateTrigger(triggerId: string, updates: Partial<TriggerDefinition>) {
    setTriggers((current) =>
      current.map((trigger) => (trigger.id === triggerId ? { ...trigger, ...updates } : trigger)),
    );
    setAutomationNotice(null);
  }

  function toggleAutomationMenu(menuId: AutomationMenuId) {
    const isClosing = openAutomationMenu === menuId;
    const nextMenu = isClosing ? null : menuId;
    setOpenAutomationMenu(nextMenu);
    resetAutomationMenuState(nextMenu);
    if (isClosing && connected) {
      focusCommandInput(commandInputRef.current);
    }
  }

  function handleAddAlias() {
    setAliases((current) => [...current, createEmptyAlias()]);
    setAutomationNotice(null);
    setPendingAutomationDelete(null);
  }

  function handleAddTrigger() {
    setTriggers((current) => [...current, createEmptyTrigger()]);
    setAutomationNotice(null);
    setPendingAutomationDelete(null);
  }

  function requestAliasDelete(aliasId: string) {
    setPendingAutomationDelete({ kind: 'alias', id: aliasId });
  }

  function requestTriggerDelete(triggerId: string) {
    setPendingAutomationDelete({ kind: 'trigger', id: triggerId });
  }

  function confirmAliasDelete(aliasId: string) {
    setAliases((current) => current.filter((entry) => entry.id !== aliasId));
    setAliasPreviewInputs((current) => removeRecordKey(current, aliasId));
    setPendingAutomationDelete(null);
    setAutomationNotice(null);
  }

  function confirmTriggerDelete(triggerId: string) {
    setTriggers((current) => current.filter((entry) => entry.id !== triggerId));
    setTriggerPreviewInputs((current) => removeRecordKey(current, triggerId));
    setPendingAutomationDelete(null);
    setAutomationNotice(null);
  }

  function updateAliasPreviewInput(aliasId: string, value: string) {
    setAliasPreviewInputs((current) => ({ ...current, [aliasId]: value }));
  }

  function updateTriggerPreviewInput(triggerId: string, value: string) {
    setTriggerPreviewInputs((current) => ({ ...current, [triggerId]: value }));
  }

  function updateTerminalSettings(updates: Partial<ClientSettings['terminal']>) {
    setClientSettings((current) => ({
      ...current,
      terminal: {
        ...current.terminal,
        ...updates,
      },
    }));
    setAutomationNotice(null);
  }

  function updateMinimapSettings(updates: Partial<ClientSettings['minimap']>) {
    setClientSettings((current) => ({
      ...current,
      minimap: {
        ...current.minimap,
        ...updates,
      },
    }));
    setAutomationNotice(null);
  }

  function updateSidebarSettings(updates: Partial<ClientSettings['sidebar']>) {
    setClientSettings((current) => ({
      ...current,
      sidebar: {
        ...current.sidebar,
        ...updates,
      },
    }));
    setAutomationNotice(null);
  }

  function updateMsdpVariable(key: MsdpVariableKey, nextValue: string) {
    setClientSettings((current) => ({
      ...current,
      msdp: normalizeMsdpVariableMap({
        ...current.msdp,
        [key]: nextValue,
      }),
    }));
    setAutomationNotice(null);
  }

  function handleConfigExport() {
    const validationMessage = getFirstAutomationValidationMessage(aliases, triggers);
    if (validationMessage) {
      setAutomationNotice({
        kind: 'error',
        text: `Fix automation validation errors before saving: ${validationMessage}`,
      });
      return;
    }

    downloadJsonFile(
      'luminari-web-client-config.json',
      buildClientConfigPayload({
        settings: clientSettings,
        aliases,
        triggers,
      }),
    );
    setOpenAutomationMenu(null);
    if (connected) {
      focusCommandInput(commandInputRef.current);
    }
    setAutomationNotice({
      kind: 'success',
      text: `Saved settings, ${aliases.length} alias${pluralize(aliases.length)}, and ${triggers.length} trigger${pluralize(triggers.length)} to file.`,
    });
  }

  async function handleConfigImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      const importedConfig = parseClientConfigImport(await file.text(), {
        settings: clientSettings,
        aliases,
        triggers,
      });
      setClientSettings(importedConfig.settings);
      setAliases(importedConfig.aliases);
      setTriggers(importedConfig.triggers);
      setAliasPreviewInputs({});
      setTriggerPreviewInputs({});
      setPendingAutomationDelete(null);
      setOpenAutomationMenu(null);
      if (connected) {
        focusCommandInput(commandInputRef.current);
      }
      setAutomationNotice({
        kind: 'success',
        text: `Loaded settings, ${importedConfig.aliases.length} alias${pluralize(importedConfig.aliases.length)}, and ${importedConfig.triggers.length} trigger${pluralize(importedConfig.triggers.length)} from ${file.name}.`,
      });
    } catch (error) {
      setAutomationNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to load configuration.',
      });
    }
  }

  function handleTerminalClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!connected || event.button !== 0 || hasExpandedSelection()) {
      return;
    }

    focusCommandInput(commandInputRef.current);
  }

  function renderInspectorPanelContent(tabId: InspectorTabId): ReactNode {
    switch (tabId) {
      case 'map':
        return <MapPanel map={mapDisplay} minimapStyle={minimapStyle} />;
      case 'room':
        return <RoomPanel room={roomDisplay} />;
      case 'character':
        return (
          <>
            <div className="identity-block">
              <strong
                aria-label={coreDisplay.character.identity.ariaLabel}
                dangerouslySetInnerHTML={{
                  __html: renderMudHtml(coreDisplay.character.identity.headingText),
                }}
              />
              <span
                dangerouslySetInnerHTML={{
                  __html: renderMudHtml(coreDisplay.character.identity.profileText),
                }}
              />
              {coreDisplay.character.identity.titleNotice ? (
                <AvailabilityNoticeBlock
                  notice={coreDisplay.character.identity.titleNotice}
                  compact
                />
              ) : null}
            </div>

            <div className="ability-grid" aria-label="Ability scores">
              {coreDisplay.character.abilityScores.map((score) => (
                <div key={score.id} className="ability-cell">
                  <span className="ability-label">{score.label}</span>
                  <CharacterFieldValue field={score} className="ability-value" />
                </div>
              ))}
            </div>

            <div className="saving-throw-grid" aria-label="Saving throws">
              {coreDisplay.character.savingThrows.map((save) => (
                <div key={save.id} className="saving-throw-cell">
                  <span className="saving-throw-label">{save.label}</span>
                  <CharacterFieldValue field={save} className="saving-throw-value" />
                </div>
              ))}
            </div>

            <dl className="stats-grid">
              {coreDisplay.character.stats.map((stat) =>
                stat.notice ? (
                  <AvailabilityStat key={stat.id} label={stat.label} notice={stat.notice} />
                ) : (
                  <Stat key={stat.id} label={stat.label} value={stat.valueText} />
                ),
              )}
            </dl>
          </>
        );
      case 'combat':
        return <CombatInspectorPanel combat={combatDisplay} />;
      case 'group':
        return <GroupPanel group={groupDisplay} />;
      case 'inventory':
        return <InventoryPanel inventory={inventoryDisplay} />;
      case 'affects':
        return <AffectsPanel affects={affectsDisplay} />;
      case 'quests':
        return <QuestPanel quest={questDisplay} />;
      case 'protocol':
        return <ProtocolInspectorPanel />;
      default:
        return assertNever(tabId);
    }
  }

  // Progressive enhancement: the terminal surface below stays mounted and keeps
  // receiving output, so the classic flow is always one click away.
  if (shouldShowOnboarding(onboardingUi)) {
    return (
      <div className="app-shell app-shell--onboarding">
        <OnboardingShell
          ui={onboardingUi}
          onAction={sendOnboardingAction}
          onInspect={handleInspectChoice}
          onUseClassicTerminal={handleUseClassicTerminal}
          onEditorDraftChange={handleEditorDraftChange}
          onEditorSave={handleEditorSave}
          onEditorCancel={handleEditorCancel}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {onboardingUi.supported && onboardingUi.preferClassic ? (
        <div className="onboarding-return-bar panel" data-prevent-command-focus>
          <span>You are using the classic terminal flow.</span>
          <button type="button" onClick={() => dispatchOnboarding({ type: 'prefer-structured' })}>
            Return to the guided experience
          </button>
        </div>
      ) : null}
      {onboardingUi.fallback ? (
        <div className="onboarding-return-bar panel" role="status" data-prevent-command-focus>
          <span>
            The guided experience is unavailable ({onboardingUi.fallback.detail}). The classic
            terminal below works normally.
          </span>
        </div>
      ) : null}
      <div ref={menuBarRef} className="window-menu-bar panel" data-prevent-command-focus>
        <div className="window-menu-links" role="menubar" aria-label="Window menu">
          {connected ? (
            <button
              type="button"
              className="window-menu-link"
              onClick={() => setIsHeaderVisible((current) => !current)}
            >
              {isHeaderVisible ? 'Hide Header' : 'Show Header'}
            </button>
          ) : null}

          <div className="window-menu-item">
            <button
              type="button"
              className={`window-menu-link${openAutomationMenu === 'aliases' ? ' window-menu-link-open' : ''}`}
              aria-expanded={openAutomationMenu === 'aliases'}
              onClick={() => toggleAutomationMenu('aliases')}
            >
              Aliases
            </button>

            {openAutomationMenu === 'aliases' ? (
              <div className="window-menu-dropdown">
                <div className="automation-menu-content">
                  <div className="automation-section-header">
                    <div>
                      <h3>Aliases</h3>
                      <p>Literal aliases match the command name and put remaining text into %1.</p>
                    </div>

                    <div className="automation-actions">
                      <button type="button" onClick={handleAddAlias}>
                        Add
                      </button>
                    </div>
                  </div>

                  <p className="automation-menu-help">
                    Use <code>*</code> as a wildcard and <code>%1</code> through <code>%9</code> in
                    expansions.
                  </p>

                  {aliases.length === 0 ? (
                    <p className="automation-empty">No aliases saved yet.</p>
                  ) : (
                    <div className="automation-list">
                      {aliases.map((alias) => {
                        const validation = aliasValidationById.get(alias.id);
                        const issues = validation?.issues ?? [];
                        const previewInput = aliasPreviewInputs[alias.id] ?? '';
                        const previewReport = previewInput.trim()
                          ? previewAliasExpansion(alias, previewInput, aliases)
                          : null;
                        const deletePending =
                          pendingAutomationDelete?.kind === 'alias' &&
                          pendingAutomationDelete.id === alias.id;

                        return (
                          <div
                            key={alias.id}
                            className={`automation-item${validation?.valid === false ? ' automation-item-invalid' : ''}`}
                          >
                            <div className="automation-item-header">
                              <label className="automation-toggle">
                                <input
                                  type="checkbox"
                                  checked={alias.enabled}
                                  onChange={(event) =>
                                    updateAlias(alias.id, { enabled: event.target.checked })
                                  }
                                />
                                <span>{alias.enabled ? 'Enabled' : 'Disabled'}</span>
                              </label>

                              <button
                                type="button"
                                className="automation-delete"
                                onClick={() => requestAliasDelete(alias.id)}
                                aria-expanded={deletePending}
                              >
                                Delete
                              </button>
                            </div>

                            {deletePending ? (
                              <div className="automation-confirm-row" role="group">
                                <span>Delete this alias?</span>
                                <button type="button" onClick={() => confirmAliasDelete(alias.id)}>
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingAutomationDelete(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : null}

                            <div className="automation-fields">
                              <label>
                                <span>Pattern</span>
                                <input
                                  value={alias.pattern}
                                  onChange={(event) =>
                                    updateAlias(alias.id, { pattern: event.target.value })
                                  }
                                  aria-invalid={hasFieldIssue(issues, 'pattern')}
                                  placeholder="k *"
                                />
                                {renderAutomationFieldErrors(issues, 'pattern')}
                              </label>

                              <label>
                                <span>Expansion</span>
                                <textarea
                                  rows={2}
                                  value={alias.expansion}
                                  onChange={(event) =>
                                    updateAlias(alias.id, { expansion: event.target.value })
                                  }
                                  aria-invalid={hasFieldIssue(issues, 'expansion')}
                                  placeholder="kill %1"
                                />
                                {renderAutomationFieldErrors(issues, 'expansion')}
                              </label>
                            </div>

                            <label className="automation-preview-control">
                              <span>Test command</span>
                              <input
                                value={previewInput}
                                onChange={(event) =>
                                  updateAliasPreviewInput(alias.id, event.target.value)
                                }
                                placeholder="k goblin"
                              />
                            </label>
                            {previewReport
                              ? renderAliasPreview(previewReport.commands, previewReport.notices)
                              : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="window-menu-item">
            <button
              type="button"
              className={`window-menu-link${openAutomationMenu === 'triggers' ? ' window-menu-link-open' : ''}`}
              aria-expanded={openAutomationMenu === 'triggers'}
              onClick={() => toggleAutomationMenu('triggers')}
            >
              Triggers
            </button>

            {openAutomationMenu === 'triggers' ? (
              <div className="window-menu-dropdown">
                <div className="automation-menu-content">
                  <div className="automation-section-header">
                    <div>
                      <h3>Triggers</h3>
                      <p>
                        Literal trigger patterns match anywhere in a line; wildcards let you capture
                        text.
                      </p>
                    </div>

                    <div className="automation-actions">
                      <button type="button" onClick={handleAddTrigger}>
                        Add
                      </button>
                    </div>
                  </div>

                  <p className="automation-menu-help">
                    Use <code>*</code> as a wildcard and <code>%1</code> through <code>%9</code> in
                    actions.
                  </p>

                  {triggers.length === 0 ? (
                    <p className="automation-empty">No triggers saved yet.</p>
                  ) : (
                    <div className="automation-list">
                      {triggers.map((trigger) => {
                        const validation = triggerValidationById.get(trigger.id);
                        const issues = validation?.issues ?? [];
                        const previewInput = triggerPreviewInputs[trigger.id] ?? '';
                        const previewReport = previewInput.trim()
                          ? previewTriggerConsumption(trigger, previewInput, aliases)
                          : null;
                        const deletePending =
                          pendingAutomationDelete?.kind === 'trigger' &&
                          pendingAutomationDelete.id === trigger.id;

                        return (
                          <div
                            key={trigger.id}
                            className={`automation-item${validation?.valid === false ? ' automation-item-invalid' : ''}`}
                          >
                            <div className="automation-item-header">
                              <label className="automation-toggle">
                                <input
                                  type="checkbox"
                                  checked={trigger.enabled}
                                  onChange={(event) =>
                                    updateTrigger(trigger.id, { enabled: event.target.checked })
                                  }
                                />
                                <span>{trigger.enabled ? 'Enabled' : 'Disabled'}</span>
                              </label>

                              <button
                                type="button"
                                className="automation-delete"
                                onClick={() => requestTriggerDelete(trigger.id)}
                                aria-expanded={deletePending}
                              >
                                Delete
                              </button>
                            </div>

                            {deletePending ? (
                              <div className="automation-confirm-row" role="group">
                                <span>Delete this trigger?</span>
                                <button
                                  type="button"
                                  onClick={() => confirmTriggerDelete(trigger.id)}
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingAutomationDelete(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : null}

                            <div className="automation-fields">
                              <label>
                                <span>Pattern</span>
                                <input
                                  value={trigger.pattern}
                                  onChange={(event) =>
                                    updateTrigger(trigger.id, { pattern: event.target.value })
                                  }
                                  aria-invalid={hasFieldIssue(issues, 'pattern')}
                                  placeholder="* tells you *"
                                />
                                {renderAutomationFieldErrors(issues, 'pattern')}
                              </label>

                              <label>
                                <span>Action</span>
                                <textarea
                                  rows={2}
                                  value={trigger.action}
                                  onChange={(event) =>
                                    updateTrigger(trigger.id, { action: event.target.value })
                                  }
                                  aria-invalid={hasFieldIssue(issues, 'action')}
                                  placeholder="tell %1 Thanks for the message."
                                />
                                {renderAutomationFieldErrors(issues, 'action')}
                              </label>
                            </div>

                            <label className="automation-preview-control">
                              <span>Sample line</span>
                              <input
                                value={previewInput}
                                onChange={(event) =>
                                  updateTriggerPreviewInput(trigger.id, event.target.value)
                                }
                                placeholder="Ari tells you hello"
                              />
                            </label>
                            {previewReport
                              ? renderTriggerPreview(previewReport.commands, previewReport.notices)
                              : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="window-menu-item">
            <button
              type="button"
              className={`window-menu-link${openAutomationMenu === 'msdpVars' ? ' window-menu-link-open' : ''}`}
              aria-expanded={openAutomationMenu === 'msdpVars'}
              onClick={() => toggleAutomationMenu('msdpVars')}
            >
              MSDP Vars
            </button>

            {openAutomationMenu === 'msdpVars' ? (
              <div className="window-menu-dropdown">
                <div className="automation-menu-content">
                  <div className="automation-section-header">
                    <div>
                      <h3>MSDP Vars</h3>
                      <p>Rename the MSDP variable names this client requests and parses.</p>
                    </div>
                  </div>

                  <p className="automation-menu-help">
                    These mappings are saved with your client settings and sent to the proxy when
                    you connect.
                  </p>

                  <div className="settings-list">
                    {MSDP_VARIABLE_GROUPS.map((group) => (
                      <section key={group.title} className="settings-group">
                        <div className="settings-group-header">
                          <h4>{group.title}</h4>
                          <p>{group.description}</p>
                        </div>

                        <div className="msdp-vars-grid">
                          {group.fields.map((field) => {
                            const isOverrideOnly = isOverrideOnlyMsdpVariableKey(field.key);
                            const supportNote = getMsdpFieldSupportNote(field.key);

                            return (
                              <label key={field.key}>
                                <span className="msdp-var-label">
                                  {field.label}
                                  {isOverrideOnly ? (
                                    <span className="msdp-var-badge">Future/override</span>
                                  ) : null}
                                </span>
                                <input
                                  aria-label={`${field.label} MSDP variable${supportNote ? `. ${supportNote}` : ''}`}
                                  value={clientSettings.msdp[field.key]}
                                  onChange={(event) =>
                                    updateMsdpVariable(field.key, event.target.value)
                                  }
                                  placeholder={
                                    defaultMsdpVariables[field.key] || 'Optional override'
                                  }
                                />
                                {supportNote ? (
                                  <small className="msdp-var-support">{supportNote}</small>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="window-menu-item">
            <button
              type="button"
              className={`window-menu-link${openAutomationMenu === 'settings' ? ' window-menu-link-open' : ''}`}
              aria-expanded={openAutomationMenu === 'settings'}
              onClick={() => toggleAutomationMenu('settings')}
            >
              Settings
            </button>

            {openAutomationMenu === 'settings' ? (
              <div className="window-menu-dropdown">
                <div className="automation-menu-content">
                  <div className="automation-section-header">
                    <div>
                      <h3>Settings</h3>
                      <p>Adjust output behavior and save or load your full client configuration.</p>
                    </div>

                    <div className="automation-actions">
                      <button type="button" onClick={() => configFileInputRef.current?.click()}>
                        Load
                      </button>
                      <button type="button" onClick={handleConfigExport}>
                        Save
                      </button>
                    </div>
                  </div>

                  <p className="automation-menu-help">
                    Saved config files include display settings, MSDP variable mappings, aliases,
                    and triggers.
                  </p>

                  <div className="settings-list">
                    <section className="settings-group">
                      <div className="settings-group-header">
                        <h4>Output window</h4>
                        <p>Fine-tune readability and scrolling in the main MUD output pane.</p>
                      </div>

                      <div className="settings-fields">
                        <label>
                          <span>Font size</span>
                          <select
                            value={String(clientSettings.terminal.fontSize)}
                            onChange={(event) =>
                              updateTerminalSettings({
                                fontSize: Number.parseInt(event.target.value, 10),
                              })
                            }
                          >
                            {OUTPUT_FONT_SIZE_OPTIONS.map((fontSize) => (
                              <option key={fontSize} value={fontSize}>
                                {fontSize}px
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Line spacing</span>
                          <select
                            value={String(clientSettings.terminal.lineHeight)}
                            onChange={(event) =>
                              updateTerminalSettings({
                                lineHeight: Number.parseFloat(event.target.value),
                              })
                            }
                          >
                            {OUTPUT_LINE_HEIGHT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="settings-toggle-list">
                        <label className="automation-toggle">
                          <input
                            type="checkbox"
                            checked={clientSettings.terminal.autoScroll}
                            onChange={(event) =>
                              updateTerminalSettings({ autoScroll: event.target.checked })
                            }
                          />
                          <span>Auto-scroll when new output arrives</span>
                        </label>

                        <label className="automation-toggle">
                          <input
                            type="checkbox"
                            checked={clientSettings.terminal.wrapLines}
                            onChange={(event) =>
                              updateTerminalSettings({ wrapLines: event.target.checked })
                            }
                          />
                          <span>Wrap long lines in the output window</span>
                        </label>
                      </div>
                    </section>

                    <section className="settings-group">
                      <div className="settings-group-header">
                        <h4>Minimap</h4>
                        <p>Control the map text size and how tall the map pane stays.</p>
                      </div>

                      <div className="settings-fields">
                        <label>
                          <span>Font size</span>
                          <input
                            type="number"
                            min={8}
                            max={48}
                            step={1}
                            inputMode="numeric"
                            value={clientSettings.minimap.fontSize}
                            onChange={(event) => {
                              const nextValue = parsePositiveIntegerInput(event.target.value);
                              if (nextValue !== null) {
                                updateMinimapSettings({ fontSize: nextValue });
                              }
                            }}
                          />
                        </label>

                        <label>
                          <span>Pane height</span>
                          <input
                            type="number"
                            min={6}
                            max={48}
                            step={1}
                            inputMode="numeric"
                            value={clientSettings.minimap.paneHeight}
                            onChange={(event) => {
                              const nextValue = parsePositiveIntegerInput(event.target.value);
                              if (nextValue !== null) {
                                updateMinimapSettings({ paneHeight: nextValue });
                              }
                            }}
                          />
                        </label>
                      </div>
                    </section>

                    <section className="settings-group">
                      <div className="settings-group-header">
                        <h4>Sidebar panels</h4>
                        <p>Use one shared font for character info, quests, group, and affects.</p>
                      </div>

                      <div className="settings-fields">
                        <label>
                          <span>Panel font</span>
                          <select
                            value={clientSettings.sidebar.fontFamily}
                            onChange={(event) => {
                              if (isSidebarFontFamily(event.target.value)) {
                                updateSidebarSettings({ fontFamily: event.target.value });
                              }
                            }}
                          >
                            {SIDEBAR_FONT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Panel font size</span>
                          <input
                            type="number"
                            min={8}
                            max={32}
                            step={1}
                            inputMode="numeric"
                            value={clientSettings.sidebar.fontSize}
                            onChange={(event) => {
                              const nextValue = parsePositiveIntegerInput(event.target.value);
                              if (nextValue !== null) {
                                updateSidebarSettings({ fontSize: nextValue });
                              }
                            }}
                          />
                        </label>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {automationNotice ? (
          <p className={`window-menu-status window-menu-status-${automationNotice.kind}`}>
            {automationNotice.text}
          </p>
        ) : null}

        <input
          ref={configFileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleConfigImport}
        />
      </div>

      {isHeaderVisible ? (
        <div className="app-header" data-prevent-command-focus>
          <header className="topbar">
            <div>
              <p className="eyebrow">{uiSettings.personalization.eyebrow}</p>
              <h1>{uiSettings.personalization.title}</h1>
              <p className="subtitle">{uiSettings.personalization.subtitle}</p>
            </div>

            <form className="connection-form panel" onSubmit={handleConnectionSubmit}>
              {uiSettings.connection.muds.length > 0 ? (
                <label>
                  <span>MUD</span>
                  <select
                    value={selectedMudId}
                    onChange={(event) => handleMudPresetChange(event.target.value)}
                  >
                    {uiSettings.connection.muds.map((mud) => (
                      <option key={mud.id} value={mud.id}>
                        {mud.name}
                      </option>
                    ))}
                    <option value={CUSTOM_MUD_VALUE}>Custom</option>
                  </select>
                  {selectedMudPreset?.description ? (
                    <small className="connection-form-help">{selectedMudPreset.description}</small>
                  ) : null}
                </label>
              ) : null}

              <label>
                <span>Host</span>
                <input value={host} onChange={(event) => handleHostChange(event.target.value)} />
              </label>

              <label>
                <span>Port</span>
                <input
                  inputMode="numeric"
                  value={port}
                  onChange={(event) => handlePortChange(Number(event.target.value) || DEFAULT_PORT)}
                />
              </label>

              <button type="submit" disabled={!canConnect}>
                {connected ? 'Disconnect' : status === 'connecting' ? 'Connecting...' : 'Connect'}
              </button>
            </form>
          </header>

          <section className={`status-row status-row-${networkStatus.kind}`} aria-live="polite">
            <div className={`status-pill status-${status}`}>{status}</div>
            <div className="status-copy">
              <p>
                <strong>{networkStatus.title}</strong>
              </p>
              <p>{networkStatus.detail}</p>
            </div>
            <div className={`browser-network-pill browser-network-${networkStatus.browserState}`}>
              {networkStatus.browserLabel}
            </div>
          </section>
        </div>
      ) : null}

      <main
        className={layoutClassName}
        data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}
        data-inspector-density={inspectorDensity}
      >
        <section className="terminal-column panel">
          <div
            className={`mobile-status-strip mobile-status-${networkStatus.kind}`}
            aria-live="polite"
            data-prevent-command-focus
          >
            <div className="mobile-status-item">
              <span>Network</span>
              <strong>{networkStatus.browserLabel}</strong>
            </div>
            <div className="mobile-status-item">
              <span>Proxy</span>
              <strong>{networkStatus.proxyLabel}</strong>
            </div>
            <div className="mobile-status-item">
              <span>MUD</span>
              <strong>{networkStatus.mudLabel}</strong>
            </div>
            <p className="mobile-status-detail">{networkStatus.detail}</p>
            <button
              type="button"
              className="mobile-reconnect-button"
              onClick={startConnection}
              disabled={!networkStatus.canUseReconnect || !canStartConnection}
            >
              {status === 'idle' ? 'Connect' : 'Reconnect'}
            </button>
          </div>

          {useXtermSpike ? (
            <XtermTerminalSpike
              autoScroll={clientSettings.terminal.autoScroll}
              className="terminal-output"
              fontSize={clientSettings.terminal.fontSize}
              lineHeight={clientSettings.terminal.lineHeight}
              onClick={handleTerminalClick}
              onFitDimensions={handleXtermFitDimensions}
              resetKey={`${terminalRendererMode}:${terminalResetKey}`}
              style={terminalOutputStyle}
              textChunks={terminalRawChunks}
            />
          ) : (
            <div
              ref={terminalRef}
              className="terminal-output"
              data-prevent-command-focus
              onClick={handleTerminalClick}
              style={terminalOutputStyle}
              dangerouslySetInnerHTML={{ __html: terminalChunks.join('') }}
            />
          )}

          <div className="bars">
            {coreDisplay.hudBars.map((bar) => (
              <StatusBar key={bar.id} bar={bar} />
            ))}
          </div>

          <form className="command-form" onSubmit={handleCommandSubmit} autoComplete="off">
            <input
              ref={commandInputRef}
              type={onboardingUi.sensitive ? 'password' : 'text'}
              name={onboardingUi.sensitive ? 'luminari-sensitive' : 'luminari-command'}
              autoComplete={onboardingUi.sensitive ? 'new-password' : 'off'}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              value={command}
              onChange={(event) => {
                setCommand(event.target.value);
                setHistoryIndex(null);
                // A sensitive value must not be stashed in the history draft.
                setHistoryDraft(onboardingUi.sensitive ? '' : event.target.value);
              }}
              onKeyDown={handleCommandKeyDown}
              placeholder={
                onboardingUi.sensitive
                  ? 'Password (hidden)'
                  : networkStatus.canSendCommand
                    ? 'Type a command...'
                    : !browserOnline
                      ? 'Browser offline; commands require network.'
                      : 'Connect before sending commands.'
              }
              readOnly={!networkStatus.canSendCommand}
              aria-label={onboardingUi.sensitive ? 'Password' : 'Command'}
            />
            <div className="command-actions" data-prevent-command-focus>
              <div className="command-history-actions" aria-label="Command history controls">
                <button
                  type="button"
                  className="command-history-button"
                  onClick={handleHistoryPrevious}
                  disabled={!connected || onboardingUi.sensitive || commandHistory.length === 0}
                  aria-label="Previous command"
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="command-history-button"
                  onClick={handleHistoryNext}
                  disabled={!connected || onboardingUi.sensitive || historyIndex === null}
                  aria-label="Next command"
                >
                  Next
                </button>
              </div>
              <button type="submit" disabled={!networkStatus.canSendCommand}>
                Send
              </button>
            </div>
          </form>
        </section>

        <aside className={sidebarClassName}>
          <section className="panel tabbed-panel inspector-panel">
            <div className="panel-header inspector-header">
              <div>
                <h2>Inspector</h2>
                <p>
                  {inspectorCollapsed ? `${activeInspectorLabel} selected` : activeInspectorLabel}
                </p>
              </div>

              <div className="inspector-controls" data-prevent-command-focus>
                <button
                  type="button"
                  className="inspector-control"
                  aria-label={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                  aria-expanded={!inspectorCollapsed}
                  onClick={() => handleInspectorCollapsedChange(!inspectorCollapsed)}
                >
                  {inspectorCollapsed ? 'Expand' : 'Collapse'}
                </button>

                <div className="inspector-density-controls" aria-label="Inspector density">
                  {(['comfortable', 'compact'] as const).map((density) => (
                    <button
                      key={density}
                      type="button"
                      className={`inspector-control inspector-density-button${
                        inspectorDensity === density ? ' inspector-density-button-active' : ''
                      }`}
                      aria-pressed={inspectorDensity === density}
                      onClick={() => handleInspectorDensityChange(density)}
                    >
                      {INSPECTOR_DENSITY_LABELS[density]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {inspectorCollapsed ? (
              <div className="inspector-collapsed-summary" aria-live="polite">
                <span>{activeInspectorLabel}</span>
              </div>
            ) : (
              <>
                <div
                  className="tab-strip inspector-tab-strip"
                  role="tablist"
                  aria-label="Inspector sections"
                >
                  {INSPECTOR_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      ref={(element) => setInspectorTabButtonRef(tab.id, element)}
                      type="button"
                      role="tab"
                      aria-selected={activeInspectorTab === tab.id}
                      aria-controls={`inspector-panel-${tab.id}`}
                      id={`inspector-tab-${tab.id}`}
                      className={`tab-button inspector-tab-button${
                        activeInspectorTab === tab.id ? ' tab-button-active' : ''
                      }`}
                      tabIndex={activeInspectorTab === tab.id ? 0 : -1}
                      onClick={() => handleInspectorTabClick(tab.id)}
                      onKeyDown={(event) => handleInspectorTabKeyDown(event, tab.id)}
                    >
                      <span className="inspector-tab-label">{tab.label}</span>
                      <span className="inspector-tab-short-label">{tab.shortLabel}</span>
                    </button>
                  ))}
                </div>

                <div
                  className="tab-panel inspector-tab-panel"
                  id={`inspector-panel-${activeInspectorTab}`}
                  role="tabpanel"
                  aria-labelledby={`inspector-tab-${activeInspectorTab}`}
                  style={sidebarPanelStyle}
                >
                  {renderInspectorPanelContent(activeInspectorTab)}
                </div>
              </>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}

function renderAutomationFieldErrors(
  issues: AutomationValidationIssue[],
  field: AutomationField,
): ReactNode {
  const fieldIssues = issues.filter((issue) => issue.field === field);
  if (fieldIssues.length === 0) {
    return null;
  }

  return (
    <div className="automation-field-errors" role="alert">
      {fieldIssues.map((issue) => (
        <p key={issue.message}>{issue.message}</p>
      ))}
    </div>
  );
}

function renderAliasPreview(commands: string[], notices: AutomationLimitNotice[]): ReactNode {
  return renderAutomationPreview('Alias preview', commands, notices);
}

function renderTriggerPreview(commands: string[], notices: AutomationLimitNotice[]): ReactNode {
  return renderAutomationPreview('Trigger preview', commands, notices);
}

function renderAutomationPreview(
  title: string,
  commands: string[],
  notices: AutomationLimitNotice[],
): ReactNode {
  return (
    <div className="automation-preview-result" aria-live="polite">
      <span>{title}</span>
      {notices.length > 0 ? (
        <ul className="automation-preview-notices">
          {notices.slice(0, 3).map((notice) => (
            <li key={`${notice.kind}:${notice.message}`}>{notice.message}</li>
          ))}
        </ul>
      ) : null}
      {commands.length > 0 ? (
        <ol>
          {commands.slice(0, 5).map((command, index) => (
            <li key={`${command}:${index}`}>{command}</li>
          ))}
        </ol>
      ) : (
        <p>No commands would be sent.</p>
      )}
      {commands.length > 5 ? <p>{commands.length - 5} more command(s) hidden.</p> : null}
    </div>
  );
}

function hasFieldIssue(issues: AutomationValidationIssue[], field: AutomationField) {
  return issues.some((issue) => issue.field === field);
}

function formatAutomationNotices(notices: AutomationLimitNotice[]) {
  const messages = [...new Set(notices.map((notice) => notice.message))];
  const visibleMessages = messages.slice(0, 2);
  return messages.length > visibleMessages.length
    ? `${visibleMessages.join(' ')} ${messages.length - visibleMessages.length} more automation notice(s).`
    : visibleMessages.join(' ');
}

function getFirstAutomationValidationMessage(
  aliases: AliasDefinition[],
  triggers: TriggerDefinition[],
) {
  for (const alias of aliases) {
    const issue = validateAlias(alias).issues[0];
    if (issue) {
      return `Alias "${alias.pattern || 'untitled'}": ${issue.message}`;
    }
  }

  for (const trigger of triggers) {
    const issue = validateTrigger(trigger).issues[0];
    if (issue) {
      return `Trigger "${trigger.pattern || 'untitled'}": ${issue.message}`;
    }
  }

  return null;
}

function removeRecordKey(record: Record<string, string>, key: string) {
  const nextRecord = { ...record };
  delete nextRecord[key];
  return nextRecord;
}

function stripMudFormatting(value: string) {
  return convertLuminariColorCodes(value).replace(ANSI_ESCAPE_PATTERN, '');
}

function isOverrideOnlyMsdpVariableKey(key: MsdpVariableKey) {
  return OVERRIDE_ONLY_MSDP_VARIABLE_KEYS.has(key);
}

function parsePositiveIntegerInput(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function loadClientConfigFromLocalStorage(): ClientConfigState {
  if (typeof window === 'undefined') {
    return DEFAULT_CLIENT_CONFIG_STATE;
  }

  try {
    const storedValue = window.localStorage.getItem(CLIENT_CONFIG_STORAGE_KEY);
    if (storedValue) {
      return parseStoredClientConfigJson(storedValue);
    }
  } catch (error) {
    console.warn('Unable to load client configuration from localStorage.', error);
  }

  if (typeof document === 'undefined') {
    return DEFAULT_CLIENT_CONFIG_STATE;
  }

  const migration = parseLegacyClientConfigFromCookieHeader(document.cookie);
  if (!migration) {
    return DEFAULT_CLIENT_CONFIG_STATE;
  }

  try {
    window.localStorage.setItem(
      CLIENT_CONFIG_STORAGE_KEY,
      serializeClientConfigPayload(migration.payload),
    );
    migration.migratedCookieNames.forEach(clearLegacyCookieGroup);
  } catch (error) {
    console.warn('Unable to migrate legacy client configuration to localStorage.', error);
  }

  for (const issue of migration.issues) {
    console.warn(issue);
  }

  return migration.payload;
}

function saveClientConfigToLocalStorage(state: ClientConfigState) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(CLIENT_CONFIG_STORAGE_KEY, serializeClientConfigPayload(state));
  } catch (error) {
    console.warn('Unable to save client configuration to localStorage.', error);
  }
}

function clearLegacyCookieGroup(name: string) {
  if (typeof document === 'undefined') {
    return;
  }

  const cookies = parseCookieMap(document.cookie);
  for (const cookieName of cookies.keys()) {
    if (
      cookieName === name ||
      cookieName === `${name}.count` ||
      cookieName.startsWith(`${name}.`)
    ) {
      expireCookie(cookieName);
    }
  }
}

function expireCookie(name: string) {
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
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

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function pluralize(count: number) {
  return count === 1 ? '' : 's';
}

function getMsdpFieldSupportNote(key: MsdpVariableKey) {
  return MSDP_FIELD_SUPPORT_NOTES[key];
}

type StatusBarProps = {
  bar: HudBarModel;
};

function StatusBar({ bar }: StatusBarProps) {
  return (
    <div className="status-bar">
      <div
        className={`bar-track bar-state-${bar.availability.kind}`}
        role="meter"
        aria-label={bar.ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(bar.percentage)}
        title={bar.ariaLabel}
      >
        <div className={`bar-fill ${bar.accentClass}`} style={{ width: `${bar.percentage}%` }} />
        <div className="bar-overlay">
          <span className="bar-label">{bar.label}</span>
          <span className="bar-counter">{bar.valueText}</span>
        </div>
      </div>
    </div>
  );
}

function CombatParticipantStatus({ participant }: { participant: CombatParticipantModel }) {
  return (
    <section
      className={`combat-status combat-status-${participant.id} combat-status-state-${participant.availability.kind}`}
      aria-label={participant.ariaLabel}
    >
      <div className="combat-status-header">
        <span className="combat-status-label">{participant.label}</span>
        <span className="combat-status-state">{participant.availability.title}</span>
      </div>
      <strong
        className="combat-status-name"
        dangerouslySetInnerHTML={{ __html: renderMudHtml(participant.nameText) }}
      />
      <div
        className={`combat-health-track bar-state-${participant.availability.kind}`}
        role="meter"
        aria-label={participant.ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(participant.percentage)}
        title={participant.ariaLabel}
      >
        <div
          className={`combat-health-fill ${participant.accentClass}`}
          style={{ width: `${participant.percentage}%` }}
        />
        <div className="combat-health-overlay">
          <span>Health</span>
          <span>{participant.valueText}</span>
        </div>
      </div>
      {participant.availability.detail ? (
        <p className="combat-status-detail">{participant.availability.detail}</p>
      ) : null}
    </section>
  );
}

function CombatInspectorPanel({ combat }: { combat: CombatDisplayModel }) {
  return (
    <div className="combat-panel" aria-label="Combat state">
      <div className="combat-status-list" aria-label="Combat participants">
        <CombatParticipantStatus participant={combat.opponent} />
        <CombatParticipantStatus participant={combat.tank} />
      </div>

      <section className="combat-inspector-section" aria-labelledby="combat-actions-heading">
        <h3 id="combat-actions-heading">Action economy</h3>
        <AvailabilityNoticeBlock notice={combat.actions.availability} compact />
        <ActionEconomyEntries actions={combat.actions} />
      </section>

      <section className="combat-inspector-section" aria-labelledby="combat-damage-heading">
        <h3 id="combat-damage-heading">Damage bonus</h3>
        <DamageBonusAvailability damageBonus={combat.damageBonus} />
      </section>
    </div>
  );
}

function DamageBonusAvailability({ damageBonus }: { damageBonus: DamageBonusCombatModel }) {
  return (
    <div
      className={`combat-damage combat-damage-${damageBonus.availability.kind}`}
      aria-label={damageBonus.ariaLabel}
    >
      <span className="combat-damage-label">{damageBonus.label}</span>
      <span
        className={`combat-damage-value availability-value-${damageBonus.availability.kind}`}
        title={damageBonus.ariaLabel}
      >
        {damageBonus.valueText}
      </span>
      <AvailabilityNoticeBlock notice={damageBonus.availability} compact />
    </div>
  );
}

function ActionEconomyEntries({ actions }: { actions: ActionEconomyModel }) {
  if (actions.entries.length === 0) {
    return null;
  }

  return (
    <div className="combat-actions" aria-label={actions.ariaLabel}>
      {actions.entries.map((entry) => (
        <ActionEconomyEntry key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function ActionEconomyEntry({ entry }: { entry: ActionEntryModel }) {
  return (
    <article
      className={`combat-action-entry combat-action-entry-${entry.kind}`}
      aria-label={entry.ariaLabel}
    >
      <span className="combat-action-label">{entry.label}</span>
      <span
        className="combat-action-value"
        dangerouslySetInnerHTML={{ __html: renderMudHtml(entry.valueText) }}
      />
      {entry.detailText ? (
        <span
          className="combat-action-detail"
          dangerouslySetInnerHTML={{ __html: renderMudHtml(entry.detailText) }}
        />
      ) : null}
    </article>
  );
}

function CharacterFieldValue({
  field,
  className,
}: {
  field: CharacterFieldModel;
  className: string;
}) {
  if (field.notice) {
    return (
      <span className={className} aria-label={field.ariaLabel}>
        <AvailabilityValue notice={field.notice} />
      </span>
    );
  }

  return (
    <span
      className={className}
      aria-label={field.ariaLabel}
      title={field.ariaLabel}
      dangerouslySetInnerHTML={{ __html: renderMudHtml(field.valueText) }}
    />
  );
}

type StatProps = {
  label: string;
  value?: string | number;
};

function Stat({ label, value }: StatProps) {
  if (typeof value === 'string') {
    return (
      <>
        <dt>{label}</dt>
        <dd dangerouslySetInnerHTML={{ __html: renderMudHtml(value || '-') }} />
      </>
    );
  }

  return (
    <>
      <dt>{label}</dt>
      <dd>{value !== undefined ? value : '-'}</dd>
    </>
  );
}

function AvailabilityStat({ label, notice }: { label: string; notice: AvailabilityNotice }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <AvailabilityValue notice={notice} />
      </dd>
    </>
  );
}

function AvailabilityNoticeBlock({
  notice,
  compact = false,
  className,
}: {
  notice: AvailabilityNotice;
  compact?: boolean;
  className?: string;
}) {
  const classNames = [
    'availability-notice',
    `availability-${notice.kind}`,
    compact ? 'availability-notice-compact' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <p className={classNames} role="note" aria-label={formatAvailabilityAriaLabel(notice)}>
      <span className="availability-title">{notice.title}</span>
      {notice.detail ? <span className="availability-detail">{notice.detail}</span> : null}
    </p>
  );
}

function AvailabilityValue({ notice }: { notice: AvailabilityNotice }) {
  return (
    <span
      className={`availability-value availability-value-${notice.kind}`}
      title={formatAvailabilityAriaLabel(notice)}
    >
      {notice.title}
    </span>
  );
}

type MapPanelProps = {
  map: MapDisplayModel;
  minimapStyle: CSSProperties;
};

const MAPPER_GRID_ROWS = [
  ['northwest', 'north', 'northeast'],
  ['west', 'current', 'east'],
  ['southwest', 'south', 'southeast'],
] as const satisfies ReadonlyArray<ReadonlyArray<MapMapperBranchPlacement | 'current'>>;
const MAPPER_GRID_PLACEMENTS = new Set<MapMapperBranchPlacement>([
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
]);

function MapPanel({ map, minimapStyle }: MapPanelProps) {
  return (
    <div className={`map-panel map-panel-${map.state}`} aria-label={map.ariaLabel}>
      <AvailabilityNoticeBlock notice={map.availability} className="map-availability" />

      {map.state === 'liveOverride' && map.minimapText ? (
        <pre
          className="minimap minimap-live-output"
          data-prevent-command-focus
          style={minimapStyle}
          dangerouslySetInnerHTML={{ __html: renderMudHtml(map.minimapText) }}
        />
      ) : null}

      {map.state === 'fallback' && map.fallback ? (
        <MapFallbackView fallback={map.fallback} />
      ) : null}

      {map.source === 'none' ? (
        <div className="map-state-output" aria-hidden="true">
          {map.availability.title}
        </div>
      ) : null}
    </div>
  );
}

function MapFallbackView({ fallback }: { fallback: MapFallbackModel }) {
  return (
    <section className="map-fallback" aria-label={fallback.ariaLabel}>
      <div className="map-fallback-heading">
        <h3 dangerouslySetInnerHTML={{ __html: renderMudHtml(fallback.headingText) }} />
        <span>Room fallback</span>
      </div>

      {fallback.mapper ? <MapMapperBoard mapper={fallback.mapper} /> : null}

      {fallback.identityFields.length > 0 ? (
        <dl className="map-field-grid" aria-label="Map room identity">
          {fallback.identityFields.map((field) => (
            <MapIdentityField key={field.id} field={field} />
          ))}
        </dl>
      ) : null}

      {fallback.exits.length > 0 ? (
        <section className="map-exit-section" aria-labelledby="map-exits-heading">
          <h4 id="map-exits-heading">Exits</h4>
          <div className="map-exit-grid" role="list" aria-label="Map exits">
            {fallback.exits.map((exit) => (
              <MapExitCard key={exit.id} exit={exit} />
            ))}
          </div>
        </section>
      ) : null}

      {fallback.rawRoomText ? (
        <p
          className="map-raw-room"
          dangerouslySetInnerHTML={{ __html: renderMudHtml(fallback.rawRoomText) }}
        />
      ) : null}
    </section>
  );
}

function MapIdentityField({ field }: { field: MapFallbackIdentityField }) {
  return (
    <div className="map-field" aria-label={field.ariaLabel}>
      <dt>{field.label}</dt>
      <dd dangerouslySetInnerHTML={{ __html: renderMudHtml(field.valueText) }} />
    </div>
  );
}

function MapExitCard({ exit }: { exit: MapFallbackExit }) {
  return (
    <article
      className={`map-exit map-exit-${exit.kind}`}
      role="listitem"
      aria-label={exit.ariaLabel}
    >
      <div className="map-exit-header">
        <span
          className="map-exit-direction"
          dangerouslySetInnerHTML={{ __html: renderMudHtml(exit.directionText) }}
        />
        {exit.statusText ? (
          <span
            className="map-exit-status"
            dangerouslySetInnerHTML={{ __html: renderMudHtml(exit.statusText) }}
          />
        ) : null}
      </div>

      {exit.destinationText ? (
        <div className="map-exit-detail">
          <span>To</span>
          <strong dangerouslySetInnerHTML={{ __html: renderMudHtml(exit.destinationText) }} />
        </div>
      ) : null}

      {exit.rawText ? (
        <p
          className="map-exit-raw"
          dangerouslySetInnerHTML={{ __html: renderMudHtml(exit.rawText) }}
        />
      ) : null}

      {exit.unknownFieldsText ? (
        <p
          className="map-exit-other"
          dangerouslySetInnerHTML={{ __html: renderMudHtml(`Other: ${exit.unknownFieldsText}`) }}
        />
      ) : null}
    </article>
  );
}

function MapMapperBoard({ mapper }: { mapper: MapMapperModel }) {
  const { placementBranches, auxiliaryBranches } = splitMapperBranches(mapper.branches);

  return (
    <section className="mapper-board" aria-label={mapper.ariaLabel}>
      <div className="mapper-grid" aria-label="Directional room map">
        {MAPPER_GRID_ROWS.flatMap((row) =>
          row.map((cell) =>
            cell === 'current' ? (
              <MapMapperCurrentRoom key={cell} currentRoom={mapper.currentRoom} />
            ) : (
              <MapMapperCell key={cell} placement={cell} branch={placementBranches.get(cell)} />
            ),
          ),
        )}
      </div>

      {auxiliaryBranches.length > 0 ? (
        <div className="mapper-auxiliary-branches" role="list" aria-label="Additional exits">
          {auxiliaryBranches.map((branch) => (
            <MapMapperBranchView key={branch.id} branch={branch} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function splitMapperBranches(branches: MapMapperBranch[]) {
  const placementBranches = new Map<MapMapperBranchPlacement, MapMapperBranch>();
  const auxiliaryBranches: MapMapperBranch[] = [];

  for (const branch of branches) {
    const canUseGridPlacement =
      MAPPER_GRID_PLACEMENTS.has(branch.placement) && !placementBranches.has(branch.placement);

    if (canUseGridPlacement) {
      placementBranches.set(branch.placement, branch);
    } else {
      auxiliaryBranches.push(branch);
    }
  }

  return { placementBranches, auxiliaryBranches };
}

function MapMapperCell({
  placement,
  branch,
}: {
  placement: MapMapperBranchPlacement;
  branch: MapMapperBranch | undefined;
}) {
  if (!branch) {
    return <div className={`mapper-cell mapper-cell-${placement} mapper-cell-empty`} />;
  }

  return (
    <div className={`mapper-cell mapper-cell-${placement}`}>
      <MapMapperBranchView branch={branch} />
    </div>
  );
}

function MapMapperCurrentRoom({ currentRoom }: { currentRoom: MapMapperCurrentRoomNode }) {
  return (
    <article className="mapper-cell mapper-current-room" aria-label={currentRoom.ariaLabel}>
      <span
        className="mapper-current-label"
        dangerouslySetInnerHTML={{ __html: renderMudHtml(currentRoom.labelText) }}
      />
      {currentRoom.detailText ? (
        <span
          className="mapper-current-detail"
          dangerouslySetInnerHTML={{ __html: renderMudHtml(currentRoom.detailText) }}
        />
      ) : null}
    </article>
  );
}

function MapMapperBranchView({ branch }: { branch: MapMapperBranch }) {
  return (
    <article
      className={`mapper-branch mapper-branch-${branch.placement}`}
      role="listitem"
      aria-label={branch.ariaLabel}
    >
      <span
        className="mapper-branch-direction"
        dangerouslySetInnerHTML={{ __html: renderMudHtml(branch.directionText) }}
      />
      {branch.destinationText ? (
        <span className="mapper-branch-destination">
          To <strong dangerouslySetInnerHTML={{ __html: renderMudHtml(branch.destinationText) }} />
        </span>
      ) : null}
      {branch.statusText ? (
        <span
          className="mapper-branch-status"
          dangerouslySetInnerHTML={{ __html: renderMudHtml(branch.statusText) }}
        />
      ) : null}
      {branch.unknownFieldsText ? (
        <span
          className="mapper-branch-other"
          dangerouslySetInnerHTML={{ __html: renderMudHtml(branch.unknownFieldsText) }}
        />
      ) : null}
    </article>
  );
}

type RoomPanelProps = {
  room: RoomDisplayModel;
};

function RoomPanel({ room }: RoomPanelProps) {
  const hasRoomContent =
    room.identityFields.length > 0 ||
    room.details.length > 0 ||
    room.exits.length > 0 ||
    Boolean(room.rawRoomText);
  const showExitsSection =
    room.state !== 'disabled' && room.state !== 'offline' && room.state !== 'error';

  return (
    <div className={`room-panel room-panel-${room.state}`} aria-label={room.ariaLabel}>
      <AvailabilityNoticeBlock notice={room.availability} compact={hasRoomContent} />

      {room.identityFields.length > 0 ? (
        <dl className="room-field-grid" aria-label="Room identity">
          {room.identityFields.map((field) => (
            <RoomIdentityField key={field.id} field={field} />
          ))}
        </dl>
      ) : null}

      {room.details.length > 0 ? (
        <section className="room-section" aria-labelledby="room-details-heading">
          <h3 id="room-details-heading">Details</h3>
          <dl className="room-detail-grid">
            {room.details.map((detail) => (
              <RoomDetail key={detail.id} detail={detail} />
            ))}
          </dl>
        </section>
      ) : null}

      {showExitsSection ? (
        <section className="room-section" aria-labelledby="room-exits-heading">
          <h3 id="room-exits-heading">Exits</h3>
          <AvailabilityNoticeBlock notice={room.exitsAvailability} compact />
          {room.exits.length > 0 ? (
            <div className="room-exit-list" role="list" aria-label="Room exits">
              {room.exits.map((exit) => (
                <RoomExitRow key={exit.id} exit={exit} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {room.rawRoomText ? (
        <section className="room-section" aria-labelledby="room-raw-heading">
          <h3 id="room-raw-heading">Raw room</h3>
          <p className="room-raw-text">{room.rawRoomText}</p>
        </section>
      ) : null}
    </div>
  );
}

function RoomIdentityField({ field }: { field: RoomIdentityFieldModel }) {
  return (
    <div className={`room-field room-field-${field.availability.kind}`}>
      <dt>{field.label}</dt>
      <dd aria-label={field.ariaLabel} title={field.ariaLabel}>
        {field.availability.kind === 'present' ? (
          <span dangerouslySetInnerHTML={{ __html: renderMudHtml(field.valueText) }} />
        ) : (
          <AvailabilityValue notice={field.availability} />
        )}
      </dd>
    </div>
  );
}

function RoomDetail({ detail }: { detail: RoomDetailModel }) {
  return (
    <div className="room-detail-line" aria-label={detail.ariaLabel}>
      <dt>{detail.label}</dt>
      <dd>{detail.valueText}</dd>
    </div>
  );
}

function RoomExitRow({ exit }: { exit: RoomExitModel }) {
  const className = [
    'room-exit',
    `room-exit-${exit.kind}`,
    exit.isDirectionMissing ? 'room-exit-missing-direction' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={className} role="listitem" aria-label={exit.ariaLabel}>
      <div className="room-exit-header">
        <span className="room-exit-direction">{exit.directionText}</span>
        {exit.statusText ? <span className="room-exit-status">{exit.statusText}</span> : null}
      </div>

      {exit.destinationText ? (
        <RoomExitDetailLine label="Destination" value={exit.destinationText} />
      ) : null}

      {exit.rawText ? <p className="room-raw-text">{exit.rawText}</p> : null}

      {exit.unknownFieldsText ? (
        <p className="room-unknown-fields">Other: {exit.unknownFieldsText}</p>
      ) : null}
    </article>
  );
}

function RoomExitDetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="room-exit-detail-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type GroupPanelProps = {
  group: GroupDisplayModel;
};

function GroupPanel({ group }: GroupPanelProps) {
  if (group.state !== 'present') {
    return <AvailabilityNoticeBlock notice={group.availability} />;
  }

  return (
    <div className="group-panel" role="list" aria-label={group.ariaLabel}>
      {group.members.map((member) => (
        <GroupMemberRow key={member.id} member={member} />
      ))}
    </div>
  );
}

function GroupMemberRow({ member }: { member: GroupMemberModel }) {
  const className = [
    'group-member',
    `group-member-${member.kind}`,
    member.isNameMissing ? 'group-member-missing-name' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={className} role="listitem" aria-label={member.ariaLabel}>
      <div className="group-member-header">
        <span className="group-member-name">{member.nameText}</span>
        {member.leaderText ? (
          <span className="group-leader-badge" aria-label={`${member.nameText} is group leader`}>
            {member.leaderText}
          </span>
        ) : null}
      </div>

      {member.statusText ? (
        <div className="group-status-line">
          <span>Status</span>
          <strong>{member.statusText}</strong>
        </div>
      ) : null}

      {member.rawText ? <p className="group-raw-text">{member.rawText}</p> : null}

      {member.resources.length > 0 ? (
        <div className="group-resources">
          {member.resources.map((resource) => (
            <GroupResource key={resource.id} resource={resource} />
          ))}
        </div>
      ) : null}

      {member.unknownFieldsText ? (
        <p className="group-unknown-fields">Other: {member.unknownFieldsText}</p>
      ) : null}
    </article>
  );
}

function GroupResource({ resource }: { resource: GroupResourceModel }) {
  return (
    <div
      className={`group-resource group-resource-${resource.id} group-resource-${resource.availability.kind}`}
      aria-label={resource.ariaLabel}
    >
      <div className="group-resource-header">
        <span>{resource.label}</span>
        <strong>{resource.valueText}</strong>
      </div>
      <div className="group-resource-track" aria-hidden="true">
        <span style={{ width: `${resource.percentage}%` }} />
      </div>
    </div>
  );
}

type AffectsPanelProps = {
  affects: AffectsDisplayModel;
};

function AffectsPanel({ affects }: AffectsPanelProps) {
  if (affects.state !== 'present' && affects.state !== 'raw') {
    return <AvailabilityNoticeBlock notice={affects.availability} />;
  }

  return (
    <div
      className={`collection-panel affects-panel collection-panel-${affects.state}`}
      role="list"
      aria-label={affects.ariaLabel}
    >
      {affects.rows.map((row) => (
        <AffectRow key={row.id} row={row} />
      ))}
    </div>
  );
}

function AffectRow({ row }: { row: AffectRowModel }) {
  const className = [
    'affect-row',
    `affect-row-${row.kind}`,
    row.isNameMissing ? 'collection-row-missing-name' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={className} role="listitem" aria-label={row.ariaLabel}>
      <div className="collection-row-header">
        <span className="collection-row-name">{row.nameText}</span>
        {row.durationText ? (
          <span
            className={`affect-duration${row.isDurationMissing ? ' affect-duration-missing' : ''}`}
          >
            {row.durationText}
          </span>
        ) : null}
      </div>

      {row.modifierText ? (
        <CollectionDetailLine label="Modifiers" value={row.modifierText} />
      ) : null}

      {row.statusText ? <CollectionDetailLine label="Status" value={row.statusText} /> : null}

      {row.rawText ? <p className="collection-raw-text">{row.rawText}</p> : null}

      {row.unknownFieldsText ? (
        <p className="collection-unknown-fields">Other: {row.unknownFieldsText}</p>
      ) : null}
    </article>
  );
}

type InventoryPanelProps = {
  inventory: InventoryDisplayModel;
};

function InventoryPanel({ inventory }: InventoryPanelProps) {
  if (inventory.state !== 'present' && inventory.state !== 'raw') {
    return <AvailabilityNoticeBlock notice={inventory.availability} />;
  }

  return (
    <div
      className={`collection-panel inventory-panel collection-panel-${inventory.state}`}
      role="list"
      aria-label={inventory.ariaLabel}
    >
      {inventory.groups.map((group) => (
        <InventoryGroup key={group.id} group={group} />
      ))}
    </div>
  );
}

function InventoryGroup({ group }: { group: InventoryGroupModel }) {
  return (
    <section className="inventory-group" role="listitem" aria-label={group.ariaLabel}>
      <h3 className="inventory-group-title">{group.label}</h3>
      <div className="inventory-group-items" role="list">
        {group.items.map((item) => (
          <InventoryItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function InventoryItem({ item }: { item: InventoryItemModel }) {
  const className = [
    'inventory-item',
    `inventory-item-${item.kind}`,
    item.isNameMissing ? 'collection-row-missing-name' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={className} role="listitem" aria-label={item.ariaLabel}>
      <div className="collection-row-header">
        <span className="collection-row-name">{item.nameText}</span>
        {item.countText ? <span className="inventory-count">x{item.countText}</span> : null}
      </div>

      {item.locationText ? (
        <CollectionDetailLine label="Location" value={item.locationText} />
      ) : null}

      {item.detailText ? <CollectionDetailLine label="Details" value={item.detailText} /> : null}

      {item.rawText ? <p className="collection-raw-text">{item.rawText}</p> : null}

      {item.unknownFieldsText ? (
        <p className="collection-unknown-fields">Other: {item.unknownFieldsText}</p>
      ) : null}
    </article>
  );
}

function CollectionDetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="collection-detail-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type QuestInfoPanelProps = {
  value: MudValue;
};

function QuestPanel({ quest }: { quest: QuestDisplayModel }) {
  return (
    <div className={`quest-panel quest-panel-${quest.state}`} aria-label={quest.ariaLabel}>
      <AvailabilityNoticeBlock notice={quest.availability} compact={quest.state === 'present'} />
      {quest.state === 'present' && quest.value !== undefined ? (
        <QuestInfoPanel value={quest.value} />
      ) : null}
    </div>
  );
}

function QuestInfoPanel({ value }: QuestInfoPanelProps) {
  const normalizedValue = normalizeQuestValue(value);
  return (
    <div className="tab-inline-output quest-html-output">{renderQuestNode(normalizedValue)}</div>
  );
}

function ProtocolInspectorPanel() {
  return (
    <div className="protocol-panel" aria-label="Protocol support status">
      <div className="protocol-summary">
        <span>Documented support boundary</span>
        <p>Static checklist status, not live negotiation telemetry.</p>
      </div>

      <div className="protocol-count-grid" aria-label="Protocol status counts">
        {PROTOCOL_FEATURE_STATUSES.map((status) => (
          <div key={status} className="protocol-count">
            <strong>{PROTOCOL_STATUS_COUNTS[status]}</strong>
            <span>{PROTOCOL_FEATURE_STATUS_LABELS[status]}</span>
          </div>
        ))}
      </div>

      {PROTOCOL_GROUPED_FEATURES.map(({ group, features }) => (
        <section
          className="protocol-section"
          key={group.id}
          aria-labelledby={`protocol-${group.id}`}
        >
          <div className="protocol-section-heading">
            <h3 id={`protocol-${group.id}`}>{group.title}</h3>
            <p>{group.summary}</p>
          </div>

          <div className="protocol-feature-list">
            {features.map((feature) => (
              <ProtocolFeatureRow key={feature.id} feature={feature} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProtocolFeatureRow({ feature }: { feature: ProtocolFeatureRecord }) {
  const statusClassName = getProtocolStatusClassName(feature.status);

  return (
    <article className={`protocol-feature protocol-feature-${statusClassName}`}>
      <div className="protocol-feature-header">
        <div>
          <h4>{feature.name}</h4>
          <p>{feature.scope}</p>
        </div>
        <span className={`protocol-status-badge protocol-status-badge-${statusClassName}`}>
          {PROTOCOL_FEATURE_STATUS_LABELS[feature.status]}
        </span>
      </div>

      <p className="protocol-feature-summary">{feature.summary}</p>
      <p className="protocol-feature-detail">{feature.detail}</p>

      <dl className="protocol-feature-meta">
        <div>
          <dt>Next</dt>
          <dd>{feature.nextAction}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            <ul className="protocol-evidence-list">
              {feature.evidence.map((evidence) => (
                <li key={`${feature.id}-${evidence.kind}-${evidence.path}`}>
                  <span>{formatProtocolEvidenceKind(evidence.kind)}</span>
                  <a
                    href={getRepositoryEvidenceHref(evidence.path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {evidence.label}
                  </a>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {feature.followUpTags.length > 0 ? (
          <div>
            <dt>Phase 04</dt>
            <dd>
              <ul className="protocol-follow-up-list">
                {feature.followUpTags.map((tag) => (
                  <li key={`${feature.id}-${tag}`}>{PROTOCOL_FOLLOW_UP_LABELS[tag]}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function formatMudValueAsText(value: MudValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return formatNumber(value) ?? String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => formatMudValueAsText(item))
      .filter(Boolean)
      .join(', ');
  }

  const entries = Object.entries(value)
    .map(([key, val]) => {
      const formattedValue = formatMudValueAsText(val);
      return formattedValue ? `${formatMudLabel(key)}: ${formattedValue}` : null;
    })
    .filter(Boolean);

  return entries.join(' | ');
}

function renderQuestNode(value: MudValue): ReactNode {
  if (value === null || value === undefined) {
    return <span className="quest-empty">No quest data reported yet.</span>;
  }

  const compactQuests = parseQuestEntries(value);
  if (compactQuests.length > 0) {
    return (
      <div className="quest-compact-list">
        {compactQuests.map((quest, index) => (
          <div className="quest-compact-item" key={`${quest.name ?? 'quest'}-${index}`}>
            {quest.name ? (
              <div dangerouslySetInnerHTML={{ __html: renderMudHtml(quest.name) }} />
            ) : null}
            {quest.type ? (
              <div dangerouslySetInnerHTML={{ __html: renderMudHtml(quest.type) }} />
            ) : null}
            {quest.vnum ? <div>{quest.vnum}</div> : null}
            {quest.progress ? <div>{quest.progress}</div> : null}
            {quest.targets ? (
              <div dangerouslySetInnerHTML={{ __html: renderMudHtml(quest.targets) }} />
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'string') {
    return <span dangerouslySetInnerHTML={{ __html: renderMudHtml(value) }} />;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{formatMudValueAsText(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="quest-empty">No entries.</span>;
    }

    return (
      <ul className="quest-list">
        {value.map((item, index) => (
          <li key={index}>{renderQuestNode(item)}</li>
        ))}
      </ul>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <span className="quest-empty">No fields.</span>;
  }

  return (
    <div className="quest-object">
      {entries.map(([key, entryValue]) => {
        const label = formatMudLabel(key);
        const isScalar =
          entryValue === null ||
          entryValue === undefined ||
          typeof entryValue === 'string' ||
          typeof entryValue === 'number' ||
          typeof entryValue === 'boolean';

        if (isScalar) {
          return (
            <div key={key} className="quest-row">
              <span className="quest-key">{label}</span>
              <span className="quest-value">{renderQuestNode(entryValue)}</span>
            </div>
          );
        }

        return (
          <div key={key} className="quest-block">
            <div className="quest-block-title">{label}</div>
            <div>{renderQuestNode(entryValue)}</div>
          </div>
        );
      })}
    </div>
  );
}

type QuestEntry = {
  name?: string;
  type?: string;
  vnum?: string;
  progress?: string;
  targets?: string;
};

function parseQuestEntries(value: MudValue): QuestEntry[] {
  const source = Array.isArray(value) ? value : isMudRecord(value) ? [value] : [];

  return source.flatMap((entry) => {
    if (!isMudRecord(entry)) {
      return [];
    }

    const name = asOptionalText(readAnyKey(entry, ['name', 'NAME']));
    const type = asOptionalText(readAnyKey(entry, ['type', 'TYPE']));

    const rawVnum = readAnyKey(entry, ['vnum', 'VNUM']);
    const vnum =
      rawVnum === undefined || rawVnum === null
        ? undefined
        : typeof rawVnum === 'number'
          ? String(Math.trunc(rawVnum))
          : String(rawVnum).replace(/,/g, '');

    const progress = formatQuestProgress(readAnyKey(entry, ['progress', 'PROGRESS']));
    const targets = formatQuestTargets(readAnyKey(entry, ['targets', 'TARGETS']));

    if (!name && !type && !vnum && !progress && !targets) {
      return [];
    }

    return [
      {
        name,
        type,
        vnum,
        progress,
        targets,
      },
    ];
  });
}

function formatQuestProgress(value: MudValue | undefined): string | undefined {
  if (!isMudRecord(value)) {
    return undefined;
  }

  const completed = asOptionalText(readAnyKey(value, ['completed', 'COMPLETED']));
  const required = asOptionalText(readAnyKey(value, ['required', 'REQUIRED']));
  if (!completed || !required) {
    return undefined;
  }

  return `${completed}/${required}`;
}

function formatQuestTargets(value: MudValue | undefined): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const names = value
    .map((target) => {
      if (isMudRecord(target)) {
        return asOptionalText(readAnyKey(target, ['name', 'NAME']));
      }

      return asOptionalText(target);
    })
    .filter((entry): entry is string => Boolean(entry));

  if (names.length === 0) {
    return undefined;
  }

  return names.join(', ');
}

function normalizeQuestValue(value: MudValue): MudValue {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  const looksLikeJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));

  if (!looksLikeJson) {
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

function isMudValue(value: unknown): value is MudValue {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isMudValue(item));
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((entry) => isMudValue(entry));
  }

  return false;
}

function isMudRecord(value: unknown): value is Record<string, MudValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAnyKey(record: Record<string, MudValue>, keys: string[]): MudValue | undefined {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function asOptionalText(value: MudValue | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const formatted = formatMudValueAsText(value);
  return formatted || undefined;
}

function formatMudLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getWebSocketUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function getSettingsUrl() {
  return '/api/settings';
}

function areTerminalDimensionsEqual(left: TerminalDimensions, right: TerminalDimensions | null) {
  return Boolean(right && left.columns === right.columns && left.rows === right.rows);
}

function measureTerminalDimensions(element: HTMLElement): TerminalDimensions {
  const contentBox = getTerminalContentBox(element);
  if (contentBox.width <= 0 || contentBox.height <= 0) {
    return DEFAULT_TERMINAL_DIMENSIONS;
  }

  const cellSize = measureTerminalCell(contentBox.styles, element.ownerDocument);
  if (cellSize.width <= 0 || cellSize.height <= 0) {
    return DEFAULT_TERMINAL_DIMENSIONS;
  }

  return normalizeTerminalDimensions({
    columns: contentBox.width / cellSize.width,
    rows: contentBox.height / cellSize.height,
  });
}

function measureTerminalCell(styles: CSSStyleDeclaration, documentRef: Document) {
  const fallback = getFallbackTerminalCellSize(styles);
  const sample = documentRef.createElement('span');
  sample.textContent = TERMINAL_CELL_MEASUREMENT_SAMPLE;
  sample.style.position = 'absolute';
  sample.style.visibility = 'hidden';
  sample.style.pointerEvents = 'none';
  sample.style.whiteSpace = 'pre';
  sample.style.fontFamily = styles.fontFamily;
  sample.style.fontSize = styles.fontSize;
  sample.style.fontStyle = styles.fontStyle;
  sample.style.fontWeight = styles.fontWeight;
  sample.style.letterSpacing = styles.letterSpacing;
  sample.style.lineHeight = styles.lineHeight;

  if (!documentRef.body) {
    return fallback;
  }

  documentRef.body.append(sample);
  try {
    const sampleBounds = sample.getBoundingClientRect();
    const measuredWidth = sampleBounds.width / TERMINAL_CELL_MEASUREMENT_SAMPLE.length;
    const measuredHeight = getTerminalLineHeight(styles, sampleBounds.height);

    return {
      height: measuredHeight > 0 ? measuredHeight : fallback.height,
      width: measuredWidth > 0 ? measuredWidth : fallback.width,
    };
  } finally {
    sample.remove();
  }
}

function getFallbackTerminalCellSize(styles: CSSStyleDeclaration) {
  const fontSize = getCssPixelValue(styles.fontSize) || DEFAULT_CLIENT_SETTINGS.terminal.fontSize;

  return {
    height: getTerminalLineHeight(styles, fontSize * DEFAULT_CLIENT_SETTINGS.terminal.lineHeight),
    width: fontSize * 0.6,
  };
}

function getTerminalLineHeight(styles: CSSStyleDeclaration, fallback: number) {
  const lineHeight = getCssPixelValue(styles.lineHeight);
  if (lineHeight > 0) {
    return lineHeight;
  }

  const fontSize = getCssPixelValue(styles.fontSize);
  if (fontSize > 0) {
    return fontSize * DEFAULT_CLIENT_SETTINGS.terminal.lineHeight;
  }

  return fallback;
}

function normalizeTerminalDimensions(dimensions: TerminalDimensions): TerminalDimensions {
  return {
    columns: normalizeTerminalDimension(
      dimensions.columns,
      terminalDimensionBounds.columns.min,
      terminalDimensionBounds.columns.max,
      DEFAULT_TERMINAL_DIMENSIONS.columns,
    ),
    rows: normalizeTerminalDimension(
      dimensions.rows,
      terminalDimensionBounds.rows.min,
      terminalDimensionBounds.rows.max,
      DEFAULT_TERMINAL_DIMENSIONS.rows,
    ),
  };
}

function normalizeTerminalDimension(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function getTerminalContentBox(element: HTMLElement) {
  const styles = window.getComputedStyle(element);
  const width =
    element.clientWidth -
    getCssPixelValue(styles.paddingLeft) -
    getCssPixelValue(styles.paddingRight);
  const height =
    element.clientHeight -
    getCssPixelValue(styles.paddingTop) -
    getCssPixelValue(styles.paddingBottom);

  return {
    height: Math.max(0, height),
    styles,
    width: Math.max(0, width),
  };
}

function getCssPixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      return null;
    }

    return parsed as ServerMessage;
  } catch {
    return null;
  }
}

function formatNumber(value: number | undefined) {
  return value === undefined ? undefined : new Intl.NumberFormat().format(value);
}

function findMatchingMudPresetId(
  mudPresets: AppSettings['connection']['muds'],
  host: string,
  port: number,
) {
  return mudPresets.find(
    (mud) => mud.host.toLowerCase() === host.trim().toLowerCase() && mud.port === port,
  )?.id;
}

function shouldPreservePointerFocus(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, label, a, summary, [data-prevent-command-focus], [contenteditable="true"]',
    ),
  );
}

function loadClientLayoutPreferencesFromLocalStorage(): ClientLayoutPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_CLIENT_LAYOUT_PREFERENCES;
  }

  try {
    return parseClientLayoutPreferencesJson(
      window.localStorage.getItem(CLIENT_LAYOUT_PREFERENCES_STORAGE_KEY),
    );
  } catch (error) {
    console.warn('Unable to load layout preferences from localStorage.', error);
    return DEFAULT_CLIENT_LAYOUT_PREFERENCES;
  }
}

function saveClientLayoutPreferencesToLocalStorage(preferences: ClientLayoutPreferences) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      CLIENT_LAYOUT_PREFERENCES_STORAGE_KEY,
      serializeClientLayoutPreferences(preferences),
    );
  } catch (error) {
    console.warn('Unable to save layout preferences to localStorage.', error);
  }
}

function getKeyboardInspectorTabId(
  currentTabId: InspectorTabId,
  key: string,
): InspectorTabId | undefined {
  const currentIndex = INSPECTOR_TAB_IDS.indexOf(currentTabId);
  if (currentIndex < 0) {
    return DEFAULT_CLIENT_LAYOUT_PREFERENCES.activeInspectorTab;
  }

  if (key === 'Home') {
    return INSPECTOR_TAB_IDS[0];
  }

  if (key === 'End') {
    return INSPECTOR_TAB_IDS[INSPECTOR_TAB_IDS.length - 1];
  }

  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return INSPECTOR_TAB_IDS[(currentIndex + 1) % INSPECTOR_TAB_IDS.length];
  }

  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return INSPECTOR_TAB_IDS[
      (currentIndex - 1 + INSPECTOR_TAB_IDS.length) % INSPECTOR_TAB_IDS.length
    ];
  }

  return undefined;
}

function getProtocolStatusClassName(status: ProtocolFeatureStatus): string {
  switch (status) {
    case 'supported':
      return 'supported';
    case 'partial':
      return 'partial';
    case 'rejected':
      return 'rejected';
    case 'deferred':
      return 'deferred';
    case 'validation-gap':
      return 'validation-gap';
    default:
      return assertNever(status);
  }
}

function formatProtocolEvidenceKind(kind: ProtocolEvidenceKind): string {
  switch (kind) {
    case 'source':
      return 'Source';
    case 'code':
      return 'Code';
    case 'test':
      return 'Test';
    case 'doc':
      return 'Doc';
    case 'spec':
      return 'Spec';
    case 'gap':
      return 'Gap';
    default:
      return assertNever(kind);
  }
}

function getRepositoryEvidenceHref(path: string) {
  const normalizedPath = path.replace(/^\.\//, '');
  return `${REPOSITORY_BLOB_BASE_URL}${normalizedPath}`;
}

function hasExpandedSelection() {
  if (typeof window === 'undefined') {
    return false;
  }

  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

function focusCommandInput(input: HTMLInputElement | null) {
  requestAnimationFrame(() => {
    input?.focus({ preventScroll: true });
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled inspector tab: ${String(value)}`);
}

export default App;
