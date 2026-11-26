import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

import { adminApi, adminKeys } from '../api';
import { useAdminAction, useAdminList, useAdminQuery, useListParams, useRole } from '../hooks';
import { formatDateTime, formatDuration, formatNumber, formatRelative } from '../format';
import {
    Button, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, KeyValue, Menu, Meter, PageHeader, Pagination,
    Panel, PanelSkeleton, Tabs,
} from '../ui';
import { CodeBlock, DrawerSection, JOB_STATUS_TABS, JobStatusChip, useOpenParam } from './ops/common';
import TriggerImportDialog from './ops/TriggerImportDialog';

const RESOURCE = 'import-jobs';
const ACTIVE = new Set(['pending', 'processing']);
const POLL_MS = 5000;

const percent = (done, total) => (total ? Math.min(100, Math.round((Number(done) / Number(total)) * 100)) : null);

function Progress({ job }) {
    if (!job.total_items) {
        return <span className="tabular text-[var(--text-2)]">{job.processed_items ? formatNumber(job.processed_items) : '—'}</span>;
    }
    const tone = job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'success' : 'accent';
    return (
        <div className="min-w-[8rem] max-w-[12rem]">
            <Meter value={job.processed_items || 0} max={job.total_items} tone={tone} showValue={false} />
            <p className="mt-1 text-xs tabular text-[var(--text-3)]">
                {formatNumber(job.processed_items || 0)} of {formatNumber(job.total_items)}
                {percent(job.processed_items, job.total_items) !== null && ` · ${percent(job.processed_items, job.total_items)}%`}
            </p>
        </div>
    );
}

const ENRICHMENT_GROUPS = [
    { key: 'overall', label: 'Overall' },
    { key: 'metadata', label: 'Metadata' },
    { key: 'franchises', label: 'Relations' },
];

