import PropTypes from 'prop-types';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import useMediaQuery from '../../../hooks/useMediaQuery';

/** Below Tailwind's `sm` breakpoint the table renders as stacked cards. */
export const PHONE_QUERY = '(max-width: 639px)';

const CHECKBOX = 'w-4 h-4 rounded border-white/20 bg-white/5 text-violet-500 focus:ring-violet-500';

const defaultRowLabel = (item) => item.name || item.title || item.username || `row ${item.id}`;

/** `'-name'` becomes `{ field: 'name', direction: 'desc' }`. */
const parseOrdering = (ordering) => {
  if (!ordering) return { field: null, direction: null };
  return ordering.startsWith('-')
    ? { field: ordering.slice(1), direction: 'desc' }
    : { field: ordering, direction: 'asc' };
};

/**
 * Admin list table. Sorting is server-side: a sortable header is a button that
 * calls `onSort(nextOrdering)` with a DRF `ordering` value ('username' /
 * '-username'); the page refetches. Rows never act on click: pass `onView` for
 * an explicit "View" button. On phones each row becomes a card.
 */
const DataTable = ({
  columns,
  data,
  loading = false,
  selectable = false,
  selectedRows = [],
  onSelectionChange,
  ordering = '',
  onSort,
  onView,
  emptyMessage = 'No data found',
  keyExtractor = (item) => item.id,
  rowLabel = defaultRowLabel,
}) => {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const sort = parseOrdering(ordering);

  const sortFieldOf = (column) => column.sortKey || column.key;
  const isSortable = (column) => Boolean(onSort && column.sortable);

  const handleSort = (column) => {
    const field = sortFieldOf(column);
    const nextDesc = sort.field === field && sort.direction === 'asc';
    onSort(nextDesc ? `-${field}` : field);
  };

  const allSelected = data.length > 0 && data.every((item) => selectedRows.includes(keyExtractor(item)));

  const handleSelectAll = (e) => {
    onSelectionChange?.(e.target.checked ? data.map(keyExtractor) : []);
  };

  const handleSelectRow = (id) => {
    if (!onSelectionChange) return;
    onSelectionChange(
      selectedRows.includes(id) ? selectedRows.filter((rowId) => rowId !== id) : [...selectedRows, id],
    );
  };

  if (loading) {
    return (
      <div role="status" className="flex flex-col items-center justify-center py-12 text-white/60">
        <div aria-hidden="true" className="w-10 h-10 border-2 border-violet-500/20 border-t-violet-500 rounded-full animate-spin mb-4" />
        <p>Loading data...</p>
      </div>
    );
  }

  const viewButton = (item) => (
    <button
      type="button"
      onClick={() => onView(item)}
      aria-label={`View ${rowLabel(item)}`}
      className="px-3 py-1.5 min-h-[44px] sm:min-h-0 text-sm bg-white/10 text-white/80 rounded-lg hover:bg-white/20 transition-colors"
    >
      View
    </button>
  );

  if (isPhone) {
    const fields = columns.filter((column) => column.key !== 'actions');
    const actions = columns.find((column) => column.key === 'actions');
    return (
      <div>
        {selectable && data.length > 0 && (
          <label className="flex items-center gap-3 px-4 min-h-[44px] text-sm text-white/70 border-b border-white/5">
            <input type="checkbox" checked={allSelected} onChange={handleSelectAll} className={CHECKBOX} />
            Select all
          </label>
        )}
        {data.length === 0 ? (
          <p className="px-4 py-12 text-center text-white/40">{emptyMessage}</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.map((item) => {
              const itemKey = keyExtractor(item);
              const isSelected = selectedRows.includes(itemKey);
              return (
                <li
                  key={itemKey}
                  data-testid="admin-card"
                  className={`px-4 py-4 space-y-2 ${isSelected ? 'bg-violet-500/10' : ''}`}
                >
                  {selectable && (
                    <label className="flex items-center gap-3 min-h-[44px] text-sm text-white/70">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectRow(itemKey)}
                        aria-label={`Select ${rowLabel(item)}`}
                        className={CHECKBOX}
                      />
                      Select
                    </label>
                  )}
                  <dl className="space-y-1.5">
                    {fields.map((column) => (
                      <div key={column.key} className="flex justify-between gap-4 text-sm">
                        <dt className="text-white/50 shrink-0">{column.title}</dt>
                        <dd className="text-white/85 text-right min-w-0 break-words">
                          {column.render ? column.render(item) : item[column.key]}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {(actions || onView) && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 [&_a]:min-h-[44px] [&_button]:min-h-[44px] [&_a]:inline-flex [&_a]:items-center">
                      {onView && viewButton(item)}
                      {actions?.render?.(item)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-white/5 border-b border-white/5">
            {selectable && (
              <th scope="col" className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={handleSelectAll}
                  aria-label="Select all rows"
                  className={CHECKBOX}
                />
              </th>
            )}
            {columns.map((column) => {
              const sortable = isSortable(column);
              const active = sortable && sort.field === sortFieldOf(column);
              const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : (sortable ? 'none' : undefined);
              const SortIcon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50"
                  style={{ width: column.width }}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-white/80 ${active ? 'text-violet-300' : ''}`}
                    >
                      {column.title}
                      <SortIcon size={12} aria-hidden="true" />
                    </button>
                  ) : column.title}
                </th>
              );
            })}
            {onView && <th scope="col" className="px-4 py-3"><span className="sr-only">View</span></th>}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0) + (onView ? 1 : 0)}
                className="px-4 py-12 text-center text-white/40"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item) => {
              const itemKey = keyExtractor(item);
              const isSelected = selectedRows.includes(itemKey);
              return (
                <tr
                  key={itemKey}
                  className={`border-b border-white/5 transition-colors ${isSelected ? 'bg-violet-500/10' : 'hover:bg-violet-500/5'}`}
                >
                  {selectable && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectRow(itemKey)}
                        aria-label={`Select ${rowLabel(item)}`}
                        className={CHECKBOX}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={`${itemKey}-${column.key}`} className="px-4 py-3 text-sm text-white/85">
                      {column.render ? column.render(item) : item[column.key]}
                    </td>
                  ))}
                  {onView && <td className="px-4 py-3 text-right">{viewButton(item)}</td>}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

DataTable.propTypes = {
  columns: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    title: PropTypes.node,
    render: PropTypes.func,
    sortable: PropTypes.bool,
    sortKey: PropTypes.string,
    width: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  })).isRequired,
  data: PropTypes.array.isRequired,
  loading: PropTypes.bool,
  selectable: PropTypes.bool,
  selectedRows: PropTypes.array,
  onSelectionChange: PropTypes.func,
  ordering: PropTypes.string,
  onSort: PropTypes.func,
  onView: PropTypes.func,
  emptyMessage: PropTypes.node,
  keyExtractor: PropTypes.func,
  rowLabel: PropTypes.func,
};

export default DataTable;
