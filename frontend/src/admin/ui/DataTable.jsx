import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';

import useMediaQuery from '../../hooks/useMediaQuery';
import EmptyState from '../../components/ui/EmptyState';
import Skeleton from '../../components/ui/Skeleton';
import { formatNumber } from '../format';
import { Checkbox, Select, withCurrentSort } from './Inputs';
import { ErrorState } from './Feedback';

const PHONE_QUERY = '(max-width: 47.99rem)';

const INTERACTIVE = 'a, button, input, select, textarea, label, [data-no-row-click]';

/**
 * A plain click on a row: focus the row's own link or button first, so a
 * drawer it opens hands focus back to that row when it closes.
 */
const clickRow = (event, row, onRowClick) => {
    if (isInteractive(event.target, event.currentTarget)) return;
    event.currentTarget.querySelector('a[href], button')?.focus({ preventScroll: true });
    onRowClick(row);
};

/** A click on a control inside the row does its own thing, not the row's. */
const isInteractive = (target, row) => {
    const hit = target.closest?.(INTERACTIVE);
    return Boolean(hit && row.contains(hit));
};

/**
 * The admin list. A borderless table on desktop (rows get a soft fill on
 * hover and selection); stacked cards on phones.
 *
 * columns: [{
 *   key, header, cell: (row) => node,
 *   sortKey?        - API ordering field; the header becomes a sort button,
 *   align?          - 'right' for numbers,
 *   width?          - CSS width ('8rem'),
 *   primary?        - the card title on phones (one column),
 *   actions?        - the trailing actions cell (kept top-right on phones),
 *   hideOnPhone?    - leave out of the phone card,
 *   className?
 * }]
 *
 * sort: { value: '-date_joined', onChange(nextOrdering), options? }
 *   options: the page's own "Sort by" list; on phones it replaces the
 *   generated one. A page that shows its own sort menu in the toolbar hides
 *   it below md (`max-md:hidden`), so phones show exactly one.
 * selection: useSelection() result (adds a checkbox column)
 * onRowClick(row): mouse convenience only; every row must still contain a
 *   link or button that does the same, so keyboard users get there too.
 */
