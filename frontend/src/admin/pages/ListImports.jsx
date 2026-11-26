import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

import { adminApi, adminKeys } from '../api';
import { useAdminList, useAdminQuery, useListParams } from '../hooks';
import { formatDateTime, formatDuration, formatNumber, formatRelative, humanize } from '../format';
import {
    Chip, DataTable, Drawer, EmptyState, ErrorState, FilterChip, FilterSelect, KeyValue, PageHeader, Pagination, Panel,
    PanelSkeleton, SearchInput, Tabs, Toolbar, UserCell,
} from '../ui';
import { DrawerSection, JOB_STATUS_TABS, JobStatusChip, secondsBetween, useOpenParam } from './ops/common';

const RESOURCE = 'user-imports';

/** UserImportJob.ImportSource */
export const SOURCE_LABELS = {
    mal_api: 'MyAnimeList',
    mal_xml: 'MyAnimeList file',
    anilist: 'AniList',
};

const SOURCE_OPTIONS = Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }));

const durationOf = (job) => {
    const seconds = secondsBetween(job.started_at, job.completed_at);
    return seconds === null ? null : formatDuration(seconds * 1000);
};

/** An `errors` / `unmatched` entry from the import: text, or an object with a title. */
function entryText(entry) {
    if (entry === null || entry === undefined) return '';
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'object') {
        const title = entry.title || entry.name || entry.anime_title || entry.series_title;
        const detail = entry.error || entry.reason || entry.message;
        if (title || detail) return [title, detail].filter(Boolean).join(' — ');
    }
    return JSON.stringify(entry);
}

function EntryList({ entries, empty }) {
    if (!entries?.length) return <p className="text-sm text-[var(--text-3)]">{empty}</p>;
    return (
        <ul className="space-y-1.5">
            {entries.map((entry, index) => (
                <li key={index} className="rounded-md bg-white/[0.03] px-3 py-2 text-sm text-[var(--text-2)] [overflow-wrap:anywhere]">
                    {entryText(entry)}
                </li>
            ))}
        </ul>
    );
}

function ImportDrawer({ id, initial, onClose }) {
    const detail = useAdminQuery(
        adminKeys.detail(RESOURCE, id),
        ({ signal }) => adminApi.get(`${RESOURCE}/${id}`, undefined, { signal }),
        { enabled: Boolean(id), placeholderData: initial },
    );
    const job = detail.data;
    const counted = job ? [
        { label: 'Imported', value: formatNumber(job.imported_entries || 0) },
        { label: 'Skipped', value: formatNumber(job.skipped_entries || 0) },
        { label: 'Failed', value: formatNumber(job.failed_entries || 0) },
        { label: 'Processed', value: `${formatNumber(job.processed_entries || 0)} of ${formatNumber(job.total_entries || 0)}` },
    ] : [];

    return (
        <Drawer
            open={Boolean(id)}
            onClose={onClose}
            title={job ? `${SOURCE_LABELS[job.source] || humanize(job.source)} import` : 'List import'}
            description={job?.user?.username ? `For ${job.user.username}` : undefined}
            headerExtra={job && <JobStatusChip status={job.status} />}
        >
            {!job && detail.error ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} compact /> : !job ? (
                <PanelSkeleton lines={6} className="!bg-transparent !p-0" />
            ) : (
                <>
                    <KeyValue items={counted} columns={4} />
                    <div className="mt-5">
                        <KeyValue
                            items={[
                                { label: 'Member', value: job.user ? <Link to={`/admin/users/${job.user.id}`} className="text-[var(--signature)]">{job.user.username}</Link> : null },
                                { label: 'Mode', value: humanize(job.mode) },
                                { label: 'Created', value: formatDateTime(job.created_at) },
                                { label: 'Started', value: formatDateTime(job.started_at) },
                                { label: 'Finished', value: formatDateTime(job.completed_at) },
                                { label: 'Took', value: durationOf(job) },
                            ]}
                        />
                    </div>
                    {job.failure_reason && (
                        <DrawerSection title="Why it failed">
                            <pre className="admin-code !text-[var(--danger)]">{job.failure_reason}</pre>
                        </DrawerSection>
                    )}
                    <DrawerSection title="Errors">
                        {detail.isPlaceholderData && job.errors === undefined
                            ? <PanelSkeleton lines={2} className="!bg-transparent !p-0" />
                            : <EntryList entries={job.errors} empty="No entry errors." />}
                    </DrawerSection>
                    <DrawerSection title="Not matched to the catalog">
                        {detail.isPlaceholderData && job.unmatched === undefined
                            ? <PanelSkeleton lines={2} className="!bg-transparent !p-0" />
                            : <EntryList entries={job.unmatched} empty="Every entry matched an anime." />}
                    </DrawerSection>
                    {(job.errors?.length >= 50 || job.unmatched?.length >= 50) && (
                        <p className="mt-3 text-xs text-[var(--text-3)]">Long lists show their first 50 entries.</p>
                    )}
                </>
            )}
        </Drawer>
    );
}

