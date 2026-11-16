import { useState } from 'react';
import PropTypes from 'prop-types';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { CheckCircle2, Play, RefreshCw, XCircle } from 'lucide-react';

import api from '../../api/client';
import { adminQueries } from '../../api/queries/admin';
import ErrorState from '../../components/common/ErrorState';
import PageLoader from '../../components/common/PageLoader';
import ConfirmDialog from './components/ConfirmDialog';
import { getAdminErrorMessage, useAdminQuery } from './hooks/useAdminQuery';
import useAdminRole from './hooks/useAdminRole';

const formatBytes = (bytes) => {
    if (bytes == null) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatTime = (value) => (value ? new Date(value).toLocaleString() : 'never');
const shortTask = (task) => (task || '').split('.').pop();

function Section({ title, children, action }) {
    return (
        <section aria-label={title} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-white/5">
                <h2 className="text-sm font-semibold text-white">{title}</h2>
                {action}
            </div>
            <div className="p-4 sm:p-5">{children}</div>
        </section>
    );
}

Section.propTypes = { title: PropTypes.string.isRequired, children: PropTypes.node, action: PropTypes.node };

const Unavailable = ({ what }) => <p className="text-sm text-white/50">{what} unavailable.</p>;
Unavailable.propTypes = { what: PropTypes.string.isRequired };

function HealthItem({ label, ok }) {
    const Icon = ok ? CheckCircle2 : XCircle;
    return (
        <li className="flex items-center justify-between gap-4 text-sm">
            <span className="text-white/70">{label}</span>
            <span className={`inline-flex items-center gap-1.5 ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
                <Icon size={14} aria-hidden="true" /> {ok ? 'OK' : 'Problem'}
            </span>
        </li>
    );
}

HealthItem.propTypes = { label: PropTypes.string.isRequired, ok: PropTypes.bool };

const AdminSystem = () => {
    const queryClient = useQueryClient();
    const { isSuperuser } = useAdminRole();
    const [refreshing, setRefreshing] = useState(false);
    const [runTarget, setRunTarget] = useState(null);
    const [running, setRunning] = useState(false);

    const query = useAdminQuery({
        ...adminQueries.system(),
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        errorLog: 'Failed to fetch system status:',
    });
    const system = query.data;

    const refresh = async () => {
        setRefreshing(true);
        try {
            await queryClient.fetchQuery({ ...adminQueries.system({ refresh: true }), staleTime: 0 });
        } catch (err) {
            toast.error(getAdminErrorMessage(err, 'Failed to refresh system status'));
        } finally {
            setRefreshing(false);
        }
    };

    const runEntry = async () => {
        setRunning(true);
        try {
            const res = await api.post(`/admin/system/beat/${encodeURIComponent(runTarget.name)}/run/`);
            toast.success(res.data?.message || `Started ${runTarget.name}`);
            setRunTarget(null);
        } catch (err) {
            toast.error(getAdminErrorMessage(err, 'Failed to start the task'));
        } finally {
            setRunning(false);
        }
    };

    if (query.isPending) return <PageLoader />;
    if (query.error && !system) {
        return (
            <ErrorState
                title="Couldn’t load system status"
                message={getAdminErrorMessage(query.error, 'Failed to load system status')}
                onRetry={() => query.refetch()}
            />
        );
    }

    const canRun = isSuperuser && system.can_run !== false;
    const { queues, workers, beat = [], anilist, database, health, failures = [] } = system;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-white">System</h1>
                    <p className="text-sm text-white/50 mt-1" aria-live="polite">
                        Updated {system.generated_at ? new Date(system.generated_at).toLocaleTimeString() : '—'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={refresh}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] sm:min-h-0 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50 transition-colors"
                >
                    <RefreshCw size={16} aria-hidden="true" className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
                    {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Section title="Health">
                    {health ? (
                        <ul className="space-y-2">
                            <HealthItem label="Database" ok={health.database} />
                            <HealthItem label="Cache" ok={health.cache} />
                            <li className="flex items-center justify-between gap-4 text-sm">
                                <span className="text-white/70">Migrations</span>
                                <span className={health.migrations_pending ? 'text-amber-300' : 'text-white/80'}>
                                    {health.migrations_pending == null ? 'Unknown' : health.migrations_pending ? 'Pending' : 'Up to date'}
                                </span>
                            </li>
                        </ul>
                    ) : <Unavailable what="Health" />}
                </Section>

                <Section title="Queues">
                    {queues?.available ? (
                        <ul className="space-y-2">
                            {queues.items.map((q) => (
                                <li key={q.name} className="flex justify-between gap-4 text-sm">
                                    <span className="text-white/70 font-mono">{q.name}</span>
                                    <span className={q.size > 0 ? 'text-white font-medium' : 'text-white/50'}>{q.size}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <Unavailable what="Queue sizes" />}
                </Section>

                <Section title="Workers">
                    {workers?.available ? (
                        workers.items.length === 0 ? (
                            <p className="text-sm text-red-400">No workers answered.</p>
                        ) : (
                            <ul className="space-y-2">
                                {workers.items.map((w) => (
                                    <li key={w.name} className="flex justify-between gap-4 text-sm">
                                        <span className="text-white/70 font-mono break-all">{w.name}</span>
                                        <span className="text-white/80 shrink-0">{w.active_tasks} active</span>
                                    </li>
                                ))}
                            </ul>
                        )
                    ) : <Unavailable what="Worker status" />}
                </Section>

                <Section title="AniList">
                    {anilist?.available ? (
                        <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-4">
                                <dt className="text-white/70">Used this minute</dt>
                                <dd className="text-white">{anilist.used_this_minute} / {anilist.limit}</dd>
                            </div>
                            {anilist.interactive_used != null && (
                                <div className="flex justify-between gap-4">
                                    <dt className="text-white/70">Web requests</dt>
                                    <dd className="text-white">{anilist.interactive_used}</dd>
                                </div>
                            )}
                            <div className="flex justify-between gap-4">
                                <dt className="text-white/70">Paused until</dt>
                                <dd className="text-white">{anilist.paused_until ? formatTime(anilist.paused_until) : 'Not paused'}</dd>
                            </div>
                            <div className="flex justify-between gap-4">
                                <dt className="text-white/70">Circuit breaker</dt>
                                <dd className="text-white">{anilist.breaker?.state || '—'}</dd>
                            </div>
                        </dl>
                    ) : <Unavailable what="AniList budget" />}
                </Section>
            </div>

            <Section title="Scheduled tasks">
                {beat.length === 0 ? <p className="text-sm text-white/50">No scheduled tasks.</p> : (
                    <ul className="divide-y divide-white/5 -my-2">
                        {beat.map((entry) => (
                            <li key={entry.name} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white font-medium flex flex-wrap items-center gap-2">
                                        {entry.name}
                                        {entry.stale && (
                                            <span className="px-2 py-0.5 rounded-md border border-amber-500/30 text-amber-300 text-xs">Stale</span>
                                        )}
                                    </p>
                                    <p className="text-xs text-white/50 break-words">
                                        <span className="font-mono">{shortTask(entry.task)}</span> · {entry.schedule}
                                        {entry.queue ? ` · ${entry.queue}` : ''}
                                    </p>
                                    <p className="text-xs text-white/50">
                                        Last run {formatTime(entry.last_run)}
                                        {entry.next_due && ` · next ${formatTime(entry.next_due)}`}
                                    </p>
                                </div>
                                {canRun && (
                                    <button
                                        type="button"
                                        onClick={() => setRunTarget(entry)}
                                        aria-label={`Run ${entry.name} now`}
                                        className="self-start sm:self-center inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] sm:min-h-0 text-sm bg-white/10 text-white/80 rounded-lg hover:bg-white/20 transition-colors"
                                    >
                                        <Play size={14} aria-hidden="true" /> Run now
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <div className="grid gap-6 md:grid-cols-2">
                <Section title="Database">
                    {database?.available ? (
                        <>
                            <p className="text-sm text-white/70 mb-3">
                                Total size <span className="text-white font-medium">{formatBytes(database.size_bytes)}</span>
                            </p>
                            <ul className="space-y-1.5">
                                {database.tables.map((t) => (
                                    <li key={t.name} className="flex justify-between gap-4 text-sm">
                                        <span className="text-white/70 font-mono break-all">{t.name}</span>
                                        <span className="text-white/80 shrink-0">{formatBytes(t.size_bytes)}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : <Unavailable what="Database size" />}
                </Section>

                <Section title="Recent failures">
                    {failures.length === 0 ? <p className="text-sm text-white/50">No failed tasks.</p> : (
                        <ul className="space-y-3">
                            {failures.map((f) => (
                                <li key={f.id} className="text-sm">
                                    <p className="text-white font-mono">{shortTask(f.task_name)}</p>
                                    <p className="text-xs text-white/50">{formatTime(f.date_created)}</p>
                                    {f.error_message && <p className="text-xs text-red-300/80 break-words mt-0.5">{f.error_message}</p>}
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
            </div>

            <ConfirmDialog
                isOpen={Boolean(runTarget)}
                title={`Run ${runTarget?.name || ''} now?`}
                message="The task runs once with its scheduled arguments. Its normal schedule is not changed."
                confirmLabel="Run now"
                busy={running}
                onCancel={() => setRunTarget(null)}
                onConfirm={runEntry}
            />
        </div>
    );
};

export default AdminSystem;
