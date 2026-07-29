/**
 * End-to-end check against the synthetic MUD over a real TCP socket.
 *
 * This is the closest thing to a full-stack test that does not need a real
 * Luminari-Source build: a real listener, real Telnet/MSDP framing, a real
 * `MudSession`, and a real chunked editor transfer. It proves the pieces fit
 * together rather than each behaving correctly in isolation.
 *
 * All content here is invented.
 */

import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import { MudSession } from '../server/mud-session.ts';
import { defaultMsdpVariables, normalizeMsdpVariableMap } from '../shared/mud.ts';
import type { ServerMessage } from '../shared/mud.ts';
import { characterMenuChoiceIds, type OnboardingState } from '../shared/onboarding.ts';
import { chunkEditorContent, editorContentDigest } from '../shared/onboarding-transfer.ts';
import {
  createSyntheticMtlsPki,
  startSyntheticMtlsProxy,
  type SyntheticMtlsPki,
  type SyntheticMtlsProxy,
} from './helpers/synthetic-mtls-proxy.ts';

let syntheticMtlsPki: SyntheticMtlsPki;

test.before(() => {
  syntheticMtlsPki = createSyntheticMtlsPki();
});

test.after(() => {
  syntheticMtlsPki.destroy();
});

/** Collects everything the session would have sent to a browser. */
class RecordingBrowserSocket {
  readonly readyState = 1;
  readonly messages: ServerMessage[] = [];

  send(data: string) {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }

  states(): OnboardingState[] {
    return this.messages
      .filter((message) => message.type === 'onboarding-state')
      .map((message) => (message as Extract<ServerMessage, { type: 'onboarding-state' }>).state);
  }

  latest(): OnboardingState | undefined {
    const states = this.states();
    return states[states.length - 1];
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Start the synthetic MUD and wait for it to announce that it is listening.
 *
 * Deliberately not probed by connecting: a throwaway connection is itself a
 * session as far as the fixture server is concerned, and tearing one down
 * immediately is not what this test is here to exercise.
 */
async function startSyntheticMud(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['scripts/synthetic-onboarding-mud.mjs', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('synthetic MUD did not start')), 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`synthetic MUD exited early with code ${code}`));
    });
  });

  return child;
}

async function startSyntheticMtlsSession(
  t: TestContext,
  backendPort: number,
  mud: ChildProcess,
  browser: RecordingBrowserSocket,
): Promise<{ proxy: SyntheticMtlsProxy; session: MudSession }> {
  const proxy = await startSyntheticMtlsProxy({
    backendPort,
    pki: syntheticMtlsPki,
  });
  const session = new MudSession(browser, {
    createMudSocket: proxy.createMudSocketFactory(),
  });

  t.after(async () => {
    session.closeBrowser();
    await proxy.close();
    mud.kill();
  });

  return { proxy, session };
}

/** Wait until the session reaches `screen`, or fail with what it did reach. */
async function waitForScreen(browser: RecordingBrowserSocket, screen: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (browser.latest()?.screen === screen) {
      return browser.latest() as OnboardingState;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `never reached "${screen}"; last screen was "${browser.latest()?.screen ?? 'none'}"`,
  );
}

async function waitForScreenAfter(
  browser: RecordingBrowserSocket,
  screen: string,
  revision: number,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const latest = browser.latest();
    if (latest?.screen === screen && latest.revision > revision) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `never reached a newer "${screen}"; last screen was ` +
      `"${browser.latest()?.screen ?? 'none'}" at revision ${browser.latest()?.revision ?? -1}`,
  );
}

