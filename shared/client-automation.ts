export const AUTOMATION_RECURSION_LIMIT = 10;
export const AUTOMATION_COMMAND_SEQUENCE_LIMIT = 20;
export const TRIGGER_COMMAND_LIMIT = 25;

export type AliasDefinition = {
  id: string;
  pattern: string;
  expansion: string;
  enabled: boolean;
};

export type TriggerDefinition = {
  id: string;
  pattern: string;
  action: string;
  enabled: boolean;
};

export type AutomationField = 'pattern' | 'expansion' | 'action' | 'input';

export type AutomationValidationIssue = {
  field: AutomationField;
  message: string;
};

export type AutomationValidationResult = {
  valid: boolean;
  issues: AutomationValidationIssue[];
};

export type AutomationLimitNotice = {
  kind: 'alias-recursion' | 'command-limit' | 'trigger-command-limit';
  message: string;
};

export type CommandSequenceResult = {
  commands: string[];
  truncated: boolean;
};

export type AliasExpansionReport = {
  input: string;
  commands: string[];
  matchedAliases: string[];
  notices: AutomationLimitNotice[];
};

export type TriggerConsumptionReport = {
  buffer: string;
  commands: string[];
  matchedTriggers: string[];
  notices: AutomationLimitNotice[];
};

export type AutomationIdFactory = (prefix: string) => string;

export function createAutomationId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyAlias(
  idFactory: AutomationIdFactory = createAutomationId,
): AliasDefinition {
  return {
    id: idFactory('alias'),
    pattern: '',
    expansion: '',
    enabled: true,
  };
}

export function createEmptyTrigger(
  idFactory: AutomationIdFactory = createAutomationId,
): TriggerDefinition {
  return {
    id: idFactory('trigger'),
    pattern: '',
    action: '',
    enabled: true,
  };
}

export function validateAlias(alias: AliasDefinition): AutomationValidationResult {
  const issues: AutomationValidationIssue[] = [];
  const trimmedPattern = alias.pattern.trim();
  const trimmedExpansion = alias.expansion.trim();

  if (!trimmedPattern) {
    issues.push({ field: 'pattern', message: 'Pattern is required.' });
  }

  if (!trimmedExpansion) {
    issues.push({ field: 'expansion', message: 'Expansion is required.' });
  }

  validateWildcardPattern(trimmedPattern, 'pattern', issues);
  validateCaptureReferences({
    value: alias.expansion,
    field: 'expansion',
    captureCount: getAliasCaptureCount(trimmedPattern),
    issues,
  });

  const sequence = splitCommandSequence(alias.expansion);
  if (trimmedExpansion && sequence.commands.length === 0) {
    issues.push({ field: 'expansion', message: 'Expansion must produce at least one command.' });
  }

  if (sequence.truncated) {
    issues.push({
      field: 'expansion',
      message: `Expansion is limited to ${AUTOMATION_COMMAND_SEQUENCE_LIMIT} commands.`,
    });
  }

  return { valid: issues.length === 0, issues };
}

export function validateTrigger(trigger: TriggerDefinition): AutomationValidationResult {
  const issues: AutomationValidationIssue[] = [];
  const trimmedPattern = trigger.pattern.trim();
  const trimmedAction = trigger.action.trim();

  if (!trimmedPattern) {
    issues.push({ field: 'pattern', message: 'Pattern is required.' });
  }

  if (!trimmedAction) {
    issues.push({ field: 'action', message: 'Action is required.' });
  }

  validateWildcardPattern(trimmedPattern, 'pattern', issues);
  validateCaptureReferences({
    value: trigger.action,
    field: 'action',
    captureCount: countWildcards(trimmedPattern),
    issues,
  });

  const sequence = splitCommandSequence(trigger.action);
  if (trimmedAction && sequence.commands.length === 0) {
    issues.push({ field: 'action', message: 'Action must produce at least one command.' });
  }

  if (sequence.truncated) {
    issues.push({
      field: 'action',
      message: `Action is limited to ${AUTOMATION_COMMAND_SEQUENCE_LIMIT} commands.`,
    });
  }

  return { valid: issues.length === 0, issues };
}

