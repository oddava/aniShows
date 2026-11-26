import { useState } from 'react';
import { Eye, EyeOff, Film, Trash2, User } from 'lucide-react';

import { adminApi } from '../api';
import { useAdminAction, useAdminList, useListParams, useRole, useSelection } from '../hooks';
import { formatDateTime, formatNumber, formatRelative } from '../format';
import {
    Button, Chip, ConfirmDialog, DataTable, EmptyState, FilterSelect, Menu, PageHeader, Pagination, Panel,
    SearchInput, Toolbar, UserCell,
} from '../ui';
import BulkReviewActions from './community/BulkReviewActions';
import ReviewDrawer, { REVIEW_INVALIDATE } from './community/ReviewDrawer';
import { FilterChip, RATING_OPTIONS, Rating, useOpenParam } from './community/shared';

const DEFAULTS = {
    ordering: '-created_at',
    has_spoilers: '',
    min_rating: '',
    max_rating: '',
    user: '',
    anime: '',
};

/** "User: kaito" when the rows tell us the name, else "User #12". */
function linkedName(rows, key, id, field) {
    const match = rows.find((row) => String(row[key]?.id) === String(id));
    return match?.[key]?.[field] || `#${id}`;
}

/**
 * Every review on the site: search, filter by spoilers, rating, author or
 * anime; open one to read it whole, flag it as a spoiler or delete it.
 */