async function waitForEditorContent(
  browser: RecordingBrowserSocket,
  transferId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const messages = browser.messages.filter(
      (message) =>
        (message.type === 'onboarding-editor-content' ||
          message.type === 'onboarding-editor-content-complete') &&
        message.transferId === transferId,
    );
    if (messages.some((message) => message.type === 'onboarding-editor-content-complete')) {
      return Buffer.concat(
        messages
          .filter(
            (message): message is Extract<ServerMessage, { type: 'onboarding-editor-content' }> =>
              message.type === 'onboarding-editor-content',
          )
          .map((message) => Buffer.from(message.data, 'base64')),
      ).toString('utf8');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`editor content transfer "${transferId}" did not complete`);
}

async function waitForEditorResult(browser: RecordingBrowserSocket, transferId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = browser.messages.find(
      (message): message is Extract<ServerMessage, { type: 'onboarding-editor-result' }> =>
        message.type === 'onboarding-editor-result' && message.transferId === transferId,
    );
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`editor result "${transferId}" did not arrive`);
}

function act(session: MudSession, state: OnboardingState, action: string, choiceId?: string) {
  session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: state.flowId,
    revision: state.revision,
    action: action as never,
    choiceId,
  });
}

test('a v2 client walks the complete structured suite through mutual TLS', async (t) => {
  const port = await freePort();
  const mud = await startSyntheticMud(port);
  const browser = new RecordingBrowserSocket();
  const { proxy, session } = await startSyntheticMtlsSession(t, port, mud, browser);

  session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));

  // Walk the existing v1 creation flow to the role-play decision.
  const account = await waitForScreen(browser, 'account-name');
  session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: account.flowId,
    revision: account.revision,
    action: 'submit',
    value: 'Fixtureaccount',
  });

  for (const screen of ['account-password'] as const) {
    const state = await waitForScreen(browser, screen);
    session.sendOnboardingAction({
      type: 'onboarding-action',
      flowId: state.flowId,
      revision: state.revision,
      action: 'submit',
      value: 'invented-passphrase',
    });
  }

  const lobby = await waitForScreen(browser, 'account-menu');
  act(session, lobby, 'create-character');

  for (const screen of [
    'name',
    'name-confirm',
    'sex',
    'race',
    'class',
    'build',
    'alignment',
    'preferences',
  ] as const) {
    const state = await waitForScreen(browser, screen);
    if (state.inputKind === 'text') {
      session.sendOnboardingAction({
        type: 'onboarding-action',
        flowId: state.flowId,
        revision: state.revision,
        action: 'submit',
        value: 'Fixtureling',
      });
    } else if (state.inputKind === 'confirm') {
      act(session, state, 'confirm');
    } else {
      act(session, state, 'select', state.choices[0]?.id);
    }
  }

  // The decisive step: choosing role-play must stay structured on v2.
  const decision = await waitForScreen(browser, 'roleplay-decision');
  assert.equal(decision.version, 2, 'the session must have negotiated v2');
  act(session, decision, 'select', 'roleplayer');

  const hub = await waitForScreen(browser, 'roleplay-hub');
  assert.equal(hub.mode, 'roleplay-profile');
  assert.equal(hub.profile?.length, 14, 'the hub must publish every role-play item');
  assert.deepEqual(
    new Set(hub.profile?.map((item) => item.id)),
    new Set([
      'profile/short-description',
      'profile/long-description',
      'profile/background-story',
      'profile/background',
      'profile/goals',
      'profile/personality',
      'profile/ideals',
      'profile/bonds',
      'profile/flaws',
      'profile/age',
      'profile/region',
      'profile/faction',
      'profile/hometown',
      'profile/deity',
    ]),
  );

  // Walk the complete generated short-description state machine, including
  // its optional second feature and numeric confirm/reselect contract.
  act(session, hub, 'open', 'profile/short-description');
  let state = await waitForScreen(browser, 'short-desc-intro');
  act(session, state, 'continue');
  state = await waitForScreen(browser, 'short-desc-feature-1');
  act(session, state, 'select', 'feature/eyes');
  state = await waitForScreen(browser, 'short-desc-adjective-1');
  act(session, state, 'select', 'adj/storm-grey');
  state = await waitForScreen(browser, 'short-desc-preview');
  act(session, state, 'continue');
  state = await waitForScreen(browser, 'short-desc-review');
  act(session, state, 'continue');
  state = await waitForScreen(browser, 'short-desc-feature-2');
  act(session, state, 'select', 'feature/hair');
  state = await waitForScreen(browser, 'short-desc-adjective-2');
  act(session, state, 'select', 'adj/amber');
  state = await waitForScreen(browser, 'short-desc-preview');
  act(session, state, 'continue');
  state = await waitForScreen(browser, 'short-desc-review');
  act(session, state, 'confirm');
  let currentHub = await waitForScreen(browser, 'roleplay-hub');
  assert.equal(
    currentHub.profile?.find((item) => item.id === 'profile/short-description')?.status,
    'configured',
  );

  // Every private text field opens the correct editor. This test cancels each
  // one; the next test proves a large field saves and downloads byte-for-byte.
  for (const [itemId, screen, fieldId] of [
    ['profile/long-description', 'long-description', 'long-description'],
    ['profile/background-story', 'background-story', 'background-story'],
  ] as const) {
    act(session, currentHub, 'open', itemId);
    state = await waitForScreen(browser, screen);
    assert.equal(state.editor?.fieldId, fieldId);
    act(session, state, 'cancel-editor');
    currentHub = await waitForScreen(browser, 'roleplay-hub');
  }

  // The background catalog is source-paginated, previews descriptor-local
  // state, supports reselect, then reports the durable one-time choice locked.
  act(session, currentHub, 'open', 'profile/background');
  state = await waitForScreen(browser, 'background-catalog');
  assert.equal(state.page?.index, 0);
  const firstPageRevision = state.revision;
  act(session, state, 'next-page');
  state = await waitForScreenAfter(browser, 'background-catalog', firstPageRevision);
  assert.equal(state.page?.index, 1);
  const secondPageRevision = state.revision;
  act(session, state, 'previous-page');
  state = await waitForScreenAfter(browser, 'background-catalog', secondPageRevision);
  act(session, state, 'select', 'background/lamplighter');
  state = await waitForScreen(browser, 'background-confirm');
  assert.equal(state.detail?.label, 'Lamplighter');
  act(session, state, 'reselect');
  state = await waitForScreen(browser, 'background-catalog');
  act(session, state, 'select', 'background/lamplighter');
  state = await waitForScreen(browser, 'background-confirm');
  act(session, state, 'confirm');
  currentHub = await waitForScreen(browser, 'roleplay-hub');
  assert.equal(
    currentHub.profile?.find((item) => item.id === 'profile/background')?.status,
    'locked',
  );

  // Goals generate directly; the other four idea screens ask the source for
  // suggestions themed by a server-provided background choice.
  for (const [itemId, ideaScreen, editorScreen, fieldId] of [
    ['profile/goals', 'goals-ideas', 'goals-editor', 'goals'],
    ['profile/personality', 'personality-ideas', 'personality-editor', 'personality'],
    ['profile/ideals', 'ideals-ideas', 'ideals-editor', 'ideals'],
    ['profile/bonds', 'bonds-ideas', 'bonds-editor', 'bonds'],
    ['profile/flaws', 'flaws-ideas', 'flaws-editor', 'flaws'],
  ] as const) {
    act(session, currentHub, 'open', itemId);
    state = await waitForScreen(browser, ideaScreen);
    const ideaRevision = state.revision;
    if (fieldId === 'goals') {
      act(session, state, 'generate-example');
    } else {
      assert.ok(state.choices.length > 0, `${ideaScreen} must offer server themes`);
      act(session, state, 'select', state.choices[0].id);
    }
    state = await waitForScreenAfter(browser, ideaScreen, ideaRevision);
    assert.ok((state.examples?.length ?? 0) > 0, `${ideaScreen} must return suggestions`);
    act(session, state, 'continue');
    state = await waitForScreen(browser, editorScreen);
    assert.equal(state.editor?.fieldId, fieldId);
    act(session, state, 'cancel-editor');
    currentHub = await waitForScreen(browser, 'roleplay-hub');
  }

  // Every remaining authoritative catalog is reachable and persists through
  // the same legacy line parser the browser action resolver targets.
  act(session, currentHub, 'open', 'profile/age');
  state = await waitForScreen(browser, 'age-select');
  act(session, state, 'select', 'age/adult');
  currentHub = await waitForScreen(browser, 'roleplay-hub');

  act(session, currentHub, 'open', 'profile/region');
  state = await waitForScreen(browser, 'region-catalog');
  act(session, state, 'select', 'region/1');
  state = await waitForScreen(browser, 'region-confirm');
  act(session, state, 'reselect');
  state = await waitForScreen(browser, 'region-catalog');
  act(session, state, 'select', 'region/1');
  state = await waitForScreen(browser, 'region-confirm');
  act(session, state, 'confirm');
  currentHub = await waitForScreen(browser, 'roleplay-hub');

  act(session, currentHub, 'open', 'profile/faction');
  state = await waitForScreen(browser, 'faction-select');
  act(session, state, 'select', 'faction/901');
  currentHub = await waitForScreen(browser, 'roleplay-hub');

  act(session, currentHub, 'open', 'profile/hometown');
  state = await waitForScreen(browser, 'hometown-select');
  act(session, state, 'select', 'hometown/1');
  currentHub = await waitForScreen(browser, 'roleplay-hub');

  act(session, currentHub, 'open', 'profile/deity');
  state = await waitForScreen(browser, 'deity-select');
  act(session, state, 'select', 'deity/1');
  state = await waitForScreen(browser, 'deity-confirm');
  assert.equal(state.detail?.label, 'Aethyra');
  act(session, state, 'confirm');
  currentHub = await waitForScreen(browser, 'roleplay-hub');

  for (const id of [
    'profile/background',
    'profile/age',
    'profile/region',
    'profile/faction',
    'profile/hometown',
    'profile/deity',
  ]) {
    const item = currentHub.profile?.find((entry) => entry.id === id);
    assert.equal(item?.status, 'locked', `${id} must report its one-time save`);
    assert.equal(item?.mutable, false, `${id} must close after its one-time save`);
  }
  assert.equal(proxy.acceptedBackendConnections, 1);
  assert.ok(proxy.clientToBackendBytes > 0);
  assert.ok(proxy.backendToClientBytes > 0);
});