export function splitCommandSequence(
  value: string,
  limit = AUTOMATION_COMMAND_SEQUENCE_LIMIT,
): CommandSequenceResult {
  const commands = value
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (commands.length <= limit) {
    return { commands, truncated: false };
  }

  return { commands: commands.slice(0, limit), truncated: true };
}

export function previewAliasExpansion(
  alias: AliasDefinition,
  input: string,
  aliases: AliasDefinition[],
): AliasExpansionReport {
  const validation = validateAlias(alias);
  if (!validation.valid) {
    return {
      input,
      commands: [],
      matchedAliases: [],
      notices: validation.issues.map((issue) => ({
        kind: 'command-limit',
        message: issue.message,
      })),
    };
  }

  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return {
      input,
      commands: [],
      matchedAliases: [],
      notices: [{ kind: 'command-limit', message: 'Enter a command to preview.' }],
    };
  }

  const entryScopedAliases = [alias, ...aliases.filter((entry) => entry.id !== alias.id)];
  return expandAliasCommands(trimmedInput, entryScopedAliases);
}

export function previewTriggerConsumption(
  trigger: TriggerDefinition,
  input: string,
  aliases: AliasDefinition[],
): TriggerConsumptionReport {
  const validation = validateTrigger(trigger);
  if (!validation.valid) {
    return {
      buffer: '',
      commands: [],
      matchedTriggers: [],
      notices: validation.issues.map((issue) => ({
        kind: 'trigger-command-limit',
        message: issue.message,
      })),
    };
  }

  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return {
      buffer: '',
      commands: [],
      matchedTriggers: [],
      notices: [{ kind: 'trigger-command-limit', message: 'Enter a sample line to preview.' }],
    };
  }

  return consumeTriggerText(`${trimmedInput}\n`, '', [trigger], aliases);
}

export function expandAliasCommands(
  text: string,
  aliases: AliasDefinition[],
  options?: { recursionLimit?: number; commandLimit?: number },
): AliasExpansionReport {
  const recursionLimit = options?.recursionLimit ?? AUTOMATION_RECURSION_LIMIT;
  const commandLimit = options?.commandLimit ?? AUTOMATION_COMMAND_SEQUENCE_LIMIT;
  const report: AliasExpansionReport = {
    input: text,
    commands: [],
    matchedAliases: [],
    notices: [],
  };
  const validAliases = aliases.filter((alias) => alias.enabled && validateAlias(alias).valid);
  const commands = expandAliasCommandBranch(text.trim(), validAliases, report, {
    depth: 0,
    recursionLimit,
    commandLimit,
  });

  if (commands.length > commandLimit) {
    report.commands = commands.slice(0, commandLimit);
    report.notices.push({
      kind: 'command-limit',
      message: `Automation output was limited to ${commandLimit} commands.`,
    });
    return report;
  }

  report.commands = commands;
  return report;
}

