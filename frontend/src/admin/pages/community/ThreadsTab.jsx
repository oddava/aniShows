import { useMemo } from 'react';
import { FolderInput, Lock, Pin, PinOff, RotateCcw, Trash2, Unlock } from 'lucide-react';

import { cleanParams } from '../../api';
import { useAdminList, useListParams, useRole } from '../../hooks';
import { formatDateTime, formatNumber, formatRelative } from '../../format';
import {
    Button, DataTable, EmptyState, FilterSelect, Menu, Pagination, SearchInput, Select, Toolbar, withCurrentSort,
} from '../../ui';
import { THREADS, ThreadStateChips, useForumCategories, useThreadActions } from './forumActions';
import ThreadDrawer from './ThreadDrawer';
import { FilterChip, useOpenParam } from './shared';

const STATE_FILTERS = {
    visible: { is_removed: 'false' },
    removed: { is_removed: 'true' },
    pinned: { is_pinned: 'true' },
    locked: { is_locked: 'true' },
};

const SORTS = [
    { value: '-created_at', label: 'Newest first' },
    { value: 'created_at', label: 'Oldest first' },
    { value: '-updated_at', label: 'Last activity' },
    { value: '-reply_count', label: 'Most replies' },
    { value: '-view_count', label: 'Most views' },
];

export default function ThreadsTab() {
    const { isSuperuser } = useRole();
    const list = useListParams({ ordering: '-created_at', category: '', state: '', author: '' });
    const { values } = list;
    const categories = useForumCategories();
    const [openId, setOpenId] = useOpenParam();
    const actions = useThreadActions({ onDeleted: () => setOpenId(null) });

    const apiParams = useMemo(() => {
        const { state, ...rest } = list.apiParams;
        return cleanParams({ ...rest, ...(STATE_FILTERS[state] || {}) });
    }, [list.apiParams]);
    const threads = useAdminList(THREADS, apiParams, { onVanishedPage: list.setPage });

    const authorName = threads.rows.find((row) => String(row.author?.id) === String(values.author))?.author?.username;

    const columns = [
        {
            key: 'title',
            header: 'Thread',
            primary: true,
            cell: (row) => (
                <span className="block min-w-0 max-w-lg">
                    <button
                        type="button"
                        onClick={() => setOpenId(row.id)}
                        className={`line-clamp-1 text-left font-medium hover:text-[var(--signature)] ${row.is_removed ? 'text-[var(--text-2)]' : 'text-[var(--text-1)]'}`}
                    >
                        {row.title}
                    </button>
                    <span className="mt-0.5 block truncate text-xs text-[var(--text-3)]">
                        {row.category?.name || 'No category'} · by {row.author?.username || 'deleted user'}
                    </span>
                </span>
            ),
        },
        { key: 'state', header: 'State', cell: (row) => <ThreadStateChips thread={row} /> },
        { key: 'replies', header: 'Replies', sortKey: 'reply_count', align: 'right', width: '6rem', cell: (row) => formatNumber(row.reply_count) },
        { key: 'views', header: 'Views', sortKey: 'view_count', align: 'right', width: '6rem', cell: (row) => formatNumber(row.view_count) },
        {
            key: 'created_at',
            header: 'Started',
            sortKey: 'created_at',
            width: '8.5rem',
            cell: (row) => <span title={formatDateTime(row.created_at)} className="text-[var(--text-2)]">{formatRelative(row.created_at)}</span>,
        },
        {
            key: 'actions',
            actions: true,
            cell: (row) => (
                <Menu
                    label={`Actions for ${row.title}`}
                    items={[
                        { label: 'Open thread', onSelect: () => setOpenId(row.id) },
                        { label: row.is_pinned ? 'Unpin' : 'Pin to the top', icon: row.is_pinned ? PinOff : Pin, onSelect: () => actions.togglePin(row) },
                        { label: row.is_locked ? 'Unlock replies' : 'Lock replies', icon: row.is_locked ? Unlock : Lock, onSelect: () => actions.toggleLock(row) },
                        { label: 'Move to another category', icon: FolderInput, onSelect: () => actions.request('move', row) },
                        'divider',
                        row.is_removed
                            ? { label: 'Restore thread', icon: RotateCcw, onSelect: () => actions.restore(row) }
                            : { label: 'Remove thread', icon: Trash2, tone: 'danger', onSelect: () => actions.request('remove', row) },
                        { label: 'Delete permanently', icon: Trash2, tone: 'danger', hidden: !isSuperuser, onSelect: () => actions.request('delete', row) },
                    ]}
                />
            ),
        },
    ];

    return (
        <>
            <Toolbar>
                <SearchInput value={list.searchInput} onChange={list.setSearchInput} placeholder="Search titles, text or authors" />
                <FilterSelect
                    label="Category"
                    allLabel="All categories"
                    value={values.category}
                    onChange={(value) => list.set({ category: value })}
                    options={categories.map((category) => ({ value: String(category.id), label: category.name }))}
                />
                <FilterSelect
                    label="State"
                    allLabel="Any state"
                    value={values.state}
                    onChange={(value) => list.set({ state: value })}
                    options={[
                        { value: 'visible', label: 'Visible' },
                        { value: 'removed', label: 'Removed' },
                        { value: 'pinned', label: 'Pinned' },
                        { value: 'locked', label: 'Locked' },
                    ]}
                />
                <Select
                    label="Sort threads"
                    value={values.ordering}
                    onChange={(ordering) => list.set({ ordering })}
                    options={withCurrentSort(SORTS, values.ordering)}
                    className="!w-auto min-w-[9.5rem] max-md:hidden"
                />
                {values.author && (
                    <FilterChip label={`Author: ${authorName || `#${values.author}`}`} onRemove={() => list.set({ author: '' })} />
                )}
            </Toolbar>

            <DataTable
                caption="Forum threads"
                columns={columns}
                rows={threads.rows}
                loading={threads.isInitialLoading}
                fetching={threads.isFetching}
                error={threads.error}
                onRetry={() => threads.refetch()}
                sort={{ value: values.ordering, onChange: (ordering) => list.set({ ordering }), options: SORTS }}
                onRowClick={(row) => setOpenId(row.id)}
                empty={list.isFiltered ? (
                    <EmptyState title="No threads match" compact actions={<Button variant="secondary" onClick={list.reset}>Clear filters</Button>}>
                        Try another category or state.
                    </EmptyState>
                ) : (
                    <EmptyState title="No threads yet" compact>Threads members start show up here.</EmptyState>
                )}
            />
            <Pagination page={list.page} totalPages={threads.totalPages} count={threads.count} pageSize={list.pageSize} onChange={list.setPage} />

            <ThreadDrawer threadId={openId} onClose={() => setOpenId(null)} actions={actions} />
            {actions.dialogs}
        </>
    );
}
