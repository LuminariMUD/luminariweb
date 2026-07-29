import assert from 'node:assert/strict';
import type { TerminalDimensions } from '../../shared/mud.ts';
import { DO, IAC, SB, SE, TELOPT_NAWS, WILL } from '../../server/telnet-parser.ts';

export function doNawsPacket() {
  return Buffer.from([IAC, DO, TELOPT_NAWS]);
}

export function willNawsPacket() {
  return Buffer.from([IAC, WILL, TELOPT_NAWS]);
}

export function nawsSubnegotiationPacket(dimensions: TerminalDimensions) {
  return Buffer.from([
    IAC,
    SB,
    TELOPT_NAWS,
    dimensions.columns >> 8,
    dimensions.columns & 0xff,
    dimensions.rows >> 8,
    dimensions.rows & 0xff,
    IAC,
    SE,
  ]);
}

export function getNawsDimensionsFromWrites(chunks: readonly Buffer[]) {
  const bytes = Buffer.concat(chunks);
  const dimensions: TerminalDimensions[] = [];

  for (let index = 0; index <= bytes.length - 9; index += 1) {
    if (
      bytes[index] !== IAC ||
      bytes[index + 1] !== SB ||
      bytes[index + 2] !== TELOPT_NAWS ||
      bytes[index + 7] !== IAC ||
      bytes[index + 8] !== SE
    ) {
      continue;
    }

    dimensions.push({
      columns: (bytes[index + 3] << 8) | bytes[index + 4],
      rows: (bytes[index + 5] << 8) | bytes[index + 6],
    });
  }

  return dimensions;
}

export function assertNawsDimensions(
  chunks: readonly Buffer[],
  expectedDimensions: readonly TerminalDimensions[],
) {
  assert.deepEqual(getNawsDimensionsFromWrites(chunks), expectedDimensions);
}

export function assertNoNawsDimensions(chunks: readonly Buffer[]) {
  assert.deepEqual(getNawsDimensionsFromWrites(chunks), []);
}
