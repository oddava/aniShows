import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';

import { adminApi, adminKeys } from '../api';
import { actionLabel, entityTypeLabel, entryLabel } from '../auditLabels';
import { useAdminList, useAdminQuery, useListParams, useRole } from '../hooks';
import { formatDateTime, formatDuration, formatNumber, formatRelative, humanize } from '../format';
import {
    Chip, DataTable, Drawer, EmptyState, FilterChip, FilterSelect, KeyValue, PageHeader, Pagination, Panel, SearchInput,
    Tabs, TextInput, Toolbar, UserCell, Button,
} from '../ui';
import { CodeBlock, DrawerSection, useOpenParam } from './ops/common';

/* ------------------------------------------------------------------ shared */

const AUDIT_ACTIONS = [
    'CREATE', 'UPDATE', 'DELETE', 'BULK_ACTION', 'SUSPEND', 'RESTORE', 'RESOLVE', 'DISMISS', 'TRIGGER', 'CONTROL',
    'EXPORT', 'LOGIN', 'LOGOUT',
];

const ACTION_TONES = {
    CREATE: 'success',
    UPDATE: 'accent',
    DELETE: 'danger',
    BULK_ACTION: 'warning',
    SUSPEND: 'danger',
    RESTORE: 'success',
    RESOLVE: 'violet',
    DISMISS: 'neutral',
    TRIGGER: 'accent',
    CONTROL: 'warning',
};

/** Used until the API's list of recorded types arrives. */
const FALLBACK_ENTITY_TYPES = ['User', 'Review', 'Anime', 'Announcement', 'AdminPanelSettings'];


const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
const LEVEL_TONES = { DEBUG: 'neutral', INFO: 'accent', WARNING: 'warning', ERROR: 'danger', CRITICAL: 'danger' };
const LOG_TYPES = [
    { value: 'REQUEST', label: 'Request' },
    { value: 'AUTH', label: 'Sign-in' },
    { value: 'ADMIN', label: 'Admin action' },
    { value: 'ERROR', label: 'Error' },
    { value: 'SECURITY', label: 'Security' },
    { value: 'SYSTEM', label: 'System' },
];




const show = (value) => {
    if (value === null || value === undefined || value === '') return <span className="text-[var(--text-3)]">—</span>;
    if (typeof value === 'object') return <span className="admin-mono">{JSON.stringify(value)}</span>;
    return String(value);
};

/** previous_state → new_state as rows of the keys that changed. */
export function diffRows(entry) {
    const previous = entry.previous_state || {};
    const next = entry.new_state || {};
    const changes = entry.changes && typeof entry.changes === 'object' ? entry.changes : {};
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next), ...Object.keys(changes)])];
    return keys.map((key) => {
        const change = changes[key];
        const before = key in previous ? previous[key] : (change && typeof change === 'object' && 'old' in change ? change.old : undefined);
        const after = key in next ? next[key] : (change && typeof change === 'object' && 'new' in change ? change.new : undefined);
        return { key, before, after };
    });
}

/* --------------------------------------------------------------- audit log */

