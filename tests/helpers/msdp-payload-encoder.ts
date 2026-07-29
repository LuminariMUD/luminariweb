import {
  MSDP_ARRAY_CLOSE,
  MSDP_ARRAY_OPEN,
  MSDP_TABLE_CLOSE,
  MSDP_TABLE_OPEN,
  MSDP_VAL,
  MSDP_VAR,
} from '../../server/telnet-parser.ts';
import type { MsdpControlToken } from './msdp-fixtures.ts';

export type MsdpPayloadTokenIssue = {
  path: string;
  message: string;
};

type EncodeContext = {
  fixtureId?: string;
};

const CONTROL_TOKEN_BYTES = {
  VAR: MSDP_VAR,
  VAL: MSDP_VAL,
  TABLE_OPEN: MSDP_TABLE_OPEN,
  TABLE_CLOSE: MSDP_TABLE_CLOSE,
  ARRAY_OPEN: MSDP_ARRAY_OPEN,
  ARRAY_CLOSE: MSDP_ARRAY_CLOSE,
} as const satisfies Record<MsdpControlToken, number>;

const UNKNOWN_CONTROL_TOKENS = new Set([
  'MSDP_VAR',
  'MSDP_VAL',
  'MSDP_TABLE_OPEN',
  'MSDP_TABLE_CLOSE',
  'MSDP_ARRAY_OPEN',
  'MSDP_ARRAY_CLOSE',
  'TABLE_START',
  'TABLE_END',
  'ARRAY_START',
  'ARRAY_END',
]);

export class MsdpPayloadEncodingError extends Error {
  readonly issues: readonly MsdpPayloadTokenIssue[];

  constructor(issues: readonly MsdpPayloadTokenIssue[]) {
    super(formatIssues(issues));
    this.name = 'MsdpPayloadEncodingError';
    this.issues = issues;
  }
}

export function encodeMsdpPayloadTokens(value: unknown, context: EncodeContext = {}): Buffer {
  const issues = validateMsdpPayloadTokens(value, context);
  if (issues.length > 0) {
    throw new MsdpPayloadEncodingError(issues);
  }

  const tokens = value as readonly string[];
  return Buffer.concat(tokens.map(encodeToken));
}

export function validateMsdpPayloadTokens(
  value: unknown,
  context: EncodeContext = {},
): MsdpPayloadTokenIssue[] {
  if (!Array.isArray(value)) {
    return [
      {
        path: context.fixtureId ? `${context.fixtureId}.payloadTokens` : 'payloadTokens',
        message: 'must be an array',
      },
    ];
  }

  const issues: MsdpPayloadTokenIssue[] = [];

  value.forEach((token, index) => {
    const path = formatPath(index, context);

    if (typeof token !== 'string') {
      issues.push({
        path,
        message: `must be a string token, received ${typeof token}`,
      });
      return;
    }

    if (UNKNOWN_CONTROL_TOKENS.has(token)) {
      issues.push({
        path,
        message: `unknown MSDP control token "${token}"`,
      });
    }
  });

  return issues;
}

function encodeToken(token: string) {
  const controlByte = CONTROL_TOKEN_BYTES[token as MsdpControlToken];
  if (controlByte !== undefined) {
    return Buffer.from([controlByte]);
  }

  return Buffer.from(token, 'utf8');
}

function formatPath(index: number, context: EncodeContext) {
  const prefix = context.fixtureId ? `${context.fixtureId}.payloadTokens` : 'payloadTokens';
  return `${prefix}[${index}]`;
}

function formatIssues(issues: readonly MsdpPayloadTokenIssue[]) {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
}
