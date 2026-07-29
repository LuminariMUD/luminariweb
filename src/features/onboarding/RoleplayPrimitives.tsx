/**
 * Small shared pieces for the role-play identity suite.
 *
 * Every status shown here is server-authored. Nothing in this file decides
 * whether an item is available, locked, or saved: it only renders what the MUD
 * already said, in a way that survives with colour, imagery, and sound absent.
 */

import type {
  OnboardingItemStatus,
  OnboardingPersistenceResult,
} from '../../../shared/onboarding.ts';

/** Label and glyph per status. Text carries the meaning, not the colour. */
const STATUS_PRESENTATION: Record<OnboardingItemStatus, { label: string; glyph: string }> = {
  unset: { label: 'Not set', glyph: '○' },
  configured: { label: 'Set', glyph: '●' },
  required: { label: 'Required', glyph: '!' },
  locked: { label: 'Locked', glyph: '🔒' },
  unavailable: { label: 'Unavailable', glyph: '—' },
  error: { label: 'Unavailable right now', glyph: '⚠' },
};

export function ItemStatusBadge({ status }: { status: OnboardingItemStatus }) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span className={`rp-status rp-status-${status}`}>
      {/* The glyph is decorative: the adjacent text is the accessible label. */}
      <span aria-hidden="true" className="rp-status-glyph">
        {presentation.glyph}
      </span>
      <span className="rp-status-label">{presentation.label}</span>
    </span>
  );
}

/**
 * Byte counter for a multiline field. The server's limit is in bytes, so bytes
 * are the primary number; characters are secondary information only.
 */
export function ByteCounter({ value, maxBytes }: { value: string; maxBytes: number }) {
  const usedBytes = new TextEncoder().encode(value).byteLength;
  const overLimit = usedBytes > maxBytes;

  return (
    <p className={`rp-byte-counter${overLimit ? ' rp-byte-counter-over' : ''}`}>
      <span aria-live="polite">
        {usedBytes.toLocaleString()} of {maxBytes.toLocaleString()} bytes
      </span>
      <span className="rp-byte-counter-secondary">
        {' '}
        ({value.length.toLocaleString()} characters)
      </span>
      {overLimit ? <span className="rp-byte-counter-warning"> — too long to save</span> : null}
    </p>
  );
}

/**
 * Result of the last mutation. `accepted` deliberately does not read as
 * success: only a checked source save may be reported as saved.
 */
export function PersistenceNotice({ result }: { result: OnboardingPersistenceResult | undefined }) {
  if (!result) {
    return null;
  }

  const message =
    result === 'saved'
      ? 'Saved.'
      : result === 'accepted'
        ? 'Accepted — waiting for the world to save it.'
        : 'That change could not be saved. Nothing was altered.';

  return (
    <p className={`rp-persistence rp-persistence-${result}`} role="status">
      {message}
    </p>
  );
}

/**
 * Server-authored warning shown before an irreversible choice. Rendered only
 * when the MUD supplies the text; the browser never invents a warning.
 */
export function IrreversibleWarning({ warning }: { warning: string | undefined }) {
  if (!warning) {
    return null;
  }

  return (
    <p className="rp-irreversible">
      <span aria-hidden="true">⚠ </span>
      {warning}
    </p>
  );
}

/** Source-owned pagination. The browser never filters an authoritative list. */
export function CatalogPager({
  index,
  count,
  totalItems,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  disabled,
}: {
  index: number;
  count: number;
  totalItems?: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  disabled: boolean;
}) {
  if (count <= 1) {
    return null;
  }

  return (
    <nav className="rp-pager" aria-label="Catalog pages">
      <button type="button" onClick={onPrevious} disabled={disabled || !canPrevious || index <= 0}>
        Previous
      </button>
      <p aria-live="polite">
        Page {index + 1} of {count}
        {totalItems === undefined ? '' : ` — ${totalItems.toLocaleString()} options`}
      </p>
      <button type="button" onClick={onNext} disabled={disabled || !canNext || index >= count - 1}>
        Next
      </button>
    </nav>
  );
}