function AuditDrawer({ entry, onClose }) {
    const { isSuperuser } = useRole();
    const rows = entry ? diffRows(entry) : [];
    const metadata = entry?.metadata || {};
    const { reason, ...otherMetadata } = metadata;
    return (
        <Drawer
            open={Boolean(entry)}
            onClose={onClose}
            title={entry ? `${entryLabel(entry)} ${entityTypeLabel(entry.entity_type).toLowerCase()}` : 'Audit entry'}
            description={entry?.entity_repr}
            headerExtra={entry && <Chip tone={ACTION_TONES[entry.action] || 'neutral'}>{entryLabel(entry)}</Chip>}
        >
            {entry && (
                <>
                    <KeyValue
                        items={[
                            { label: 'When', value: formatDateTime(entry.timestamp) },
                            { label: 'By', value: entry.username ? <UserCell user={{ id: entry.user, username: entry.username }} /> : 'System' },
                            { label: 'Record', value: `${entityTypeLabel(entry.entity_type)}${entry.entity_id ? ` #${entry.entity_id}` : ''}` },
                            { label: 'IP address', hidden: !isSuperuser, value: entry.user_ip && <span className="admin-mono">{entry.user_ip}</span> },
                        ]}
                    />
                    {reason && (
                        <DrawerSection title="Reason">
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-1)]">{reason}</p>
                        </DrawerSection>
                    )}
                    {rows.length > 0 && (
                        <DrawerSection title="What changed">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[24rem] text-sm">
                                    <caption className="sr-only">Changed fields, before and after</caption>
                                    <thead>
                                        <tr className="text-left text-xs text-[var(--text-3)]">
                                            <th scope="col" className="pb-2 pr-3 font-medium">Field</th>
                                            <th scope="col" className="pb-2 pr-3 font-medium">Before</th>
                                            <th scope="col" className="pb-2 font-medium">After</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => (
                                            <tr key={row.key} className="align-top">
                                                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-[var(--text-2)] [overflow-wrap:anywhere]">{row.key}</th>
                                                <td className="py-1.5 pr-3 text-[var(--text-2)] [overflow-wrap:anywhere]">{show(row.before)}</td>
                                                <td className="py-1.5 text-[var(--text-1)] [overflow-wrap:anywhere]">{show(row.after)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </DrawerSection>
                    )}
                    {Object.keys(otherMetadata).length > 0 && (
                        <DrawerSection title="Details"><CodeBlock value={otherMetadata} /></DrawerSection>
                    )}
                </>
            )}
        </Drawer>
    );
}

function AuditLog() {
    const list = useListParams({ action: '', entity_type: '', entity_id: '', user: '', ordering: '-timestamp' });
    const entityTypes = useAdminQuery(
        adminKeys.view('audit-logs/entity_types'),
        ({ signal }) => adminApi.get('audit-logs/entity_types', undefined, { signal }),
        { staleTime: 5 * 60_000 },
    ).data?.entity_types || FALLBACK_ENTITY_TYPES;
    const [openId, setOpenId] = useOpenParam();
    const entries = useAdminList('audit-logs', list.apiParams, { onVanishedPage: list.setPage });
    const openRow = entries.rows.find((row) => String(row.id) === String(openId));
    const detail = useAdminQuery(
        adminKeys.detail('audit-logs', openId),
        ({ signal }) => adminApi.get(`audit-logs/${openId}`, undefined, { signal }),
        { enabled: Boolean(openId) && !openRow },
    );
    const openEntry = openRow || detail.data;

    const columns = [
        {
            key: 'what',
            header: 'Action',
            primary: true,
            cell: (entry) => (
                <button
                    type="button"
                    onClick={() => setOpenId(entry.id)}
                    aria-label={`${entryLabel(entry)}: ${entry.entity_repr || `${entityTypeLabel(entry.entity_type)}${entry.entity_id ? ` #${entry.entity_id}` : ''}`}`}
                    className="flex min-w-0 items-center gap-2.5 text-left"
                >
                    <Chip tone={ACTION_TONES[entry.action] || 'neutral'} className="shrink-0">{entryLabel(entry)}</Chip>
                    <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                            {entry.entity_repr || `${entityTypeLabel(entry.entity_type)}${entry.entity_id ? ` #${entry.entity_id}` : ''}`}
                        </span>
                        <span className="block truncate text-xs text-[var(--text-3)]">{entityTypeLabel(entry.entity_type)}{entry.entity_id ? ` #${entry.entity_id}` : ''}</span>
                    </span>
                </button>
            ),
        },
        {
            key: 'actor',
            header: 'By',
            cell: (entry) => (entry.username ? <UserCell user={{ id: entry.user, username: entry.username }} avatarSize="xs" /> : <span className="text-[var(--text-3)]">System</span>),
        },
        {
            key: 'reason',
            header: 'Reason',
            hideOnPhone: true,
            cell: (entry) => (entry.metadata?.reason
                ? <span className="line-clamp-2 max-w-[18rem] text-[var(--text-2)]">{entry.metadata.reason}</span>
                : <span className="text-[var(--text-3)]">—</span>),
        },
        {
            key: 'when',
            header: 'When',
            sortKey: 'timestamp',
            cell: (entry) => <span title={formatDateTime(entry.timestamp)} className="whitespace-nowrap text-[var(--text-2)]">{formatRelative(entry.timestamp)}</span>,
        },
    ];

    return (
        <>
            <Toolbar>
                <SearchInput value={list.searchInput} onChange={list.setSearchInput} placeholder="Search by admin, record or id" />
                <FilterSelect
                    label="Action"
                    allLabel="Any action"
                    value={list.values.action}
                    onChange={(value) => list.set({ action: value })}
                    options={AUDIT_ACTIONS.map((action) => ({ value: action, label: actionLabel(action) }))}
                />
                <FilterSelect
                    label="Record type"
                    allLabel="Any record"
                    value={list.values.entity_type}
                    onChange={(value) => list.set({ entity_type: value, entity_id: '' })}
                    options={[...new Set([...entityTypes, list.values.entity_type].filter(Boolean))].map((type) => ({ value: type, label: entityTypeLabel(type) }))}
                />
                {list.values.user && (
                    <FilterChip label={`By user #${list.values.user}`} onRemove={() => list.set({ user: '' })} />
                )}
                {list.values.entity_id && (
                    <FilterChip label={`Record #${list.values.entity_id}`} onRemove={() => list.set({ entity_id: '' })} />
                )}
            </Toolbar>
            <DataTable
                columns={columns}
                rows={entries.rows}
                loading={entries.isInitialLoading}
                fetching={entries.isFetching && !entries.isInitialLoading}
                error={entries.error}
                onRetry={() => entries.refetch()}
                sort={{ value: list.values.ordering, onChange: (ordering) => list.set({ ordering }) }}
                onRowClick={(entry) => setOpenId(entry.id)}
                caption="Audit log"
                empty={(
                    <EmptyState
                        title={list.isFiltered ? 'Nothing matches' : 'No admin actions yet'}
                        actions={list.isFiltered ? <Button variant="secondary" onClick={list.reset}>Clear filters</Button> : null}
                        compact
                    >
                        {list.isFiltered ? 'Try another action or search.' : 'Every change made in the admin is recorded here.'}
                    </EmptyState>
                )}
            />
            <Pagination page={list.page} totalPages={entries.totalPages} count={entries.count} pageSize={list.pageSize} onChange={list.setPage} />
            <AuditDrawer entry={openId ? openEntry : null} onClose={() => setOpenId(null)} />
        </>
    );
}

/* ------------------------------------------------------------ request logs */

function StatusCode({ code }) {
    if (!code) return <span className="text-[var(--text-3)]">—</span>;
    const tone = code >= 500 ? 'text-[var(--danger)]' : code >= 400 ? 'text-[var(--status-on-hold)]' : 'text-[var(--text-2)]';
    return <span className={`tabular font-medium ${tone}`}>{code}</span>;
}

function RequestStats({ params }) {
    const stats = useAdminQuery(
        adminKeys.view('logs/stats', params),
        ({ signal }) => adminApi.get('logs/stats', params, { signal }),
        { staleTime: 30_000 },
    );
    const data = stats.data;
    if (!data) return null;
    const byLevel = data.by_level || {};
    return (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius-md)] bg-white/[0.03] px-4 py-3 text-sm">
            <span className="text-[var(--text-2)]">
                <span className="font-semibold tabular text-[var(--text-1)]">{formatNumber(data.total)}</span>
                {' '}{data.window === '24h' ? 'in the last 24 hours' : 'matching'}
            </span>
            <span className="text-[var(--text-2)]">
                <span className={`font-semibold tabular ${data.recent_errors ? 'text-[var(--danger)]' : 'text-[var(--text-1)]'}`}>{formatNumber(data.recent_errors)}</span>
                {' '}errors today ({formatNumber(data.error_rate)}%)
            </span>
            <span className="flex flex-wrap gap-1.5">
                {LEVELS.filter((level) => byLevel[level]).map((level) => (
                    <Chip key={level} tone={LEVEL_TONES[level]}>{humanize(level)} {formatNumber(byLevel[level])}</Chip>
                ))}
            </span>
        </div>
    );
}

