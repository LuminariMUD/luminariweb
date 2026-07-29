/**
 * Luminari structured onboarding contract.
 *
 * The MUD stays authoritative for every option, restriction, validation, and
 * save. This module only describes the browser-facing shape of that authority
 * and validates it at the proxy boundary, so a malformed, hostile, or
 * version-skewed payload degrades to the classic terminal instead of driving
 * the interface.
 *
 * Nothing here may carry a password, password hash, or other secret.
 */

import { editorTransferLimits, expectedChunkCount } from './onboarding-transfer.ts';

/**
 * The version an old source enables by advertising nothing else, and the
 * baseline this client must always keep working. See ADR 0004.
 */
export const ONBOARDING_PROTOCOL_VERSION = 1;

/** The highest version this build can speak. */
export const ONBOARDING_PROTOCOL_VERSION_MAX = 2;

/**
 * Versions this client accepts, highest first. Advertised to the MUD so a new
 * source can pick the best mutually supported version; an old source ignores
 * the list entirely and v1 negotiation still works.
 */
export const ONBOARDING_SUPPORTED_VERSIONS: readonly number[] = [2, 1];

/**
 * The MSDP variable the MUD uses to publish onboarding state. It is reserved:
 * players must not be able to remap it from the MSDP settings screen.
 */
export const ONBOARDING_MSDP_VARIABLE = 'LUMINARI_ONBOARDING';

/** MSDP variable the client reports so the MUD knows the structured UI exists. */
export const ONBOARDING_CAPABILITY_VARIABLE = 'LUMINARI_ONBOARDING_VERSION';

/**
 * MSDP variable carrying the full supported-version list. Sent after the v1
 * variable so an old source has already been satisfied by the time it appears.
 */
export const ONBOARDING_VERSIONS_CAPABILITY_VARIABLE = 'LUMINARI_ONBOARDING_VERSIONS';

/**
 * Reserved MSDP variable for v2 structured actions (editor transfer). Small
 * menu actions keep using the legacy input line; profile text must never be
 * encoded as terminal commands.
 */
export const ONBOARDING_ACTION_MSDP_VARIABLE = 'LUMINARI_ONBOARDING_ACTION';

/**
 * Reserved MSDP variable for source-to-browser editor downloads. State
 * metadata arrives first; the gateway verifies this side channel in full
 * before forwarding any content to the browser.
 */
export const ONBOARDING_CONTENT_MSDP_VARIABLE = 'LUMINARI_ONBOARDING_CONTENT';

/** Hard bounds. Anything outside these is rejected, never truncated silently. */
export const onboardingLimits = {
  maxPayloadBytes: 16 * 1024,
  maxChoices: 64,
  maxCharacters: 100,
  maxActions: 16,
  maxShortText: 120,
  maxMediumText: 512,
  maxLongText: 2048,
  maxFieldCount: 32,
  maxRevision: 1_000_000,
  /** v2 hub summary. The hub carries completion metadata, never full text. */
  maxProfileItems: 24,
  /** v2 server-generated suggestions shown on an "ideas" screen. */
  maxExamples: 12,
  maxExampleBytes: 2048,
  /** v2 bounded selected-choice detail. */
  maxDetailFacts: 24,
  maxDetailBytes: 4096,
} as const;

/**
 * Session phase is deliberately separate from the TCP/WebSocket connection
 * status. `connected` only ever means the proxy opened a socket.
 */
export type SessionPhase =
  | 'offline'
  | 'negotiating'
  | 'account'
  | 'character'
  | 'creating'
  | 'playing';

export const sessionPhases: readonly SessionPhase[] = [
  'offline',
  'negotiating',
  'account',
  'character',
  'creating',
  'playing',
];

export type OnboardingMode =
  | 'account'
  | 'character-creation'
  | 'character-menu'
  | 'roleplay-profile'
  | 'play';

export const onboardingModes: readonly OnboardingMode[] = [
  'account',
  'character-creation',
  'character-menu',
  'roleplay-profile',
  'play',
];

/** Every screen the structured flow can render. Unknown screens fall back. */
export type OnboardingScreen =
  | 'account-name'
  | 'account-name-confirm'
  | 'account-password'
  | 'account-new-password'
  | 'account-confirm-password'
  | 'account-menu'
  | 'account-link'
  | 'account-link-password'
  | 'name'
  | 'name-confirm'
  | 'sex'
  | 'race'
  | 'race-detail'
  | 'class'
  | 'class-detail'
  | 'build'
  | 'alignment'
  | 'preferences'
  | 'roleplay-decision'
  | 'motd'
  | 'character-menu'
  | 'handoff'
  // --- protocol v2: role-play identity suite -------------------------------
  | 'roleplay-hub'
  | 'short-desc-intro'
  | 'short-desc-feature-1'
  | 'short-desc-adjective-1'
  | 'short-desc-preview'
  | 'short-desc-review'
  | 'short-desc-feature-2'
  | 'short-desc-adjective-2'
  | 'long-description'
  | 'background-story'
  | 'background-catalog'
  | 'background-confirm'
  | 'goals-ideas'
  | 'goals-editor'
  | 'personality-ideas'
  | 'personality-editor'
  | 'ideals-ideas'
  | 'ideals-editor'
  | 'bonds-ideas'
  | 'bonds-editor'
  | 'flaws-ideas'
  | 'flaws-editor'
  | 'age-select'
  | 'region-catalog'
  | 'region-confirm'
  | 'faction-select'
  | 'hometown-select'
  | 'deity-select'
  | 'deity-confirm';

