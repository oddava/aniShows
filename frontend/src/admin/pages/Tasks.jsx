import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';

import { adminApi, adminKeys } from '../api';
import { useAdminAction, useAdminList, useAdminQuery, useListParams, useRole, useSelection } from '../hooks';
import { formatDateTime, formatDuration, formatRelative, shortTaskName } from '../format';
import {
    BulkBar, Button, ConfirmDialog, DataTable, Dialog, Drawer, EmptyState, ErrorState, FilterSelect, KeyValue, Menu,
    PageHeader, Pagination, Panel, PanelSkeleton, SearchInput, Select, Toolbar,
} from '../ui';
import { CeleryStatusChip, CodeBlock, DrawerSection, useOpenParam } from './ops/common';

const RESOURCE = 'celery/tasks/results';

const STATUS_OPTIONS = [
    { value: 'FAILURE', label: 'Failed' },
    { value: 'SUCCESS', label: 'Succeeded' },
    { value: 'STARTED', label: 'Running' },
    { value: 'RETRY', label: 'Retrying' },
    { value: 'PENDING', label: 'Waiting' },
    { value: 'REVOKED', label: 'Cancelled' },
];

const CLEAR_OPTIONS = [
    { value: '1', label: 'Older than 1 day' },
    { value: '3', label: 'Older than 3 days' },
    { value: '7', label: 'Older than 7 days' },
    { value: '14', label: 'Older than 14 days' },
];

const runtime = (seconds) => (seconds === null || seconds === undefined ? null : formatDuration(Number(seconds) * 1000));

function TaskDrawer({ id, initial, onClose, onDelete }) {
    const detail = useAdminQuery(
        adminKeys.detail(RESOURCE, id),
        ({ signal }) => adminApi.get(`${RESOURCE}/${id}`, undefined, { signal }),
        { enabled: Boolean(id), placeholderData: initial },
    );
    const task = detail.data;
    const full = task && !detail.isPlaceholderData;

    return (
        <Drawer
            open={Boolean(id)}
            onClose={onClose}
            title={task ? shortTaskName(task.task_name) : 'Task'}
            description={task?.task_name}
            headerExtra={task && <CeleryStatusChip status={task.status} />}
            footer={task ? <Button variant="danger" icon={Trash2} onClick={() => onDelete(task)}>Delete record</Button> : null}
        >
            {!task && detail.error ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} compact /> : !task ? (
                <PanelSkeleton lines={6} className="!bg-transparent !p-0" />
            ) : (
                <>
                    <KeyValue
                        items={[
                            { label: 'Queued', value: formatDateTime(task.date_created) },
                            { label: 'Started', value: formatDateTime(task.date_started) },
                            { label: 'Finished', value: formatDateTime(task.date_completed) },
                            { label: 'Runtime', value: runtime(task.execution_time) },
                            { label: 'Queue', value: task.queue },
                            { label: 'Worker', value: task.worker && <span className="admin-mono">{task.worker}</span> },
                            { label: 'Retries', value: task.retries ? String(task.retries) : null },
                            {
                                label: 'Started by',
                                value: task.triggered_by
                                    ? <Link to={`/admin/users/${task.triggered_by.id}`} className="text-[var(--signature)]">{task.triggered_by.username}</Link>
                                    : 'Scheduler',
                            },
                            { label: 'Task id', value: <span className="admin-mono">{task.task_id}</span>, wide: true },
                        ]}
                    />
                    {task.error_message && (
                        <DrawerSection title="Error">
                            <pre className="admin-code !text-[var(--danger)]">{task.error_message}</pre>
                        </DrawerSection>
                    )}
                    {full ? (
                        <>
                            {task.traceback && <DrawerSection title="Traceback"><CodeBlock value={task.traceback} /></DrawerSection>}
                            {task.result_summary && (
                                <DrawerSection title="Summary">
                                    <p className="text-sm leading-relaxed text-[var(--text-2)]">{task.result_summary}</p>
                                </DrawerSection>
                            )}
                            <DrawerSection title="Arguments">
                                <div className="space-y-3">
                                    <CodeBlock value={task.task_args} label="Positional" />
                                    <CodeBlock value={task.task_kwargs} label="Named" />
                                    {!task.task_args?.length && !Object.keys(task.task_kwargs || {}).length && (
                                        <p className="text-sm text-[var(--text-3)]">No arguments.</p>
                                    )}
                                </div>
                            </DrawerSection>
                            {task.result_data && Object.keys(task.result_data).length > 0 && (
                                <DrawerSection title="Result"><CodeBlock value={task.result_data} /></DrawerSection>
                            )}
                        </>
                    ) : (
                        <div className="mt-6"><PanelSkeleton lines={4} className="!bg-transparent !p-0" /></div>
                    )}
                </>
            )}
        </Drawer>
    );
}