function RequestDrawer({ entry, onClose }) {
    return (
        <Drawer
            open={Boolean(entry)}
            onClose={onClose}
            title={entry ? `${entry.method || ''} ${entry.path || humanize(entry.log_type)}`.trim() : 'Log entry'}
            headerExtra={entry && <Chip tone={LEVEL_TONES[entry.level] || 'neutral'}>{humanize(entry.level)}</Chip>}
        >
            {entry && (
                <>
                    <KeyValue
                        items={[
                            { label: 'When', value: formatDateTime(entry.timestamp) },
                            { label: 'Type', value: humanize(entry.log_type) },
                            { label: 'Status', value: <StatusCode code={entry.status_code} /> },
                            { label: 'Took', value: entry.duration_ms !== null && entry.duration_ms !== undefined ? formatDuration(entry.duration_ms) : null },
                            { label: 'Member', value: entry.username ? <UserCell user={{ id: entry.user, username: entry.username }} /> : 'Signed out' },
                            { label: 'IP address', value: entry.user_ip && <span className="admin-mono">{entry.user_ip}</span> },
                            { label: 'Path', value: entry.path && <span className="admin-mono">{entry.path}</span>, wide: true },
                        ]}
                    />
                    {entry.message && (
                        <DrawerSection title="Message">
                            <pre className="admin-code">{entry.message}</pre>
                        </DrawerSection>
                    )}
                    <DrawerSection title="Details">
                        <CodeBlock value={entry.details} empty={<p className="text-sm text-[var(--text-3)]">No details recorded.</p>} />
                    </DrawerSection>
                </>
            )}
        </Drawer>
    );
}