/** Screens introduced by protocol v2. A v1 state may never use these. */
export const roleplayScreens: readonly OnboardingScreen[] = [
  'roleplay-hub',
  'short-desc-intro',
  'short-desc-feature-1',
  'short-desc-adjective-1',
  'short-desc-preview',
  'short-desc-review',
  'short-desc-feature-2',
  'short-desc-adjective-2',
  'long-description',
  'background-story',
  'background-catalog',
  'background-confirm',
  'goals-ideas',
  'goals-editor',
  'personality-ideas',
  'personality-editor',
  'ideals-ideas',
  'ideals-editor',
  'bonds-ideas',
  'bonds-editor',
  'flaws-ideas',
  'flaws-editor',
  'age-select',
  'region-catalog',
  'region-confirm',
  'faction-select',
  'hometown-select',
  'deity-select',
  'deity-confirm',
];

/** Screens that host a structured multiline editor and its chunked transfer. */
export const roleplayEditorScreens: readonly OnboardingScreen[] = [
  'long-description',
  'background-story',
  'goals-editor',
  'personality-editor',
  'ideals-editor',
  'bonds-editor',
  'flaws-editor',
];

export const onboardingScreens: readonly OnboardingScreen[] = [
  'account-name',
  'account-name-confirm',
  'account-password',
  'account-new-password',
  'account-confirm-password',
  'account-menu',
  'account-link',
  'account-link-password',
  'name',
  'name-confirm',
  'sex',
  'race',
  'race-detail',
  'class',
  'class-detail',
  'build',
  'alignment',
  'preferences',
  'roleplay-decision',
  'motd',
  'character-menu',
  'handoff',
  ...roleplayScreens,
];

/** How the screen expects the player to answer. */
export type OnboardingInputKind =
  | 'none'
  | 'text'
  | 'password'
  | 'choice'
  | 'confirm'
  /** v2: a bounded multiline editor backed by chunked transfer, not a line. */
  | 'multiline';

export const onboardingInputKinds: readonly OnboardingInputKind[] = [
  'none',
  'text',
  'password',
  'choice',
  'confirm',
  'multiline',
];

/**
 * Where the character stands relative to the MUD's save boundary. The UI must
 * never show a completion animation before the server reports `saved`.
 */
export type OnboardingPersistence = 'none' | 'draft' | 'pending' | 'saved' | 'failed';

export const onboardingPersistenceStates: readonly OnboardingPersistence[] = [
  'none',
  'draft',
  'pending',
  'saved',
  'failed',
];

/** Actions the server says are legal on this screen. */
export type OnboardingActionName =
  | 'select'
  | 'submit'
  | 'confirm'
  | 'reselect'
  | 'detail'
  | 'cancel'
  | 'quit'
  | 'create-character'
  | 'link-character'
  | 'classic-terminal'
  // --- protocol v2 ---------------------------------------------------------
  /** Advance a preview/intro screen that takes no choice. */
  | 'continue'
  /** Open a hub item. */
  | 'open'
  /** Commit the editor content assembled by a chunked transfer. */
  | 'save-text'
  /** Abandon an editor without mutating the character. */
  | 'cancel-editor'
  /** Ask the source for a fresh set of generated suggestions. */
  | 'generate-example'
  | 'next-page'
  | 'previous-page';

export const onboardingActionNames: readonly OnboardingActionName[] = [
  'select',
  'submit',
  'confirm',
  'reselect',
  'detail',
  'cancel',
  'quit',
  'create-character',
  'link-character',
  'classic-terminal',
  'continue',
  'open',
  'save-text',
  'cancel-editor',
  'generate-example',
  'next-page',
  'previous-page',
];

/**
 * Actions that only exist in protocol v2. Accepting one of these from a v1
 * state would mean the browser invented an affordance the source never offered.
 */
export const roleplayActionNames: readonly OnboardingActionName[] = [
  'continue',
  'open',
  'save-text',
  'cancel-editor',
  'generate-example',
  'next-page',
  'previous-page',
];

/**
 * Actions that travel on the reserved v2 MSDP action variable rather than
 * resolving to a legacy input line. Everything else keeps the v1 line path.
 */
export const structuredTransportActions: readonly OnboardingActionName[] = [
  'save-text',
  'cancel-editor',
];

/**
 * Protocol-v1's selected-character menu predates wire-valued choices. These
 * stable browser IDs let the proxy expose the two safe navigation paths while
 * still validating that the MUD is on the exact character-menu screen.
 */
export const characterMenuChoiceIds = {
  enterGame: 'character-menu/enter-game',
  accountMenu: 'character-menu/account-menu',
  roleplayProfile: 'character-menu/roleplay-profile',
} as const;

const characterMenuWireValues = new Map<string, string>([
  [characterMenuChoiceIds.enterGame, '1'],
  [characterMenuChoiceIds.accountMenu, '0'],
  [characterMenuChoiceIds.roleplayProfile, '2'],
]);

