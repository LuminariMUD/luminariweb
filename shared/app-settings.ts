export type MudPreset = {
  id: string;
  name: string;
  host: string;
  port: number;
  description?: string;
};

export type AppSettings = {
  ports: {
    client: number;
    server: number;
    preview: number;
  };
  connection: {
    defaultHost: string;
    defaultPort: number;
    muds: MudPreset[];
  };
  personalization: {
    browserTitle: string;
    eyebrow: string;
    title: string;
    subtitle: string;
  };
};

export const appSettings: AppSettings = {
  ports: {
    client: 5190,
    server: 5191,
    preview: 5192,
  },
  connection: {
    defaultHost: 'krynn.d20mud.com',
    defaultPort: 4300,
    muds: [
      {
        id: 'krynn',
        name: 'Chronicles of Krynn',
        host: 'krynn.d20mud.com',
        port: 4300,
        description: 'Post War of the Lance Dragonlance RP and Adventuring.',
      },
      {
        id: 'luminari',
        name: 'LuminariMUD',
        host: 'LuminariMUD.com',
        port: 4100,
        description: 'MUD running the LuminariMUD codebase in the world of Lumia.',
      },
      {
        id: 'faerun',
        name: 'Faerun: A Forgotten Realms MUD',
        host: 'faerun.d20mud.com',
        port: 3100,
        description: 'Forgotten Realms Adventuring in Western Faerun.',
      },
      {
        id: 'starwars',
        name: 'd20MUD: Star Wars',
        host: 'starwars.d20mud.com',
        port: 5500,
        description: 'Galactic Empire Star Wars using d20-based rules.',
      },
    ],
  },
  personalization: {
    browserTitle: 'Luminari Web',
    eyebrow: 'LuminariMUD web client',
    title: 'Luminari Web',
    subtitle: 'A React and Node MUD client with an MSDP-driven HUD and WebSocket-to-Telnet proxy.',
  },
};
