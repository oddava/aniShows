import { useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    CheckCircle2, Filter, Mail, Search, Shield, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX, XCircle,
} from 'lucide-react';

import api from '../../api/client';
import { adminKeys } from '../../api/queries/admin';
import CustomSelect from '../../components/common/CustomSelect';
import ErrorState from '../../components/common/ErrorState';
import AdminPagination from './components/AdminPagination';
import BulkActions from './components/BulkActions';
import ConfirmDialog from './components/ConfirmDialog';
import DataTable from './components/DataTable';
import UserDrawer from './components/UserDrawer';
import { getAdminErrorMessage, useAdminList } from './hooks/useAdminQuery';
import useAdminRole from './hooks/useAdminRole';
import useDebouncedValue from './hooks/useDebouncedValue';

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** Staff may suspend regular users; superusers may also suspend staff. Nobody acts on a superuser or themselves. */
export const canModerateUser = (target, { userId, isSuperuser }) => (
    target.id !== userId && !target.is_superuser && (!target.is_staff || isSuperuser)
);
/** Promote, demote and delete are superuser-only. */
export const canManageUser = (target, { userId, isSuperuser }) => (
    isSuperuser && target.id !== userId && !target.is_superuser
);

const ICON_BUTTON = 'inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors';

function ReasonField({ value, onChange, label }) {
    const id = useId();
    const hintId = useId();
    const length = value.trim().length;
    return (
        <div>
            <label htmlFor={id} className="block text-sm text-white/70 mb-1">{label}</label>
            <textarea
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                maxLength={REASON_MAX}
                rows={3}
                required
                aria-describedby={hintId}
                className="w-full px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 resize-none"
            />
            <p id={hintId} className="text-xs text-white/50 mt-1">
                {length < REASON_MIN ? `At least ${REASON_MIN} characters.` : `${length}/${REASON_MAX}`} Recorded in the audit log.
            </p>
        </div>
    );
}