export function consumeTriggerText(
  text: string,
  buffer: string,
  triggers: TriggerDefinition[],
  aliases: AliasDefinition[],
  options?: { triggerCommandLimit?: number; aliasCommandLimit?: number },
): TriggerConsumptionReport {
  const triggerCommandLimit = options?.triggerCommandLimit ?? TRIGGER_COMMAND_LIMIT;
  const aliasCommandLimit = options?.aliasCommandLimit ?? AUTOMATION_COMMAND_SEQUENCE_LIMIT;
  const combined = `${buffer}${text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')}`;
  const segments = combined.split('\n');
  const nextBuffer = segments.pop() ?? '';
  const report: TriggerConsumptionReport = {
    buffer: nextBuffer,
    commands: [],
    matchedTriggers: [],
    notices: [],
  };
  const validTriggers = triggers.filter(
    (trigger) => trigger.enabled && validateTrigger(trigger).valid,
  );

  for (const segment of segments) {
    const line = segment.trim();
    if (!line) {
      continue;
    }

    for (const trigger of validTriggers) {
      const match = matchTriggerPattern(line, trigger.pattern);
      if (!match) {
        continue;
      }

      report.matchedTriggers.push(trigger.id);
      const actionText = substituteCaptures(trigger.action, line, match.captures);
      const sequence = splitCommandSequence(actionText);
      if (sequence.truncated) {
        report.notices.push({
          kind: 'command-limit',
          message: `Trigger action for "${trigger.pattern}" was limited to ${AUTOMATION_COMMAND_SEQUENCE_LIMIT} commands before alias expansion.`,
        });
      }

      for (const command of sequence.commands) {
        const expansion = expandAliasCommands(command, aliases, {
          commandLimit: aliasCommandLimit,
        });
        report.notices.push(...expansion.notices);
        for (const expandedCommand of expansion.commands) {
          if (report.commands.length >= triggerCommandLimit) {
            report.notices.push({
              kind: 'trigger-command-limit',
              message: `Trigger automation was limited to ${triggerCommandLimit} commands.`,
            });
            return report;
          }

          report.commands.push(expandedCommand);
        }
      }
    }
  }

  return report;
}

export function matchAliasPattern(text: string, pattern: string) {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return null;
  }

  if (trimmedPattern.includes('*')) {
    return matchWildcardPattern(text, trimmedPattern);
  }

  const normalizedText = text.toLowerCase();
  const normalizedPattern = trimmedPattern.toLowerCase();
  if (normalizedText === normalizedPattern) {
    return { captures: [''] };
  }

  if (normalizedText.startsWith(`${normalizedPattern} `)) {
    return { captures: [text.slice(trimmedPattern.length).trimStart()] };
  }

  return null;
}

export function matchTriggerPattern(text: string, pattern: string) {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return null;
  }

  if (trimmedPattern.includes('*')) {
    return matchWildcardPattern(text, trimmedPattern);
  }

  return text.toLowerCase().includes(trimmedPattern.toLowerCase()) ? { captures: [] } : null;
}

export function substituteCaptures(template: string, source: string, captures: string[]) {
  return template.replace(/%(\d)/g, (_match, indexText: string) => {
    const index = Number(indexText);
    if (index === 0) {
      return source;
    }

    return captures[index - 1] ?? '';
  });
}

export function normalizeAliases(
  value: unknown,
  options?: { emptyStateMessage?: string; idFactory?: AutomationIdFactory },
): AliasDefinition[] {
  if (!Array.isArray(value)) {
    if (options?.emptyStateMessage) {
      throw new Error(options.emptyStateMessage);
    }

    return [];
  }

  return value.map((entry, index) =>
    normalizeAliasEntry(entry, index, options?.idFactory ?? createAutomationId),
  );
}

export function normalizeTriggers(
  value: unknown,
  options?: { emptyStateMessage?: string; idFactory?: AutomationIdFactory },
): TriggerDefinition[] {
  if (!Array.isArray(value)) {
    if (options?.emptyStateMessage) {
      throw new Error(options.emptyStateMessage);
    }

    return [];
  }

  return value.map((entry, index) =>
    normalizeTriggerEntry(entry, index, options?.idFactory ?? createAutomationId),
  );
}

function expandAliasCommandBranch(
  text: string,
  aliases: AliasDefinition[],
  report: AliasExpansionReport,
  options: { depth: number; recursionLimit: number; commandLimit: number },
): string[] {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return [];
  }

  if (options.depth >= options.recursionLimit) {
    report.notices.push({
      kind: 'alias-recursion',
      message: `Alias recursion limit of ${options.recursionLimit} was reached. Command was not sent.`,
    });
    return [];
  }

  for (const alias of aliases) {
    const match = matchAliasPattern(trimmedText, alias.pattern);
    if (!match) {
      continue;
    }

    report.matchedAliases.push(alias.id);
    const expandedText = substituteCaptures(alias.expansion, trimmedText, match.captures);
    const sequence = splitCommandSequence(expandedText, options.commandLimit);
    if (sequence.truncated) {
      report.notices.push({
        kind: 'command-limit',
        message: `Alias "${alias.pattern}" was limited to ${options.commandLimit} commands.`,
      });
    }

    return sequence.commands.flatMap((command) =>
      expandAliasCommandBranch(command, aliases, report, {
        ...options,
        depth: options.depth + 1,
      }),
    );
  }

  return [trimmedText];
}

