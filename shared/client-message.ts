import { normalizeMsdpVariableMap, terminalDimensionBounds } from './mud.ts';
import type { ClientMessage, TerminalDimensions } from './mud.ts';
import { isOnboardingActionMessage } from './onboarding.ts';
import { isEditorTransferClientMessage } from './onboarding-transfer.ts';

const INVALID_BROWSER_MESSAGE_DETAIL = 'Received an invalid browser message.';
const INVALID_RESIZE_MESSAGE_DETAIL = 'Received invalid terminal resize dimensions.';
const INVALID_ONBOARDING_ACTION_DETAIL = 'Received an invalid onboarding action.';
const INVALID_EDITOR_TRANSFER_DETAIL = 'Received an invalid editor transfer message.';
/**
 * Hard ceiling on one encoded browser->proxy message, in UTF-8 bytes. Editor
 * transfer chunk sizing is derived from this, so it must stay a byte budget.
 */
export const MAX_BROWSER_MESSAGE_BYTES = 65_536;

export type ClientMessageParseResult =
  | {
      errorDetail: string;
      message: null;
    }
  | {
      errorDetail: null;
      message: ClientMessage;
    };

export function parseClientMessage(data: unknown): ClientMessageParseResult {
  const text = browserMessageDataToString(data);
  if (!text) {
    return invalidClientMessage();
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      return invalidClientMessage();
    }

    const message = parsed as Record<string, unknown>;

    if (
      message.type === 'connect' &&
      typeof message.host === 'string' &&
      typeof message.port === 'number'
    ) {
      return validClientMessage({
        type: 'connect',
        host: message.host,
        port: message.port,
        msdpVariables: normalizeMsdpVariableMap(message.msdpVariables),
      });
    }

    if (message.type === 'disconnect') {
      return validClientMessage({ type: 'disconnect' });
    }

    if (message.type === 'heartbeat') {
      return validClientMessage({ type: 'heartbeat' });
    }

    if (message.type === 'input' && typeof message.text === 'string') {
      return validClientMessage({ type: 'input', text: message.text });
    }

    if (message.type === 'msdp-config') {
      return validClientMessage({
        type: 'msdp-config',
        msdpVariables: normalizeMsdpVariableMap(message.msdpVariables),
      });
    }

    if (message.type === 'onboarding-action') {
      if (!isOnboardingActionMessage(message)) {
        return invalidClientMessage(INVALID_ONBOARDING_ACTION_DETAIL);
      }

      return validClientMessage(message);
    }

    if (typeof message.type === 'string' && message.type.startsWith('onboarding-editor-')) {
      if (!isEditorTransferClientMessage(message)) {
        return invalidClientMessage(INVALID_EDITOR_TRANSFER_DETAIL);
      }

      return validClientMessage(message);
    }

    if (message.type === 'resize') {
      const dimensions = parseTerminalDimensions(message);
      if (!dimensions) {
        return invalidClientMessage(INVALID_RESIZE_MESSAGE_DETAIL);
      }

      return validClientMessage({
        type: 'resize',
        columns: dimensions.columns,
        rows: dimensions.rows,
      });
    }

    return invalidClientMessage();
  } catch {
    return invalidClientMessage();
  }
}

function validClientMessage(message: ClientMessage): ClientMessageParseResult {
  return {
    errorDetail: null,
    message,
  };
}

function invalidClientMessage(
  errorDetail = INVALID_BROWSER_MESSAGE_DETAIL,
): ClientMessageParseResult {
  return {
    errorDetail,
    message: null,
  };
}

function parseTerminalDimensions(message: Record<string, unknown>): TerminalDimensions | null {
  if (
    !isValidTerminalDimension(
      message.columns,
      terminalDimensionBounds.columns.min,
      terminalDimensionBounds.columns.max,
    ) ||
    !isValidTerminalDimension(
      message.rows,
      terminalDimensionBounds.rows.min,
      terminalDimensionBounds.rows.max,
    )
  ) {
    return null;
  }

  return {
    columns: message.columns,
    rows: message.rows,
  };
}

function isValidTerminalDimension(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Measure a string the way the transport does. `String.length` counts UTF-16
 * code units, so a limit named in bytes would admit roughly three times its
 * stated size for multi-byte text. Editor transfers rely on this being a real
 * byte budget, so the cheap length check is only used to skip the encode for
 * strings that cannot possibly exceed the cap.
 */
function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function browserMessageDataToString(data: unknown) {
  if (typeof data === 'string') {
    // One UTF-16 code unit is at most 3 UTF-8 bytes (surrogate pairs are 2
    // units for 4 bytes), so anything this short is provably under the cap.
    if (data.length <= MAX_BROWSER_MESSAGE_BYTES / 3) {
      return data;
    }

    return utf8ByteLength(data) <= MAX_BROWSER_MESSAGE_BYTES ? data : '';
  }

  const bytes = toMessageBytes(data);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_BROWSER_MESSAGE_BYTES) {
    return '';
  }

  return new TextDecoder().decode(bytes);
}

function toMessageBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  if (!Array.isArray(data)) {
    return null;
  }

  const chunks = data.map(toMessageBytes);
  if (chunks.some((chunk) => chunk === null)) {
    return null;
  }

  const byteChunks = chunks as Uint8Array[];
  const totalBytes = byteChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (totalBytes > MAX_BROWSER_MESSAGE_BYTES) {
    return null;
  }

  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of byteChunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}
