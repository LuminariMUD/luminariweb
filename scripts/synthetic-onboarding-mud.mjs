#!/usr/bin/env node
/**
 * Synthetic onboarding MUD.
 *
 * A tiny Telnet server that speaks just enough MSDP to exercise the structured
 * onboarding flow end to end without a database, a world load, or any real
 * account data. Every name and value here is invented.
 *
 * Usage: node scripts/synthetic-onboarding-mud.mjs [port]
 */

import net from 'node:net';
import { createHash } from 'node:crypto';

const IAC = 255;
const DO = 253;
const WILL = 251;
const WONT = 252;
const SB = 250;
const SE = 240;
const TELOPT_ECHO = 1;
const TELOPT_MSDP = 69;
const MSDP_VAR = 1;
const MSDP_VAL = 2;

const port = Number(process.argv[2] ?? 4444);

const races = [
  ['human', 'Human', 'race/human', 'Adaptable, widespread, and at home almost anywhere.'],
  ['moon-elf', 'Moon Elf', 'race/moon-elf', 'Long-lived, contemplative, and drawn to moonlight.'],
  [
    'mountain-dwarf',
    'Mountain Dwarf',
    'race/mountain-dwarf',
    'Enduring crafters of the deep halls.',
  ],
  ['half-orc', 'Half Orc', 'race/half-orc', 'Resilient, direct, and often underestimated.'],
  ['rock-gnome', 'Rock Gnome', 'race/rock-gnome', 'Curious tinkers with a talent for invention.'],
  ['tiefling', 'Tiefling', 'race/tiefling', 'Planar heritage worn openly and without apology.'],
];

const classes = [
  ['wizard', 'Wizard', 'class/wizard', 'Studied arcane mastery and deliberate control.', 'd4'],
  ['cleric', 'Cleric', 'class/cleric', 'Divine channeling in service of a cause.', 'd8'],
  ['rogue', 'Rogue', 'class/rogue', 'Skill, mobility, tools, and opportunism.', 'd6'],
  ['warrior', 'Warrior', 'class/warrior', 'Broad mastery of weapons and armour.', 'd10'],
  ['ranger', 'Ranger', 'class/ranger', 'Tracking, wilderness craft, and flexible combat.', 'd8'],
];

const alignments = [
  ['lawful-good', 'Lawful Good', '0'],
  ['neutral-good', 'Neutral Good', '1'],
  ['chaotic-good', 'Chaotic Good', '2'],
  ['lawful-neutral', 'Lawful Neutral', '3'],
  ['true-neutral', 'True Neutral', '4'],
  ['chaotic-neutral', 'Chaotic Neutral', '5'],
];

const roleplayTextFields = {
  'long-description': { fieldId: 'long-description', title: 'Long description', maxBytes: 4096 },
  'background-story': {
    fieldId: 'background-story',
    title: 'Background story',
    maxBytes: 49_152,
  },
  'goals-editor': { fieldId: 'goals', title: 'Goals', maxBytes: 49_152 },
  'personality-editor': { fieldId: 'personality', title: 'Personality', maxBytes: 49_152 },
  'ideals-editor': { fieldId: 'ideals', title: 'Ideals', maxBytes: 49_152 },
  'bonds-editor': { fieldId: 'bonds', title: 'Bonds', maxBytes: 49_152 },
  'flaws-editor': { fieldId: 'flaws', title: 'Flaws', maxBytes: 49_152 },
};

const ideaFields = {
  'goals-ideas': { fieldId: 'goals', title: 'Goals' },
  'personality-ideas': { fieldId: 'personality', title: 'Personality' },
  'ideals-ideas': { fieldId: 'ideals', title: 'Ideals' },
  'bonds-ideas': { fieldId: 'bonds', title: 'Bonds' },
  'flaws-ideas': { fieldId: 'flaws', title: 'Flaws' },
};

const ideaThemes = [
  {
    id: 'background/lamplighter',
    label: 'Lamplighter',
    wireValue: '1',
    enabled: true,
    mediaKey: 'background/fallback',
    summary: 'Suggestions shaped by nights spent keeping the roads lit.',
  },
  {
    id: 'background/tidewright',
    label: 'Tidewright',
    wireValue: '2',
    enabled: true,
    mediaKey: 'background/fallback',
    summary: 'Suggestions shaped by tides, harbours, and uncertain voyages.',
  },
];

const defaultIdeaExamples = {
  goals: [
    { id: 'goal/objective', text: 'Objective: Relight every wayshrine on the Ember Road.' },
    { id: 'goal/reason', text: 'Reason: Your family vanished after the last shrine went dark.' },
    { id: 'goal/obstacle', text: 'Complication: Someone benefits from keeping the road unlit.' },
  ],
  personality: [
    { id: 'personality/quiet', text: 'I listen for the smallest change in a familiar room.' },
    { id: 'personality/ritual', text: 'I light a lamp before making any difficult promise.' },
  ],
  ideals: [
    { id: 'ideals/service', text: 'Service: A safe road belongs to everyone who walks it.' },
    { id: 'ideals/truth', text: 'Truth: Hidden ledgers do more harm than open blades.' },
  ],
  bonds: [
    { id: 'bonds/road', text: 'The Ember Road is the only home that has never rejected me.' },
    { id: 'bonds/mentor', text: 'I still carry the lamp my missing mentor entrusted to me.' },
  ],
  flaws: [
    { id: 'flaws/suspicion', text: 'I assume every extinguished light was put out deliberately.' },
    { id: 'flaws/control', text: 'I cannot leave a task unfinished, even when retreat is wiser.' },
  ],
};

const ageChoices = [
  ['age/adult', 'Adult', '1', 'age/adult'],
  ['age/adolescent', 'Adolescent', '2', 'age/adolescent'],
  ['age/middle-aged', 'Middle-aged', '3', 'age/middle-aged'],
  ['age/old-aged', 'Old-aged', '4', 'age/old-aged'],
  ['age/venerable', 'Venerable', '5', 'age/venerable'],
];

const regionChoices = [
  ['region/1', 'Ashenport Coast', '1', 'region/ashenport', 'Trade Tongue'],
  ['region/2', 'Sanctus Marches', '2', 'region/sanctus', 'Celestial'],
];

const factionChoices = [
  ['faction/0', 'Adventurer / No faction', '0', 'faction/adventurer'],
  ['faction/901', 'Lantern Wardens', '1', 'faction/fallback'],
];

const hometownChoices = [['hometown/1', 'Ashenport', '1', 'hometown/ashenport']];

const deityChoices = [
  ['deity/0', 'None', '0', 'deity/none', 'Follow no deity.'],
  ['deity/1', 'Aethyra', '1', 'deity/aethyra', 'Light, safe passage, and honest witness.'],
];

