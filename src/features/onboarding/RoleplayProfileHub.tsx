/**
 * The role-play profile hub.
 *
 * Deliberately a hub, not a wizard: almost everything here is optional, and
 * presenting it as a linear sequence would make skipped items read as failed
 * mandatory steps. Item order, status, mutability, and reasons are all
 * server-authored.
 */

import { MediaImage } from './MediaImage.tsx';
import { ItemStatusBadge, PersistenceNotice } from './RoleplayPrimitives.tsx';
import { roleplayItemMediaKeys } from './media-manifest.ts';
import type { ScreenProps } from './screen-props.ts';

export function RoleplayProfileHub({ state, ui, onAction }: ScreenProps) {
  const items = state.profile ?? [];
  const requiredItems = items.filter((item) => item.required);
  const settable = items.filter((item) => item.mutable);
  const configured = items.filter((item) => item.status === 'configured');

  return (
    <div className="rp-hub">
      <PersistenceNotice result={state.persistenceResult} />

      {/* The hub owns its own completion summary. The creation progress rail
          ends at the role-play decision, so optional items never appear there
          as unfinished mandatory steps. */}
      <p className="rp-hub-summary" aria-live="polite">
        {configured.length} of {settable.length} optional details filled in
        {requiredItems.length > 0
          ? ` — ${requiredItems.length} still required before you can enter the world`
          : ''}
        .
      </p>

      {items.length === 0 ? (
        <p className="rp-empty">The world offered no profile options for this character.</p>
      ) : (
        <ul className="rp-hub-list">
          {items.map((item) => {
            const mediaKey = item.mediaKey ?? roleplayItemMediaKeys[item.id] ?? undefined;
            return (
              <li key={item.id} className={`rp-hub-item rp-hub-item-${item.status}`}>
                <button
                  type="button"
                  className="rp-hub-button"
                  // Closed items stay visible and readable but inert, so the
                  // player can see what exists and why it is unavailable.
                  disabled={!item.mutable || ui.pending}
                  onClick={() => onAction('open', { choiceId: item.id })}
                  aria-describedby={item.reason ? `${item.id}-reason` : undefined}
                >
                  {mediaKey ? (
                    <MediaImage mediaKey={mediaKey} rendition="thumb" className="rp-hub-image" />
                  ) : null}
                  <span className="rp-hub-text">
                    <span className="rp-hub-label">{item.label}</span>
                    <ItemStatusBadge status={item.status} />
                    {item.summary ? <span className="rp-hub-value">{item.summary}</span> : null}
                  </span>
                </button>
                {item.reason ? (
                  <p className="rp-hub-reason" id={`${item.id}-reason`}>
                    {item.reason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {state.actions.includes('quit') ? (
        <div className="rp-actions">
          <button type="button" onClick={() => onAction('quit')} disabled={ui.pending}>
            Done for now
          </button>
        </div>
      ) : null}
    </div>
  );
}