test('mutual TLS preserves terminal input, resize, heartbeat, close, and reconnect', async (t) => {
  const port = await freePort();
  const mud = await startSyntheticMud(port);
  const browser = new RecordingBrowserSocket();
  const { proxy, session } = await startSyntheticMtlsSession(t, port, mud, browser);

  session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));

  const account = await waitForScreen(browser, 'account-name');
  session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: account.flowId,
    revision: account.revision,
    action: 'submit',
    value: 'Fixtureaccount',
  });
  const password = await waitForScreen(browser, 'account-password');
  session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: password.flowId,
    revision: password.revision,
    action: 'submit',
    value: 'invented-passphrase',
  });

  const lobby = await waitForScreen(browser, 'account-menu');
  act(session, lobby, 'select', 'Aelwyn');
  const characterMenu = await waitForScreen(browser, 'character-menu');
  assert.equal(characterMenu.version, 2);
  act(session, characterMenu, 'select', characterMenuChoiceIds.roleplayProfile);

  const hub = await waitForScreen(browser, 'roleplay-hub');
  assert.equal(hub.selection.name, 'Aelwyn');
  assert.equal(hub.profile?.length, 14);

  act(session, hub, 'quit');
  const returnedMenu = await waitForScreen(browser, 'character-menu');
  act(session, returnedMenu, 'select', characterMenuChoiceIds.enterGame);
  const handoff = await waitForScreen(browser, 'handoff');

  session.updateTerminalDimensions({ columns: 132, rows: 42 });
  session.keepAlive();
  session.sendInput('look');
  await waitForScreenAfter(browser, 'handoff', handoff.revision);

  const firstFlowId = handoff.flowId;
  session.disconnect('Synthetic mutual-TLS reconnect.');
  session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));
  const reconnected = await waitForScreen(browser, 'account-name');

  assert.notEqual(reconnected.flowId, firstFlowId);
  assert.equal(proxy.acceptedBackendConnections, 2);
  assert.ok(proxy.clientToBackendBytes > 0);
  assert.ok(proxy.backendToClientBytes > 0);
  assert.equal(
    browser.messages.some(
      (message) =>
        message.type === 'connection-status' &&
        message.status === 'disconnected' &&
        message.detail === 'Synthetic mutual-TLS reconnect.',
    ),
    true,
  );
});