function screenFor(step, session) {
  switch (step) {
    case 'account-name':
      return {
        mode: 'account',
        screen: 'account-name',
        title: 'Welcome to Luminari',
        prompt: 'Enter your account name, or a new one to create an account.',
        inputKind: 'text',
        inputLabel: 'Account name',
        persistence: 'none',
        actions: ['submit', 'classic-terminal'],
      };
    case 'account-password':
      return {
        mode: 'account',
        screen: 'account-password',
        title: 'Account password',
        prompt: 'Enter the password for this account.',
        inputKind: 'password',
        sensitiveInput: true,
        inputLabel: 'Password',
        persistence: 'none',
        actions: ['submit', 'classic-terminal'],
      };
    case 'account-menu':
      return {
        mode: 'account',
        screen: 'account-menu',
        title: 'Your characters',
        prompt: 'Choose a character to play, or create a new one.',
        inputKind: 'choice',
        persistence: 'none',
        characters: [
          {
            id: 'Aelwyn',
            name: 'Aelwyn',
            wireValue: '1',
            level: 12,
            race: 'Moon Elf',
            raceMediaKey: 'race/moon-elf',
            classSummary: 'Wizard',
            classMediaKeys: ['class/wizard'],
          },
          {
            id: 'Bordrek',
            name: 'Bordrek',
            wireValue: '2',
            level: 4,
            race: 'Mountain Dwarf',
            raceMediaKey: 'race/mountain-dwarf',
            classSummary: 'Warrior',
            status: 'Last seen three days ago',
          },
        ],
        actions: ['select', 'create-character', 'link-character', 'quit', 'classic-terminal'],
      };
    case 'account-link':
      return {
        mode: 'account',
        screen: 'account-link',
        title: 'Link an existing character',
        prompt: 'Enter the name of the character you want to add to this account.',
        inputKind: 'text',
        inputLabel: 'Character name',
        persistence: 'none',
        actions: ['submit', 'cancel', 'classic-terminal'],
      };
    case 'character-menu':
      return {
        mode: 'character-menu',
        screen: 'character-menu',
        title: 'Character menu',
        prompt: 'Choose what to do with this character.',
        inputKind: 'choice',
        persistence: 'none',
        actions: ['select', 'detail', 'classic-terminal'],
      };
    case 'name':
      return {
        mode: 'character-creation',
        screen: 'name',
        title: 'Name your character',
        prompt: 'Enter the name your character will be known by.',
        inputKind: 'text',
        inputLabel: 'Character name',
        persistence: 'draft',
        actions: ['submit', 'classic-terminal'],
      };
    case 'name-confirm':
      return {
        mode: 'character-creation',
        screen: 'name-confirm',
        title: 'Confirm the name',
        prompt: 'Did you spell that name the way you meant to?',
        inputKind: 'confirm',
        persistence: 'draft',
        actions: ['confirm', 'reselect', 'classic-terminal'],
      };
    case 'sex':
      return {
        mode: 'character-creation',
        screen: 'sex',
        title: 'Choose an identity',
        prompt: 'Select the sex your character is recorded as.',
        inputKind: 'choice',
        persistence: 'draft',
        choices: [
          {
            id: 'male',
            label: 'Male',
            wireValue: 'm',
            enabled: true,
            mediaKey: 'identity/sex-male',
          },
          {
            id: 'female',
            label: 'Female',
            wireValue: 'f',
            enabled: true,
            mediaKey: 'identity/sex-female',
          },
        ],
        actions: ['select', 'classic-terminal'],
      };
    case 'race':
      return {
        mode: 'character-creation',
        screen: 'race',
        title: 'Choose your ancestry',
        prompt: 'Select an ancestry to continue.',
        inputKind: 'choice',
        persistence: 'draft',
        choices: races.map(([id, label, mediaKey, summary]) => ({
          id,
          label,
          wireValue: label,
          enabled: true,
          mediaKey,
          summary,
          description: `${summary} The server decides which ancestries are available to this account.`,
          facts: [
            { label: 'Size', value: 'Medium', glyph: 'size' },
            { label: 'Level adjustment', value: '0', glyph: 'level-adjustment' },
          ],
        })),
        actions: ['select', 'detail', 'classic-terminal'],
      };
    case 'class':
      return {
        mode: 'character-creation',
        screen: 'class',
        title: 'Choose your path',
        prompt: 'Select a class to continue.',
        inputKind: 'choice',
        persistence: 'draft',
        choices: classes.map(([id, label, mediaKey, summary, hitDie]) => ({
          id,
          label,
          wireValue: label,
          enabled: true,
          mediaKey,
          summary,
          facts: [
            { label: 'Hit die', value: hitDie, glyph: 'hit-die' },
            { label: 'Primary attributes', value: 'Varies', glyph: 'primary-attributes' },
          ],
        })),
        actions: ['select', 'detail', 'classic-terminal'],
      };
    case 'build':
      return {
        mode: 'character-creation',
        screen: 'build',
        title: 'Guided or custom build',
        prompt: "Choose how your character's build is decided.",
        inputKind: 'choice',
        persistence: 'draft',
        choices: [
          {
            id: 'premade',
            label: 'Guided build',
            wireValue: 'premade',
            enabled: true,
            mediaKey: 'build/premade',
            summary: 'The server picks a proven set of choices for you.',
          },
          {
            id: 'custom',
            label: 'Custom build',
            wireValue: 'custom',
            enabled: true,
            mediaKey: 'build/custom',
            summary: 'You make each build decision yourself as you level.',
          },
        ],
        actions: ['select', 'classic-terminal'],
      };
    case 'alignment':
      return {
        mode: 'character-creation',
        screen: 'alignment',
        title: 'Choose an alignment',
        prompt: 'Only alignments valid for your ancestry and path are shown.',
        inputKind: 'choice',
        persistence: 'pending',
        choices: alignments.map(([id, label, wireValue]) => ({
          id: `alignment/${id}`,
          label,
          wireValue,
          enabled: true,
          mediaKey: `alignment/${id}`,
        })),
        actions: ['select', 'classic-terminal'],
      };
    case 'preferences':
      return {
        mode: 'character-creation',
        screen: 'preferences',
        title: 'Recommended settings',
        prompt: 'Apply the recommended settings bundle, or keep the defaults.',
        inputKind: 'choice',
        persistence: 'saved',
        choices: [
          {
            id: 'recommended',
            label: 'Use recommended settings',
            wireValue: 'y',
            enabled: true,
            mediaKey: 'preferences/recommended',
            summary: 'Turns on the settings most new players find helpful.',
          },
          {
            id: 'manual',
            label: 'Keep the defaults',
            wireValue: 'n',
            enabled: true,
            mediaKey: 'preferences/manual',
            summary: 'Leave every setting as it is; you can change them in game.',
          },
        ],
        actions: ['select', 'classic-terminal'],
      };
    case 'roleplay-decision':
      return {
        mode: 'character-creation',
        screen: 'roleplay-decision',
        title: 'Role-play details',
        prompt: 'Decide whether to fill in role-play details now.',
        inputKind: 'choice',
        persistence: 'saved',
        choices: [
          {
            id: 'roleplayer',
            label: 'Fill in role-play details',
            wireValue: '2',
            enabled: true,
            mediaKey: 'roleplay/choice-roleplayer',
            summary: "Describe your character's background, goals, and personality.",
          },
          {
            id: 'non-roleplayer',
            label: 'Skip role-play details',
            wireValue: '1',
            enabled: true,
            mediaKey: 'roleplay/choice-non-roleplayer',
            summary: 'Head straight into the world.',
          },
          {
            id: 'later',
            label: 'Decide later',
            wireValue: '3',
            enabled: true,
            mediaKey: 'roleplay/choice-later',
            summary: 'Leave the profile bookmarked and return to it in game.',
          },
        ],
        actions: ['select', 'classic-terminal'],
      };
    case 'motd':
      return {
        mode: 'character-menu',
        screen: 'motd',
        title: 'Message of the day',
        prompt: 'Read the message of the day, then continue.',
        inputKind: 'confirm',
        persistence: 'saved',
        help: 'Welcome to Luminari. This is a synthetic message for rendered QA.',
        actions: ['confirm', 'classic-terminal'],
      };
    // --- protocol v2: role-play identity suite ---------------------------
    // Every name and every line of text below is invented. No captured player
    // content may ever appear in a fixture.
    case 'roleplay-hub':
      return {
        mode: 'roleplay-profile',
        screen: 'roleplay-hub',
        title: 'Role-play profile',
        prompt: 'Choose a detail to fill in. Everything here is optional.',
        inputKind: 'choice',
        persistence: 'draft',
        persistenceResult: session.profile.lastSaved ? 'saved' : undefined,
        profile: [
          {
            id: 'profile/short-description',
            label: 'Short description',
            wireValue: '0',
            status: session.profile.shortDesc ? 'configured' : 'unset',
            mutable: true,
            required: false,
            summary: session.profile.shortDesc,
            mediaKey: 'roleplay/short-description',
          },
          {
            id: 'profile/long-description',
            label: 'Long description',
            wireValue: '1',
            status: session.profile['long-description'] ? 'configured' : 'unset',
            mutable: true,
            required: false,
            mediaKey: 'roleplay/long-description',
          },
          {
            id: 'profile/background-story',
            label: 'Background story',
            wireValue: '2',
            status: session.profile['background-story'] ? 'configured' : 'unset',
            mutable: true,
            required: false,
            summary: session.profile['background-story']
              ? `${session.profile['background-story'].split(/\s+/).length} words written`
              : undefined,
            mediaKey: 'roleplay/background-story',
          },
          {
            id: 'profile/background',
            label: 'Background',
            wireValue: '3',
            status: session.profile.background ? 'locked' : 'unset',
            mutable: !session.profile.background,
            required: false,
            summary: session.profile.background,
            reason: session.profile.background
              ? 'A background is chosen once and cannot be changed.'
              : undefined,
            mediaKey: 'background/fallback',
          },
          ...[
            ['goals', 'Goals', '4'],
            ['personality', 'Personality', '5'],
            ['ideals', 'Ideals', '6'],
            ['bonds', 'Bonds', '7'],
            ['flaws', 'Flaws', '8'],
          ].map(([fieldId, label, wireValue]) => ({
            id: `profile/${fieldId}`,
            label,
            wireValue,
            status: session.profile[fieldId] ? 'configured' : 'unset',
            mutable: true,
            required: false,
            mediaKey: `roleplay/${fieldId}`,
          })),
          {
            id: 'profile/age',
            label: 'Age',
            wireValue: '9',
            status: session.profile.age ? 'locked' : 'unset',
            mutable: !session.profile.age,
            required: false,
            summary: session.profile.age,
            reason: session.profile.age
              ? 'Age is chosen once and cannot be changed here.'
              : undefined,
            mediaKey: session.profile.ageMediaKey ?? 'roleplay/profile-hub',
          },
          {
            id: 'profile/region',
            label: 'Homeland',
            wireValue: 'a',
            status: session.profile.region ? 'locked' : 'unset',
            mutable: !session.profile.region,
            required: false,
            summary: session.profile.region,
            reason: session.profile.region
              ? 'A homeland is chosen once and cannot be changed here.'
              : undefined,
            mediaKey: session.profile.regionMediaKey ?? 'region/fallback',
          },
          {
            id: 'profile/faction',
            label: 'Faction',
            wireValue: 'b',
            status: session.profile.faction ? 'locked' : 'unset',
            mutable: !session.profile.faction,
            required: false,
            summary: session.profile.faction,
            reason: session.profile.faction
              ? 'A faction has already been chosen for this fixture.'
              : undefined,
            mediaKey: session.profile.factionMediaKey ?? 'faction/fallback',
          },
          {
            id: 'profile/hometown',
            label: 'Hometown',
            wireValue: 'c',
            status: session.profile.hometown ? 'locked' : 'unset',
            mutable: !session.profile.hometown,
            required: false,
            summary: session.profile.hometown,
            reason: session.profile.hometown
              ? 'A hometown is chosen once and cannot be changed here.'
              : undefined,
            mediaKey: session.profile.hometownMediaKey ?? 'hometown/fallback',
          },
          {
            id: 'profile/deity',
            label: 'Deity',
            wireValue: 'd',
            status: session.profile.deity ? 'locked' : 'unset',
            mutable: !session.profile.deity,
            required: false,
            summary: session.profile.deity,
            reason: session.profile.deity
              ? 'A deity is chosen once and cannot be changed here.'
              : undefined,
            mediaKey: session.profile.deityMediaKey ?? 'deity/fallback',
          },
        ],
        controlWire: { quit: 'q' },
        actions: ['open', 'quit', 'classic-terminal'],
      };
    case 'long-description':
    case 'background-story':
    case 'goals-editor':
    case 'personality-editor':
    case 'ideals-editor':
    case 'bonds-editor':
    case 'flaws-editor': {
      const definition = roleplayTextFields[session.step];
      return {
        mode: 'roleplay-profile',
        screen: session.step,
        title: definition.title,
        prompt: 'Write as much or as little as you like. Leave it blank to skip.',
        inputKind: 'multiline',
        persistence: 'draft',
        persistenceResult: session.profile.lastSaved === definition.fieldId ? 'saved' : undefined,
        editor: {
          fieldId: definition.fieldId,
          maxBytes: definition.maxBytes,
          contentRevision: session.contentRevisions[definition.fieldId] ?? 0,
          empty: !session.profile[definition.fieldId],
        },
        actions: ['save-text', 'cancel-editor', 'classic-terminal'],
      };
    }
    case 'goals-ideas':
    case 'personality-ideas':
    case 'ideals-ideas':
    case 'bonds-ideas':
    case 'flaws-ideas': {
      const definition = ideaFields[session.step];
      const isGoals = definition.fieldId === 'goals';
      return {
        mode: 'roleplay-profile',
        screen: session.step,
        title: definition.title,
        prompt: 'Here are some ideas, or write your own.',
        inputKind: 'none',
        persistence: 'draft',
        choices: isGoals ? [] : ideaThemes,
        examples: session.ideaExamples[definition.fieldId] ?? [],
        controlWire: {
          continue: 'q',
          ...(isGoals ? { 'generate-example': '1' } : {}),
          cancel: '0',
        },
        actions: [
          ...(isGoals ? ['generate-example'] : ['select', 'detail']),
          'continue',
          'cancel',
          'classic-terminal',
        ],
      };
    }
    case 'background-catalog':
      return {
        mode: 'roleplay-profile',
        screen: 'background-catalog',
        title: 'Background',
        prompt: 'Pick the life you led before adventuring.',
        inputKind: 'choice',
        persistence: 'draft',
        // Source-owned pagination: the browser must ask for the next page
        // rather than filtering a list locally.
        page: { index: session.profile.backgroundPage ?? 0, count: 2, totalItems: 16 },
        choices:
          (session.profile.backgroundPage ?? 0) === 0
            ? [
                {
                  id: 'background/lamplighter',
                  label: 'Lamplighter',
                  wireValue: '1',
                  enabled: true,
                  mediaKey: 'background/fallback',
                  summary: 'You kept the night roads lit.',
                },
                {
                  id: 'background/tidewright',
                  label: 'Tidewright',
                  wireValue: '2',
                  enabled: true,
                  mediaKey: 'background/fallback',
                  summary: 'You read the harbour the way others read a page.',
                },
              ]
            : [
                {
                  id: 'background/ashen-scribe',
                  label: 'Ashen Scribe',
                  wireValue: '3',
                  enabled: true,
                  // Deliberately an unstaged key: must resolve to the
                  // category fallback without blocking selection.
                  mediaKey: 'background/ashen-scribe',
                  summary: 'You copied ledgers no one was meant to read.',
                },
              ],
        controlWire: {
          'next-page': '__onboarding-next__',
          'previous-page': '__onboarding-previous__',
          cancel: 'quit',
        },
        actions: [
          'select',
          'detail',
          ...((session.profile.backgroundPage ?? 0) === 0 ? ['next-page'] : ['previous-page']),
          'cancel',
          'classic-terminal',
        ],
      };
    case 'background-confirm': {
      const pending = session.pendingChoice ?? {
        id: 'background/lamplighter',
        label: 'Lamplighter',
        mediaKey: 'background/fallback',
        summary: 'You kept the night roads lit.',
      };
      return {
        mode: 'roleplay-profile',
        screen: 'background-confirm',
        title: 'Confirm this background',
        prompt: 'This choice is permanent.',
        inputKind: 'confirm',
        persistence: 'draft',
        detail: {
          ...pending,
          description:
            'Years of walking the dark between lamps taught you which shadows move on their own.',
          facts: [
            { label: 'Bonus feat', value: 'Keen Sight' },
            { label: 'Skill', value: 'Perception' },
          ],
          irreversibleWarning: 'A background is chosen once and can never be changed.',
        },
        controlWire: { confirm: 'y', reselect: 'n' },
        actions: ['confirm', 'reselect', 'classic-terminal'],
      };
    }
    case 'short-desc-intro':
      return {
        mode: 'roleplay-profile',
        screen: 'short-desc-intro',
        title: 'Describe yourself',
        prompt: 'Others see this description before they learn your name.',
        inputKind: 'none',
        persistence: 'draft',
        help: session.shortDraft.preview ?? 'an adult traveller',
        // The forced gate: no cancel is offered, and blocking says so plainly.
        blocking: Boolean(session.profile.forcedShortDesc),
        controlWire: { continue: '1', cancel: '0' },
        actions: session.profile.forcedShortDesc
          ? ['continue', 'classic-terminal']
          : ['continue', 'cancel', 'classic-terminal'],
      };
    case 'short-desc-feature-1':
    case 'short-desc-feature-2':
      return {
        mode: 'roleplay-profile',
        screen: session.step,
        title:
          session.step === 'short-desc-feature-2' ? 'Choose a second feature' : 'Choose a feature',
        prompt:
          session.step === 'short-desc-feature-2'
            ? 'Add another detail, or keep what you have.'
            : 'Which feature should others notice first?',
        inputKind: 'choice',
        persistence: 'draft',
        blocking: Boolean(session.profile.forcedShortDesc),
        help: session.shortDraft.preview ?? 'an adult traveller',
        choices: [
          { id: 'feature/eyes', label: 'Eyes', wireValue: '1', enabled: true },
          { id: 'feature/hair', label: 'Hair', wireValue: '2', enabled: true },
          { id: 'feature/build', label: 'Build', wireValue: '3', enabled: true },
        ],
        actions: ['select', 'classic-terminal'],
      };
    case 'short-desc-adjective-1':
    case 'short-desc-adjective-2':
      return {
        mode: 'roleplay-profile',
        screen: session.step,
        title:
          session.step === 'short-desc-adjective-2'
            ? 'Choose a second descriptor'
            : 'Choose a descriptor',
        prompt: 'Pick the word that fits best.',
        inputKind: 'choice',
        persistence: 'draft',
        blocking: Boolean(session.profile.forcedShortDesc),
        help: session.shortDraft.preview ?? 'an adult traveller',
        choices: [
          { id: 'adj/storm-grey', label: 'storm-grey', wireValue: '1', enabled: true },
          { id: 'adj/amber', label: 'amber', wireValue: '2', enabled: true },
        ],
        actions: ['select', 'classic-terminal'],
      };
    case 'short-desc-preview':
      return {
        mode: 'roleplay-profile',
        screen: 'short-desc-preview',
        title: 'Your description',
        prompt: 'Review the description built so far.',
        inputKind: 'none',
        persistence: 'draft',
        blocking: Boolean(session.profile.forcedShortDesc),
        help: session.shortDraft.preview ?? 'a traveller with storm-grey eyes',
        controlWire: { continue: '1' },
        actions: ['continue', 'classic-terminal'],
      };
    case 'short-desc-review':
      return {
        mode: 'roleplay-profile',
        screen: 'short-desc-review',
        title: 'Your description',
        prompt: 'Keep this description, or start again.',
        inputKind: 'choice',
        persistence: 'draft',
        blocking: Boolean(session.profile.forcedShortDesc),
        help: 'a traveller with storm-grey eyes',
        help: session.shortDraft.preview ?? 'a traveller with storm-grey eyes',
        controlWire: { confirm: '1', reselect: '2', continue: '3', cancel: '0' },
        actions: session.profile.forcedShortDesc
          ? [
              'confirm',
              'reselect',
              ...(session.shortDraft.second ? [] : ['continue']),
              'classic-terminal',
            ]
          : [
              'confirm',
              'reselect',
              ...(session.shortDraft.second ? [] : ['continue']),
              'cancel',
              'classic-terminal',
            ],
      };
    case 'age-select':
      return {
        mode: 'roleplay-profile',
        screen: 'age-select',
        title: 'Age',
        prompt: 'Choose how many years your character carries.',
        inputKind: 'choice',
        persistence: 'draft',
        page: { index: 0, count: 1, totalItems: ageChoices.length },
        choices: ageChoices.map(([id, label, wireValue, mediaKey]) => ({
          id,
          label,
          wireValue,
          enabled: true,
          mediaKey,
        })),
        controlWire: { cancel: 'quit' },
        actions: ['select', 'detail', 'cancel', 'classic-terminal'],
      };
    case 'region-catalog':
      return {
        mode: 'roleplay-profile',
        screen: 'region-catalog',
        title: 'Homeland',
        prompt: 'Choose the region your character comes from.',
        inputKind: 'choice',
        persistence: 'draft',
        page: { index: 0, count: 1, totalItems: regionChoices.length },
        choices: regionChoices.map(([id, label, wireValue, mediaKey, language]) => ({
          id,
          label,
          wireValue,
          enabled: true,
          mediaKey,
          facts: [{ label: 'Language', value: language }],
        })),
        controlWire: { cancel: 'quit' },
        actions: ['select', 'detail', 'cancel', 'classic-terminal'],
      };
    case 'region-confirm': {
      const pending = session.pendingChoice ?? {
        id: 'region/1',
        label: 'Ashenport Coast',
        mediaKey: 'region/ashenport',
        summary: 'A trade coast whose people learn to read both ledgers and tides.',
      };
      return {
        mode: 'roleplay-profile',
        screen: 'region-confirm',
        title: 'Confirm this homeland',
        prompt: 'This choice is permanent.',
        inputKind: 'confirm',
        persistence: 'draft',
        detail: {
          ...pending,
          facts: [{ label: 'Language', value: pending.language ?? 'Trade Tongue' }],
          irreversibleWarning: 'A homeland cannot be changed here after it is saved.',
        },
        controlWire: { confirm: 'y', reselect: 'n' },
        actions: ['confirm', 'reselect', 'classic-terminal'],
      };
    }
    case 'faction-select':
      return {
        mode: 'roleplay-profile',
        screen: 'faction-select',
        title: 'Faction',
        prompt: 'Choose an allegiance, or remain unaffiliated.',
        inputKind: 'choice',
        persistence: 'draft',
        page: { index: 0, count: 1, totalItems: factionChoices.length },
        choices: factionChoices.map(([id, label, wireValue, mediaKey]) => ({
          id,
          label,
          wireValue,
          enabled: true,
          mediaKey,
          description:
            label === 'Lantern Wardens'
              ? 'A runtime faction invented for this synthetic server.'
              : 'Choose your own allies without joining a faction.',
        })),
        controlWire: { cancel: 'quit' },
        actions: ['select', 'detail', 'cancel', 'classic-terminal'],
      };
    case 'hometown-select':
      return {
        mode: 'roleplay-profile',
        screen: 'hometown-select',
        title: 'Hometown',
        prompt: 'Choose where your character calls home.',
        inputKind: 'choice',
        persistence: 'draft',
        page: { index: 0, count: 1, totalItems: hometownChoices.length },
        choices: hometownChoices.map(([id, label, wireValue, mediaKey]) => ({
          id,
          label,
          wireValue,
          enabled: true,
          mediaKey,
        })),
        controlWire: { cancel: 'quit' },
        actions: ['select', 'detail', 'cancel', 'classic-terminal'],
      };
    case 'deity-select':
      return {
        mode: 'roleplay-profile',
        screen: 'deity-select',
        title: 'Deity',
        prompt: 'Choose a deity to follow, or none.',
        inputKind: 'choice',
        persistence: 'draft',
        page: { index: 0, count: 1, totalItems: deityChoices.length },
        choices: deityChoices.map(([id, label, wireValue, mediaKey, summary]) => ({
          id,
          label,
          wireValue,
          enabled: true,
          mediaKey,
          summary,
        })),
        controlWire: { cancel: 'quit' },
        actions: ['select', 'detail', 'cancel', 'classic-terminal'],
      };
    case 'deity-confirm': {
      const pending = session.pendingChoice ?? {
        id: 'deity/1',
        label: 'Aethyra',
        mediaKey: 'deity/aethyra',
        summary: 'Light, safe passage, and honest witness.',
      };
      return {
        mode: 'roleplay-profile',
        screen: 'deity-confirm',
        title: 'Confirm this deity',
        prompt: 'This choice is permanent.',
        inputKind: 'confirm',
        persistence: 'draft',
        detail: {
          ...pending,
          facts: [
            { label: 'Alignment', value: 'Neutral Good' },
            { label: 'Portfolio', value: pending.summary },
          ],
          irreversibleWarning: 'This spiritual choice cannot be changed here after it is saved.',
        },
        controlWire: { confirm: 'y', reselect: 'n' },
        actions: ['confirm', 'reselect', 'classic-terminal'],
      };
    }
    case 'play':
      return {
        mode: 'play',
        screen: 'handoff',
        title: 'In the world',
        prompt: '',
        inputKind: 'none',
        persistence: 'saved',
        actions: [],
      };
    default:
      return screenFor('account-name', session);
  }
}