/** A mechanical fact rendered beside a choice (hit die, size, save bonus). */
export interface OnboardingFact {
  label: string;
  value: string;
  glyph?: string;
}

export interface OnboardingChoice {
  /** Stable server ID, independent of display text. */
  id: string;
  label: string;
  /** Exact text the proxy sends on the existing line-input path. */
  wireValue: string;
  enabled: boolean;
  /** Stable media key such as `race/human`; never derived from the label. */
  mediaKey?: string;
  summary?: string;
  description?: string;
  /** Present only when the server chose to reveal a locked option. */
  lockReason?: string;
  unlockCost?: string;
  facts?: OnboardingFact[];
  badges?: string[];
}

export interface OnboardingCharacterSummary {
  id: string;
  name: string;
  wireValue: string;
  level?: number;
  race?: string;
  raceMediaKey?: string;
  classSummary?: string;
  classMediaKeys?: string[];
  status?: string;
  incomplete?: boolean;
}

export interface OnboardingSelection {
  name?: string;
  sex?: string;
  race?: string;
  raceMediaKey?: string;
  className?: string;
  classMediaKey?: string;
  build?: string;
  alignment?: string;
}

export interface OnboardingError {
  code: string;
  message: string;
  field?: string;
}

// ---------------------------------------------------------------------------
// Protocol v2: role-play identity suite
// ---------------------------------------------------------------------------

/**
 * Server-authored state of one profile hub item. The browser renders these; it
 * never derives availability, mutability, or the reason an item is closed.
 */
export type OnboardingItemStatus =
  /** Never set, and settable now. */
  | 'unset'
  /** Set, with a safe summary label. */
  | 'configured'
  /** Must be completed before the character can proceed. */
  | 'required'
  /** Set once and no longer changeable. */
  | 'locked'
  /** Not offered to this character at all (race, campaign, or ruleset). */
  | 'unavailable'
  /** The source could not build this item; it stays visible but inert. */
  | 'error';

export const onboardingItemStatuses: readonly OnboardingItemStatus[] = [
  'unset',
  'configured',
  'required',
  'locked',
  'unavailable',
  'error',
];

export interface OnboardingProfileItem {
  /** Stable server ID, e.g. `profile/long-description`. */
  id: string;
  label: string;
  /** Exact value the proxy sends to open this item on the legacy line path. */
  wireValue: string;
  status: OnboardingItemStatus;
  /** Whether the source will accept a change right now. */
  mutable: boolean;
  /** Whether the character is blocked until this item is set. */
  required: boolean;
  /**
   * Short safe label of the current value (a background name, an age band).
   * Never the body of a private text field.
   */
  summary?: string;
  /** Server-authored explanation for a locked/unavailable/error status. */
  reason?: string;
  mediaKey?: string;
}

/** Source-owned catalog pagination. The browser never filters or truncates. */
export interface OnboardingPage {
  index: number;
  count: number;
  totalItems?: number;
}

/** Bounded detail for the currently previewed catalog entry. */
export interface OnboardingDetail {
  id: string;
  label: string;
  mediaKey?: string;
  summary?: string;
  description?: string;
  facts?: OnboardingFact[];
  /** Server-authored warning shown before an irreversible confirmation. */
  irreversibleWarning?: string;
}

/** One server-generated suggestion on an "ideas" screen. */
export interface OnboardingExample {
  id: string;
  text: string;
}

/**
 * Metadata for a multiline field. Content itself never rides in the state
 * document; it arrives through the chunked editor transfer keyed by
 * `transferId`, and the browser must not render an editable field until the
 * whole transfer has been verified.
 */
export interface OnboardingEditorMeta {
  /** Stable field ID, e.g. `background-story`. */
  fieldId: string;
  /** The source's byte limit for this field. Authoritative. */
  maxBytes: number;
  /** Bumps whenever the stored content changes; guards blind overwrites. */
  contentRevision: number;
  /** Present when the source is sending existing content down. */
  transferId?: string;
  totalBytes?: number;
  chunkCount?: number;
  /** Lowercase hex SHA-256 of the raw content. */
  digest?: string;
  /** True when the field is currently empty and no transfer will arrive. */
  empty?: boolean;
}

/**
 * Outcome of the last mutation. `accepted` means in memory only; the UI must
 * not claim success until `saved`, which requires a checked source save.
 */
export type OnboardingPersistenceResult = 'accepted' | 'saved' | 'failed';

export const onboardingPersistenceResults: readonly OnboardingPersistenceResult[] = [
  'accepted',
  'saved',
  'failed',
];

export interface OnboardingState {
  version: number;
  /** Connection-local flow identifier; changes on reconnect or account switch. */
  flowId: string;
  /** Increases on every server state change; stale actions are rejected. */
  revision: number;
  mode: OnboardingMode;
  screen: OnboardingScreen;
  title: string;
  prompt: string;
  help?: string;
  sensitiveInput: boolean;
  inputKind: OnboardingInputKind;
  inputLabel?: string;
  persistence: OnboardingPersistence;
  choices: OnboardingChoice[];
  characters: OnboardingCharacterSummary[];
  selection: OnboardingSelection;
  actions: OnboardingActionName[];
  mediaKey?: string;
  sceneKey?: string;
  error?: OnboardingError;