export default function Tasks() {
    const { isSuperuser } = useRole();
    const list = useListParams({ status: '', queue: '', ordering: '-date_created' });
    const [openId, setOpenId] = useOpenParam();
    const selection = useSelection([list.values, list.search]);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [clearOpen, setClearOpen] = useState(false);
    const [clearDays, setClearDays] = useState('7');

    const tasks = useAdminList(RESOURCE, list.apiParams, { onVanishedPage: list.setPage, enabled: isSuperuser });
    const invalidate = [adminKeys.resource(RESOURCE)];

    const removeOne = useAdminAction(
        (task) => adminApi.del(`${RESOURCE}/${task.id}`),
        {
            invalidate,
            success: 'Task record deleted.',
            onSuccess: (_, task) => {
                setDeleteTarget(null);
                if (String(openId) === String(task.id)) setOpenId(null);
                selection.setMany([task.id], false);
            },
        },
    );

    const bulkDelete = useAdminAction(
        (body) => adminApi.post(`${RESOURCE}/bulk_delete`, body),
        {
            invalidate,
            success: (data) => data?.message || 'Task records deleted.',
            onSuccess: () => {
                setBulkOpen(false);
                setClearOpen(false);
                selection.clear();
            },
        },
    );

    if (!isSuperuser) {
        return (
            <>
                <PageHeader title="Task history" />
                <Panel><ErrorState error={{ response: { status: 403 } }} /></Panel>
            </>
        );
    }

    const columns = [
        {
            key: 'task',
            header: 'Task',
            primary: true,
            sortKey: 'task_name',
            sortFirst: 'asc',
            cell: (task) => (
                <button type="button" onClick={() => setOpenId(task.id)} className="block min-w-0 max-w-[22rem] text-left">
                    <span className="admin-mono block truncate font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                        {task.task_name_short || shortTaskName(task.task_name)}
                    </span>
                    {task.error_message
                        ? <span className="block truncate text-xs text-[var(--danger)]">{task.error_message}</span>
                        : <span className="block truncate text-xs text-[var(--text-3)]">{task.triggered_by ? `Started by ${task.triggered_by.username}` : 'Scheduler'}</span>}
                </button>
            ),
        },
        { key: 'status', header: 'Status', cell: (task) => <CeleryStatusChip status={task.status} /> },
        { key: 'queue', header: 'Queue', hideOnPhone: true, cell: (task) => <span className="admin-mono text-[var(--text-2)]">{task.queue || '—'}</span> },
        {
            key: 'runtime',
            header: 'Runtime',
            align: 'right',
            sortKey: 'execution_time',
            cell: (task) => runtime(task.execution_time) || <span className="text-[var(--text-3)]">—</span>,
        },
        {
            key: 'created',
            header: 'Queued',
            sortKey: 'date_created',
            cell: (task) => <span title={formatDateTime(task.date_created)} className="text-[var(--text-2)]">{formatRelative(task.date_created)}</span>,
        },
        {
            key: 'actions',
            actions: true,
            cell: (task) => (
                <Menu
                    label={`Actions for ${task.task_name_short || task.task_name}`}
                    items={[
                        { label: 'Details', onSelect: () => setOpenId(task.id) },
                        { label: 'Delete record', tone: 'danger', onSelect: () => setDeleteTarget(task) },
                    ]}
                />
            ),
        },
    ];

    const queues = [...new Set(tasks.rows.map((task) => task.queue).filter(Boolean))];
    if (list.values.queue && !queues.includes(list.values.queue)) queues.push(list.values.queue);
    const openRow = tasks.rows.find((row) => String(row.id) === String(openId));

    return (
        <>
            <PageHeader
                title="Task history"
                description="Every background task the workers ran in the last 7 days, with its arguments and errors."
                actions={<Button variant="ghost" icon={Trash2} onClick={() => setClearOpen(true)}>Clear old records</Button>}
            />

            <Panel>
                <Toolbar>
                    <SearchInput
                        value={list.searchInput}
                        onChange={list.setSearchInput}
                        placeholder="Search task name, id or error"
                    />
                    <FilterSelect label="Status" allLabel="Any status" value={list.values.status} onChange={(value) => list.set({ status: value })} options={STATUS_OPTIONS} />
                    {queues.length > 0 && (
                        <FilterSelect label="Queue" allLabel="Any queue" value={list.values.queue} onChange={(value) => list.set({ queue: value })} options={queues.map((queue) => ({ value: queue, label: queue }))} />
                    )}
                </Toolbar>
                <DataTable
                    columns={columns}
                    rows={tasks.rows}
                    loading={tasks.isInitialLoading}
                    fetching={tasks.isFetching && !tasks.isInitialLoading}
                    error={tasks.error}
                    onRetry={() => tasks.refetch()}
                    selection={selection}
                    sort={{ value: list.values.ordering, onChange: (ordering) => list.set({ ordering }) }}
                    onRowClick={(task) => setOpenId(task.id)}
                    caption="Background task history"
                    empty={(
                        <EmptyState
                            title={list.isFiltered ? 'No tasks match' : 'No task history'}
                            actions={list.isFiltered ? <Button variant="secondary" onClick={list.reset}>Clear filters</Button> : null}
                            compact
                        >
                            {list.isFiltered ? 'Try another status or search.' : 'Tasks appear here as the workers run them.'}
                        </EmptyState>
                    )}
                />
                <Pagination page={list.page} totalPages={tasks.totalPages} count={tasks.count} pageSize={list.pageSize} onChange={list.setPage} />
                <BulkBar count={selection.count} onClear={selection.clear}>
                    <Button size="sm" variant="danger" icon={Trash2} onClick={() => setBulkOpen(true)}>Delete</Button>
                </BulkBar>
            </Panel>

            <TaskDrawer id={openId} initial={openRow} onClose={() => setOpenId(null)} onDelete={setDeleteTarget} />

            <ConfirmDialog
                open={Boolean(deleteTarget)}
                onClose={() => setDeleteTarget(null)}
                title="Delete this task record?"
                tone="danger"
                confirmLabel="Delete"
                busy={removeOne.isPending}
                onConfirm={() => removeOne.mutate(deleteTarget)}
            >
                Only the history record goes. Whatever the task did stays done.
            </ConfirmDialog>

            <ConfirmDialog
                open={bulkOpen}
                onClose={() => setBulkOpen(false)}
                title={`Delete ${selection.count} task ${selection.count === 1 ? 'record' : 'records'}?`}
                tone="danger"
                confirmLabel="Delete"
                busy={bulkDelete.isPending}
                onConfirm={() => bulkDelete.mutate({ ids: selection.ids })}
            >
                Only the history records go. Whatever the tasks did stays done.
            </ConfirmDialog>

            <Dialog
                open={clearOpen}
                onClose={() => setClearOpen(false)}
                title="Clear old task records"
                description="Records are also removed automatically after 7 days."
                size="sm"
                footer={(
                    <>
                        <Button variant="ghost" onClick={() => setClearOpen(false)} disabled={bulkDelete.isPending}>Cancel</Button>
                        <Button variant="danger-solid" loading={bulkDelete.isPending} onClick={() => bulkDelete.mutate({ days: Number(clearDays) })}>
                            Clear records
                        </Button>
                    </>
                )}
            >
                <Select label="Which records" value={clearDays} onChange={setClearDays} options={CLEAR_OPTIONS} />
            </Dialog>
        </>
    );
}
