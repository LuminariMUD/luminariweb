import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALIASES_COOKIE_NAME,
  CLIENT_CONFIG_STORAGE_KEY,
  CLIENT_CONFIG_TYPE,
  CLIENT_CONFIG_VERSION,
  CLIENT_SETTINGS_COOKIE_NAME,
  DEFAULT_CLIENT_CONFIG_STATE,
  DEFAULT_CLIENT_SETTINGS,
  TRIGGERS_COOKIE_NAME,
  buildClientConfigPayload,
  parseClientConfigImport,
  parseLegacyClientConfigFromCookieHeader,
  parseStoredClientConfigJson,
  readLegacyChunkedCookie,
  serializeClientConfigPayload,
} from '../shared/client-config-persistence.ts';
import type { ClientConfigState } from '../shared/client-config-persistence.ts';

const currentState: ClientConfigState = {
  settings: {
    ...DEFAULT_CLIENT_SETTINGS,
    terminal: {
      ...DEFAULT_CLIENT_SETTINGS.terminal,
      fontSize: 18,
    },
  },
  aliases: [{ id: 'alias-current', pattern: 'l', expansion: 'look', enabled: true }],
  triggers: [{ id: 'trigger-current', pattern: 'Welcome', action: 'look', enabled: false }],
};

test('builds and parses valid versioned client config payloads', () => {
  const payload = buildClientConfigPayload(currentState);
  assert.equal(payload.type, CLIENT_CONFIG_TYPE);
  assert.equal(payload.version, CLIENT_CONFIG_VERSION);

  const parsed = parseStoredClientConfigJson(serializeClientConfigPayload(currentState));
  assert.equal(parsed.settings.terminal.fontSize, 18);
  assert.deepEqual(parsed.aliases, currentState.aliases);
  assert.deepEqual(parsed.triggers, currentState.triggers);
});

test('falls back to defaults for missing, corrupt, and future-version storage payloads', () => {
  assert.deepEqual(parseStoredClientConfigJson(null), DEFAULT_CLIENT_CONFIG_STATE);
  assert.deepEqual(parseStoredClientConfigJson('not json'), DEFAULT_CLIENT_CONFIG_STATE);
  assert.deepEqual(
    parseStoredClientConfigJson(
      JSON.stringify({
        type: CLIENT_CONFIG_TYPE,
        version: CLIENT_CONFIG_VERSION + 1,
        settings: currentState.settings,
        aliases: currentState.aliases,
        triggers: currentState.triggers,
      }),
    ),
    DEFAULT_CLIENT_CONFIG_STATE,
  );
});

test('normalizes full config imports before returning replacement state', () => {
  const imported = parseClientConfigImport(
    JSON.stringify({
      type: CLIENT_CONFIG_TYPE,
      version: CLIENT_CONFIG_VERSION,
      settings: {
        terminal: {
          fontSize: 99,
          lineHeight: 1.4,
          autoScroll: false,
          wrapLines: false,
        },
      },
      aliases: [{ id: 'alias-new', pattern: 'k *', expansion: 'kill %1', enabled: true }],
      triggers: [{ id: 'trigger-new', pattern: '* arrives', action: 'look', enabled: true }],
    }),
    currentState,
  );

  assert.equal(imported.settings.terminal.fontSize, 32);
  assert.equal(imported.settings.terminal.autoScroll, false);
  assert.equal(imported.aliases[0]?.id, 'alias-new');
  assert.equal(imported.triggers[0]?.id, 'trigger-new');
});

