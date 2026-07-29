import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import { terminalDimensionBounds } from '../../shared/mud.ts';
import type { TerminalDimensions } from '../../shared/mud.ts';

export type TerminalRendererMode = 'html' | 'xterm-spike';

export const DEFAULT_TERMINAL_RENDERER_MODE: TerminalRendererMode = 'html';
export const XTERM_SPIKE_RENDERER_MODE: TerminalRendererMode = 'xterm-spike';
export const TERMINAL_RENDERER_QUERY_PARAM = 'terminalRenderer';
export const XTERM_SPIKE_ARIA_LABEL = 'Experimental terminal output';
export const XTERM_SPIKE_SCROLLBACK = 2000;

export function parseTerminalRendererMode(search: string | URLSearchParams): TerminalRendererMode {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const mode = params.get(TERMINAL_RENDERER_QUERY_PARAM);

  if (mode === XTERM_SPIKE_RENDERER_MODE) {
    return XTERM_SPIKE_RENDERER_MODE;
  }

  return DEFAULT_TERMINAL_RENDERER_MODE;
}

export function isXtermSpikeRenderer(mode: TerminalRendererMode) {
  return mode === XTERM_SPIKE_RENDERER_MODE;
}

export function createXtermSpikeTheme(): ITheme {
  return {
    background: '#020617',
    black: '#020617',
    blue: '#60a5fa',
    brightBlack: '#64748b',
    brightBlue: '#93c5fd',
    brightCyan: '#5eead4',
    brightGreen: '#86efac',
    brightMagenta: '#f0abfc',
    brightRed: '#fb7185',
    brightWhite: '#f8fafc',
    brightYellow: '#fde68a',
    cursor: '#f8fafc',
    cursorAccent: '#020617',
    cyan: '#2dd4bf',
    foreground: '#e2e8f0',
    green: '#4ade80',
    magenta: '#e879f9',
    red: '#f43f5e',
    selectionBackground: '#334155',
    selectionForeground: '#f8fafc',
    selectionInactiveBackground: '#1e293b',
    white: '#e2e8f0',
    yellow: '#facc15',
  };
}

export function createXtermSpikeOptions(settings?: {
  fontSize?: number;
  lineHeight?: number;
}): ITerminalOptions {
  return {
    altClickMovesCursor: false,
    convertEol: true,
    cursorBlink: false,
    cursorInactiveStyle: 'none',
    disableStdin: true,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: settings?.fontSize,
    lineHeight: settings?.lineHeight,
    rightClickSelectsWord: true,
    screenReaderMode: true,
    scrollback: XTERM_SPIKE_SCROLLBACK,
    theme: createXtermSpikeTheme(),
  };
}

export function normalizeXtermFitDimensions(
  dimensions: Partial<TerminalDimensions> | null | undefined,
): TerminalDimensions | null {
  if (!dimensions) {
    return null;
  }

  const columns = normalizeFitDimension(
    dimensions.columns,
    terminalDimensionBounds.columns.min,
    terminalDimensionBounds.columns.max,
  );
  const rows = normalizeFitDimension(
    dimensions.rows,
    terminalDimensionBounds.rows.min,
    terminalDimensionBounds.rows.max,
  );

  if (columns === null || rows === null) {
    return null;
  }

  return { columns, rows };
}

function normalizeFitDimension(value: number | undefined, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}