  // --- protocol v2 (absent on every v1 state) ------------------------------
  /** Hub item summaries. Present on `roleplay-hub`. */
  profile?: OnboardingProfileItem[];
  /** Source-owned catalog pagination. */
  page?: OnboardingPage;
  /** Bounded detail for the previewed catalog entry. */
  detail?: OnboardingDetail;
  /** Server-generated suggestions on an "ideas" screen. */
  examples?: OnboardingExample[];
  /** Multiline field metadata. Content arrives by chunked transfer. */
  editor?: OnboardingEditorMeta;
  /** Outcome of the last mutation, distinct from the coarse `persistence`. */
  persistenceResult?: OnboardingPersistenceResult;
  /**
   * Exact wire values for control actions that carry no choice of their own
   * (`continue`, `generate-example`, pagination, and screen-specific `cancel`
   * or `quit`). Keeping these server-authored means the browser never invents a
   * keystroke for a screen whose terminal prompt it cannot see.
   */
  controlWire?: Partial<Record<OnboardingActionName, string>>;
  /**
   * True when the source will not accept a cancel here — notably the forced
   * short-description gate. The browser must not synthesize an escape.
   */
  blocking?: boolean;
}

/** Browser -> proxy. Validated against the proxy's latest known state. */
export interface OnboardingActionMessage {
  type: 'onboarding-action';
  flowId: string;
  revision: number;
  action: OnboardingActionName;
  choiceId?: string;
  /** Free text for `submit` screens. Never logged. */
  value?: string;
}

/** Reasons the structured experience hands back to the classic terminal. */
export type OnboardingFallbackReason =
  | 'unsupported-server'
  | 'version-skew'
  | 'malformed-payload'
  | 'payload-too-large'
  | 'player-requested'
  | 'disconnected';

export interface OnboardingStateMessage {
  type: 'onboarding-state';
  state: OnboardingState;
  phase: SessionPhase;
}

export interface OnboardingFallbackMessage {
  type: 'onboarding-fallback';
  reason: OnboardingFallbackReason;
  detail: string;
}

export interface SensitiveInputMessage {
  type: 'sensitive-input';
  sensitive: boolean;
}

export const defaultOnboardingSelection: OnboardingSelection = {};

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  // Control characters would let a payload forge layout or terminal output.
  // eslint-disable-next-line no-control-regex -- stripping control bytes is the point
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (cleaned.length > maxLength) {
    return null;
  }
  return cleaned;
}

function readOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = readString(value, maxLength);
  return parsed ? parsed : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }
  if (value === 'false' || value === '0' || value === 0) {
    return false;
  }
  return fallback;
}

function readInteger(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase() as T;
  return allowed.includes(normalized) ? normalized : null;
}

function readArray(value: unknown, maxLength: number): unknown[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    // MSDP tables collapse a single-element array into a bare value.
    return [value];
  }
  if (value.length > maxLength) {
    return null;
  }
  return value;
}

function parseFacts(value: unknown): OnboardingFact[] {
  const raw = readArray(value, onboardingLimits.maxFieldCount);
  if (!raw) {
    return [];
  }
  const facts: OnboardingFact[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const label = readString(item.label, onboardingLimits.maxShortText);
    const factValue = readString(item.value, onboardingLimits.maxShortText);
    if (!label || !factValue) {
      continue;
    }
    facts.push({
      label,
      value: factValue,
      glyph: readOptionalString(item.glyph, onboardingLimits.maxShortText),
    });
  }
  return facts;
}

function parseChoice(value: unknown): OnboardingChoice | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id, onboardingLimits.maxShortText);
  const label = readString(value.label, onboardingLimits.maxShortText);
  if (!id || !label) {
    return null;
  }
  const wireValue = readString(value.wireValue ?? value.wire ?? id, onboardingLimits.maxShortText);
  if (!wireValue) {
    return null;
  }

  const badgesRaw = readArray(value.badges, onboardingLimits.maxFieldCount) ?? [];
  const badges = badgesRaw
    .map((badge) => readString(badge, onboardingLimits.maxShortText))
    .filter((badge): badge is string => Boolean(badge));

  return {
    id,
    label,
    wireValue,
    enabled: readBoolean(value.enabled, true),
    mediaKey: readOptionalString(value.mediaKey, onboardingLimits.maxShortText),
    summary: readOptionalString(value.summary, onboardingLimits.maxMediumText),
    description: readOptionalString(value.description, onboardingLimits.maxLongText),
    lockReason: readOptionalString(value.lockReason, onboardingLimits.maxMediumText),
    unlockCost: readOptionalString(value.unlockCost, onboardingLimits.maxShortText),
    facts: parseFacts(value.facts),
    badges: badges.length ? badges : undefined,
  };
}

