import { useCallback, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useQueryClient } from '@tanstack/react-query';

import api from '../../../api/client';
import ConfirmDialog from './ConfirmDialog';

/** Bulk deletes above this many rows need the count typed out. */
export const TYPED_CONFIRM_THRESHOLD = 10;

const VARIANT = {
  danger: 'bg-red-500/20 text-red-400 hover:bg-red-500/30',
  primary: 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/30',
  default: 'bg-white/10 text-white/80 hover:bg-white/20',
};

/** The selection bar shown above a table while rows are selected. */
const BulkActions = ({ selectedCount, actions = [], onClearSelection }) => {
  if (selectedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-violet-500/10 border-y border-violet-500/20">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-violet-300" aria-live="polite">
          {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-sm text-white/60 hover:text-white transition-colors min-h-[44px] sm:min-h-0"
        >
          Clear selection
        </button>
      </div>

      <div className="flex items-center gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              key={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              className={`px-3 py-1.5 min-h-[44px] sm:min-h-0 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${VARIANT[action.variant] || VARIANT.default}`}
            >
              {Icon && <Icon size={14} aria-hidden="true" />}
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

BulkActions.propTypes = {
  selectedCount: PropTypes.number.isRequired,
  actions: PropTypes.arrayOf(PropTypes.shape({
    label: PropTypes.string.isRequired,
    onClick: PropTypes.func.isRequired,
    icon: PropTypes.elementType,
    variant: PropTypes.oneOf(['danger', 'primary', 'default']),
    disabled: PropTypes.bool,
  })),
  onClearSelection: PropTypes.func,
};

export default BulkActions;

const describeModel = (label) => {
  const name = label.split('.').pop() || label;
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
};

const getDetail = (err, fallback) => err?.response?.data?.detail || fallback;

/**
 * Two-step bulk delete through `/admin/bulk/`: a dry run reports what would be
 * removed (cascades included), the admin confirms in a dialog (typing the count
 * for more than 10 rows), then the delete is sent with `confirm` set to the
 * matched count.
 *
 *   const bulkDelete = useBulkDelete({ entityType: 'genre', noun: 'genres', invalidate });
 *   const done = await bulkDelete.start(ids); // resolves to the response data or null
 *   ...
 *   {bulkDelete.dialog}
 */
export function useBulkDelete({ entityType, noun, invalidate = [], extra = {}, onError }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  const inFlight = useRef(false);

  const close = useCallback((value) => {
    resolver.current?.(value);
    resolver.current = null;
    inFlight.current = false;
    setState(null);
  }, []);

  const start = useCallback(async (ids) => {
    // A second click while the dry run (or the dialog) is pending starts nothing.
    if (inFlight.current) return null;
    inFlight.current = true;
    let preview;
    try {
      const res = await api.post('/admin/bulk/', {
        operation: 'delete',
        entity_type: entityType,
        entity_ids: ids,
        dry_run: true,
        ...extra,
      });
      preview = res.data;
    } catch (err) {
      inFlight.current = false;
      onError?.(getDetail(err, `Failed to check the selected ${noun}`));
      return null;
    }
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({ ids, preview, busy: false });
    });
  }, [entityType, noun, extra, onError]);

  const run = async () => {
    if (!state) return;
    setState((current) => ({ ...current, busy: true }));
    try {
      const res = await api.post('/admin/bulk/', {
        operation: 'delete',
        entity_type: entityType,
        entity_ids: state.ids,
        confirm: String(state.preview.matched),
        ...extra,
      });
      invalidate.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      close(res.data);
    } catch (err) {
      onError?.(getDetail(err, `Failed to delete ${noun}`));
      close(null);
    }
  };

  const matched = state?.preview?.matched ?? 0;
  const byModel = Object.entries(state?.preview?.would_delete_by_model || {});

  const dialog = (
    <ConfirmDialog
      isOpen={state !== null}
      title={`Delete ${matched} ${noun}?`}
      destructive
      busy={state?.busy}
      confirmLabel="Delete"
      confirmDisabled={matched === 0}
      requireText={matched > TYPED_CONFIRM_THRESHOLD ? `delete ${matched}` : undefined}
      message={(
        <>
          <p>{matched === 0 ? 'None of the selected rows still exist.' : 'This cannot be undone. It removes:'}</p>
          {byModel.length > 0 && (
            <ul className="space-y-1">
              {byModel.map(([label, count]) => (
                <li key={label} className="flex justify-between gap-4">
                  <span>{describeModel(label)}</span>
                  <span className="text-white font-medium">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      onConfirm={run}
      onCancel={() => close(null)}
    />
  );

  return { start, dialog };
}