test('the forced short-description gate cannot cancel and hands off once saved', async (t) => {
  const port = await freePort();
  const mud = await startSyntheticMud(port);
  const browser = new RecordingBrowserSocket();
  const session = new MudSession(browser);

  t.after(() => {
    session.closeBrowser();
    mud.kill();
  });

  session.connect('127.0.0.1', port, normalizeMsdpVariableMap(defaultMsdpVariables));

  const account = await waitForScreen(browser, 'account-name');
  session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: account.flowId,
    revision: account.revision,
    action: 'submit',
    value: 'Fixtureaccount',
  });
  const password = await waitForScreen(browser, 'account-password');
  session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: password.flowId,
    revision: password.revision,
    action: 'submit',
    value: 'invented-passphrase',
  });

  const lobby = await waitForScreen(browser, 'account-menu');
  act(session, lobby, 'select', 'Bordrek');
  const characterMenu = await waitForScreen(browser, 'character-menu');
  act(session, characterMenu, 'select', characterMenuChoiceIds.enterGame);

  let state = await waitForScreen(browser, 'short-desc-intro');
  assert.equal(state.blocking, true);
  assert.ok(!state.actions.includes('cancel'));
  act(session, state, 'continue');
  state = await waitForScreen(browser, 'short-desc-feature-1');
  act(session, state, 'select', 'feature/eyes');
  state = await waitForScreen(browser, 'short-desc-adjective-1');
  act(session, state, 'select', 'adj/storm-grey');
  state = await waitForScreen(browser, 'short-desc-preview');
  act(session, state, 'continue');
  state = await waitForScreen(browser, 'short-desc-review');
  assert.equal(state.blocking, true);
  assert.ok(!state.actions.includes('cancel'));
  act(session, state, 'confirm');

  const handoff = await waitForScreen(browser, 'handoff');
  assert.equal(handoff.persistence, 'saved');
});

