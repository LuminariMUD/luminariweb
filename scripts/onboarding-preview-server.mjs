#!/usr/bin/env node
/**
 * Onboarding preview server (development only).
 *
 * Stands in for the WebSocket proxy so the structured onboarding UI can be
 * designed, reviewed, and screenshotted without a MUD, a database, or any real
 * account data. It speaks the same `/ws` message contract the real proxy does
 * and replays a scripted flow made entirely of invented values.
 *
 * This is a design and QA harness. It performs no authentication and must
 * never be exposed outside a developer machine.
 *
 * Usage: node scripts/onboarding-preview-server.mjs
 * Then run `npm run dev:client` and open the Vite dev server.
 */

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { appSettings } from '../shared/app-settings.ts';
import { characterMenuChoiceIds } from '../shared/onboarding.ts';

const port = appSettings.ports.server;

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
  ['goliath', 'Goliath', 'race/goliath', 'Mountain-born endurance and unhurried strength.'],
  ['aasimar', 'Aasimar', 'race/aasimar', 'Celestial heritage carried lightly.'],
];

const classes = [
  ['wizard', 'Wizard', 'class/wizard', 'Studied arcane mastery and deliberate control.', 'd4'],
  ['cleric', 'Cleric', 'class/cleric', 'Divine channeling in service of a cause.', 'd8'],
  ['rogue', 'Rogue', 'class/rogue', 'Skill, mobility, tools, and opportunism.', 'd6'],
  ['warrior', 'Warrior', 'class/warrior', 'Broad mastery of weapons and armour.', 'd10'],
  ['ranger', 'Ranger', 'class/ranger', 'Tracking, wilderness craft, and flexible combat.', 'd8'],
  ['bard', 'Bard', 'class/bard', 'Performance, inspiration, lore, and magic.', 'd6'],
];

const alignments = [
  ['lawful-good', 'Lawful Good', '0'],
  ['neutral-good', 'Neutral Good', '1'],
  ['chaotic-good', 'Chaotic Good', '2'],
  ['lawful-neutral', 'Lawful Neutral', '3'],
  ['true-neutral', 'True Neutral', '4'],
  ['chaotic-neutral', 'Chaotic Neutral', '5'],
  ['lawful-evil', 'Lawful Evil', '6'],
  ['neutral-evil', 'Neutral Evil', '7'],
  ['chaotic-evil', 'Chaotic Evil', '8'],
];