function parseCharacter(value: unknown): OnboardingCharacterSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id, onboardingLimits.maxShortText);
  const name = readString(value.name, onboardingLimits.maxShortText);
  if (!id || !name) {
    return null;
  }
  const wireValue = readString(value.wireValue ?? id, onboardingLimits.maxShortText);
  if (!wireValue) {
    return null;
  }

  const classMediaRaw = readArray(value.classMediaKeys, onboardingLimits.maxFieldCount) ?? [];
  const classMediaKeys = classMediaRaw
    .map((key) => readString(key, onboardingLimits.maxShortText))
    .filter((key): key is string => Boolean(key));

  const level = readInteger(value.level, 0, 100);

  return {
    id,
    name,
    wireValue,
    level: level === null ? undefined : level,
    race: readOptionalString(value.race, onboardingLimits.maxShortText),
    raceMediaKey: readOptionalString(value.raceMediaKey, onboardingLimits.maxShortText),
    classSummary: readOptionalString(value.classSummary, onboardingLimits.maxMediumText),
    classMediaKeys: classMediaKeys.length ? classMediaKeys : undefined,
    status: readOptionalString(value.status, onboardingLimits.maxShortText),
    incomplete: readBoolean(value.incomplete, false),
  };
}

function parseSelection(value: unknown): OnboardingSelection {
  if (!isRecord(value)) {
    return {};
  }
  return {
    name: readOptionalString(value.name, onboardingLimits.maxShortText),
    sex: readOptionalString(value.sex, onboardingLimits.maxShortText),
    race: readOptionalString(value.race, onboardingLimits.maxShortText),
    raceMediaKey: readOptionalString(value.raceMediaKey, onboardingLimits.maxShortText),
    className: readOptionalString(value.className, onboardingLimits.maxShortText),
    classMediaKey: readOptionalString(value.classMediaKey, onboardingLimits.maxShortText),
    build: readOptionalString(value.build, onboardingLimits.maxShortText),
    alignment: readOptionalString(value.alignment, onboardingLimits.maxShortText),
  };
}

function parseError(value: unknown): OnboardingError | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const message = readString(value.message, onboardingLimits.maxMediumText);
  if (!message) {
    return undefined;
  }
  return {
    code: readString(value.code, onboardingLimits.maxShortText) ?? 'unknown',
    message,
    field: readOptionalString(value.field, onboardingLimits.maxShortText),
  };
}

// ---------------------------------------------------------------------------
// Protocol v2 parsing
// ---------------------------------------------------------------------------

function parseProfileItem(value: unknown): OnboardingProfileItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id, onboardingLimits.maxShortText);
  const label = readString(value.label, onboardingLimits.maxShortText);
  const status = readEnum(value.status, onboardingItemStatuses);
  if (!id || !label || !status) {
    return null;
  }
  const wireValue = readString(value.wireValue ?? value.wire ?? '', onboardingLimits.maxShortText);
  if (!wireValue) {
    return null;
  }
  return {
    id,
    label,
    wireValue,
    status,
    // Fail closed: an item is immutable unless the source says otherwise, and a
    // status the source already closed can never be reported as mutable.
    mutable:
      readBoolean(value.mutable, false) &&
      status !== 'locked' &&
      status !== 'unavailable' &&
      status !== 'error',
    required: readBoolean(value.required, false) || status === 'required',
    summary: readOptionalString(value.summary, onboardingLimits.maxMediumText),
    reason: readOptionalString(value.reason, onboardingLimits.maxMediumText),
    mediaKey: readOptionalString(value.mediaKey, onboardingLimits.maxShortText),
  };
}

function parseProfile(value: unknown): OnboardingProfileItem[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const raw = readArray(value, onboardingLimits.maxProfileItems);
  if (!raw) {
    return undefined;
  }
  const items: OnboardingProfileItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const item = parseProfileItem(entry);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return items.length ? items : undefined;
}

/** Control actions the source may supply an explicit wire value for. */
const controlWireActions: readonly OnboardingActionName[] = [
  'confirm',
  'reselect',
  'continue',
  'generate-example',
  'next-page',
  'previous-page',
  'cancel',
  'quit',
];

function parseControlWire(
  value: unknown,
): Partial<Record<OnboardingActionName, string>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const wire: Partial<Record<OnboardingActionName, string>> = {};
  let found = false;
  for (const action of controlWireActions) {
    const line = readOptionalString(value[action], onboardingLimits.maxShortText);
    if (line !== undefined) {
      wire[action] = line;
      found = true;
    }
  }
  return found ? wire : undefined;
}

function parsePage(value: unknown): OnboardingPage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const count = readInteger(value.count, 1, 1000);
  const index = readInteger(value.index, 0, 999);
  if (count === null || index === null || index >= count) {
    return undefined;
  }
  const totalItems = readInteger(value.totalItems, 0, 100_000);
  return { index, count, totalItems: totalItems === null ? undefined : totalItems };
}

function parseDetail(value: unknown): OnboardingDetail | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readString(value.id, onboardingLimits.maxShortText);
  const label = readString(value.label, onboardingLimits.maxShortText);
  if (!id || !label) {
    return undefined;
  }
  const facts = parseFacts(value.facts);
  return {
    id,
    label,
    mediaKey: readOptionalString(value.mediaKey, onboardingLimits.maxShortText),
    summary: readOptionalString(value.summary, onboardingLimits.maxMediumText),
    description: readOptionalString(value.description, onboardingLimits.maxDetailBytes),
    facts: facts.length ? facts.slice(0, onboardingLimits.maxDetailFacts) : undefined,
    irreversibleWarning: readOptionalString(
      value.irreversibleWarning,
      onboardingLimits.maxMediumText,
    ),
  };
}