export default function Reviews() {
    const { isSuperuser } = useRole();
    const list = useListParams(DEFAULTS);
    const { values } = list;
    const reviews = useAdminList('reviews', list.apiParams, { onVanishedPage: list.setPage });
    const selection = useSelection({ ...values, q: list.search });
    const [openId, setOpenId] = useOpenParam();
    const [deleting, setDeleting] = useState(null);

    const toggleSpoiler = useAdminAction(
        (id) => adminApi.post(`reviews/${id}/toggle_spoiler`),
        {
            invalidate: REVIEW_INVALIDATE,
            success: (data) => (data?.has_spoilers ? 'Marked as containing spoilers.' : 'Spoiler flag removed.'),
            error: 'Could not change the spoiler flag.',
        },
    );

    const remove = useAdminAction(
        ({ id, reason }) => adminApi.del(`reviews/${id}`, undefined, { reason }),
        {
            invalidate: REVIEW_INVALIDATE,
            success: 'Review removed. The author has been told why.',
            error: 'Could not remove the review.',
            onSuccess: (_data, { id }) => {
                setDeleting(null);
                if (selection.has(id)) selection.toggle(id);
            },
        },
    );

    const columns = [
        {
            key: 'review',
            header: 'Review',
            primary: true,
            cell: (row) => (
                <span className="block min-w-0 max-w-md">
                    <button
                        type="button"
                        onClick={() => setOpenId(row.id)}
                        className="line-clamp-1 text-left font-medium text-[var(--text-1)] hover:text-[var(--signature)]"
                    >
                        {row.anime?.title || 'Deleted anime'}
                    </button>
                    <span className="mt-0.5 line-clamp-1 text-xs text-[var(--text-3)]">
                        {row.text?.trim() ? row.text : 'No text, only a rating.'}
                    </span>
                </span>
            ),
        },
        {
            key: 'author',
            header: 'Author',
            cell: (row) => <UserCell user={row.user} avatarSize="xs" />,
        },
        {
            key: 'rating',
            header: 'Rating',
            sortKey: 'rating',
            align: 'right',
            width: '6rem',
            cell: (row) => <Rating value={row.rating} />,
        },
        {
            key: 'flags',
            header: 'Flags',
            phoneLabel: 'Flags',
            cell: (row) => (
                <span className="inline-flex flex-wrap gap-1.5">
                    {row.has_spoilers && <Chip tone="warning">Contains spoilers</Chip>}
                    {Number(row.report_count) > 0 && <Chip tone="danger">{formatNumber(row.report_count)} reported</Chip>}
                    {!row.has_spoilers && !(Number(row.report_count) > 0) && <span className="text-[var(--text-3)]">—</span>}
                </span>
            ),
        },
        {
            key: 'created_at',
            header: 'Written',
            sortKey: 'created_at',
            width: '9rem',
            cell: (row) => <span title={formatDateTime(row.created_at)} className="text-[var(--text-2)]">{formatRelative(row.created_at)}</span>,
        },
        {
            key: 'actions',
            actions: true,
            cell: (row) => (
                <Menu
                    label={`Actions for the review of ${row.anime?.title || 'this anime'}`}
                    items={[
                        { label: 'Open review', onSelect: () => setOpenId(row.id) },
                        {
                            label: row.has_spoilers ? 'Remove spoiler flag' : 'Mark as spoiler',
                            icon: row.has_spoilers ? Eye : EyeOff,
                            onSelect: () => toggleSpoiler.mutate(row.id),
                        },
                        'divider',
                        { label: 'More by this author', icon: User, onSelect: () => list.set({ user: row.user?.id }), hidden: !row.user?.id },
                        { label: 'More on this anime', icon: Film, onSelect: () => list.set({ anime: row.anime?.id }), hidden: !row.anime?.id },
                        'divider',
                        { label: 'Remove review', icon: Trash2, tone: 'danger', onSelect: () => setDeleting(row) },
                    ]}
                />
            ),
        },
    ];

    const minOptions = RATING_OPTIONS.filter((option) => !values.max_rating || Number(option.value) <= Number(values.max_rating));
    const maxOptions = RATING_OPTIONS.filter((option) => !values.min_rating || Number(option.value) >= Number(values.min_rating));

    return (
        <>
            <PageHeader
                title="Reviews"
                description="Everything members have written. Open a review to read it whole, flag spoilers or delete it."
                actions={<Button variant="secondary" to="/admin/moderation">Report queue</Button>}
            />

            <Panel>
                <Toolbar>
                    <SearchInput
                        value={list.searchInput}
                        onChange={list.setSearchInput}
                        placeholder="Search text, authors or anime"
                    />
                    <FilterSelect
                        label="Spoilers"
                        allLabel="Spoilers or not"
                        value={values.has_spoilers}
                        onChange={(value) => list.set({ has_spoilers: value })}
                        options={[{ value: 'true', label: 'Contains spoilers' }, { value: 'false', label: 'No spoilers' }]}
                    />
                    <FilterSelect
                        label="Lowest rating"
                        allLabel="Rated from 1"
                        value={values.min_rating}
                        onChange={(value) => list.set({ min_rating: value })}
                        options={minOptions.map((option) => ({ ...option, label: `Rated from ${option.label}` }))}
                        className="!min-w-[8.5rem]"
                    />
                    <FilterSelect
                        label="Highest rating"
                        allLabel="Up to 10"
                        value={values.max_rating}
                        onChange={(value) => list.set({ max_rating: value })}
                        options={maxOptions.map((option) => ({ ...option, label: `Up to ${option.label}` }))}
                        className="!min-w-[8rem]"
                    />
                    {values.user && (
                        <FilterChip
                            label={`User: ${linkedName(reviews.rows, 'user', values.user, 'username')}`}
                            onRemove={() => list.set({ user: '' })}
                        />
                    )}
                    {values.anime && (
                        <FilterChip
                            label={`Anime: ${linkedName(reviews.rows, 'anime', values.anime, 'title')}`}
                            onRemove={() => list.set({ anime: '' })}
                        />
                    )}
                </Toolbar>

                <DataTable
                    caption="Reviews"
                    columns={columns}
                    rows={reviews.rows}
                    loading={reviews.isInitialLoading}
                    fetching={reviews.isFetching}
                    error={reviews.error}
                    onRetry={() => reviews.refetch()}
                    sort={{ value: values.ordering, onChange: (ordering) => list.set({ ordering }) }}
                    selection={isSuperuser ? selection : undefined}
                    onRowClick={(row) => setOpenId(row.id)}
                    empty={list.isFiltered ? (
                        <EmptyState
                            title="No reviews match"
                            compact
                            actions={<Button variant="secondary" onClick={list.reset}>Clear filters</Button>}
                        >
                            Try a wider rating range or a shorter search.
                        </EmptyState>
                    ) : (
                        <EmptyState title="No reviews yet" compact>Reviews members write show up here.</EmptyState>
                    )}
                />
                <Pagination
                    page={list.page}
                    totalPages={reviews.totalPages}
                    count={reviews.count}
                    pageSize={list.pageSize}
                    onChange={list.setPage}
                />
            </Panel>

            {isSuperuser && <BulkReviewActions selection={selection} />}

            <ConfirmDialog
                open={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                title="Remove this review?"
                tone="danger"
                confirmLabel="Remove review"
                reason={{ label: 'Reason for the author', required: true, placeholder: 'For example: spoils the ending without a warning', hint: 'The author gets an in-app notice with this reason. It is also kept in the audit log.' }}
                busy={remove.isPending}
                onConfirm={({ reason }) => remove.mutate({ id: deleting.id, reason })}
            >
                {deleting && (
                    <>
                        {deleting.user?.username || 'This member'}&rsquo;s review of {deleting.anime?.title || 'this anime'} is
                        removed for everyone, with its votes, reactions and reports. This cannot be undone. To keep it but
                        hide the text behind a warning, mark it as a spoiler instead.
                    </>
                )}
            </ConfirmDialog>

            <ReviewDrawer
                reviewId={openId}
                onClose={() => setOpenId(null)}
                onDeleted={() => {
                    const id = Number(openId);
                    if (selection.has(id)) selection.toggle(id);
                }}
            />
        </>
    );
}