const flow = [
  'account-name',
  'account-password',
  'account-menu',
  'account-link',
  'character-menu',
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

function screenFor(step) {
  switch (step) {
    case 'account-name':
      return {
        mode: 'account',
        screen: 'account-name',
        title: 'Welcome to Luminari',
        prompt: 'Enter your account name, or a new one to create an account.',
        inputKind: 'text',
        inputLabel: 'Account name',
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
        actions: ['submit', 'classic-terminal'],
      };
    case 'account-menu':
      return {
        mode: 'account',
        screen: 'account-menu',
        title: 'Your characters',
        prompt: 'Choose a character to play, or create a new one.',
        inputKind: 'choice',
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
          {
            id: 'Caelrix',
            name: 'Caelrix',
            wireValue: '3',
            level: 60,
            race: 'Human',
            raceMediaKey: 'race/human',
            classSummary:
              'Wizard/Cleric/Rogue/Warrior/Monk/Druid/Berserker/Sorcerer/Paladin/Ranger/Bard',
            status: 'Staff character',
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
        selection: {
          name: 'Aelwyn',
          sex: 'Female',
          race: 'Moon Elf',
          raceMediaKey: 'race/moon-elf',
          className: 'Wizard',
          classMediaKey: 'class/wizard',
          alignment: 'Neutral Good',
        },
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
          description: `${summary} Availability, restrictions, and unlocks are decided by the server.`,
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
          description: summary,
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
    default:
      return {
        mode: 'play',
        screen: 'handoff',
        title: 'In the world',
        prompt: '',
        inputKind: 'none',
        persistence: 'saved',
        actions: [],
      };
  }
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.get('/api/settings', (_request, response) => {
  response.json(appSettings);
});

wss.on('connection', (socket) => {
  const session = {
    index: 0,
    revision: 0,
    flowId: `preview-${Date.now()}`,
    selection: {},
    sensitive: false,
  };

  const send = (message) => socket.send(JSON.stringify(message));

  const emit = () => {
    const base = screenFor(flow[session.index]);
    session.revision += 1;

    const sensitive = base.sensitiveInput === true;
    if (sensitive !== session.sensitive) {
      session.sensitive = sensitive;
      send({ type: 'sensitive-input', sensitive });
    }

    send({
      type: 'onboarding-state',
      phase:
        base.mode === 'account'
          ? 'account'
          : base.mode === 'character-creation'
            ? 'creating'
            : base.mode === 'character-menu'
              ? 'character'
              : 'playing',
      state: {
        version: 1,
        flowId: session.flowId,
        revision: session.revision,
        sensitiveInput: false,
        persistence: 'none',
        choices: [],
        characters: [],
        selection: session.selection,
        ...base,
      },
    });
  };

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }

    if (message.type === 'connect') {
      send({ type: 'connection-status', status: 'connected', detail: 'Preview session ready.' });
      send({ type: 'terminal', text: 'Preview session ready.\r\n' });
      emit();
      return;
    }

    if (message.type === 'disconnect') {
      send({ type: 'connection-status', status: 'disconnected', detail: 'Preview session ended.' });
      return;
    }

    if (message.type !== 'onboarding-action') {
      return;
    }

    if (message.revision !== session.revision) {
      send({
        type: 'onboarding-rejected',
        code: 'stale-revision',
        detail: 'The screen changed before you answered.',
      });
      return;
    }

    const step = flow[session.index];
    if (step === 'account-menu') {
      if (message.action === 'create-character') {
        session.index = flow.indexOf('name');
      } else if (message.action === 'link-character') {
        session.index = flow.indexOf('account-link');
      } else if (message.action === 'select') {
        session.index = flow.indexOf('character-menu');
      } else {
        emit();
        return;
      }
      emit();
      return;
    }
    if (step === 'account-link') {
      session.index = flow.indexOf('account-menu');
      emit();
      return;
    }
    if (step === 'character-menu') {
      if (message.choiceId === characterMenuChoiceIds.accountMenu) {
        session.index = flow.indexOf('account-menu');
      } else if (message.choiceId === characterMenuChoiceIds.enterGame) {
        session.index = flow.indexOf('play');
      } else {
        emit();
        return;
      }
      emit();
      return;
    }
    if (step === 'roleplay-decision') {
      if (message.choiceId === 'roleplayer') {
        send({
          type: 'terminal',
          text: '\r\nCHARACTER OPTIONS MENU\r\nChoose the role-play details to edit.\r\n',
        });
        session.index = flow.indexOf('play');
      } else {
        session.index = flow.indexOf('motd');
      }
      emit();
      return;
    }
    if (step === 'motd') {
      session.index = flow.indexOf('play');
      emit();
      return;
    }

    if (step === 'name' && message.value) {
      session.selection = { ...session.selection, name: message.value };
    }
    if (step === 'sex') {
      session.selection = {
        ...session.selection,
        sex: message.choiceId === 'female' ? 'Female' : 'Male',
      };
    }
    if (step === 'race') {
      const race = races.find(([id]) => id === message.choiceId);
      if (race) {
        session.selection = { ...session.selection, race: race[1], raceMediaKey: race[2] };
      }
    }
    if (step === 'class') {
      const chosen = classes.find(([id]) => id === message.choiceId);
      if (chosen) {
        session.selection = {
          ...session.selection,
          className: chosen[1],
          classMediaKey: chosen[2],
        };
      }
    }
    if (step === 'build') {
      session.selection = {
        ...session.selection,
        build: message.choiceId === 'premade' ? 'Guided' : 'Custom',
      };
    }
    if (step === 'alignment') {
      const chosen = alignments.find(([id]) => `alignment/${id}` === message.choiceId);
      if (chosen) {
        session.selection = { ...session.selection, alignment: chosen[1] };
      }
    }

    if (message.action === 'detail') {
      emit();
      return;
    }

    session.index = Math.min(session.index + 1, flow.length - 1);
    emit();
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Onboarding preview server on http://127.0.0.1:${port}\n`);
});