function parseExamples(value: unknown): OnboardingExample[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const raw = readArray(value, onboardingLimits.maxExamples);
  if (!raw) {
    return undefined;
  }
  const examples: OnboardingExample[] = [];
  const seen = new Set<string>();
  for (const [position, entry] of raw.entries()) {
    if (!isRecord(entry)) {
      continue;
    }
    const text = readString(entry.text, onboardingLimits.maxExampleBytes);
    if (!text) {
      continue;
    }
    const id = readOptionalString(entry.id, onboardingLimits.maxShortText) ?? `example/${position}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    examples.push({ id, text });
  }
  return examples.length ? examples : undefined;
}

function parseEditorMeta(value: unknown): OnboardingEditorMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const fieldId = readString(value.fieldId, onboardingLimits.maxShortText);
  if (!fieldId) {
    return undefined;
  }
  const maxBytes = readInteger(value.maxBytes, 1, editorTransferLimits.maxContentBytes);
  if (maxBytes === null) {
    return undefined;
  }
  const contentRevision = readInteger(value.contentRevision, 0, onboardingLimits.maxRevision) ?? 0;

  const meta: OnboardingEditorMeta = {
    fieldId,
    maxBytes,
    contentRevision,
    empty: readBoolean(value.empty, false),
  };

  // An inbound transfer is only described when every field of the descriptor is
  // present and self-consistent. A half-described transfer is treated as no
  // transfer, so the browser waits rather than assembling partial content.
  const transferId = readOptionalString(value.transferId, onboardingLimits.maxShortText);
  const totalBytes = readInteger(value.totalBytes, 0, maxBytes);
  const chunkCount = readInteger(value.chunkCount, 0, editorTransferLimits.maxChunks);
  const digest = readOptionalString(value.digest, 64);

  if (
    transferId &&
    totalBytes !== null &&
    chunkCount !== null &&
    digest &&
    /^[0-9a-f]{64}$/.test(digest) &&
    chunkCount === expectedChunkCount(totalBytes)
  ) {
    meta.transferId = transferId;
    meta.totalBytes = totalBytes;
    meta.chunkCount = chunkCount;
    meta.digest = digest;
  }

  return meta;
}

export type OnboardingParseResult =
  | { ok: true; state: OnboardingState }
  | { ok: false; reason: OnboardingFallbackReason; detail: string };

/**
 * Validate a decoded onboarding payload. Returns a fallback reason instead of
 * throwing, because every failure mode here must land the player back on the
 * classic terminal rather than break the session.
 */
export function parseOnboardingState(input: unknown): OnboardingParseResult {
  if (!isRecord(input)) {
    return { ok: false, reason: 'malformed-payload', detail: 'payload is not an object' };
  }

  const version = readInteger(input.version, 1, 1000);
  if (version === null) {
    return { ok: false, reason: 'malformed-payload', detail: 'missing protocol version' };
  }
  if (!ONBOARDING_SUPPORTED_VERSIONS.includes(version)) {
    return {
      ok: false,
      reason: 'version-skew',
      detail: `server onboarding protocol v${version} is not supported`,
    };
  }

  const flowId = readString(input.flowId, onboardingLimits.maxShortText);
  if (!flowId) {
    return { ok: false, reason: 'malformed-payload', detail: 'missing flowId' };
  }

  const revision = readInteger(input.revision, 0, onboardingLimits.maxRevision);
  if (revision === null) {
    return { ok: false, reason: 'malformed-payload', detail: 'missing or out-of-range revision' };
  }

  const mode = readEnum(input.mode, onboardingModes);
  if (!mode) {
    return { ok: false, reason: 'malformed-payload', detail: 'unknown mode' };
  }

  const screen = readEnum(input.screen, onboardingScreens);
  if (!screen) {
    return {
      ok: false,
      reason: 'version-skew',
      detail: `unknown onboarding screen "${String(input.screen)}"`,
    };
  }

  // A v1 source must never be able to drive a v2 surface. If it names one, the
  // payload is either forged or the negotiated version is wrong; either way the
  // safe result is the classic terminal, not a half-supported role-play suite.
  const isRoleplayVersion = version >= ONBOARDING_PROTOCOL_VERSION_MAX;
  if (!isRoleplayVersion && (roleplayScreens.includes(screen) || mode === 'roleplay-profile')) {
    return {
      ok: false,
      reason: 'version-skew',
      detail: 'role-play screens require onboarding protocol v2',
    };
  }

  const title = readString(input.title, onboardingLimits.maxShortText);
  const prompt = readString(input.prompt, onboardingLimits.maxMediumText);
  if (title === null || prompt === null) {
    return { ok: false, reason: 'malformed-payload', detail: 'title or prompt out of bounds' };
  }

  const rawChoices = readArray(input.choices, onboardingLimits.maxChoices);
  if (!rawChoices) {
    return { ok: false, reason: 'payload-too-large', detail: 'too many choices' };
  }
  const rawCharacters = readArray(input.characters, onboardingLimits.maxCharacters);
  if (!rawCharacters) {
    return { ok: false, reason: 'payload-too-large', detail: 'too many characters' };
  }
  const rawActions = readArray(input.actions, onboardingLimits.maxActions);
  if (!rawActions) {
    return { ok: false, reason: 'payload-too-large', detail: 'too many actions' };
  }

  const choices: OnboardingChoice[] = [];
  const seenChoiceIds = new Set<string>();
  for (const item of rawChoices) {
    const choice = parseChoice(item);
    if (choice && !seenChoiceIds.has(choice.id)) {
      seenChoiceIds.add(choice.id);
      choices.push(choice);
    }
  }

  const characters: OnboardingCharacterSummary[] = [];
  const seenCharacterIds = new Set<string>();
  for (const item of rawCharacters) {
    const character = parseCharacter(item);
    if (character && !seenCharacterIds.has(character.id)) {
      seenCharacterIds.add(character.id);
      characters.push(character);
    }
  }

  const actions: OnboardingActionName[] = [];
  for (const item of rawActions) {
    const action = readEnum(item, onboardingActionNames);
    if (!action || actions.includes(action)) {
      continue;
    }
    // Drop v2-only actions from a v1 state rather than failing the whole
    // payload: the rest of the screen is still legitimately renderable.
    if (!isRoleplayVersion && roleplayActionNames.includes(action)) {
      continue;
    }
    actions.push(action);
  }

  const inputKind = readEnum(input.inputKind, onboardingInputKinds) ?? 'none';
  const persistence = readEnum(input.persistence, onboardingPersistenceStates) ?? 'none';

  // Fail safe: a password screen is sensitive even if the flag is missing.
  const sensitiveInput = readBoolean(input.sensitiveInput, false) || inputKind === 'password';

  return {
    ok: true,
    state: {
      version,
      flowId,
      revision,
      mode,
      screen,
      title,
      prompt,
      help: readOptionalString(input.help, onboardingLimits.maxLongText),
      sensitiveInput,
      inputKind,
      inputLabel: readOptionalString(input.inputLabel, onboardingLimits.maxShortText),
      persistence,
      choices,
      characters,
      selection: parseSelection(input.selection),
      actions,
      mediaKey: readOptionalString(input.mediaKey, onboardingLimits.maxShortText),
      sceneKey: readOptionalString(input.sceneKey, onboardingLimits.maxShortText),
      error: parseError(input.error),
      // v2-only fields are parsed only for a v2 state, so a v1 source cannot
      // smuggle a hub, an editor descriptor, or a persistence claim.
      profile: isRoleplayVersion ? parseProfile(input.profile) : undefined,
      page: isRoleplayVersion ? parsePage(input.page) : undefined,
      detail: isRoleplayVersion ? parseDetail(input.detail) : undefined,
      examples: isRoleplayVersion ? parseExamples(input.examples) : undefined,
      editor: isRoleplayVersion ? parseEditorMeta(input.editor) : undefined,
      persistenceResult: isRoleplayVersion
        ? (readEnum(input.persistenceResult, onboardingPersistenceResults) ?? undefined)
        : undefined,
      blocking: isRoleplayVersion ? readBoolean(input.blocking, false) : undefined,
      controlWire: isRoleplayVersion ? parseControlWire(input.controlWire) : undefined,
    },
  };
}

/** Map a validated state onto the session phase the shell renders. */
export function sessionPhaseForState(state: OnboardingState): SessionPhase {
  switch (state.mode) {
    case 'account':
      return 'account';
    case 'character-creation':
      return 'creating';
    case 'character-menu':
      return 'character';
    case 'roleplay-profile':
      // The suite is reachable both while creating a character and from the
      // menu of an existing one. `creating` keeps the shell in its structured
      // layout without claiming the player is already in the world.
      return 'creating';
    case 'play':
      return 'playing';
    default:
      return 'negotiating';
  }
}

/**
 * Validate a browser action against the latest server state. Returns the exact
 * line to send on the existing input path, or an error the UI can show.
 */
export function resolveOnboardingAction(
  state: OnboardingState | null,
  message: OnboardingActionMessage,
): { ok: true; line: string; sensitive: boolean } | { ok: false; code: string; detail: string } {
  if (!state) {
    return { ok: false, code: 'no-state', detail: 'no onboarding state is active' };
  }
  if (message.flowId !== state.flowId) {
    return { ok: false, code: 'stale-flow', detail: 'action belongs to an earlier connection' };
  }
  if (message.revision !== state.revision) {
    return { ok: false, code: 'stale-revision', detail: 'the screen changed before you answered' };
  }
  if (!state.actions.includes(message.action)) {
    return { ok: false, code: 'action-not-allowed', detail: 'action is not offered here' };
  }

  // Editor actions never resolve to a line. They ride the reserved v2 MSDP
  // action variable so profile text cannot be interpreted as editor commands.
  if (structuredTransportActions.includes(message.action)) {
    return {
      ok: false,
      code: 'structured-transport-required',
      detail: 'this action uses the editor transfer path, not a command line',
    };
  }

  switch (message.action) {
    case 'open': {
      // A hub item is opened by its own server-offered wire value, and only
      // when the source still reports it as mutable.
      const item = state.profile?.find((entry) => entry.id === message.choiceId);
      if (!item) {
        return { ok: false, code: 'unknown-choice', detail: 'item is not on this screen' };
      }
      if (!item.mutable) {
        return { ok: false, code: 'item-not-mutable', detail: 'item cannot be changed right now' };
      }
      return { ok: true, line: item.wireValue, sensitive: false };
    }
    case 'select':
    case 'detail': {
      const choice = state.choices.find((item) => item.id === message.choiceId);
      if (choice) {
        if (!choice.enabled) {
          return { ok: false, code: 'choice-locked', detail: 'choice is not available' };
        }
        return { ok: true, line: choice.wireValue, sensitive: false };
      }

      // The account lobby selects a character rather than a catalog choice.
      const character = state.characters.find((item) => item.id === message.choiceId);
      if (character) {
        return { ok: true, line: character.wireValue, sensitive: false };
      }

      // Protocol v1 represents the selected-character menu as a choice screen
      // without a choice catalog. Keep this compatibility mapping restricted
      // to select actions on that exact state so arbitrary input never crosses
      // the proxy boundary.
      if (
        message.action === 'select' &&
        state.mode === 'character-menu' &&
        state.screen === 'character-menu' &&
        message.choiceId
      ) {
        if (
          message.choiceId === characterMenuChoiceIds.roleplayProfile &&
          state.version < ONBOARDING_PROTOCOL_VERSION_MAX
        ) {
          return {
            ok: false,
            code: 'unknown-choice',
            detail: 'item is not on this protocol version',
          };
        }
        const wireValue = characterMenuWireValues.get(message.choiceId);
        if (wireValue) {
          return { ok: true, line: wireValue, sensitive: false };
        }
      }

      return { ok: false, code: 'unknown-choice', detail: 'choice is not on this screen' };
    }
    case 'submit': {
      if (state.inputKind !== 'text' && state.inputKind !== 'password') {
        return { ok: false, code: 'input-not-expected', detail: 'this screen takes no text' };
      }
      const value = message.value ?? '';
      if (!value || value.length > onboardingLimits.maxShortText) {
        return { ok: false, code: 'invalid-input', detail: 'value is empty or too long' };
      }
      return { ok: true, line: value, sensitive: state.sensitiveInput };
    }
    case 'continue':
    case 'generate-example':
    case 'next-page':
    case 'previous-page': {
      const line = state.controlWire?.[message.action];
      if (line === undefined) {
        return {
          ok: false,
          code: 'no-wire-value',
          detail: 'the server did not offer a value for this control',
        };
      }
      if (message.action === 'next-page' || message.action === 'previous-page') {
        // Pagination is source-owned; refuse to step outside the page window
        // the server actually published.
        const page = state.page;
        const atEdge =
          !page ||
          (message.action === 'next-page' ? page.index >= page.count - 1 : page.index <= 0);
        if (atEdge) {
          return { ok: false, code: 'no-such-page', detail: 'there is no page in that direction' };
        }
      }
      return { ok: true, line, sensitive: false };
    }
    case 'confirm':
      return { ok: true, line: state.controlWire?.confirm ?? 'y', sensitive: false };
    case 'reselect':
      return { ok: true, line: state.controlWire?.reselect ?? 'n', sensitive: false };
    case 'create-character':
      return { ok: true, line: 'c', sensitive: false };
    case 'link-character':
      return { ok: true, line: 'a', sensitive: false };
    case 'quit':
      return { ok: true, line: state.controlWire?.quit ?? 'q', sensitive: false };
    case 'cancel': {
      // The forced short-description gate must not be escapable. The server
      // signals this with `blocking`, and it also simply omits `cancel` from
      // `actions` — this is the belt-and-braces check.
      if (state.blocking) {
        return {
          ok: false,
          code: 'cancel-not-allowed',
          detail: 'this step must be completed before you can continue',
        };
      }
      const wire = state.controlWire?.cancel;
      if (wire !== undefined) {
        return { ok: true, line: wire, sensitive: false };
      }
      if (state.screen === 'account-link' && state.inputKind === 'text') {
        return { ok: true, line: 'q', sensitive: false };
      }
      return {
        ok: false,
        code: 'cancel-not-supported',
        detail: 'this screen has no server-authorized return path',
      };
    }
    case 'classic-terminal':
      return { ok: false, code: 'client-only', detail: 'handled entirely in the browser' };
    default:
      return { ok: false, code: 'action-not-allowed', detail: 'unsupported action' };
  }
}

export function isOnboardingActionMessage(value: unknown): value is OnboardingActionMessage {
  if (!isRecord(value) || value.type !== 'onboarding-action') {
    return false;
  }
  if (typeof value.flowId !== 'string' || value.flowId.length > onboardingLimits.maxShortText) {
    return false;
  }
  if (
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    value.revision > onboardingLimits.maxRevision
  ) {
    return false;
  }
  if (!readEnum(value.action, onboardingActionNames)) {
    return false;
  }
  if (
    value.choiceId !== undefined &&
    (typeof value.choiceId !== 'string' || value.choiceId.length > onboardingLimits.maxShortText)
  ) {
    return false;
  }
  if (
    value.value !== undefined &&
    (typeof value.value !== 'string' || value.value.length > onboardingLimits.maxShortText)
  ) {
    return false;
  }
  return true;
}
