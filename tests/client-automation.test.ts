import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTOMATION_COMMAND_SEQUENCE_LIMIT,
  consumeTriggerText,
  expandAliasCommands,
  matchAliasPattern,
  matchTriggerPattern,
  previewAliasExpansion,
  previewTriggerConsumption,
  splitCommandSequence,
  substituteCaptures,
  validateAlias,
  validateTrigger,
} from '../shared/client-automation.ts';
import type { AliasDefinition, TriggerDefinition } from '../shared/client-automation.ts';

function alias(overrides: Partial<AliasDefinition>): AliasDefinition {
  return {
    id: overrides.id ?? 'alias-1',
    pattern: overrides.pattern ?? 'k *',
    expansion: overrides.expansion ?? 'kill %1',
    enabled: overrides.enabled ?? true,
  };
}

function trigger(overrides: Partial<TriggerDefinition>): TriggerDefinition {
  return {
    id: overrides.id ?? 'trigger-1',
    pattern: overrides.pattern ?? '* tells you *',
    action: overrides.action ?? 'tell %1 I heard: %2',
    enabled: overrides.enabled ?? true,
  };
}

test('validates missing alias fields and invalid capture references', () => {
  const missing = validateAlias(alias({ pattern: '', expansion: '' }));
  assert.equal(missing.valid, false);
  assert.deepEqual(
    missing.issues.map((issue) => issue.message),
    ['Pattern is required.', 'Expansion is required.'],
  );

  const invalidCapture = validateAlias(alias({ pattern: 'k *', expansion: 'kill %2' }));
  assert.equal(invalidCapture.valid, false);
  assert.equal(invalidCapture.issues[0]?.message, '%2 has no matching wildcard capture.');

  const literalCapture = validateAlias(alias({ pattern: 'c', expansion: 'cast %1' }));
  assert.equal(literalCapture.valid, true);
});

test('validates missing trigger fields and literal trigger capture misuse', () => {
  const missing = validateTrigger(trigger({ pattern: '', action: '' }));
  assert.equal(missing.valid, false);
  assert.deepEqual(
    missing.issues.map((issue) => issue.message),
    ['Pattern is required.', 'Action is required.'],
  );

  const invalidCapture = validateTrigger(trigger({ pattern: 'tells you', action: 'reply %1' }));
  assert.equal(invalidCapture.valid, false);
  assert.equal(invalidCapture.issues[0]?.message, '%1 has no matching wildcard capture.');
});

test('splits command sequences by semicolon and newline with a hard command limit', () => {
  assert.deepEqual(splitCommandSequence('look; score\ninventory').commands, [
    'look',
    'score',
    'inventory',
  ]);

  const longSequence = Array.from(
    { length: AUTOMATION_COMMAND_SEQUENCE_LIMIT + 2 },
    (_entry, index) => `say ${index}`,
  ).join(';');
  const result = splitCommandSequence(longSequence);
  assert.equal(result.commands.length, AUTOMATION_COMMAND_SEQUENCE_LIMIT);
  assert.equal(result.truncated, true);
});

test('matches literal and wildcard aliases and substitutes captures', () => {
  assert.deepEqual(matchAliasPattern('k goblin', 'k'), { captures: ['goblin'] });
  assert.deepEqual(matchAliasPattern('kill red goblin', 'kill * goblin'), {
    captures: ['red'],
  });
  assert.equal(matchAliasPattern('look', 'k'), null);
  assert.equal(
    substituteCaptures('kill %1 from %0', 'k goblin', ['goblin']),
    'kill goblin from k goblin',
  );
});

test('expands aliases, ignores disabled entries, and reports recursion limits', () => {
  const aliases = [
    alias({ id: 'disabled', pattern: 'x', expansion: 'say hidden', enabled: false }),
    alias({ id: 'kill', pattern: 'k *', expansion: 'kill %1' }),
  ];
  assert.deepEqual(expandAliasCommands('x', aliases).commands, ['x']);
  assert.deepEqual(expandAliasCommands('k goblin', aliases).commands, ['kill goblin']);

  const recursive = expandAliasCommands('loop', [
    alias({ id: 'loop', pattern: 'loop', expansion: 'loop' }),
  ]);
  assert.deepEqual(recursive.commands, []);
  assert.equal(recursive.notices[0]?.kind, 'alias-recursion');
});

test('previews aliases locally without requiring a dispatch target', () => {
  const report = previewAliasExpansion(
    alias({ id: 'prep', pattern: 'prep *', expansion: 'cast armor %1;cast shield %1' }),
    'prep hero',
    [],
  );
  assert.deepEqual(report.commands, ['cast armor hero', 'cast shield hero']);
  assert.deepEqual(report.matchedAliases, ['prep']);

  const empty = previewAliasExpansion(alias({}), '', []);
  assert.equal(empty.commands.length, 0);
  assert.match(empty.notices[0]?.message ?? '', /Enter a command/);
});

test('matches trigger lines, wildcard captures, disabled entries, and buffered input', () => {
  assert.deepEqual(matchTriggerPattern('Ari tells you hello', '* tells you *'), {
    captures: ['Ari', 'hello'],
  });
  assert.equal(matchTriggerPattern('Ari says hello', 'tells you'), null);

  const disabled = trigger({
    id: 'disabled',
    pattern: '* tells you *',
    action: 'tell %1 hidden',
    enabled: false,
  });
  const active = trigger({ id: 'active', pattern: '* tells you *', action: 'tell %1 ok' });

  const first = consumeTriggerText('Ari tells', '', [disabled, active], []);
  assert.equal(first.buffer, 'Ari tells');
  assert.deepEqual(first.commands, []);

  const second = consumeTriggerText(' you hello\n', first.buffer, [disabled, active], []);
  assert.deepEqual(second.commands, ['tell Ari ok']);
  assert.deepEqual(second.matchedTriggers, ['active']);
});

test('previews trigger actions locally and expands alias-backed actions', () => {
  const aliases = [alias({ id: 'buff', pattern: 'buff *', expansion: 'cast armor %1' })];
  const report = previewTriggerConsumption(
    trigger({ id: 'arrival', pattern: '* arrives.', action: 'buff %1' }),
    'Tara arrives.',
    aliases,
  );

  assert.deepEqual(report.commands, ['cast armor Tara']);
  assert.deepEqual(report.matchedTriggers, ['arrival']);
});

test('caps trigger-generated command batches with a visible notice', () => {
  const action = Array.from({ length: 5 }, (_entry, index) => `say ${index}`).join(';');
  const report = consumeTriggerText('Ari tells you hello\n', '', [trigger({ action })], [], {
    triggerCommandLimit: 3,
  });

  assert.deepEqual(report.commands, ['say 0', 'say 1', 'say 2']);
  assert.equal(report.notices.at(-1)?.kind, 'trigger-command-limit');
});
