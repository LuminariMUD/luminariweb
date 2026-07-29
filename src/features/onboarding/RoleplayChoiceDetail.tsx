/**
 * Detail and confirmation for an irreversible role-play choice: background
 * archetype, homeland region, and deity.
 *
 * Every mechanical fact and every warning shown here comes from the MUD. The
 * browser does not know what a background's feat does, and must never imply it.
 */

import { MediaImage } from './MediaImage.tsx';
import { IrreversibleWarning, PersistenceNotice } from './RoleplayPrimitives.tsx';
import type { ScreenProps } from './screen-props.ts';

export function RoleplayChoiceDetail({ state, ui, onAction }: ScreenProps) {
  const detail = state.detail;

  if (!detail) {
    return (
      <div className="rp-detail">
        <p className="rp-empty">The world sent no details for this choice.</p>
        {state.actions.includes('reselect') ? (
          <button type="button" disabled={ui.pending} onClick={() => onAction('reselect')}>
            Choose something else
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rp-detail">
      <PersistenceNotice result={state.persistenceResult} />

      {detail.mediaKey ? (
        <MediaImage mediaKey={detail.mediaKey} rendition="detail" className="rp-detail-image" />
      ) : null}

      <h3 className="rp-detail-title">{detail.label}</h3>
      {detail.summary ? <p className="rp-detail-summary">{detail.summary}</p> : null}
      {detail.description ? <p className="rp-detail-body">{detail.description}</p> : null}

      {detail.facts && detail.facts.length > 0 ? (
        <dl className="rp-facts">
          {detail.facts.map((fact) => (
            <div key={`${fact.label}:${fact.value}`} className="rp-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <IrreversibleWarning warning={detail.irreversibleWarning} />

      {state.error ? (
        <p className="rp-error" role="alert">
          {state.error.message}
        </p>
      ) : null}

      <div className="rp-actions">
        {state.actions.includes('confirm') ? (
          <button
            type="button"
            className="rp-primary"
            disabled={ui.pending}
            onClick={() => onAction('confirm')}
          >
            Confirm
          </button>
        ) : null}
        {state.actions.includes('reselect') ? (
          <button type="button" disabled={ui.pending} onClick={() => onAction('reselect')}>
            Choose something else
          </button>
        ) : null}
        {state.actions.includes('cancel') ? (
          <button type="button" disabled={ui.pending} onClick={() => onAction('cancel')}>
            Back to profile
          </button>
        ) : null}
      </div>
    </div>
  );
}