function normalizeAliasEntry(
  value: unknown,
  index: number,
  idFactory: AutomationIdFactory,
): AliasDefinition {
  if (!isObjectRecord(value)) {
    throw new Error(`Alias ${index + 1} is invalid.`);
  }

  const pattern = readOptionalString(value, ['pattern', 'name']);
  const expansion = readOptionalString(value, ['expansion', 'value', 'command']);

  if (!pattern?.trim() || !expansion?.trim()) {
    throw new Error(`Alias ${index + 1} must include both pattern and expansion.`);
  }

  const alias = {
    id: readOptionalString(value, ['id'])?.trim() || idFactory('alias'),
    pattern,
    expansion,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
  };
  const validation = validateAlias(alias);
  if (!validation.valid) {
    throw new Error(`Alias ${index + 1}: ${validation.issues[0]?.message ?? 'Invalid alias.'}`);
  }

  return alias;
}

function normalizeTriggerEntry(
  value: unknown,
  index: number,
  idFactory: AutomationIdFactory,
): TriggerDefinition {
  if (!isObjectRecord(value)) {
    throw new Error(`Trigger ${index + 1} is invalid.`);
  }

  const pattern = readOptionalString(value, ['pattern', 'match']);
  const action = readOptionalString(value, ['action', 'command', 'expansion']);

  if (!pattern?.trim() || !action?.trim()) {
    throw new Error(`Trigger ${index + 1} must include both pattern and action.`);
  }

  const trigger = {
    id: readOptionalString(value, ['id'])?.trim() || idFactory('trigger'),
    pattern,
    action,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
  };
  const validation = validateTrigger(trigger);
  if (!validation.valid) {
    throw new Error(`Trigger ${index + 1}: ${validation.issues[0]?.message ?? 'Invalid trigger.'}`);
  }

  return trigger;
}

function validateWildcardPattern(
  pattern: string,
  field: AutomationField,
  issues: AutomationValidationIssue[],
) {
  const wildcardCount = countWildcards(pattern);
  if (wildcardCount > 9) {
    issues.push({
      field,
      message: 'Patterns can use at most 9 wildcard captures.',
    });
  }
}

function validateCaptureReferences(options: {
  value: string;
  field: AutomationField;
  captureCount: number;
  issues: AutomationValidationIssue[];
}) {
  for (const index of getCaptureReferenceIndexes(options.value)) {
    if (index === 0) {
      continue;
    }

    if (index > options.captureCount) {
      options.issues.push({
        field: options.field,
        message: `%${index} has no matching wildcard capture.`,
      });
      return;
    }
  }
}

function getAliasCaptureCount(pattern: string) {
  const wildcardCount = countWildcards(pattern);
  return wildcardCount > 0 ? wildcardCount : 1;
}

function getCaptureReferenceIndexes(value: string) {
  const indexes: number[] = [];
  const matcher = /%(\d)/g;
  let match = matcher.exec(value);
  while (match) {
    indexes.push(Number(match[1]));
    match = matcher.exec(value);
  }

  return indexes;
}

function countWildcards(value: string) {
  return [...value].filter((character) => character === '*').length;
}

function matchWildcardPattern(text: string, pattern: string) {
  const escapedSegments = pattern.trim().split('*').map(escapeRegExp);
  const matcher = new RegExp(`^${escapedSegments.join('(.*?)')}$`, 'i');
  const match = matcher.exec(text);
  if (!match) {
    return null;
  }

  return { captures: match.slice(1).map((capture) => capture.trim()) };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readOptionalString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
