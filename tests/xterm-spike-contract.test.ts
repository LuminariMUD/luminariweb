import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalDimensionBounds } from '../shared/mud.ts';
import {
  DEFAULT_TERMINAL_RENDERER_MODE,
  XTERM_SPIKE_ARIA_LABEL,
  XTERM_SPIKE_RENDERER_MODE,
  XTERM_SPIKE_SCROLLBACK,
  createXtermSpikeOptions,
  normalizeXtermFitDimensions,
  parseTerminalRendererMode,
} from '../src/terminal/xterm-spike-options.ts';

test('parses xterm spike mode and falls back for invalid values', () => {
  assert.equal(
    parseTerminalRendererMode('?terminalRenderer=xterm-spike'),
    XTERM_SPIKE_RENDERER_MODE,
  );
  assert.equal(parseTerminalRendererMode('?terminalRenderer=html'), DEFAULT_TERMINAL_RENDERER_MODE);
  assert.equal(
    parseTerminalRendererMode('?terminalRenderer=<script>'),
    DEFAULT_TERMINAL_RENDERER_MODE,
  );
  assert.equal(parseTerminalRendererMode(''), DEFAULT_TERMINAL_RENDERER_MODE);
});

test('creates xterm spike options with command input and accessibility defaults', () => {
  const options = createXtermSpikeOptions({ fontSize: 16, lineHeight: 1.55 });

  assert.equal(options.disableStdin, true);
  assert.equal(options.screenReaderMode, true);
  assert.equal(options.scrollback, XTERM_SPIKE_SCROLLBACK);
  assert.equal(options.convertEol, true);
  assert.equal(options.altClickMovesCursor, false);
  assert.equal(options.fontSize, 16);
  assert.equal(options.lineHeight, 1.55);
  assert.equal(options.theme?.background, '#020617');
  assert.equal(XTERM_SPIKE_ARIA_LABEL, 'Experimental terminal output');
});

test('normalizes bounded fit dimensions and rejects unusable sizes', () => {
  assert.deepEqual(normalizeXtermFitDimensions({ columns: 120.9, rows: 40.2 }), {
    columns: 120,
    rows: 40,
  });
  assert.deepEqual(normalizeXtermFitDimensions({ columns: 1, rows: 1 }), {
    columns: terminalDimensionBounds.columns.min,
    rows: terminalDimensionBounds.rows.min,
  });
  assert.deepEqual(normalizeXtermFitDimensions({ columns: 999999, rows: 999999 }), {
    columns: terminalDimensionBounds.columns.max,
    rows: terminalDimensionBounds.rows.max,
  });
  assert.equal(normalizeXtermFitDimensions({ columns: 0, rows: 40 }), null);
  assert.equal(normalizeXtermFitDimensions({ columns: Number.NaN, rows: 40 }), null);
  assert.equal(normalizeXtermFitDimensions(null), null);
});
