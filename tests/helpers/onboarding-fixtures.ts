/**
 * Synthetic onboarding fixtures.
 *
 * Every value here is invented. No live account name, character name, password,
 * or role-play text may ever appear in a fixture.
 */

import { IAC, MSDP_VAL, MSDP_VAR, SB, SE, TELOPT_MSDP } from '../../server/telnet-parser.ts';
import { ONBOARDING_MSDP_VARIABLE } from '../../shared/onboarding.ts';
import type { OnboardingState } from '../../shared/onboarding.ts';

export function makeOnboardingState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    version: 1,
    flowId: 'fixture-flow',
    revision: 1,
    mode: 'character-creation',
    screen: 'race',
    title: 'Choose your ancestry',
    prompt: 'Select an ancestry to continue.',
    sensitiveInput: false,
    inputKind: 'choice',
    persistence: 'draft',
    choices: [
      {
        id: 'human',
        label: 'Human',
        wireValue: 'Human',
        enabled: true,
        mediaKey: 'race/human',
        summary: 'Adaptable and widely travelled.',
      },
      {
        id: 'moonelf',
        label: 'Moon Elf',
        wireValue: 'Moon Elf',
        enabled: true,
        mediaKey: 'race/moon-elf',
        summary: 'Long-lived and lunar in temperament.',
      },
    ],
    characters: [],
    selection: {},
    actions: ['select', 'detail', 'classic-terminal'],
    ...overrides,
  };
}

/** The account lobby, with two invented characters. */
export function makeAccountLobbyState(): OnboardingState {
  return makeOnboardingState({
    mode: 'account',
    screen: 'account-menu',
    title: 'Your characters',
    prompt: 'Choose a character to play, or create a new one.',
    persistence: 'none',
    choices: [],
    characters: [
      {
        id: 'Fixturea',
        name: 'Fixturea',
        wireValue: '1',
        level: 7,
        race: 'Human',
        raceMediaKey: 'race/human',
        classSummary: 'Wizard',
      },
      {
        id: 'Fixtureb',
        name: 'Fixtureb',
        wireValue: '2',
        level: 2,
        race: 'Moon Elf',
        raceMediaKey: 'race/moon-elf',
        classSummary: 'Ranger',
      },
    ],
    actions: ['select', 'create-character', 'link-character', 'quit', 'classic-terminal'],
  });
}

/** The selected-character menu emitted after an existing character is loaded. */
export function makeCharacterMenuState(): OnboardingState {
  return makeOnboardingState({
    mode: 'character-menu',
    screen: 'character-menu',
    title: 'Character menu',
    prompt: 'Choose what to do with this character.',
    inputKind: 'choice',
    persistence: 'none',
    choices: [],
    characters: [],
    selection: {
      name: 'Fixturea',
      sex: 'Female',
      race: 'Moon Elf',
      raceMediaKey: 'race/moon-elf',
      className: 'Wizard',
      classMediaKey: 'class/wizard',
      alignment: 'Neutral Good',
    },
    actions: ['select', 'detail', 'classic-terminal'],
  });
}

/** A password prompt. Note there is no password value anywhere in the state. */
export function makePasswordState(): OnboardingState {
  return makeOnboardingState({
    mode: 'account',
    screen: 'account-password',
    title: 'Account password',
    prompt: 'Enter the password for this account.',
    sensitiveInput: true,
    inputKind: 'password',
    persistence: 'none',
    choices: [],
    actions: ['submit', 'classic-terminal'],
  });
}

/** Encode a state the way the MUD does: one JSON string in one MSDP variable. */
export function onboardingMsdpPacket(state: unknown, variable = ONBOARDING_MSDP_VARIABLE) {
  const payload = typeof state === 'string' ? state : JSON.stringify(state);
  return Buffer.concat([
    Buffer.from([IAC, SB, TELOPT_MSDP, MSDP_VAR]),
    Buffer.from(variable, 'utf8'),
    Buffer.from([MSDP_VAL]),
    Buffer.from(payload, 'utf8'),
    Buffer.from([IAC, SE]),
  ]);
}

// ---------------------------------------------------------------------------
// Protocol v2: role-play identity suite. All content below is invented.
// ---------------------------------------------------------------------------

/** The profile hub, exercising every server-authored item status. */
export function makeRoleplayHubState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return makeOnboardingState({
    version: 2,
    mode: 'roleplay-profile',
    screen: 'roleplay-hub',
    title: 'Role-play profile',
    prompt: 'Choose a detail to fill in. Everything here is optional.',
    inputKind: 'choice',
    persistence: 'draft',
    choices: [],
    actions: ['open', 'quit', 'classic-terminal'],
    profile: [
      {
        id: 'profile/short-description',
        label: 'Short description',
        wireValue: '0',
        status: 'unset',
        mutable: true,
        required: false,
        mediaKey: 'roleplay/short-description',
      },
      {
        id: 'profile/background-story',
        label: 'Background story',
        wireValue: '2',
        status: 'configured',
        mutable: true,
        required: false,
        summary: '412 words written',
        mediaKey: 'roleplay/background-story',
      },
      {
        id: 'profile/age',
        label: 'Age',
        wireValue: '9',
        status: 'locked',
        mutable: false,
        required: false,
        summary: 'Venerable',
        reason: 'Age is chosen once and cannot be changed.',
        mediaKey: 'age/venerable',
      },
      {
        id: 'profile/faction',
        label: 'Faction',
        wireValue: 'b',
        status: 'unavailable',
        mutable: false,
        required: false,
        reason: 'No factions are recruiting on this world.',
        mediaKey: 'faction/fallback',
      },
    ],
    ...overrides,
  });
}

/** The forced short-description gate: required, and not cancellable. */
export function makeForcedShortDescriptionState(): OnboardingState {
  return makeOnboardingState({
    version: 2,
    mode: 'roleplay-profile',
    screen: 'short-desc-intro',
    title: 'Describe yourself',
    prompt: 'You must set a short description before entering the world.',
    inputKind: 'none',
    persistence: 'draft',
    choices: [],
    actions: ['continue', 'classic-terminal'],
    blocking: true,
    controlWire: { continue: '' },
  });
}

/** A multiline editor screen with an inbound content transfer described. */
export function makeEditorState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return makeOnboardingState({
    version: 2,
    mode: 'roleplay-profile',
    screen: 'background-story',
    title: 'Background story',
    prompt: 'Write your history. Leave it blank to skip.',
    inputKind: 'multiline',
    persistence: 'draft',
    choices: [],
    actions: ['save-text', 'cancel-editor', 'classic-terminal'],
    editor: {
      fieldId: 'background-story',
      maxBytes: 49_152,
      contentRevision: 3,
      empty: true,
    },
    ...overrides,
  });
}

/** A source-paginated catalog with a previewed entry and an irreversible step. */
export function makeCatalogState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return makeOnboardingState({
    version: 2,
    mode: 'roleplay-profile',
    screen: 'background-catalog',
    title: 'Background',
    prompt: 'Pick the life you led before adventuring.',
    inputKind: 'choice',
    persistence: 'draft',
    choices: [
      {
        id: 'background/lamplighter',
        label: 'Lamplighter',
        wireValue: '4',
        enabled: true,
        mediaKey: 'background/fallback',
        summary: 'You kept the night roads lit.',
      },
    ],
    actions: ['select', 'detail', 'next-page', 'cancel', 'classic-terminal'],
    page: { index: 0, count: 3, totalItems: 16 },
    controlWire: { 'next-page': 'n', 'previous-page': 'p', cancel: '0' },
    ...overrides,
  });
}