const order = [
  'account-name',
  'account-password',
  'account-menu',
  'account-link',
  'name',
  'name-confirm',
  'sex',
  'race',
  'class',
  'build',
  'alignment',
  'preferences',
  'roleplay-decision',
  'motd',
  'play',
];

function stripControl(value) {
  let out = '';
  for (const character of value ?? '') {
    if (character.charCodeAt(0) > 31) {
      out += character;
    }
  }
  return out;
}

/**
 * Return the prefix that contains only complete Telnet controls.
 *
 * TCP and TLS are byte streams: either can split the IAC byte from its command,
 * the option from a negotiation, or an MSDP subnegotiation from its IAC SE.
 * Keep the incomplete suffix for the next read instead of treating transport
 * chunk boundaries as protocol boundaries.
 */
function completeTelnetPrefixLength(buffer) {
  let index = 0;
  while (index < buffer.length) {
    if (buffer[index] !== IAC) {
      index += 1;
      continue;
    }
    if (index + 1 >= buffer.length) {
      return index;
    }

    const command = buffer[index + 1];
    if (command === IAC) {
      index += 2;
      continue;
    }
    if (command === SB) {
      if (index + 2 >= buffer.length) {
        return index;
      }
      let terminator = index + 3;
      while (
        terminator + 1 < buffer.length &&
        !(buffer[terminator] === IAC && buffer[terminator + 1] === SE)
      ) {
        terminator += 1;
      }
      if (terminator + 1 >= buffer.length) {
        return index;
      }
      index = terminator + 2;
      continue;
    }
    if (command >= WILL && command <= 254) {
      if (index + 2 >= buffer.length) {
        return index;
      }
      index += 3;
      continue;
    }

    index += 2;
  }
  return buffer.length;
}

