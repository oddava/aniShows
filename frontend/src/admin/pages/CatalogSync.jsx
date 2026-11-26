import { useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';

import { adminApi, adminKeys } from '../api';
import { useAdminAction, useAdminList, useAdminQuery, useListParams, useOpenParam, useRole } from '../hooks';
import { formatDateTime, formatDuration, formatNumber, formatRelative, plural } from '../format';
import {
    BarList, Button, Chip, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, FilterSelect, KeyValue, Meter,
    Notice, PageHeader, Pagination, Panel, PanelSkeleton, StatCard, StatGrid, Tabs, Toolbar,
} from '../ui';
import { CodeBlock, DrawerSection } from './ops/common';
import { exclusionLabel } from './catalog/catalogScope';

const OVERVIEW = 'catalog';
const RUNS = 'catalog/runs';

const RUN_TONES = { running: 'accent', succeeded: 'success', partial: 'warning', failed: 'danger' };
const RUN_LABELS = { running: 'Running', succeeded: 'Done', partial: 'Stopped early', failed: 'Failed' };
const TRIGGER_LABELS = { schedule: 'Scheduled', admin: 'Started by hand', chain: 'Continued' };
const ROLE_LABELS = { previous: 'Last season', current: 'This season', next: 'Next season', later: 'After that' };

const STATUS_TABS = [
    { value: '', label: 'All' },
    { value: 'failed', label: 'Failed' },
    { value: 'partial', label: 'Stopped early' },
];

function RunStatusChip({ status }) {
    return <Chip tone={RUN_TONES[status] || 'neutral'} dot>{RUN_LABELS[status] || status}</Chip>;
}

/** "12 new · 40 updated · 2 hidden", or "No changes". */
function runSummary(run) {
    const parts = [
        run.created ? `${formatNumber(run.created)} new` : null,
        run.updated ? `${formatNumber(run.updated)} updated` : null,
        run.excluded ? `${formatNumber(run.excluded)} hidden` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'No changes';
}

function SweepNotice({ sweep, canRun, onStart, starting }) {
    if (!sweep || sweep.phase === 'done') return null;
    if (sweep.phase === 'not_started') {
        return (
            <Notice
                tone="accent"
                title="The full sweep has not run yet"
                className="mb-4 sm:mb-5"
                action={canRun && <Button variant="primary" icon={Play} onClick={onStart} loading={starting}>Start the sweep</Button>}
            >
                It reads every Japanese title on AniList, one release year at a time, in short slices between other work. Expect about 20 minutes of AniList time spread over an hour or so.
            </Notice>
        );
    }
    const where = {
        backfill: 'Checking titles already stored',
        years: sweep.year ? `Reading ${sweep.year}` : 'Reading release years',
        unreleased: 'Reading announced titles',
    }[sweep.phase] || 'Under way';
    return (
        <Panel className="mb-4 sm:mb-5">
            <Meter label={`Full sweep · ${where}`} value={sweep.percent ?? 0} max={100} showValue={false} />
            <p className="mt-2 text-xs text-[var(--text-3)]">
                {sweep.percent ?? 0}% · newest years first, so recent titles are already in. It continues on its own.
            </p>
        </Panel>
    );
}

function SeasonsPanel({ seasons }) {
    return (
        <Panel id="catalog-seasons" title="Seasons" description="Listed here against what AniList has for the same season.">
            <ul className="space-y-4">
                {seasons.map((season) => {
                    const known = season.anilist !== null && season.anilist !== undefined;
                    const complete = known && season.listed >= season.anilist;
                    return (
                        <li key={`${season.season}-${season.year}`}>
                            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate">
                                    <span className="font-medium text-[var(--text-1)]">{season.label}</span>
                                    <span className="text-[var(--text-3)]"> · {ROLE_LABELS[season.role]}</span>
                                </span>
                                <span className="shrink-0 tabular text-[var(--text-1)]">
                                    {formatNumber(season.listed)}
                                    {known && <span className="text-[var(--text-3)]"> / {formatNumber(season.anilist)}</span>}
                                </span>
                            </div>
                            <Meter
                                value={season.listed}
                                max={known ? Math.max(season.anilist, 1) : Math.max(season.listed, 1)}
                                tone={complete ? 'success' : 'accent'}
                                showValue={false}
                                label={undefined}
                            />
                        </li>
                    );
                })}
            </ul>
        </Panel>
    );
}

function LanesPanel({ lanes, canRun, onRun, pendingLane }) {
    return (
        <Panel id="catalog-lanes" title="What runs" description="Each part keeps one kind of data fresh. They run on their own.">
            <ul className="-mx-2 space-y-1">
                {lanes.map((lane) => {
                    const last = lane.last_run;
                    return (
                        <li key={lane.lane} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--radius-md)] px-2 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--text-1)]">
                                    {lane.label}
                                    <span className="text-xs font-normal text-[var(--text-3)]">{lane.schedule}</span>
                                </p>
                                <p className="mt-0.5 text-sm text-[var(--text-2)]">{lane.description}</p>
                                <p className="mt-1 text-xs text-[var(--text-3)]">
                                    {lane.running ? 'Running now' : last ? (
                                        <>
                                            {RUN_LABELS[last.status] || last.status} {formatRelative(last.started_at)}
                                            {' · '}
                                            {runSummary(last)}
                                            {lane.last_change_at && last.created + last.updated + last.excluded === 0 && ` · last change ${formatRelative(lane.last_change_at)}`}
                                        </>
                                    ) : 'Has not run yet'}
                                </p>
                            </div>
                            {canRun && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={Play}
                                    disabled={lane.running}
                                    loading={pendingLane === lane.lane}
                                    onClick={() => onRun(lane)}
                                >
                                    Run now
                                </Button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </Panel>
    );
}

function RunDrawer({ run, onClose }) {
    const detail = run?.detail || {};
    return (
        <Drawer
            open={Boolean(run)}
            onClose={onClose}
            title={run ? `${run.lane_label} · ${formatDateTime(run.started_at)}` : 'Run'}
            headerExtra={run && <RunStatusChip status={run.status} />}
        >
            {run && (
                <>
                    <KeyValue
                        columns={3}
                        items={[
                            { label: 'New', value: formatNumber(run.created) },
                            { label: 'Updated', value: formatNumber(run.updated) },
                            { label: 'Hidden', value: formatNumber(run.excluded) },
                            { label: 'Read from AniList', value: formatNumber(run.fetched) },
                            { label: 'Requests', value: formatNumber(run.requests) },
                            { label: 'Took', value: run.duration_seconds !== null ? formatDuration(run.duration_seconds * 1000) : 'Still running' },
                            { label: 'Started by', value: TRIGGER_LABELS[run.trigger] || run.trigger, wide: true },
                        ]}
                    />
                    {run.error && (
                        <DrawerSection title="What happened">
                            <p className="text-sm leading-relaxed text-[var(--text-2)]">{run.error}</p>
                        </DrawerSection>
                    )}
                    {Object.keys(detail).length > 0 && (
                        <DrawerSection title="Details">
                            <CodeBlock value={detail} />
                        </DrawerSection>
                    )}
                </>
            )}
        </Drawer>
    );
}

export default function CatalogSync() {
    const { isSuperuser } = useRole();
    const list = useListParams({ status: '', lane: '', changed: '1' });
    const [openId, setOpenId] = useOpenParam();
    const [restartOpen, setRestartOpen] = useState(false);

    const overview = useAdminQuery(
        adminKeys.view(OVERVIEW),
        ({ signal }) => adminApi.get(OVERVIEW, undefined, { signal }),
        {
            refetchInterval: (query) => (query.state.data?.lanes?.some((lane) => lane.running) ? 10000 : 60000),
            refetchIntervalInBackground: false,
        },
    );
    const runs = useAdminList(RUNS, list.apiParams, {
        onVanishedPage: list.setPage,
        refetchInterval: overview.data?.lanes?.some((lane) => lane.running) ? 10000 : false,
        refetchIntervalInBackground: false,
    });

    const run = useAdminAction(
        ({ lane, restart }) => adminApi.post(`catalog/lanes/${lane}/run`, restart ? { restart: true } : {}),
        {
            invalidate: [adminKeys.resource(OVERVIEW), adminKeys.resource(RUNS)],
            success: (_data, { label }) => `${label} queued. It shows up here once it starts.`,
            error: 'Could not start it.',
            onSuccess: () => setRestartOpen(false),
        },
    );

    const data = overview.data;
    const canRun = Boolean(isSuperuser && data?.can_run);
    const totals = data?.totals || {};
    const lanes = data?.lanes || [];
    const openRun = runs.rows.find((row) => String(row.id) === String(openId));

    const columns = [
        {
            key: 'lane',
            header: 'Run',
            primary: true,
            cell: (row) => (
                <button type="button" onClick={() => setOpenId(row.id)} className="block min-w-0 text-left">
                    <span className="block truncate font-medium text-[var(--text-1)] hover:text-[var(--signature)]">{row.lane_label}</span>
                    <span className="block truncate text-xs text-[var(--text-3)]">{TRIGGER_LABELS[row.trigger] || row.trigger}</span>
                </button>
            ),
        },
        { key: 'status', header: 'Status', cell: (row) => <RunStatusChip status={row.status} /> },
        {
            key: 'result',
            header: 'Result',
            cell: (row) => (
                <span className={row.created + row.updated + row.excluded ? 'text-[var(--text-1)]' : 'text-[var(--text-3)]'}>
                    {row.error && row.status !== 'succeeded' ? row.error : runSummary(row)}
                </span>
            ),
        },
        {
            key: 'started',
            header: 'Started',
            cell: (row) => <span title={formatDateTime(row.started_at)} className="text-[var(--text-2)]">{formatRelative(row.started_at)}</span>,
        },
        {
            key: 'requests',
            header: 'Requests',
            align: 'right',
            hideOnPhone: true,
            cell: (row) => <span className="tabular text-[var(--text-2)]">{formatNumber(row.requests)}</span>,
        },
    ];

    if (overview.error && !data) {
        return (
            <>
                <PageHeader title="Catalog sync" />
                <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
            </>
        );
    }

    return (
        <>
            <PageHeader
                title="Catalog sync"
                description={data
                    ? `Every title comes from AniList: ${data.rules.countries.join(', ')} animation, without ${data.rules.excluded_formats.map((f) => (f === 'MUSIC' ? 'music videos' : f.toLowerCase())).join(' or ')}. It runs on its own.`
                    : 'Every title comes from AniList. It runs on its own.'}
                actions={(
                    <>
                        <Button variant="ghost" icon={RefreshCw} onClick={() => { overview.refetch(); runs.refetch(); }}>Refresh</Button>
                        {canRun && data?.sweep?.phase === 'done' && (
                            <Button variant="secondary" onClick={() => setRestartOpen(true)}>Sweep again</Button>
                        )}
                    </>
                )}
            />

            {!data ? <PanelSkeleton lines={6} /> : (
                <>
                    <SweepNotice
                        sweep={data.sweep}
                        canRun={canRun}
                        starting={run.isPending && run.variables?.lane === 'seed'}
                        onStart={() => run.mutate({ lane: 'seed', label: 'The full sweep' })}
                    />

                    <StatGrid columns={4} className="mb-4 sm:mb-5">
                        <StatCard label="Listed" value={totals.listed} hint={`${formatNumber(totals.total)} stored`} to="/admin/anime" />
                        <StatCard
                            label="With full details"
                            value={totals.hydrated}
                            hint={totals.waiting_for_details ? `${formatNumber(totals.waiting_for_details)} queued` : 'Cast, staff, images'}
                        />
                        <StatCard label="Hidden" value={totals.hidden} hint="Outside the scope" />
                        <StatCard
                            label="Last read from AniList"
                            value={data.changes_since ? formatRelative(data.changes_since) : 'Not yet'}
                            hint="Edits on AniList arrive within 15 minutes"
                        />
                    </StatGrid>

                    <div className="mb-4 grid gap-4 sm:mb-5 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                        <div className="space-y-4 sm:space-y-5">
                            <SeasonsPanel seasons={data.seasons} />
                            {data.hidden_reasons.length > 0 && (
                                <Panel title="Why titles are hidden" description="Still reachable by link from people's lists.">
                                    <BarList
                                        valueFormat={formatNumber}
                                        items={data.hidden_reasons.map((row) => ({
                                            key: row.reason,
                                            label: exclusionLabel(row.reason),
                                            value: row.count,
                                        }))}
                                    />
                                </Panel>
                            )}
                        </div>
                        <LanesPanel
                            lanes={lanes}
                            canRun={canRun}
                            pendingLane={run.isPending ? run.variables?.lane : null}
                            onRun={(lane) => run.mutate({ lane: lane.lane, label: lane.label })}
                        />
                    </div>
                </>
            )}

            <Panel
                title="Run log"
                description={list.values.changed === '1' ? 'Runs that changed something or went wrong.' : 'Every run, quiet ones too.'}
            >
                <Toolbar>
                    <Tabs
                        items={STATUS_TABS}
                        value={list.values.status}
                        onChange={(value) => list.set({ status: value })}
                        label="Run status"
                        size="sm"
                    />
                    <FilterSelect
                        label="Part"
                        allLabel="Every part"
                        value={list.values.lane}
                        onChange={(value) => list.set({ lane: value })}
                        options={lanes.map((lane) => ({ value: lane.lane, label: lane.label }))}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => list.set({ changed: list.values.changed === '1' ? '0' : '1' })}
                    >
                        {list.values.changed === '1' ? 'Show quiet runs' : 'Hide quiet runs'}
                    </Button>
                </Toolbar>
                <DataTable
                    columns={columns}
                    rows={runs.rows}
                    loading={runs.isInitialLoading}
                    fetching={runs.isFetching && !runs.isInitialLoading && !runs.isRefetching}
                    error={runs.error}
                    onRetry={() => runs.refetch()}
                    onRowClick={(row) => setOpenId(row.id)}
                    caption="Catalog sync runs"
                    empty={(
                        <EmptyState title={list.isFiltered ? 'No runs match' : 'No runs yet'} compact>
                            {list.isFiltered ? 'Try another filter.' : 'Scheduled runs appear here within 15 minutes.'}
                        </EmptyState>
                    )}
                />
                <Pagination page={list.page} totalPages={runs.totalPages} count={runs.count} pageSize={list.pageSize} onChange={list.setPage} />
            </Panel>

            <RunDrawer run={openRun} onClose={() => setOpenId(null)} />

            <ConfirmDialog
                open={restartOpen}
                onClose={() => setRestartOpen(false)}
                title="Sweep the whole catalog again?"
                confirmLabel="Start over"
                busy={run.isPending}
                onConfirm={() => run.mutate({ lane: 'seed', restart: true, label: 'The full sweep' })}
            >
                {`It re-reads every title in scope, about ${plural(Math.ceil((totals.listed || 0) / 50), 'request')}, in short slices. It already runs weekly on its own.`}
            </ConfirmDialog>
        </>
    );
}