const AdminUsers = () => {
    const role = useAdminRole();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search.trim());
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState({ is_staff: '', is_active: '' });
    const [ordering, setOrdering] = useState('-date_joined');
    const [selectedRows, setSelectedRows] = useState([]);
    const [drawerUserId, setDrawerUserId] = useState(null);
    const drawerOpener = useRef(null);
    // { kind: 'suspend'|'restore'|'staff'|'delete'|'bulk-ban'|'bulk-unban', user?, ids? }
    const [pending, setPending] = useState(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const list = useAdminList({
        resource: 'users',
        params: {
            page,
            ...(debouncedSearch && { search: debouncedSearch }),
            ...(filters.is_staff && { is_staff: filters.is_staff }),
            ...(filters.is_active && { is_active: filters.is_active }),
            ordering,
        },
        page,
        setPage,
        errorLog: 'Failed to fetch users:',
    });

    const openDrawer = (user) => {
        drawerOpener.current = document.activeElement;
        setDrawerUserId(user.id);
    };
    const closeDrawer = () => {
        setDrawerUserId(null);
        const opener = drawerOpener.current;
        window.setTimeout(() => opener?.focus?.(), 0);
    };

    const ask = (next) => {
        setReason('');
        setPending(next);
    };

    const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.resource('users') });

    const runPending = async () => {
        const { kind, user, ids } = pending;
        setBusy(true);
        try {
            let message;
            if (kind === 'suspend' || kind === 'restore') {
                const res = await api.post(`/admin/users/${user.id}/${kind}/`, { reason: reason.trim() });
                message = res.data?.changed === false
                    ? `${user.username} was already ${kind === 'suspend' ? 'suspended' : 'active'}`
                    : res.data?.message || `${user.username} ${kind === 'suspend' ? 'suspended' : 'restored'}`;
            } else if (kind === 'staff') {
                const res = await api.post(`/admin/users/${user.id}/toggle_staff/`, { is_staff: !user.is_staff });
                message = res.data?.message || 'Staff status updated';
            } else if (kind === 'delete') {
                const res = await api.delete(`/admin/users/${user.id}/`);
                message = res.data?.message || `${user.username} deleted`;
                // Return focus to the row's opener rather than dropping it on <body>.
                if (drawerUserId === user.id) closeDrawer();
            } else {
                const res = await api.post('/admin/bulk/', {
                    operation: kind === 'bulk-ban' ? 'ban' : 'unban',
                    entity_type: 'user',
                    entity_ids: ids,
                    reason: reason.trim(),
                });
                message = res.data?.message || 'Users updated';
                setSelectedRows([]);
            }
            toast.success(message);
            setPending(null);
            refresh();
        } catch (err) {
            toast.error(getAdminErrorMessage(err, 'That action failed'));
        } finally {
            setBusy(false);
        }
    };

    const rowActions = (user) => {
        const moderate = canModerateUser(user, role);
        const manage = canManageUser(user, role);
        return (
            <>
                {moderate && (user.is_active ? (
                    <button type="button" onClick={() => ask({ kind: 'suspend', user })} className={ICON_BUTTON} aria-label={`Suspend ${user.username}`}>
                        <UserX size={16} aria-hidden="true" />
                    </button>
                ) : (
                    <button type="button" onClick={() => ask({ kind: 'restore', user })} className={ICON_BUTTON} aria-label={`Restore ${user.username}`}>
                        <UserCheck size={16} aria-hidden="true" />
                    </button>
                ))}
                {manage && (
                    <button
                        type="button"
                        onClick={() => ask({ kind: 'staff', user })}
                        className={ICON_BUTTON}
                        aria-label={user.is_staff ? `Remove staff role from ${user.username}` : `Promote ${user.username} to staff`}
                    >
                        {user.is_staff ? <ShieldOff size={16} aria-hidden="true" /> : <Shield size={16} aria-hidden="true" />}
                    </button>
                )}
                {manage && (
                    <button
                        type="button"
                        onClick={() => ask({ kind: 'delete', user })}
                        className={`${ICON_BUTTON} hover:bg-red-500/20 hover:text-red-400`}
                        aria-label={`Delete ${user.username}`}
                    >
                        <Trash2 size={16} aria-hidden="true" />
                    </button>
                )}
            </>
        );
    };

    const columns = [
        {
            key: 'username',
            title: 'User',
            sortable: true,
            render: (user) => (
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-sm font-bold text-gray-400 overflow-hidden flex-shrink-0" aria-hidden="true">
                        {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col min-w-0 text-left">
                        <span className="font-semibold text-white truncate">{user.username}</span>
                        <span className="text-xs text-gray-500 flex items-center gap-1 truncate">
                            <Mail size={10} aria-hidden="true" /> {user.email}
                        </span>
                    </div>
                </div>
            ),
        },
        {
            key: 'is_active',
            title: 'Status',
            render: (user) => (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] uppercase font-semibold border ${user.is_active ? 'border-emerald-500/20 text-emerald-400' : 'border-red-500/20 text-red-400'}`}>
                    {user.is_active ? <CheckCircle2 size={12} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />}
                    {user.is_active ? 'Active' : 'Suspended'}
                </span>
            ),
        },
        {
            key: 'role',
            title: 'Role',
            render: (user) => (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] uppercase font-semibold border ${user.is_superuser ? 'border-amber-500/30 text-amber-400' : user.is_staff ? 'border-blue-500/30 text-blue-400' : 'border-white/10 text-gray-400'}`}>
                    {user.is_superuser ? <Shield size={12} aria-hidden="true" /> : user.is_staff ? <ShieldCheck size={12} aria-hidden="true" /> : <UserCheck size={12} aria-hidden="true" />}
                    {user.is_superuser ? 'Superuser' : user.is_staff ? 'Staff' : 'User'}
                </span>
            ),
        },
        {
            key: 'date_joined',
            title: 'Joined',
            sortable: true,
            render: (user) => <span className="text-xs text-gray-400">{new Date(user.date_joined).toLocaleDateString()}</span>,
        },
        {
            key: 'actions',
            title: 'Actions',
            render: (user) => <div className="flex items-center gap-2">{rowActions(user)}</div>,
        },
    ];

    const pendingUser = pending?.user;
    const needsReason = ['suspend', 'restore', 'bulk-ban', 'bulk-unban'].includes(pending?.kind);
    const reasonOk = reason.trim().length >= REASON_MIN;
    const dialogCopy = {
        suspend: {
            title: `Suspend ${pendingUser?.username}?`,
            message: 'They are signed out on every device and cannot sign in until restored.',
            confirmLabel: 'Suspend',
            destructive: true,
        },
        restore: {
            title: `Restore ${pendingUser?.username}?`,
            message: 'They can sign in again.',
            confirmLabel: 'Restore',
        },
        staff: {
            title: pendingUser?.is_staff ? `Remove staff role from ${pendingUser?.username}?` : `Promote ${pendingUser?.username} to staff?`,
            message: pendingUser?.is_staff
                ? 'They lose access to the admin area.'
                : 'Staff can moderate reviews and suspend regular users.',
            confirmLabel: pendingUser?.is_staff ? 'Remove staff role' : 'Promote',
        },
        delete: {
            title: `Delete ${pendingUser?.username}?`,
            message: 'Their account, lists, reviews and favorites are deleted. This cannot be undone.',
            confirmLabel: 'Delete user',
            destructive: true,
            requireText: pendingUser?.username,
        },
        'bulk-ban': {
            title: `Suspend ${pending?.ids?.length} users?`,
            message: 'Staff and superuser accounts in the selection are skipped.',
            confirmLabel: 'Suspend',
            destructive: true,
        },
        'bulk-unban': {
            title: `Restore ${pending?.ids?.length} users?`,
            message: 'Staff and superuser accounts in the selection are skipped.',
            confirmLabel: 'Restore',
        },
    }[pending?.kind] || { title: '' };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">User Management</h1>
                <p className="text-gray-400 mt-1">View, filter, and moderate platform users.</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} aria-hidden="true" />
                    <input
                        type="search"
                        aria-label="Search users"
                        placeholder="Search users by name or email..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500"
                    />
                </div>
                <div className="flex w-full md:w-auto gap-3">
                    <div className="flex-1 md:flex-none">
                        <CustomSelect
                            value={filters.is_active}
                            onChange={(next) => { setFilters((f) => ({ ...f, is_active: next })); setPage(1); }}
                            options={[
                                { value: '', label: 'All statuses' },
                                { value: 'true', label: 'Active' },
                                { value: 'false', label: 'Suspended' },
                            ]}
                            startIcon={Filter}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm"
                            ariaLabel="Filter by user status"
                        />
                    </div>
                    <div className="flex-1 md:flex-none">
                        <CustomSelect
                            value={filters.is_staff}
                            onChange={(next) => { setFilters((f) => ({ ...f, is_staff: next })); setPage(1); }}
                            options={[
                                { value: '', label: 'All roles' },
                                { value: 'true', label: 'Staff & superusers' },
                                { value: 'false', label: 'Regular users' },
                            ]}
                            startIcon={Shield}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm"
                            ariaLabel="Filter by user role"
                        />
                    </div>
                </div>
            </div>

            {role.isSuperuser && (
                <BulkActions
                    selectedCount={selectedRows.length}
                    actions={[
                        { label: 'Suspend', icon: UserX, variant: 'danger', onClick: () => ask({ kind: 'bulk-ban', ids: selectedRows }) },
                        { label: 'Restore', icon: UserCheck, onClick: () => ask({ kind: 'bulk-unban', ids: selectedRows }) },
                    ]}
                    onClearSelection={() => setSelectedRows([])}
                />
            )}

            {list.error && !list.isFetching ? (
                <ErrorState
                    title="Error Loading Users"
                    message={getAdminErrorMessage(list.error, 'Failed to load users')}
                    onRetry={() => list.refetch()}
                />
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    <DataTable
                        columns={columns}
                        data={list.items}
                        loading={list.isFetching && list.items.length === 0}
                        selectable={role.isSuperuser}
                        selectedRows={selectedRows}
                        onSelectionChange={setSelectedRows}
                        ordering={ordering}
                        onSort={(next) => { setOrdering(next); setPage(1); }}
                        onView={openDrawer}
                        rowLabel={(user) => user.username}
                        emptyMessage="No users found matching your criteria."
                    />
                    <AdminPagination page={page} totalPages={list.totalPages} onPageChange={setPage} />
                </div>
            )}

            {drawerUserId !== null && (
                <UserDrawer
                    userId={drawerUserId}
                    onClose={closeDrawer}
                    paused={pending !== null}
                    renderActions={(user) => rowActions(user)}
                />
            )}

            <ConfirmDialog
                isOpen={pending !== null}
                {...dialogCopy}
                busy={busy}
                confirmDisabled={needsReason && !reasonOk}
                onCancel={() => setPending(null)}
                onConfirm={runPending}
            >
                {needsReason && <ReasonField value={reason} onChange={setReason} label="Reason" />}
            </ConfirmDialog>
        </div>
    );
};

export default AdminUsers;