test('editor limits and chunked save/load remain intact through mutual TLS', async (t) => {
  const port = await freePort();
  const mud = await startSyntheticMud(port);
  const browser = new RecordingBrowserSocket();
  const { proxy, session } = await startSyntheticMtlsSession(t, port, mud, browser);

  session.connect('luminarimud.com', 4100, normalizeMsdpVariableMap(defaultMsdpVariables));

  // Jump straight to the suite using the synthetic MUD's own line protocol.
  const account = await waitForScreen(browser, 'account-name');
  session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: account.flowId,
    revision: account.revision,
    action: 'submit',
    value: 'Fixtureaccount',
  });
  const password = await waitForScreen(browser, 'account-password');
  session.sendOnboardingAction({
    type: 'onboarding-action',
    flowId: password.flowId,
    revision: password.revision,
    action: 'submit',
    value: 'invented-passphrase',
  });
  const lobby = await waitForScreen(browser, 'account-menu');
  act(session, lobby, 'create-character');

  for (const screen of [
    'name',
    'name-confirm',
    'sex',
    'race',
    'class',
    'build',
    'alignment',
    'preferences',
  ] as const) {
    const state = await waitForScreen(browser, screen);
    if (state.inputKind === 'text') {
      session.sendOnboardingAction({
        type: 'onboarding-action',
        flowId: state.flowId,
        revision: state.revision,
        action: 'submit',
        value: 'Fixtureling',
      });
    } else if (state.inputKind === 'confirm') {
      act(session, state, 'confirm');
    } else {
      act(session, state, 'select', state.choices[0]?.id);
    }
  }

  const decision = await waitForScreen(browser, 'roleplay-decision');
  act(session, decision, 'select', 'roleplayer');

  const hub = await waitForScreen(browser, 'roleplay-hub');
  act(session, hub, 'open', 'profile/background-story');

  const editor = await waitForScreen(browser, 'background-story');
  assert.equal(editor.inputKind, 'multiline');
  assert.equal(editor.editor?.fieldId, 'background-story');

  session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: editor.flowId,
    revision: editor.revision,
    fieldId: 'background-story',
    transferId: 'oversized-over-mtls',
    totalBytes: (editor.editor?.maxBytes ?? 0) + 1,
    chunkCount: 1,
    digest: '0'.repeat(64),
  });
  const oversizedResult = await waitForEditorResult(browser, 'oversized-over-mtls');
  assert.equal(oversizedResult.ok, false);
  assert.equal(oversizedResult.code, 'content-too-large');

  // Deliberately large and multi-byte: it must cross several chunks and
  // survive byte-accurate reassembly.
  const content = `An invented history. ${'漂泊の記録。'.repeat(1_500)}`;
  const chunks = chunkEditorContent(content);
  assert.ok(chunks.length > 1, 'the fixture must span multiple chunks');

  session.handleEditorTransfer({
    type: 'onboarding-editor-begin',
    flowId: editor.flowId,
    revision: editor.revision,
    fieldId: 'background-story',
    transferId: 'e2e-1',
    totalBytes: Buffer.byteLength(content, 'utf8'),
    chunkCount: chunks.length,
    digest: await editorContentDigest(content),
  });
  for (const [index, data] of chunks.entries()) {
    session.handleEditorTransfer({
      type: 'onboarding-editor-chunk',
      transferId: 'e2e-1',
      index,
      data,
    });
  }
  session.handleEditorTransfer({
    type: 'onboarding-editor-commit',
    flowId: editor.flowId,
    revision: editor.revision,
    transferId: 'e2e-1',
  });

  // The MUD acknowledges by publishing a new hub state that reflects the save.
  const savedHub = await waitForScreen(browser, 'roleplay-hub');
  const item = savedHub.profile?.find((entry) => entry.id === 'profile/background-story');
  assert.equal(item?.status, 'configured', 'the field must now read as set');
  assert.equal(savedHub.persistenceResult, 'saved');

  // The content itself must not have been echoed back into the hub summary.
  assert.ok(!JSON.stringify(savedHub).includes('漂泊の記録'), 'hub must not carry private text');

  // Reopen the same field. The synthetic source now exercises the reverse
  // state -> begin/chunks/commit path, and the gateway must reconstruct the
  // exact authoritative value before making it editable.
  act(session, savedHub, 'open', 'profile/background-story');
  const reopened = await waitForScreen(browser, 'background-story');
  assert.equal(reopened.editor?.empty, false);
  assert.ok(reopened.editor?.transferId);
  assert.equal(await waitForEditorContent(browser, reopened.editor!.transferId!), content);
  assert.equal(proxy.acceptedBackendConnections, 1);
  assert.ok(proxy.clientToBackendBytes > Buffer.byteLength(content, 'utf8'));
  assert.ok(proxy.backendToClientBytes > Buffer.byteLength(content, 'utf8'));
});
