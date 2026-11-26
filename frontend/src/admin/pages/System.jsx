import { useState } from 'react';
import useMediaQuery from '../../hooks/useMediaQuery';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw } from 'lucide-react';

import { adminApi, adminKeys, errorMessage } from '../api';
import { useAdminAction, useAdminQuery, useRole } from '../hooks';
import { describeSchedule, formatBytes, formatDateTime, formatNumber, formatRelative, humanize, shortTaskName } from '../format';
import { notifyError } from '../../components/ui/toast';
import {
    BarList, Button, Chip, ConfirmDialog, DataTable, ErrorState, Meter, PageHeader, Panel, PanelSkeleton, StateDot,
} from '../ui';

const SYSTEM_KEY = adminKeys.view('system');
const POLL_MS = 30_000;
const BUSY_QUEUE = 100;

function Health({ health = {}, workers, generatedAt }) {
    const migrations = health.migrations_pending;
    const items = [
        { key: 'db', tone: health.database ? 'success' : 'danger', text: health.database ? 'Database is answering' : 'Database is not answering' },
        { key: 'cache', tone: health.cache ? 'success' : 'danger', text: health.cache ? 'Cache is working' : 'Cache is not working' },
        {
            key: 'migrations',
            tone: migrations === false ? 'success' : migrations ? 'warning' : 'neutral',
            text: migrations === false ? 'Migrations up to date' : migrations ? 'Migrations waiting to run' : 'Migrations unknown',
        },
    ];
    // Workers belong in the verdict: with none answering, background jobs stall.
    const workerCount = workers?.available ? workers.total ?? workers.items?.length ?? 0 : null;
    if (workerCount !== null) {
        items.push({
            key: 'workers',
            tone: workerCount > 0 ? 'success' : 'danger',
            text: workerCount > 0 ? `${formatNumber(workerCount)} ${workerCount === 1 ? 'worker' : 'workers'} answering` : 'No workers answering',
        });
    }
    const allGood = health.database && health.cache && migrations === false && workerCount !== 0;
    return (
        <Panel
            title={allGood ? 'Everything is running' : 'Something needs a look'}
            description={generatedAt ? `Checked ${formatRelative(generatedAt)}` : null}
        >
            <ul className="flex flex-wrap gap-x-8 gap-y-3">
                {items.map((item) => <li key={item.key}><StateDot tone={item.tone}>{item.text}</StateDot></li>)}
            </ul>
        </Panel>
    );
}

