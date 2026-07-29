/**
 * Catalog screens for background, age, region, faction, hometown, and deity.
 *
 * Pagination is source-owned: the browser asks the MUD for the next page and
 * never filters or truncates an authoritative list locally. Unknown runtime
 * entries (factions especially) resolve through the existing category
 * fallbacks, so missing art never blocks a selection.
 */

import { ChoiceGallery } from './ChoiceGallery.tsx';
import { CatalogPager, PersistenceNotice } from './RoleplayPrimitives.tsx';
import type { ScreenProps } from './screen-props.ts';

export function RoleplayCatalog(props: ScreenProps) {
  const { state, ui, onAction } = props;
  const page = state.page;

  return (
    <div className="rp-catalog">
      <PersistenceNotice result={state.persistenceResult} />

      <ChoiceGallery
        {...props}
        layout="grid"
        allowInspect={state.actions.includes('detail')}
        emptyMessage="The world offered no options here yet."
      />

      {page ? (
        <CatalogPager
          index={page.index}
          count={page.count}
          totalItems={page.totalItems}
          canPrevious={state.actions.includes('previous-page')}
          canNext={state.actions.includes('next-page')}
          onPrevious={() => onAction('previous-page')}
          onNext={() => onAction('next-page')}
          disabled={ui.pending}
        />
      ) : null}

      {state.actions.includes('cancel') ? (
        <div className="rp-actions">
          <button type="button" disabled={ui.pending} onClick={() => onAction('cancel')}>
            Back to profile
          </button>
        </div>
      ) : null}
    </div>
  );
}