function msdpPair(variable, value) {
  return Buffer.concat([
    Buffer.from([IAC, SB, TELOPT_MSDP, MSDP_VAR]),
    Buffer.from(variable, 'utf8'),
    Buffer.from([MSDP_VAL]),
    Buffer.from(value, 'utf8'),
    Buffer.from([IAC, SE]),
  ]);
}

const server = net.createServer((socket) => {
  const session = {
    step: 'account-name',
    revision: 0,
    flowId: `synthetic-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    selection: {},
    capable: false,
    version: 1,
    /** Invented profile content, held per-session only. */
    profile: {},
    profileReturnStep: 'motd',
    contentRevisions: {},
    ideaExamples: {},
    shortDraft: {},
    pendingChoice: null,
    editorField: null,
    transfers: new Map(),
  };

  const emit = () => {
    if (!session.capable) {
      return;
    }
    session.revision += 1;
    const base = screenFor(session.step, session);
    let outbound = null;
    if (base.editor && base.editor.empty === false) {
      const content = session.profile[base.editor.fieldId];
      const bytes = Buffer.from(content, 'utf8');
      const chunks = [];
      for (let offset = 0; offset < bytes.length; offset += 6_144) {
        chunks.push(bytes.subarray(offset, offset + 6_144).toString('base64'));
      }
      const digest = createHash('sha256').update(bytes).digest('hex');
      const transferId =
        `synthetic-source-${session.revision}-${base.editor.fieldId}-` +
        `${base.editor.contentRevision}`;
      base.editor = {
        ...base.editor,
        empty: false,
        transferId,
        totalBytes: bytes.length,
        chunkCount: chunks.length,
        digest,
      };
      outbound = { chunks, digest, fieldId: base.editor.fieldId, transferId };
    }
    const payload = JSON.stringify({
      version: session.version,
      flowId: session.flowId,
      revision: session.revision,
      sensitiveInput: false,
      choices: [],
      characters: [],
      selection: session.selection,
      ...base,
    });
    socket.write(msdpPair('LUMINARI_ONBOARDING', payload));

    if (outbound) {
      socket.write(
        msdpPair(
          'LUMINARI_ONBOARDING_CONTENT',
          JSON.stringify({
            v: 2,
            phase: 'begin',
            flowId: session.flowId,
            revision: session.revision,
            fieldId: outbound.fieldId,
            transferId: outbound.transferId,
            totalBytes: Buffer.byteLength(session.profile[outbound.fieldId], 'utf8'),
            chunkCount: outbound.chunks.length,
            digest: outbound.digest,
          }),
        ),
      );
      for (const [index, data] of outbound.chunks.entries()) {
        socket.write(
          msdpPair(
            'LUMINARI_ONBOARDING_CONTENT',
            JSON.stringify({
              phase: 'chunk',
              transferId: outbound.transferId,
              index,
              data,
            }),
          ),
        );
      }
      socket.write(
        msdpPair(
          'LUMINARI_ONBOARDING_CONTENT',
          JSON.stringify({ phase: 'commit', transferId: outbound.transferId }),
        ),
      );
    }

    // Mirror the MUD's Telnet ECHO behaviour on password prompts.
    socket.write(Buffer.from([IAC, base.sensitiveInput ? WILL : WONT, TELOPT_ECHO]));
  };

  /**
   * Receive a bounded editor transfer on the reserved v2 action variable.
   *
   * Mirrors what the real source must do: assemble in session-local memory,
   * verify the whole transfer, and only then treat the content as a commit.
   * A partial or mismatched transfer must never become a save.
   */
  const handleEditorAction = (raw) => {
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return;
    }

    if (
      envelope.action === 'cancel-editor' &&
      envelope.phase === 'cancel' &&
      envelope.v === 2 &&
      envelope.flowId === session.flowId &&
      envelope.revision === session.revision &&
      envelope.fieldId === session.editorField
    ) {
      session.transfers.clear();
      session.step = 'roleplay-hub';
      session.editorField = null;
      emit();
      return;
    }

    if (envelope.phase === 'begin') {
      const fieldDefinition = Object.values(roleplayTextFields).find(
        (definition) => definition.fieldId === session.editorField,
      );
      if (
        envelope.v !== 2 ||
        envelope.action !== 'save-text' ||
        envelope.flowId !== session.flowId ||
        envelope.revision !== session.revision ||
        envelope.fieldId !== session.editorField ||
        typeof envelope.transferId !== 'string' ||
        !/^[A-Za-z0-9_.:/-]{1,120}$/.test(envelope.transferId) ||
        !Number.isInteger(envelope.totalBytes) ||
        envelope.totalBytes < 0 ||
        envelope.totalBytes > (fieldDefinition?.maxBytes ?? 0) ||
        !Number.isInteger(envelope.chunkCount) ||
        envelope.chunkCount !== Math.ceil(envelope.totalBytes / 6_144) ||
        typeof envelope.digest !== 'string' ||
        !/^[0-9a-f]{64}$/.test(envelope.digest) ||
        session.transfers.size > 0
      ) {
        return;
      }
      session.transfers.set(envelope.transferId, {
        fieldId: envelope.fieldId,
        totalBytes: envelope.totalBytes,
        chunkCount: envelope.chunkCount,
        digest: envelope.digest,
        receivedBytes: 0,
        chunks: [],
      });
      return;
    }

    const transfer = session.transfers.get(envelope.transferId);
    if (!transfer) {
      return;
    }

    if (envelope.phase === 'chunk') {
      if (
        envelope.index !== transfer.chunks.length ||
        typeof envelope.data !== 'string' ||
        envelope.data.length === 0 ||
        envelope.data.length > 8_192 ||
        envelope.data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.data)
      ) {
        // Out of order: drop the whole transfer rather than reassemble it.
        session.transfers.delete(envelope.transferId);
        return;
      }
      const decoded = Buffer.from(envelope.data, 'base64');
      const expectedBytes =
        envelope.index < transfer.chunkCount - 1
          ? 6_144
          : transfer.totalBytes - 6_144 * (transfer.chunkCount - 1);
      if (
        decoded.toString('base64') !== envelope.data ||
        decoded.length !== expectedBytes ||
        transfer.receivedBytes + decoded.length > transfer.totalBytes
      ) {
        session.transfers.delete(envelope.transferId);
        return;
      }
      transfer.receivedBytes += decoded.length;
      transfer.chunks.push(envelope.data);
      return;
    }

    if (envelope.phase === 'commit') {
      session.transfers.delete(envelope.transferId);
      if (transfer.chunks.length !== transfer.chunkCount) {
        return;
      }

      const content = Buffer.concat(
        transfer.chunks.map((chunk) => Buffer.from(chunk, 'base64')),
      ).toString('utf8');

      if (Buffer.byteLength(content, 'utf8') !== transfer.totalBytes) {
        return;
      }
      if (
        createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex') !== transfer.digest
      ) {
        return;
      }
      if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(content)) {
        return;
      }

      session.profile[transfer.fieldId] = content.replace(/\r\n?/g, '\n').replaceAll('~', ' ');
      session.contentRevisions[transfer.fieldId] =
        (session.contentRevisions[transfer.fieldId] ?? 0) + 1;
      session.profile.lastSaved = transfer.fieldId;
      session.step = 'roleplay-hub';
      session.editorField = null;
      emit();
    }
  };

  const advance = (line) => {
    const index = order.indexOf(session.step);
    const trimmed = line.trim();

    if (session.step === 'account-menu') {
      if (trimmed.toLowerCase() === 'c') {
        session.step = 'name';
      } else if (trimmed.toLowerCase() === 'a') {
        session.step = 'account-link';
      } else if (trimmed === '1' || trimmed === '2') {
        session.selection =
          trimmed === '1'
            ? {
                name: 'Aelwyn',
                sex: 'Female',
                race: 'Moon Elf',
                raceMediaKey: 'race/moon-elf',
                className: 'Wizard',
                classMediaKey: 'class/wizard',
                alignment: 'Neutral Good',
              }
            : {
                name: 'Bordrek',
                sex: 'Male',
                race: 'Mountain Dwarf',
                raceMediaKey: 'race/mountain-dwarf',
                className: 'Warrior',
                classMediaKey: 'class/warrior',
                alignment: 'Lawful Neutral',
              };
        // Bordrek is the invented fixture for the required introduction gate.
        // Aelwyn exercises the ordinary optional profile entry.
        session.profile.forcedShortDesc = trimmed === '2';
        session.step = 'character-menu';
      } else {
        emit();
        return;
      }
      emit();
      return;
    }

    if (session.step === 'account-link') {
      session.step = 'account-menu';
      emit();
      return;
    }

    if (session.step === 'character-menu') {
      if (trimmed === '0') {
        session.selection = {};
        session.step = 'account-menu';
      } else if (trimmed === '1') {
        session.step = session.profile.forcedShortDesc ? 'short-desc-intro' : 'play';
      } else if (trimmed === '2' && session.version >= 2) {
        session.profileReturnStep = 'character-menu';
        session.step = 'roleplay-hub';
      } else {
        emit();
        return;
      }
      emit();
      return;
    }

    if (session.step === 'roleplay-decision') {
      if (trimmed === '2') {
        if (session.version >= 2) {
          // v2 keeps the player in the structured suite.
          session.profileReturnStep = 'motd';
          session.step = 'roleplay-hub';
        } else {
          // v1 deliberately hands off to the classic terminal.
          socket.write('\r\nCHARACTER OPTIONS MENU\r\nChoose the role-play details to edit.\r\n');
          session.step = 'play';
        }
      } else if (trimmed === '1' || trimmed === '3') {
        session.step = 'motd';
      } else {
        emit();
        return;
      }
      emit();
      return;
    }

    // --- protocol v2: role-play identity suite ---------------------------

    if (session.step === 'roleplay-hub') {
      const openings = {
        0: 'short-desc-intro',
        1: 'long-description',
        2: 'background-story',
        3: 'background-catalog',
        4: 'goals-ideas',
        5: 'personality-ideas',
        6: 'ideals-ideas',
        7: 'bonds-ideas',
        8: 'flaws-ideas',
        9: 'age-select',
        a: 'region-catalog',
        b: 'faction-select',
        c: 'hometown-select',
        d: 'deity-select',
      };
      if (trimmed === 'q') {
        session.step = session.profileReturnStep;
      } else if (openings[trimmed]) {
        session.step = openings[trimmed];
        session.pendingChoice = null;
        if (roleplayTextFields[session.step]) {
          session.editorField = roleplayTextFields[session.step].fieldId;
        } else {
          session.editorField = null;
        }
        if (session.step === 'short-desc-intro') {
          session.shortDraft = {};
        }
      } else {
        emit();
        return;
      }
      emit();
      return;
    }

    if (roleplayTextFields[session.step]) {
      // Only cancel arrives as a line here; saves use the editor transfer path.
      session.step = 'roleplay-hub';
      session.editorField = null;
      emit();
      return;
    }

    if (ideaFields[session.step]) {
      const definition = ideaFields[session.step];

      if (trimmed === '0') {
        session.step = 'roleplay-hub';
      } else if (trimmed.toLowerCase() === 'q') {
        session.step = `${definition.fieldId}-editor`;
        session.editorField = definition.fieldId;
      } else if (
        (definition.fieldId === 'goals' && trimmed === '1') ||
        (definition.fieldId !== 'goals' &&
          ideaThemes.some((choice) => choice.wireValue === trimmed))
      ) {
        session.ideaExamples[definition.fieldId] = defaultIdeaExamples[definition.fieldId];
        emit();
        return;
      } else {
        emit();
        return;
      }
      emit();
      return;
    }

    if (session.step === 'background-catalog') {
      if (trimmed.toLowerCase() === 'quit') {
        session.step = 'roleplay-hub';
      } else if (trimmed === '__onboarding-next__') {
        session.profile.backgroundPage = 1;
      } else if (trimmed === '__onboarding-previous__') {
        session.profile.backgroundPage = 0;
      } else {
        const choice = screenFor('background-catalog', session).choices.find(
          (entry) => entry.wireValue === trimmed,
        );
        if (!choice) {
          emit();
          return;
        }
        session.pendingChoice = {
          id: choice.id,
          label: choice.label,
          mediaKey: choice.mediaKey,
          summary: choice.summary,
        };
        session.step = 'background-confirm';
      }
      emit();
      return;
    }

    if (session.step === 'background-confirm') {
      if (trimmed.toLowerCase() === 'y') {
        // One-time choice: the hub reports it locked from here on.
        session.profile.background = session.pendingChoice?.label ?? 'Lamplighter';
        session.profile.lastSaved = 'background';
        session.step = 'roleplay-hub';
      } else {
        session.step = 'background-catalog';
      }
      emit();
      return;
    }

    if (session.step === 'short-desc-intro') {
      if (trimmed === '0' && !session.profile.forcedShortDesc) {
        session.step = 'roleplay-hub';
      } else {
        session.step = 'short-desc-feature-1';
      }
      emit();
      return;
    }

    if (session.step === 'short-desc-feature-1') {
      const feature = screenFor(session.step, session).choices.find(
        (entry) => entry.wireValue === trimmed,
      );
      if (!feature) {
        emit();
        return;
      }
      session.shortDraft.feature1 = feature.label;
      session.step = 'short-desc-adjective-1';
      emit();
      return;
    }

    if (session.step === 'short-desc-adjective-1') {
      const adjective = screenFor(session.step, session).choices.find(
        (entry) => entry.wireValue === trimmed,
      );
      if (!adjective) {
        emit();
        return;
      }
      session.shortDraft.adjective1 = adjective.label;
      session.shortDraft.preview = `a traveller with ${adjective.label} ${(
        session.shortDraft.feature1 ?? 'eyes'
      ).toLowerCase()}`;
      session.step = 'short-desc-preview';
      emit();
      return;
    }

    if (session.step === 'short-desc-feature-2') {
      const feature = screenFor(session.step, session).choices.find(
        (entry) => entry.wireValue === trimmed,
      );
      if (!feature) {
        emit();
        return;
      }
      session.shortDraft.feature2 = feature.label;
      session.step = 'short-desc-adjective-2';
      emit();
      return;
    }

    if (session.step === 'short-desc-adjective-2') {
      const adjective = screenFor(session.step, session).choices.find(
        (entry) => entry.wireValue === trimmed,
      );
      if (!adjective) {
        emit();
        return;
      }
      session.shortDraft.adjective2 = adjective.label;
      session.shortDraft.second = true;
      session.shortDraft.preview =
        `${session.shortDraft.preview ?? 'a traveller'}, with ${adjective.label} ` +
        `${(session.shortDraft.feature2 ?? 'hair').toLowerCase()}`;
      session.step = 'short-desc-preview';
      emit();
      return;
    }

    if (session.step === 'short-desc-preview') {
      session.step = 'short-desc-review';
      emit();
      return;
    }

    if (session.step === 'short-desc-review') {
      if (trimmed === '1') {
        session.profile.shortDesc =
          session.shortDraft.preview ?? 'a traveller with storm-grey eyes';
        session.profile.lastSaved = 'short-description';
        if (session.profile.forcedShortDesc) {
          // A forced description persists, then enters the world directly.
          session.profile.forcedShortDesc = false;
          session.step = 'play';
        } else {
          session.step = 'roleplay-hub';
        }
      } else if (trimmed === '0' && !session.profile.forcedShortDesc) {
        session.step = 'roleplay-hub';
      } else if (trimmed === '3' && !session.shortDraft.second) {
        session.step = 'short-desc-feature-2';
      } else {
        session.shortDraft = {};
        session.step = 'short-desc-intro';
      }
      emit();
      return;
    }

    if (session.step === 'age-select') {
      if (trimmed.toLowerCase() === 'quit') {
        session.step = 'roleplay-hub';
      } else {
        const choice = ageChoices.find(([, , wireValue]) => wireValue === trimmed);
        if (!choice) {
          emit();
          return;
        }
        session.profile.age = choice[1];
        session.profile.ageMediaKey = choice[3];
        session.profile.lastSaved = 'age';
        session.step = 'roleplay-hub';
      }
      emit();
      return;
    }

    if (session.step === 'region-catalog') {
      if (trimmed.toLowerCase() === 'quit') {
        session.step = 'roleplay-hub';
      } else {
        const choice = regionChoices.find(([, , wireValue]) => wireValue === trimmed);
        if (!choice) {
          emit();
          return;
        }
        session.pendingChoice = {
          id: choice[0],
          label: choice[1],
          mediaKey: choice[3],
          language: choice[4],
        };
        session.step = 'region-confirm';
      }
      emit();
      return;
    }

    if (session.step === 'region-confirm') {
      if (trimmed.toLowerCase() === 'y') {
        session.profile.region = session.pendingChoice?.label ?? 'Ashenport Coast';
        session.profile.regionMediaKey = session.pendingChoice?.mediaKey ?? 'region/fallback';
        session.profile.lastSaved = 'region';
        session.step = 'roleplay-hub';
      } else {
        session.pendingChoice = null;
        session.step = 'region-catalog';
      }
      emit();
      return;
    }

    if (session.step === 'faction-select') {
      if (trimmed.toLowerCase() === 'quit') {
        session.step = 'roleplay-hub';
        emit();
        return;
      }
      const choice = factionChoices.find(([, , wireValue]) => wireValue === trimmed);
      if (!choice) {
        emit();
        return;
      }
      session.profile.faction = choice[1];
      session.profile.factionMediaKey = choice[3];
      session.profile.lastSaved = 'faction';
      session.step = 'roleplay-hub';
      emit();
      return;
    }

    if (session.step === 'hometown-select') {
      if (trimmed.toLowerCase() === 'quit') {
        session.step = 'roleplay-hub';
        emit();
        return;
      }
      const choice = hometownChoices.find(([, , wireValue]) => wireValue === trimmed);
      if (!choice) {
        emit();
        return;
      }
      session.profile.hometown = choice[1];
      session.profile.hometownMediaKey = choice[3];
      session.profile.lastSaved = 'hometown';
      session.step = 'roleplay-hub';
      emit();
      return;
    }

    if (session.step === 'deity-select') {
      if (trimmed.toLowerCase() === 'quit') {
        session.step = 'roleplay-hub';
      } else {
        const choice = deityChoices.find(([, , wireValue]) => wireValue === trimmed);
        if (!choice) {
          emit();
          return;
        }
        session.pendingChoice = {
          id: choice[0],
          label: choice[1],
          mediaKey: choice[3],
          summary: choice[4],
        };
        session.step = 'deity-confirm';
      }
      emit();
      return;
    }

    if (session.step === 'deity-confirm') {
      if (trimmed.toLowerCase() === 'y') {
        session.profile.deity = session.pendingChoice?.label ?? 'None';
        session.profile.deityMediaKey = session.pendingChoice?.mediaKey ?? 'deity/fallback';
        session.profile.lastSaved = 'deity';
        session.step = 'roleplay-hub';
      } else {
        session.pendingChoice = null;
        session.step = 'deity-select';
      }
      emit();
      return;
    }

    if (session.step === 'motd') {
      session.step = 'play';
      emit();
      return;
    }

    if (session.step === 'name') {
      session.selection = { ...session.selection, name: trimmed };
    }
    if (session.step === 'sex') {
      session.selection = {
        ...session.selection,
        sex: trimmed.toLowerCase().startsWith('f') ? 'Female' : 'Male',
      };
    }
    if (session.step === 'race') {
      const race = races.find(([, label]) => label.toLowerCase() === trimmed.toLowerCase());
      if (race) {
        session.selection = { ...session.selection, race: race[1], raceMediaKey: race[2] };
      }
    }
    if (session.step === 'class') {
      const chosen = classes.find(([, label]) => label.toLowerCase() === trimmed.toLowerCase());
      if (chosen) {
        session.selection = {
          ...session.selection,
          className: chosen[1],
          classMediaKey: chosen[2],
        };
      }
    }
    if (session.step === 'build') {
      const build = trimmed.toLowerCase();
      if (build !== 'premade' && build !== 'custom') {
        emit();
        return;
      }
      session.selection = {
        ...session.selection,
        build: build === 'premade' ? 'Guided' : 'Custom',
      };
    }
    if (session.step === 'alignment') {
      const chosen = alignments.find(([, , wire]) => wire === trimmed);
      if (chosen) {
        session.selection = { ...session.selection, alignment: chosen[1] };
      }
    }

    session.step = order[Math.min(index + 1, order.length - 1)];
    emit();
  };

  socket.write(Buffer.from([IAC, WILL, TELOPT_MSDP]));
  socket.write('Welcome to the synthetic Luminari onboarding server.\r\n');

  let text = '';
  let pending = Buffer.alloc(0);

  socket.on('data', (incoming) => {
    /*
     * Buffer across reads before parsing. Protocol v2 editor chunks are ~8 KB
     * of base64, so one subnegotiation reliably spans several TCP segments;
     * parsing a single read in isolation would silently drop them.
     */
    pending = pending.length === 0 ? incoming : Buffer.concat([pending, incoming]);

    const completeLength = completeTelnetPrefixLength(pending);
    if (completeLength === 0) {
      return;
    }
    const chunk = pending.subarray(0, completeLength);
    pending = pending.subarray(completeLength);

    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] === IAC) {
        if (chunk[index + 1] === IAC) {
          text += String.fromCharCode(IAC);
          index += 1;
          continue;
        }
        // Skip the negotiation or subnegotiation that follows.
        if (chunk[index + 1] === SB) {
          const payloadStart = index + 3;
          let end = payloadStart;
          while (end < chunk.length && !(chunk[end] === IAC && chunk[end + 1] === SE)) {
            end += 1;
          }
          const payload = chunk.subarray(payloadStart, end).toString('utf8');
          const [variable, value] = payload.split(String.fromCharCode(MSDP_VAL));
          const variableName = stripControl(variable);
          if (variableName === 'LUMINARI_ONBOARDING_VERSION') {
            session.capable = value?.trim() === '1';
            if (session.capable) {
              emit();
            }
          } else if (variableName === 'LUMINARI_ONBOARDING_ACTION') {
            handleEditorAction(value ?? '');
          } else if (variableName === 'LUMINARI_ONBOARDING_VERSIONS') {
            // Protocol v2 negotiation: pick the highest version both sides
            // speak. An old client never sends this, so v1 is unaffected.
            const offered = (value ?? '')
              .split(',')
              .map((entry) => Number.parseInt(entry.trim(), 10))
              .filter((entry) => Number.isInteger(entry));
            if (offered.includes(2)) {
              session.version = 2;
              session.capable = true;
              emit();
            }
          }
          index = end + 1;
          continue;
        }
        index += chunk[index + 1] >= WILL && chunk[index + 1] <= 254 ? 2 : 1;
        continue;
      }

      const byte = chunk[index];
      if (byte === 10) {
        const line = text;
        text = '';
        advance(line);
        continue;
      }
      if (byte !== 13) {
        text += String.fromCharCode(byte);
      }
    }
  });

  socket.on('error', () => undefined);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Synthetic onboarding MUD listening on 127.0.0.1:${port}\n`);
});