function Queues({ queues = {} }) {
    return (
        <Panel title="Queues" description="Tasks waiting for a worker">
            {!queues.available ? (
                <p className="text-sm text-[var(--text-3)]">Could not read queue sizes from the broker.</p>
            ) : queues.items?.length ? (
                <ul className="space-y-1">
                    {queues.items.map((queue) => (
                        <li key={queue.name} className="flex min-h-9 items-center justify-between gap-3 text-sm">
                            <span className="admin-mono truncate text-[var(--text-1)]">{queue.name}</span>
                            {queue.size >= BUSY_QUEUE
                                ? <Chip tone="warning" className="tabular">{formatNumber(queue.size)}</Chip>
                                : <span className="tabular text-[var(--text-2)]">{formatNumber(queue.size)}</span>}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-[var(--text-3)]">No queues are configured.</p>
            )}
        </Panel>
    );
}

function Workers({ workers = {} }) {
    return (
        <Panel title="Workers" description={workers.available ? `${formatNumber(workers.total || 0)} answered` : null}>
            {!workers.available ? (
                <p className="text-sm text-[var(--text-3)]">Could not reach the workers through the broker.</p>
            ) : workers.items?.length ? (
                <ul className="space-y-1">
                    {workers.items.map((worker) => (
                        <li key={worker.name} className="flex min-h-9 items-center justify-between gap-3 text-sm">
                            <StateDot tone="success"><span className="admin-mono truncate text-[var(--text-1)]">{worker.name}</span></StateDot>
                            <span className="shrink-0 tabular text-[var(--text-2)]">
                                {worker.active_tasks ? `${formatNumber(worker.active_tasks)} running` : 'Idle'}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm font-medium text-[var(--danger)]">No workers answered. Background jobs are not running.</p>
            )}
        </Panel>
    );
}

function AniList({ anilist = {} }) {
    if (!anilist.available) {
        return (
            <Panel title="AniList budget">
                <p className="text-sm text-[var(--text-3)]">Budget figures are not available.</p>
            </Panel>
        );
    }
    const used = Number(anilist.used_this_minute) || 0;
    const limit = Number(anilist.limit) || 0;
    const share = limit ? used / limit : 0;
    const breakerState = anilist.breaker?.state;
    const paused = anilist.paused_until && new Date(anilist.paused_until) > new Date();
    return (
        <Panel title="AniList budget" description="Requests this minute, shared by every sync">
            <Meter label="Used this minute" value={used} max={limit} tone={share >= 0.9 ? 'danger' : share >= 0.7 ? 'warning' : 'accent'} />
            <ul className="mt-4 space-y-2 text-sm">
                {anilist.interactive_used !== undefined && anilist.interactive_used !== null && (
                    <li className="flex justify-between gap-3">
                        <span className="text-[var(--text-2)]">For members browsing</span>
                        <span className="tabular text-[var(--text-1)]">{formatNumber(anilist.interactive_used)}</span>
                    </li>
                )}
                {breakerState && (
                    <li className="flex items-center justify-between gap-3">
                        <span className="text-[var(--text-2)]">Circuit breaker</span>
                        <Chip tone={breakerState === 'closed' ? 'success' : breakerState === 'open' ? 'danger' : 'warning'}>
                            {breakerState === 'closed' ? 'Closed' : breakerState === 'open' ? 'Open, calls paused' : humanize(breakerState)}
                        </Chip>
                    </li>
                )}
                {paused && (
                    <li className="flex justify-between gap-3">
                        <span className="text-[var(--text-2)]">Paused until</span>
                        <span className="text-[var(--status-on-hold)]">{formatDateTime(anilist.paused_until)}</span>
                    </li>
                )}
            </ul>
        </Panel>
    );
}

function Database({ database = {} }) {
    return (
        <Panel title="Database" description={database.available ? `${formatBytes(database.size_bytes)} in total` : null}>
            {!database.available ? (
                <p className="text-sm text-[var(--text-3)]">Size figures are not available.</p>
            ) : (
                <>
                    <p className="mb-2 text-xs font-medium text-[var(--text-3)]">Largest tables</p>
                    <BarList
                        items={(database.tables || []).map((table) => ({ key: table.name, label: <span className="admin-mono">{table.name}</span>, value: table.size_bytes }))}
                        valueFormat={formatBytes}
                    />
                </>
            )}
        </Panel>
    );
}

function Failures({ failures = [], isSuperuser }) {
    return (
        <Panel
            title="Recent failures"
            actions={isSuperuser && <Link to="/admin/tasks?status=FAILURE" className="text-link !min-h-9 text-sm">All failures</Link>}
        >
            {failures.length === 0 ? (
                <p className="text-sm text-[var(--text-2)]">No task has failed recently.</p>
            ) : (
                <ul className="space-y-3">
                    {failures.map((failure) => (
                        <li key={failure.id} className="min-w-0 text-sm">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                                {isSuperuser ? (
                                    <Link to={`/admin/tasks?open=${failure.id}`} className="admin-mono font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                                        {shortTaskName(failure.task_name)}
                                    </Link>
                                ) : (
                                    <span className="admin-mono font-medium text-[var(--text-1)]">{shortTaskName(failure.task_name)}</span>
                                )}
                                <span className="text-xs text-[var(--text-3)]" title={formatDateTime(failure.date_created)}>{formatRelative(failure.date_created)}</span>
                            </div>
                            {failure.error_message && (
                                <p className="mt-0.5 line-clamp-2 text-[var(--text-2)] [overflow-wrap:anywhere]">{failure.error_message}</p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </Panel>
    );
}

const PHONE_BEAT_ROWS = 6;

function BeatSchedule({ beat = [], canRun, onRun }) {
    const isPhone = useMediaQuery('(max-width: 47.99rem)');
    const [showAll, setShowAll] = useState(false);
    // Jobs that need a look come first; on phones the rest fold away.
    const isLate = (entry) => Boolean(entry.tracked && entry.stale);
    const ordered = [...beat].sort((a, b) => Number(isLate(b)) - Number(isLate(a)));
    const folded = isPhone && !showAll && ordered.length > PHONE_BEAT_ROWS;
    const rows = folded ? ordered.slice(0, PHONE_BEAT_ROWS) : ordered;
    // Only jobs whose state is known count as late (matches BeatState).
    const lateCount = beat.filter((entry) => entry.tracked && entry.stale).length;
    const columns = [
        {
            key: 'name',
            header: 'Job',
            primary: true,
            cell: (entry) => (
                <span className="block min-w-0">
                    <span className="block truncate font-medium text-[var(--text-1)]">{entry.name}</span>
                    <span className="admin-mono block truncate text-xs text-[var(--text-3)]">{shortTaskName(entry.task)}</span>
                </span>
            ),
        },
        { key: 'schedule', header: 'Runs', cell: (entry) => <span className="text-[var(--text-2)]" title={entry.schedule}>{describeSchedule(entry.schedule)}</span> },
        {
            key: 'last',
            header: 'Last run',
            cell: (entry) => (entry.last_run
                ? <span title={formatDateTime(entry.last_run)} className="text-[var(--text-2)]">{formatRelative(entry.last_run)}</span>
                : <span className="text-[var(--text-3)]">{entry.tracked ? 'Not in history' : 'Not tracked'}</span>),
        },
        {
            key: 'next',
            header: 'Next due',
            hideOnPhone: true,
            cell: (entry) => (entry.next_due
                ? <span title={formatDateTime(entry.next_due)} className="text-[var(--text-2)]">{formatRelative(entry.next_due)}</span>
                : <span className="text-[var(--text-3)]">—</span>),
        },
        {
            key: 'state',
            header: 'State',
            cell: (entry) => <BeatState entry={entry} />,
        },
        ...(canRun ? [{
            key: 'actions',
            actions: true,
            header: 'Run',
            cell: (entry) => (
                <Button size="sm" variant="ghost" icon={Play} onClick={() => onRun(entry)} aria-label={`Run ${entry.name} now`}>
                    Run
                </Button>
            ),
        }] : []),
    ];
    return (
        <Panel
            title="Scheduled jobs"
            description={lateCount
                ? `${formatNumber(lateCount)} of ${formatNumber(beat.length)} need a look; they are listed first`
                : 'What the scheduler runs, and when it last did'}
        >
            <DataTable
                columns={columns}
                rows={rows}
                rowKey={(entry) => entry.name}
                caption="Scheduled jobs"
                empty={<p className="text-sm text-[var(--text-3)]">No scheduled jobs are configured.</p>}
            />
            {isPhone && ordered.length > PHONE_BEAT_ROWS && (
                <Button variant="ghost" className="mt-2 w-full" onClick={() => setShowAll((value) => !value)}>
                    {showAll ? 'Show fewer' : `Show all ${formatNumber(ordered.length)} jobs`}
                </Button>
            )}
        </Panel>
    );
}

/**
 * A scheduled job's state, saying only what the run history can back up:
 * untracked jobs are "Not tracked", never "On time".
 */
export function BeatState({ entry }) {
    if (!entry.tracked) return <Chip tone="neutral">Not tracked</Chip>;
    if (!entry.last_run) {
        return entry.stale
            ? <Chip tone="warning" dot title="Due since tracking began, with no run recorded">Never ran</Chip>
            : <Chip tone="neutral">No runs yet</Chip>;
    }
    return entry.stale
        ? <Chip tone="warning" dot title="The next run is late">Overdue</Chip>
        : <Chip tone="success" dot>On time</Chip>;
}

export default function System() {
    const { isSuperuser } = useRole();
    const queryClient = useQueryClient();
    const [runTarget, setRunTarget] = useState(null);

    const system = useAdminQuery(
        SYSTEM_KEY,
        ({ signal }) => adminApi.get('system', undefined, { signal }),
        { refetchInterval: POLL_MS, refetchIntervalInBackground: false, staleTime: 10_000 },
    );

    const refresh = () => queryClient.fetchQuery({
        queryKey: SYSTEM_KEY,
        queryFn: () => adminApi.get('system', { refresh: 1 }),
        staleTime: 0,
    }).catch((error) => notifyError(errorMessage(error, 'Could not refresh the system status.')));

    const run = useAdminAction(
        (entry) => adminApi.post(`system/beat/${encodeURIComponent(entry.name)}/run`),
        {
            invalidate: [SYSTEM_KEY],
            success: (data) => data?.message || 'Queued.',
            error: 'Could not queue the job.',
            onSuccess: () => setRunTarget(null),
        },
    );

    const data = system.data;
    const canRun = Boolean(isSuperuser && data?.can_run);

    return (
        <>
            <PageHeader
                title="System"
                description="Workers, queues, scheduled jobs and the services the site depends on. Updates every 30 seconds."
                actions={<Button variant="ghost" icon={RefreshCw} onClick={refresh} loading={system.isFetching && !system.isLoading}>Refresh</Button>}
            />

            {system.error && !data ? (
                <Panel><ErrorState error={system.error} onRetry={() => system.refetch()} /></Panel>
            ) : !data ? (
                <div className="space-y-4 sm:space-y-5" aria-busy="true">
                    <PanelSkeleton lines={1} />
                    <div className="grid gap-4 sm:gap-5 lg:grid-cols-2"><PanelSkeleton /><PanelSkeleton /></div>
                    <PanelSkeleton lines={8} />
                </div>
            ) : (
                <div className="space-y-4 sm:space-y-5">
                    <Health health={data.health} workers={data.workers} generatedAt={data.generated_at} />
                    <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-2">
                        <Workers workers={data.workers} />
                        <Queues queues={data.queues} />
                    </div>
                    <BeatSchedule beat={data.beat} canRun={canRun} onRun={setRunTarget} />
                    <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-2">
                        <AniList anilist={data.anilist} />
                        <Database database={data.database} />
                    </div>
                    <Failures failures={data.failures} isSuperuser={isSuperuser} />
                </div>
            )}

            <ConfirmDialog
                open={Boolean(runTarget)}
                onClose={() => setRunTarget(null)}
                title={runTarget ? `Run ${runTarget.name} now?` : 'Run now?'}
                confirmLabel="Run now"
                busy={run.isPending}
                onConfirm={() => run.mutate(runTarget)}
            >
                {runTarget && (
                    <>
                        <p>
                            It runs once with its usual options, on top of its schedule
                            {runTarget.schedule ? ` (${describeSchedule(runTarget.schedule)})` : ''}. If it is already running, nothing new starts.
                        </p>
                        {runTarget.kwargs && Object.keys(runTarget.kwargs).length > 0 && (
                            <pre className="admin-code mt-3">{JSON.stringify(runTarget.kwargs, null, 2)}</pre>
                        )}
                    </>
                )}
            </ConfirmDialog>
        </>
    );
}