function OfflineImportDetails({ offline }) {
    const enrichment = offline.enrichment || {};
    const groups = ENRICHMENT_GROUPS.filter((group) => enrichment[group.key]);
    const overall = enrichment.overall || {};
    return (
        <>
            <DrawerSection title="Offline database run">
                <KeyValue
                    columns={3}
                    items={[
                        { label: 'Run', value: offline.import_status },
                        { label: 'Seen', value: formatNumber(offline.records_seen) },
                        { label: 'Created', value: formatNumber(offline.records_created) },
                        { label: 'Updated', value: formatNumber(offline.records_updated) },
                        { label: 'Failed', value: formatNumber(offline.records_failed) },
                        { label: 'Marked stale', value: formatNumber(offline.records_marked_stale) },
                    ]}
                />
            </DrawerSection>
            {groups.length > 0 && (
                <DrawerSection title="Enrichment">
                    <div className="space-y-4">
                        {groups.map((group) => {
                            const value = enrichment[group.key];
                            return (
                                <div key={group.key}>
                                    <Meter
                                        label={`${group.label}${value.completion_percent !== null && value.completion_percent !== undefined ? ` · ${value.completion_percent}%` : ''}`}
                                        value={value.completed ?? 0}
                                        max={value.queued ?? 0}
                                        tone={value.failed ? 'warning' : 'accent'}
                                    />
                                    {(value.running > 0 || value.failed > 0) && (
                                        <p className="mt-1 text-xs text-[var(--text-3)]">
                                            {[value.running ? `${formatNumber(value.running)} running` : null, value.failed ? `${formatNumber(value.failed)} need attention` : null].filter(Boolean).join(' · ')}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {(overall.quarantined_count > 0 || overall.transient_backlog > 0) && (
                        <p className="mt-3 text-sm text-[var(--text-2)]">
                            {formatNumber(overall.quarantined_count || 0)} held back, {formatNumber(overall.transient_backlog || 0)} waiting to retry.{' '}
                            <Link to="/admin/sync-health?quarantined=true" className="text-link !inline !min-h-0">Sync health</Link>
                        </p>
                    )}
                    {overall.top_quarantine_reasons?.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-[var(--text-2)]">
                            {overall.top_quarantine_reasons.map((reason) => (
                                <li key={reason.quarantine_reason} className="flex justify-between gap-3">
                                    <span className="admin-mono truncate">{reason.quarantine_reason}</span>
                                    <span className="tabular">{formatNumber(reason.count)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </DrawerSection>
            )}
        </>
    );
}

function JobDrawer({ id, initial, onClose, canCancel, onCancel }) {
    const detail = useAdminQuery(
        adminKeys.detail(RESOURCE, id),
        ({ signal }) => adminApi.get(`${RESOURCE}/${id}`, undefined, { signal }),
        {
            enabled: Boolean(id),
            placeholderData: initial,
            refetchInterval: (query) => (ACTIVE.has(query.state.data?.status) ? POLL_MS : false),
            refetchIntervalInBackground: false,
        },
    );
    const job = detail.data;
    const metadata = job?.metadata || {};

    return (
        <Drawer
            open={Boolean(id)}
            onClose={onClose}
            title={job ? `${job.source} · ${job.source_type}` : 'Import'}
            headerExtra={job && <JobStatusChip status={job.status} />}
            footer={job && canCancel && ACTIVE.has(job.status) ? (
                <Button variant="danger" onClick={() => onCancel(job)}>Cancel import</Button>
            ) : null}
        >
            {!job && detail.error ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} compact /> : !job ? (
                <PanelSkeleton lines={6} className="!bg-transparent !p-0" />
            ) : (
                <>
                    {job.total_items > 0 && (
                        <div className="mb-6">
                            <Meter
                                label="Progress"
                                value={job.processed_items || 0}
                                max={job.total_items}
                                tone={job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'success' : 'accent'}
                            />
                        </div>
                    )}
                    <KeyValue
                        items={[
                            { label: 'Started', value: formatDateTime(job.created_at) },
                            { label: 'Last update', value: formatDateTime(job.updated_at) },
                            { label: 'Duration', value: job.duration_seconds !== null && job.duration_seconds !== undefined ? formatDuration(job.duration_seconds * 1000) : null },
                            { label: 'Errors', value: formatNumber(job.error_count || 0) },
                            { label: 'Worker', value: metadata.worker },
                            { label: 'Retries', value: metadata.retries ? formatNumber(metadata.retries) : null },
                            { label: 'Task id', value: <span className="admin-mono">{job.task_id}</span>, wide: true },
                        ]}
                    />
                    {job.error_message && (
                        <DrawerSection title="What went wrong">
                            <pre className="admin-code !text-[var(--danger)]">{job.error_message}</pre>
                        </DrawerSection>
                    )}
                    {metadata.offline_import && <OfflineImportDetails offline={metadata.offline_import} />}
                    {metadata.result_summary && (
                        <DrawerSection title="Summary">
                            <p className="text-sm leading-relaxed text-[var(--text-2)]">{metadata.result_summary}</p>
                        </DrawerSection>
                    )}
                    <DrawerSection title="Options">
                        <CodeBlock value={metadata.task_kwargs} empty={<p className="text-sm text-[var(--text-3)]">Default options.</p>} />
                    </DrawerSection>
                    {metadata.result_data && Object.keys(metadata.result_data).length > 0 && (
                        <DrawerSection title="Result">
                            <CodeBlock value={metadata.result_data} />
                        </DrawerSection>
                    )}
                </>
            )}
        </Drawer>
    );
}

export default function Imports() {
    const { isSuperuser } = useRole();
    const list = useListParams({ status: '', ordering: '-date_created' });
    const [openId, setOpenId] = useOpenParam();
    const [triggerOpen, setTriggerOpen] = useState(false);
    const [cancelTarget, setCancelTarget] = useState(null);

    const jobs = useAdminList(RESOURCE, list.apiParams, {
        onVanishedPage: list.setPage,
        refetchInterval: (query) => {
            const rows = query.state.data?.results || [];
            return rows.some((row) => ACTIVE.has(row.status)) ? POLL_MS : false;
        },
        refetchIntervalInBackground: false,
    });

    const cancel = useAdminAction(
        (job) => adminApi.post(`${RESOURCE}/${job.id}/cancel`),
        {
            invalidate: [adminKeys.resource(RESOURCE)],
            success: (data) => data?.message || 'Import cancelled.',
            error: 'Could not cancel the import.',
            onSuccess: () => setCancelTarget(null),
        },
    );

    const running = jobs.rows.filter((row) => ACTIVE.has(row.status)).length;

    const columns = [
        {
            key: 'job',
            header: 'Import',
            primary: true,
            cell: (job) => (
                <button type="button" onClick={() => setOpenId(job.id)} className="block min-w-0 text-left">
                    <span className="block truncate font-medium text-[var(--text-1)] hover:text-[var(--signature)]">{job.source}</span>
                    <span className="block truncate text-xs text-[var(--text-3)]">{job.source_type}</span>
                </button>
            ),
        },
        { key: 'status', header: 'Status', cell: (job) => <JobStatusChip status={job.status} /> },
        { key: 'progress', header: 'Progress', cell: (job) => <Progress job={job} /> },
        {
            key: 'errors',
            header: 'Errors',
            align: 'right',
            cell: (job) => (job.error_count ? <span className="text-[var(--danger)]">{formatNumber(job.error_count)}</span> : <span className="text-[var(--text-3)]">0</span>),
        },
        {
            key: 'started',
            header: 'Started',
            sortKey: 'date_created',
            cell: (job) => <span title={formatDateTime(job.created_at)} className="text-[var(--text-2)]">{formatRelative(job.created_at)}</span>,
        },
        {
            key: 'duration',
            header: 'Took',
            align: 'right',
            hideOnPhone: true,
            cell: (job) => (job.duration_seconds ? formatDuration(job.duration_seconds * 1000) : <span className="text-[var(--text-3)]">—</span>),
        },
        {
            key: 'actions',
            actions: true,
            cell: (job) => (
                <Menu
                    label={`Actions for ${job.source} import`}
                    items={[
                        { label: 'Details', onSelect: () => setOpenId(job.id) },
                        { label: 'Cancel import', tone: 'danger', hidden: !isSuperuser || !ACTIVE.has(job.status), onSelect: () => setCancelTarget(job) },
                    ]}
                />
            ),
        },
    ];

    const openRow = jobs.rows.find((row) => String(row.id) === String(openId));

    return (
        <>
            <PageHeader
                title="Catalog imports"
                description="Jobs that bring anime in from AniList and the Anime Offline Database."
                actions={isSuperuser && <Button variant="primary" icon={Plus} onClick={() => setTriggerOpen(true)}>New import</Button>}
            />

            <Tabs
                items={JOB_STATUS_TABS.map((item) => (item.value === 'processing' && running && !list.values.status ? { ...item, count: running } : item))}
                value={list.values.status}
                onChange={(value) => list.set({ status: value })}
                label="Import status"
                panelId="imports-panel"
                className="mb-4"
            />

            <Panel id="imports-panel" role="tabpanel">
                <DataTable
                    columns={columns}
                    rows={jobs.rows}
                    loading={jobs.isInitialLoading}
                    fetching={jobs.isFetching && !jobs.isInitialLoading && !jobs.isRefetching}
                    error={jobs.error}
                    onRetry={() => jobs.refetch()}
                    sort={{ value: list.values.ordering, onChange: (ordering) => list.set({ ordering }) }}
                    onRowClick={(job) => setOpenId(job.id)}
                    caption="Catalog import jobs"
                    empty={(
                        <EmptyState
                            title={list.values.status ? 'No imports with this status' : 'No imports yet'}
                            actions={isSuperuser && !list.values.status ? <Button variant="primary" onClick={() => setTriggerOpen(true)}>New import</Button> : null}
                            compact
                        >
                            {list.values.status ? 'Pick another status to see more.' : 'Scheduled syncs and imports you start appear here.'}
                        </EmptyState>
                    )}
                />
                <Pagination page={list.page} totalPages={jobs.totalPages} count={jobs.count} pageSize={list.pageSize} onChange={list.setPage} />
            </Panel>

            <JobDrawer
                id={openId}
                initial={openRow}
                onClose={() => setOpenId(null)}
                canCancel={isSuperuser}
                onCancel={setCancelTarget}
            />

            {isSuperuser && <TriggerImportDialog open={triggerOpen} onClose={() => setTriggerOpen(false)} />}

            <ConfirmDialog
                open={Boolean(cancelTarget)}
                onClose={() => setCancelTarget(null)}
                title="Cancel this import?"
                tone="danger"
                confirmLabel="Cancel import"
                cancelLabel="Keep running"
                busy={cancel.isPending}
                onConfirm={() => cancel.mutate(cancelTarget)}
            >
                The worker stops it now. Anime it already saved stay in the catalog.
            </ConfirmDialog>
        </>
    );
}
