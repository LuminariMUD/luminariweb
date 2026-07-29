import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { TerminalDimensions } from '../../shared/mud.ts';
import { convertLuminariColorCodes } from './render-mud-html.ts';
import {
  XTERM_SPIKE_ARIA_LABEL,
  createXtermSpikeOptions,
  normalizeXtermFitDimensions,
} from './xterm-spike-options.ts';
import './xterm-spike.css';

type XtermTerminalSpikeProps = {
  autoScroll: boolean;
  className?: string;
  fontSize: number;
  lineHeight: number;
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onFitDimensions: (dimensions: TerminalDimensions) => void;
  resetKey: string;
  style?: CSSProperties;
  textChunks: readonly string[];
};

export function XtermTerminalSpike({
  autoScroll,
  className,
  fontSize,
  lineHeight,
  onClick,
  onFitDimensions,
  resetKey,
  style,
  textChunks,
}: XtermTerminalSpikeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const fitInFlightRef = useRef(false);
  const lastFitDimensionsRef = useRef<TerminalDimensions | null>(null);
  const lastResetKeyRef = useRef(resetKey);
  const writtenChunkCountRef = useRef(0);

  const runFit = useCallback(() => {
    fitFrameRef.current = null;

    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || fitInFlightRef.current) {
      return;
    }

    fitInFlightRef.current = true;
    try {
      fitAddon.fit();
      const nextDimensions = normalizeXtermFitDimensions({
        columns: terminal.cols,
        rows: terminal.rows,
      });

      if (!nextDimensions || areDimensionsEqual(nextDimensions, lastFitDimensionsRef.current)) {
        return;
      }

      lastFitDimensionsRef.current = nextDimensions;
      onFitDimensions(nextDimensions);
    } finally {
      fitInFlightRef.current = false;
    }
  }, [onFitDimensions]);

  const scheduleFit = useCallback(() => {
    if (fitFrameRef.current !== null) {
      return;
    }

    fitFrameRef.current = window.requestAnimationFrame(runFit);
  }, [runFit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal(createXtermSpikeOptions({ fontSize, lineHeight }));
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    lastFitDimensionsRef.current = null;
    writtenChunkCountRef.current = 0;
    scheduleFit();

    let resizeObserver: ResizeObserver | null = null;
    const handleWindowResize = () => {
      scheduleFit();
    };

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', handleWindowResize);
    } else {
      resizeObserver = new ResizeObserver(() => {
        scheduleFit();
      });
      resizeObserver.observe(container);
    }

    return () => {
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }

      window.removeEventListener('resize', handleWindowResize);
      resizeObserver?.disconnect();
      fitAddon.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      fitInFlightRef.current = false;
      lastFitDimensionsRef.current = null;
      writtenChunkCountRef.current = 0;
    };
  }, [fontSize, lineHeight, scheduleFit]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (lastResetKeyRef.current !== resetKey || textChunks.length < writtenChunkCountRef.current) {
      terminal.reset();
      writtenChunkCountRef.current = 0;
      lastResetKeyRef.current = resetKey;
    }

    for (const chunk of textChunks.slice(writtenChunkCountRef.current)) {
      terminal.write(convertLuminariColorCodes(chunk));
    }
    writtenChunkCountRef.current = textChunks.length;

    if (autoScroll) {
      terminal.scrollToBottom();
    }
  }, [autoScroll, fontSize, lineHeight, resetKey, textChunks]);

  return (
    <div
      className={['xterm-spike', className].filter(Boolean).join(' ')}
      data-prevent-command-focus
      onClick={onClick}
      style={style}
    >
      <div
        ref={containerRef}
        className="xterm-spike-surface"
        role="application"
        aria-label={XTERM_SPIKE_ARIA_LABEL}
      />
    </div>
  );
}

function areDimensionsEqual(left: TerminalDimensions, right: TerminalDimensions | null) {
  return Boolean(right && left.columns === right.columns && left.rows === right.rows);
}