export default function DataTable({
    columns,
    rows,
    rowKey = (row) => row.id,
    loading = false,
    fetching = false,
    error,
    onRetry,
    empty,
    sort,
    selection,
    onRowClick,
    caption,
    skeletonRows = 8,
    rowTone,
}) {
    const isPhone = useMediaQuery(PHONE_QUERY);
    const showSkeleton = loading && rows.length === 0;

    if (error && rows.length === 0) {
        return <ErrorState error={error} onRetry={onRetry} />;
    }

    if (!showSkeleton && rows.length === 0) {
        return empty || <EmptyState title="Nothing here" compact>No records match this view.</EmptyState>;
    }

    const pageIds = rows.map(rowKey);
    const selectedOnPage = selection ? pageIds.filter((id) => selection.has(id)).length : 0;

    if (isPhone) {
        return (
            <>
                <PhoneControls
                    columns={columns}
                    sort={sort}
                    selection={selection}
                    pageIds={pageIds}
                    selectedOnPage={selectedOnPage}
                    disabled={showSkeleton}
                />
                <PhoneCards
                columns={columns}
                rows={rows}
                rowKey={rowKey}
                showSkeleton={showSkeleton}
                skeletonRows={skeletonRows}
                selection={selection}
                onRowClick={onRowClick}
                fetching={fetching}
                />
            </>
        );
    }

    return (
        <div className={`-mx-2 overflow-x-auto custom-scrollbar transition-opacity ${fetching && !showSkeleton ? 'opacity-70' : ''}`} aria-busy={fetching || loading || undefined}>
            <table className="admin-table w-full min-w-[40rem] border-separate border-spacing-x-0 border-spacing-y-0.5 text-sm">
                {caption && <caption className="sr-only">{caption}</caption>}
                <thead>
                    <tr>
                        {selection && (
                            <th scope="col" className="w-10 px-2 pb-2 text-left">
                                <Checkbox
                                    label="Select all on this page"
                                    checked={selectedOnPage > 0 && selectedOnPage === pageIds.length}
                                    indeterminate={selectedOnPage > 0 && selectedOnPage < pageIds.length}
                                    onChange={(on) => selection.setMany(pageIds, on)}
                                    disabled={showSkeleton}
                                />
                            </th>
                        )}
                        {columns.map((column) => (
                            <HeaderCell key={column.key} column={column} sort={sort} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {showSkeleton
                        ? Array.from({ length: skeletonRows }, (_, index) => (
                            <tr key={`skeleton-${index}`} aria-hidden="true">
                                {selection && <td className="px-2 py-3.5"><Skeleton className="h-4 w-4" /></td>}
                                {columns.map((column, columnIndex) => (
                                    <td key={column.key} className="px-3 py-3.5">
                                        <Skeleton className={`h-3.5 ${columnIndex === 0 ? 'w-3/4' : 'w-1/2'} ${column.align === 'right' ? 'ml-auto' : ''}`} />
                                    </td>
                                ))}
                            </tr>
                        ))
                        : rows.map((row) => {
                            const id = rowKey(row);
                            const selected = selection?.has(id);
                            return (
                                <tr
                                    key={id}
                                    data-row-root
                                    data-selected={selected || undefined}
                                    data-clickable={onRowClick ? 'true' : undefined}
                                    onClick={onRowClick ? (event) => clickRow(event, row, onRowClick) : undefined}
                                    className={rowTone?.(row) || ''}
                                >
                                    {selection && (
                                        <td className="w-10 px-2 py-2.5 align-middle">
                                            <Checkbox
                                                label="Select row"
                                                checked={selected}
                                                onChange={() => selection.toggle(id)}
                                            />
                                        </td>
                                    )}
                                    {columns.map((column) => (
                                        <td
                                            key={column.key}
                                            style={column.width ? { width: column.width } : undefined}
                                            className={`px-3 py-2.5 align-middle text-[var(--text-1)] ${column.align === 'right' ? 'text-right tabular' : ''} ${column.actions ? 'w-12 !py-1 text-right' : ''} ${column.className || ''}`}
                                        >
                                            {column.cell(row)}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                </tbody>
            </table>
        </div>
    );
}

function HeaderCell({ column, sort }) {
    const base = `px-3 pb-2 text-xs font-medium text-[var(--text-3)] ${column.align === 'right' ? 'text-right' : 'text-left'}`;
    if (column.actions) {
        return <th scope="col" className={base}><span className="sr-only">{column.header || 'Actions'}</span></th>;
    }
    if (!column.sortKey || !sort) {
        return <th scope="col" style={column.width ? { width: column.width } : undefined} className={base}>{column.header}</th>;
    }
    const current = sort.value || '';
    const ascending = current === column.sortKey;
    const descending = current === `-${column.sortKey}`;
    const ariaSort = ascending ? 'ascending' : descending ? 'descending' : 'none';
    const next = descending ? column.sortKey : ascending ? `-${column.sortKey}` : (column.sortFirst === 'asc' ? column.sortKey : `-${column.sortKey}`);
    const Icon = ascending ? ArrowUp : descending ? ArrowDown : ChevronsUpDown;
    return (
        <th scope="col" aria-sort={ariaSort} style={column.width ? { width: column.width } : undefined} className={base}>
            <button
                type="button"
                onClick={() => sort.onChange(next)}
                className={`-mx-1.5 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 transition-colors hover:text-[var(--text-1)] ${ascending || descending ? 'text-[var(--text-1)]' : ''}`}
            >
                {column.header}
                <Icon className={`h-3.5 w-3.5 ${ascending || descending ? '' : 'opacity-50'}`} aria-hidden="true" />
            </button>
        </th>
    );
}

/**
 * Phones have no column headers to tap, so sorting and "select all" sit in a
 * small bar above the cards.
 */
function PhoneControls({ columns, sort, selection, pageIds, selectedOnPage, disabled }) {
    const sortable = sort ? columns.filter((column) => column.sortKey) : [];
    // A page's own wording ("Newest first") wins over column names.
    const options = sort?.options
        ? withCurrentSort(sort.options, sort.value)
        : sortable.flatMap((column) => {
            const name = column.phoneLabel || column.header;
            return [
                { value: `-${column.sortKey}`, label: `${name}, descending` },
                { value: column.sortKey, label: `${name}, ascending` },
            ];
        });
    const canSort = Boolean(sort) && options.length > 0;
    if (!selection && !canSort) return null;
    if (!sort?.options && sort?.value && !options.some((option) => option.value === sort.value)) {
        options.unshift({ value: sort.value, label: 'Current order' });
    }
    return (
        <div className="mb-3 flex items-center justify-between gap-3">
            {selection ? (
                <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--text-2)]">
                    <Checkbox
                        checked={selectedOnPage > 0 && selectedOnPage === pageIds.length}
                        indeterminate={selectedOnPage > 0 && selectedOnPage < pageIds.length}
                        onChange={(on) => selection.setMany(pageIds, on)}
                        disabled={disabled}
                    />
                    Select all
                </label>
            ) : <span />}
            {canSort && (
                <Select
                    label="Sort by"
                    value={sort.value || ''}
                    onChange={(value) => sort.onChange(value)}
                    options={sort.value ? options : [{ value: '', label: 'Default order' }, ...options]}
                    className="!w-auto max-w-[60%]"
                />
            )}
        </div>
    );
}

function PhoneCards({ columns, rows, rowKey, showSkeleton, skeletonRows, selection, onRowClick, fetching }) {
    const primary = columns.find((column) => column.primary) || columns[0];
    const actions = columns.find((column) => column.actions);
    const details = columns.filter((column) => column !== primary && column !== actions && !column.hideOnPhone);

    if (showSkeleton) {
        return (
            <ul className="space-y-2" aria-hidden="true">
                {Array.from({ length: Math.min(skeletonRows, 5) }, (_, index) => (
                    <li key={index} className="rounded-[var(--radius-md)] bg-white/[0.03] p-3.5">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="mt-3 h-3 w-1/2" />
                        <Skeleton className="mt-2 h-3 w-1/3" />
                    </li>
                ))}
            </ul>
        );
    }

    return (
        <ul className={`space-y-2 transition-opacity ${fetching ? 'opacity-70' : ''}`} aria-busy={fetching || undefined}>
            {rows.map((row) => {
                const id = rowKey(row);
                const selected = selection?.has(id);
                return (
                    <li
                        key={id}
                        data-row-root
                        onClick={onRowClick ? (event) => clickRow(event, row, onRowClick) : undefined}
                        className={`rounded-[var(--radius-md)] p-3.5 transition-colors ${selected ? 'bg-[var(--signature-soft)]' : 'bg-white/[0.03]'} ${onRowClick ? 'cursor-pointer' : ''}`}
                    >
                        <div className="flex items-start gap-3">
                            {selection && (
                                <Checkbox
                                    label="Select row"
                                    checked={selected}
                                    onChange={() => selection.toggle(id)}
                                    className="mt-0.5"
                                />
                            )}
                            <div className="min-w-0 flex-1 text-sm text-[var(--text-1)]">{primary.cell(row)}</div>
                            {actions && <div className="-my-1.5 -mr-1.5 shrink-0">{actions.cell(row)}</div>}
                        </div>
                        {details.length > 0 && (
                            <dl className={`mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 ${selection ? 'pl-[1.875rem]' : ''}`}>
                                {details.map((column) => (
                                    <div key={column.key} className="min-w-0">
                                        <dt className="text-xs text-[var(--text-3)]">{column.phoneLabel || column.header}</dt>
                                        <dd className="mt-0.5 min-w-0 text-sm text-[var(--text-1)] [overflow-wrap:anywhere]">{column.cell(row)}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/** "21–40 of 340" with previous/next. Hidden when everything fits on one page. */
export function Pagination({ page, totalPages, count, pageSize, onChange, className = '' }) {
    if (!count || totalPages <= 1) {
        return count ? (
            <p className={`mt-4 text-sm text-[var(--text-3)] tabular ${className}`}>
                {formatNumber(count)} {count === 1 ? 'result' : 'results'}
            </p>
        ) : null;
    }
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, count);
    return (
        <nav aria-label="Pagination" className={`mt-4 flex flex-wrap items-center justify-between gap-3 ${className}`}>
            <p className="text-sm text-[var(--text-2)] tabular">
                <span className="text-[var(--text-1)]">{formatNumber(from)}–{formatNumber(to)}</span> of {formatNumber(count)}
            </p>
            <div className="flex items-center gap-1">
                <span className="mr-2 text-sm text-[var(--text-3)] tabular">Page {page} of {formatNumber(totalPages)}</span>
                <button
                    type="button"
                    onClick={() => onChange(page - 1)}
                    disabled={page <= 1}
                    aria-label="Previous page"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.05] text-[var(--text-1)] transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-35"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    onClick={() => onChange(page + 1)}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.05] text-[var(--text-1)] transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-35"
                >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>
        </nav>
    );
}

/**
 * Appears at the bottom of the screen while rows are selected:
 * "3 selected · Clear" and the bulk actions.
 */
export function BulkBar({ count, onClear, children, noun = 'selected' }) {
    if (!count) return null;
    return (
        <div className="pointer-events-none sticky bottom-4 z-30 mt-4 flex justify-center [bottom:max(1rem,env(safe-area-inset-bottom))]">
            <div
                role="region"
                aria-label="Bulk actions"
                className="admin-popover pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--ink-3)] py-2 pl-4 pr-2 shadow-[var(--shadow-pop)]"
            >
                <p className="mr-1 text-sm font-medium text-[var(--text-1)] tabular" aria-live="polite">
                    {formatNumber(count)} {noun}
                </p>
                <button type="button" onClick={onClear} className="btn-ghost !min-h-10 text-sm">Clear</button>
                <span className="flex flex-wrap items-center gap-1.5">{children}</span>
            </div>
        </div>
    );
}