export default function ListImports() {
    const list = useListParams({ status: '', source: '', user: '', ordering: '-created_at' });
    const [openId, setOpenId] = useOpenParam();
    const imports = useAdminList(RESOURCE, list.apiParams, { onVanishedPage: list.setPage });

    const columns = [
        {
            key: 'user',
            header: 'Member',
            primary: true,
            cell: (job) => (
                <UserCell
                    user={job.user}
                    secondary={
                        <button type="button" onClick={() => setOpenId(job.id)} className="hover:text-[var(--text-1)]">
                            {SOURCE_LABELS[job.source] || humanize(job.source)} · {humanize(job.mode)}
                        </button>
                    }
                />
            ),
        },
        { key: 'status', header: 'Status', cell: (job) => <JobStatusChip status={job.status} /> },
        {
            key: 'result',
            header: 'Imported',
            cell: (job) => (
                <span className="tabular text-sm">
                    {formatNumber(job.imported_entries || 0)}
                    <span className="text-[var(--text-3)]">
                        {' '}· {formatNumber(job.skipped_entries || 0)} skipped
                    </span>
                    {job.failed_entries > 0 && <span className="text-[var(--danger)]"> · {formatNumber(job.failed_entries)} failed</span>}
                </span>
            ),
        },
        {
            key: 'created',
            header: 'Started',
            sortKey: 'created_at',
            cell: (job) => <span className="text-[var(--text-2)]" title={formatDateTime(job.created_at)}>{formatRelative(job.created_at)}</span>,
        },
        { key: 'took', header: 'Took', align: 'right', hideOnPhone: true, cell: (job) => durationOf(job) || <span className="text-[var(--text-3)]">—</span> },
    ];

    const openRow = imports.rows.find((row) => String(row.id) === String(openId));

    return (
        <>
            <PageHeader
                title="List imports"
                description="Members bringing their lists over from MyAnimeList and AniList. Look here when someone says an import went wrong."
            />

            <Tabs
                items={JOB_STATUS_TABS}
                value={list.values.status}
                onChange={(value) => list.set({ status: value })}
                label="Import status"
                panelId="list-imports-panel"
                className="mb-4"
            />

            <Panel id="list-imports-panel" role="tabpanel">
                <Toolbar>
                    <SearchInput
                        value={list.searchInput}
                        onChange={list.setSearchInput}
                        placeholder="Search by member or list name"
                    />
                    <FilterSelect label="Source" allLabel="All sources" value={list.values.source} onChange={(value) => list.set({ source: value })} options={SOURCE_OPTIONS} />
                    {list.values.user && (
                        <FilterChip label={`Member #${list.values.user}`} onRemove={() => list.set({ user: '' })} />
                    )}
                </Toolbar>
                <DataTable
                    columns={columns}
                    rows={imports.rows}
                    loading={imports.isInitialLoading}
                    fetching={imports.isFetching && !imports.isInitialLoading}
                    error={imports.error}
                    onRetry={() => imports.refetch()}
                    sort={{ value: list.values.ordering, onChange: (ordering) => list.set({ ordering }) }}
                    onRowClick={(job) => setOpenId(job.id)}
                    caption="Member list imports"
                    empty={(
                        <EmptyState title={list.isFiltered ? 'No imports match' : 'No list imports yet'} compact>
                            {list.isFiltered ? 'Try another status or source.' : 'Imports appear here when members bring in a list.'}
                        </EmptyState>
                    )}
                />
                <Pagination page={list.page} totalPages={imports.totalPages} count={imports.count} pageSize={list.pageSize} onChange={list.setPage} />
            </Panel>

            <ImportDrawer id={openId} initial={openRow} onClose={() => setOpenId(null)} />
        </>
    );
}