function RequestLogs() {
    const list = useListParams({ level: '', log_type: '', start_date: '', end_date: '', user: '', ordering: '-timestamp' });
    const [openId, setOpenId] = useOpenParam();
    const logs = useAdminList('logs', list.apiParams, { onVanishedPage: list.setPage });
    const openRow = logs.rows.find((row) => String(row.id) === String(openId));
    const detail = useAdminQuery(
        adminKeys.detail('logs', openId),
        ({ signal }) => adminApi.get(`logs/${openId}`, undefined, { signal }),
        { enabled: Boolean(openId) && !openRow },
    );
    const { page, page_size: pageSize, ordering, ...statsParams } = list.apiParams;

    const columns = [
        {
            key: 'request',
            header: 'Request',
            primary: true,
            cell: (entry) => (
                <button type="button" onClick={() => setOpenId(entry.id)} className="block min-w-0 max-w-[28rem] text-left">
                    <span className="flex min-w-0 items-baseline gap-2">
                        {entry.method && <span className="admin-mono shrink-0 text-xs font-semibold text-[var(--text-2)]">{entry.method}</span>}
                        <span className="admin-mono truncate text-[var(--text-1)] hover:text-[var(--signature)]">{entry.path || humanize(entry.log_type)}</span>
                    </span>
                    {entry.message && <span className="block truncate text-xs text-[var(--text-3)]">{entry.message}</span>}
                </button>
            ),
        },
        { key: 'level', header: 'Level', cell: (entry) => <Chip tone={LEVEL_TONES[entry.level] || 'neutral'}>{humanize(entry.level)}</Chip> },
        { key: 'status', header: 'Status', align: 'right', sortKey: 'status_code', cell: (entry) => <StatusCode code={entry.status_code} /> },
        {
            key: 'duration',
            header: 'Took',
            align: 'right',
            sortKey: 'duration_ms',
            cell: (entry) => (entry.duration_ms !== null && entry.duration_ms !== undefined ? formatDuration(entry.duration_ms) : <span className="text-[var(--text-3)]">—</span>),
        },
        {
            key: 'user',
            header: 'Member',
            hideOnPhone: true,
            cell: (entry) => (entry.username ? <UserCell user={{ id: entry.user, username: entry.username }} avatarSize="xs" /> : <span className="text-[var(--text-3)]">—</span>),
        },
        {
            key: 'when',
            header: 'When',
            sortKey: 'timestamp',
            cell: (entry) => <span title={formatDateTime(entry.timestamp)} className="whitespace-nowrap text-[var(--text-2)]">{formatRelative(entry.timestamp)}</span>,
        },
    ];

    return (
        <>
            <RequestStats params={statsParams} />
            <Toolbar>
                <SearchInput value={list.searchInput} onChange={list.setSearchInput} placeholder="Search path, method or message" />
                <FilterSelect
                    label="Level"
                    allLabel="Any level"
                    value={list.values.level}
                    onChange={(value) => list.set({ level: value })}
                    options={LEVELS.map((level) => ({ value: level, label: humanize(level) }))}
                />
                <FilterSelect label="Type" allLabel="Any type" value={list.values.log_type} onChange={(value) => list.set({ log_type: value })} options={LOG_TYPES} />
                <TextInput
                    type="date"
                    aria-label="From date"
                    value={list.values.start_date}
                    max={list.values.end_date || undefined}
                    onChange={(event) => list.set({ start_date: event.target.value })}
                    className="!w-auto"
                />
                <TextInput
                    type="date"
                    aria-label="To date"
                    value={list.values.end_date}
                    min={list.values.start_date || undefined}
                    onChange={(event) => list.set({ end_date: event.target.value })}
                    className="!w-auto"
                />
                {list.values.user && (
                    <FilterChip label={`Member #${list.values.user}`} onRemove={() => list.set({ user: '' })} />
                )}
            </Toolbar>
            <DataTable
                columns={columns}
                rows={logs.rows}
                loading={logs.isInitialLoading}
                fetching={logs.isFetching && !logs.isInitialLoading}
                error={logs.error}
                onRetry={() => logs.refetch()}
                sort={{ value: ordering || list.values.ordering, onChange: (next) => list.set({ ordering: next }) }}
                onRowClick={(entry) => setOpenId(entry.id)}
                caption="Request logs"
                empty={(
                    <EmptyState
                        title={list.isFiltered ? 'Nothing matches' : 'No logs yet'}
                        actions={list.isFiltered ? <Button variant="secondary" onClick={list.reset}>Clear filters</Button> : null}
                        compact
                    >
                        {list.isFiltered ? 'Try a wider date range or another level.' : 'Requests and errors are logged here.'}
                    </EmptyState>
                )}
            />
            <Pagination page={page || list.page} totalPages={logs.totalPages} count={logs.count} pageSize={pageSize || list.pageSize} onChange={list.setPage} />
            <RequestDrawer entry={openId ? openRow || detail.data : null} onClose={() => setOpenId(null)} />
        </>
    );
}

/* -------------------------------------------------------------------- page */

export default function Logs() {
    const { isSuperuser } = useRole();
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = isSuperuser && searchParams.get('tab') === 'requests' ? 'requests' : 'audit';

    const tabs = [
        { value: 'audit', label: 'Audit log' },
        ...(isSuperuser ? [{ value: 'requests', label: 'Request logs' }] : []),
    ];

    // A different log keeps none of the other's filters.
    const switchTab = (value) => setSearchParams(value === 'audit' ? {} : { tab: value }, { replace: true });

    return (
        <>
            <PageHeader
                title="Logs"
                description={isSuperuser
                    ? 'Who changed what in the admin, and the requests and errors the site recorded.'
                    : 'Who changed what in the admin.'}
            />
            {tabs.length > 1 && (
                <Tabs items={tabs} value={tab} onChange={switchTab} label="Log" panelId="logs-panel" className="mb-4" />
            )}
            <Panel id="logs-panel" role={tabs.length > 1 ? 'tabpanel' : undefined}>
                {tab === 'requests' ? <RequestLogs key="requests" /> : <AuditLog key="audit" />}
            </Panel>
        </>
    );
}