test('preserves current state when partial alias and trigger imports are valid', () => {
  const aliasImport = parseClientConfigImport(
    JSON.stringify({
      type: 'luminari-web-client-aliases',
      aliases: [{ id: 'alias-imported', pattern: 'score', expansion: 'score', enabled: true }],
    }),
    currentState,
  );
  assert.deepEqual(aliasImport.settings, currentState.settings);
  assert.equal(aliasImport.aliases[0]?.id, 'alias-imported');
  assert.deepEqual(aliasImport.triggers, currentState.triggers);

  const triggerImport = parseClientConfigImport(
    JSON.stringify({
      type: 'luminari-web-client-triggers',
      triggers: [{ id: 'trigger-imported', pattern: 'hungry', action: 'eat bread', enabled: true }],
    }),
    currentState,
  );
  assert.deepEqual(triggerImport.settings, currentState.settings);
  assert.deepEqual(triggerImport.aliases, currentState.aliases);
  assert.equal(triggerImport.triggers[0]?.id, 'trigger-imported');
});

test('rejects malformed imports without producing partial replacement state', () => {
  assert.throws(
    () => parseClientConfigImport('not json', currentState),
    /Configuration file is not valid JSON/,
  );

  assert.throws(
    () =>
      parseClientConfigImport(
        JSON.stringify({
          type: CLIENT_CONFIG_TYPE,
          version: CLIENT_CONFIG_VERSION,
          settings: currentState.settings,
          aliases: [{ id: 'alias-ok', pattern: 'l', expansion: 'look', enabled: true }],
          triggers: [{ id: 'trigger-bad', pattern: 'tells you', action: 'reply %1' }],
        }),
        currentState,
      ),
    /Trigger 1: %1 has no matching wildcard capture/,
  );

  assert.throws(
    () =>
      parseClientConfigImport(
        JSON.stringify({
          type: CLIENT_CONFIG_TYPE,
          version: CLIENT_CONFIG_VERSION + 1,
          settings: currentState.settings,
          aliases: currentState.aliases,
          triggers: currentState.triggers,
        }),
        currentState,
      ),
    /not supported/,
  );
});

test('reads legacy chunked cookies as migration inputs', () => {
  const rawAliases = JSON.stringify([
    { id: 'alias-cookie', pattern: 'buff *', expansion: 'cast armor %1', enabled: true },
  ]);
  const encodedAliases = encodeURIComponent(rawAliases);
  const splitAt = Math.floor(encodedAliases.length / 2);
  const cookieHeader = [
    `${ALIASES_COOKIE_NAME}.count=2`,
    `${ALIASES_COOKIE_NAME}.0=${encodedAliases.slice(0, splitAt)}`,
    `${ALIASES_COOKIE_NAME}.1=${encodedAliases.slice(splitAt)}`,
  ].join('; ');

  assert.equal(readLegacyChunkedCookie(cookieHeader, ALIASES_COOKIE_NAME), rawAliases);
});

test('migrates valid legacy cookie groups and reports malformed groups without clearing them', () => {
  const settings = encodeURIComponent(JSON.stringify(currentState.settings));
  const triggers = encodeURIComponent(JSON.stringify(currentState.triggers));
  const cookieHeader = [
    `${CLIENT_SETTINGS_COOKIE_NAME}=${settings}`,
    `${ALIASES_COOKIE_NAME}=bad-json`,
    `${TRIGGERS_COOKIE_NAME}=${triggers}`,
  ].join('; ');

  const migration = parseLegacyClientConfigFromCookieHeader(cookieHeader);
  assert.ok(migration);
  assert.deepEqual(migration.migratedCookieNames, [
    CLIENT_SETTINGS_COOKIE_NAME,
    TRIGGERS_COOKIE_NAME,
  ]);
  assert.equal(
    migration.payload.settings.terminal.fontSize,
    currentState.settings.terminal.fontSize,
  );
  assert.deepEqual(migration.payload.aliases, []);
  assert.deepEqual(migration.payload.triggers, currentState.triggers);
  assert.deepEqual(migration.issues, ['Legacy aliases cookie could not be migrated.']);
});

test('exports the configured localStorage key as a stable browser contract', () => {
  assert.equal(CLIENT_CONFIG_STORAGE_KEY, 'lwc.config');
});
