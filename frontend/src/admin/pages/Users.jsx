import { useMemo, useState } from 'react';
import { startOfDay, subDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Ban, Download, RotateCcw } from 'lucide-react';

import { adminApi, adminKeys, errorMessage } from '../api';
import { useAdminAction, useAdminList, useListParams, useRole, useSelection } from '../hooks';
import { formatDateTime, formatNumber, formatRelative } from '../format';
import { notifyError } from '../../components/ui/toast';
import {
    BulkBar, Button, ConfirmDialog, DataTable, EmptyState, FilterSelect, Menu, PageHeader, Pagination, Panel,
    SearchInput, Toolbar, UserCell, UserStateChips,
} from '../ui';
import { REASON_MAX, REASON_MIN, useUserActions } from './people/userActions';

const DEFAULTS = { ordering: '-date_joined', is_active: '', role: '', email_verified: '', joined: '' };

const JOINED_OPTIONS = [
    { value: '1', label: 'Joined today' },
    { value: '7', label: 'Joined in the last 7 days' },
    { value: '30', label: 'Joined in the last 30 days' },
    { value: '90', label: 'Joined in the last 90 days' },
];

// "staff" is everyone with admin access (as Analytics counts it); moderators
// are staff who are not superusers.
const ROLE_PARAMS = {
    members: { is_staff: 'false', is_superuser: 'false' },
    staff: { is_staff: 'true' },
    moderators: { is_staff: 'true', is_superuser: 'false' },
    superusers: { is_superuser: 'true' },
};

/** URL filters → API filters (the "role" menu is two booleans on the API). */
export function usersApiParams(apiParams, now = new Date()) {
    const { role, joined, ...rest } = apiParams;
    const days = Number.parseInt(joined, 10);
    return {
        ...rest,
        ...(ROLE_PARAMS[role] || {}),
        // "Joined in the last N days" from the start of the admin's own day,
        // sent as an exact moment so the server does not read it as a UTC date.
        ...(days > 0 && { joined_since: startOfDay(subDays(now, days - 1)).toISOString() }),
    };
}

function When({ value, never = 'Never' }) {
    if (!value) return <span className="text-[var(--text-3)]">{never}</span>;
    return <time dateTime={value} title={formatDateTime(value)} className="text-[var(--text-2)]">{formatRelative(value)}</time>;
}

export default function Users() {
    const navigate = useNavigate();
    const { isSuperuser } = useRole();
    const list = useListParams(DEFAULTS);
    const params = useMemo(() => usersApiParams(list.apiParams), [list.apiParams]);
    const users = useAdminList('users', params, { onVanishedPage: list.setPage });
    const selection = useSelection([list.search, list.values.is_active, list.values.role, list.values.email_verified, list.values.joined]);
    const actions = useUserActions({ includeOpen: true });
    const [bulk, setBulk] = useState(null); // 'ban' | 'unban'
    const [exporting, setExporting] = useState(false);

    const bulkAction = useAdminAction(
        ({ operation, reason }) => adminApi.post('bulk', {
            operation, entity_type: 'user', entity_ids: selection.ids, reason,
        }),
        {
            invalidate: [adminKeys.resource('users')],
            success: (data) => data?.message || 'Done.',
            onSuccess: () => {
                setBulk(null);
                selection.clear();
            },
        },
    );

    const exportCsv = async () => {
        setExporting(true);
        try {
            const { page, page_size: pageSize, ...rest } = params; // eslint-disable-line no-unused-vars
            await adminApi.download('users/export', rest, 'users.csv');
        } catch (error) {
            notifyError(errorMessage(error, 'The export did not work. Try again.'));
        } finally {
            setExporting(false);
        }
    };

    const columns = [
        {
            key: 'user',
            header: 'User',
            sortKey: 'username',
            sortFirst: 'asc',
            primary: true,
            cell: (user) => <UserCell user={user} secondary={user.email} />,
        },
        { key: 'state', header: 'State', cell: (user) => <UserStateChips user={user} /> },
        {
            key: 'verified',
            header: 'Email',
            hideOnPhone: true,
            cell: (user) => (user.email_verified
                ? <span className="text-[var(--text-2)]">Verified</span>
                : <span className="text-[var(--status-on-hold)]">Not verified</span>),
        },
        { key: 'joined', header: 'Joined', sortKey: 'date_joined', cell: (user) => <When value={user.date_joined} /> },
        { key: 'login', header: 'Last sign-in', sortKey: 'last_login', cell: (user) => <When value={user.last_login} /> },
        {
            key: 'activity',
            header: 'Activity',
            align: 'right',
            cell: (user) => (
                <span className="text-[var(--text-2)]">
                    {formatNumber(user.list_entries_count ?? 0)} listed · {formatNumber(user.reviews_count ?? 0)} reviews
                </span>
            ),
        },
        { key: 'actions', actions: true, header: 'Actions', cell: (user) => <Menu label={`Actions for ${user.username}`} items={actions.itemsFor(user)} /> },
    ];

    return (
        <>
            <PageHeader
                title="Users"
                description="Find members, check their accounts and step in when something is wrong."
                actions={isSuperuser && (
                    <Button variant="secondary" icon={Download} onClick={exportCsv} loading={exporting}>
                        Export CSV
                    </Button>
                )}
            />

            <Panel>
                <Toolbar>
                    <SearchInput
                        value={list.searchInput}
                        onChange={list.setSearchInput}
                        placeholder="Search by username or email"
                    />
                    <FilterSelect
                        label="Status"
                        allLabel="Any status"
                        value={list.values.is_active}
                        onChange={(value) => list.set({ is_active: value })}
                        options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Suspended' }]}
                    />
                    <FilterSelect
                        label="Role"
                        allLabel="Any role"
                        value={list.values.role}
                        onChange={(value) => list.set({ role: value })}
                        options={[
                            { value: 'members', label: 'Members' },
                            { value: 'staff', label: 'All staff' },
                            { value: 'moderators', label: 'Moderators' },
                            { value: 'superusers', label: 'Superusers' },
                        ]}
                    />
                    <FilterSelect
                        label="Email"
                        allLabel="Any email"
                        value={list.values.email_verified}
                        onChange={(value) => list.set({ email_verified: value })}
                        options={[{ value: 'true', label: 'Verified' }, { value: 'false', label: 'Not verified' }]}
                    />
                    <FilterSelect
                        label="Joined"
                        allLabel="Joined any time"
                        value={list.values.joined}
                        onChange={(value) => list.set({ joined: value })}
                        options={JOINED_OPTIONS}
                    />
                </Toolbar>

                <DataTable
                    caption="Users"
                    columns={columns}
                    rows={users.rows}
                    loading={users.isInitialLoading}
                    fetching={users.isFetching}
                    error={users.error}
                    onRetry={users.refetch}
                    sort={{ value: list.values.ordering, onChange: (ordering) => list.set({ ordering }) }}
                    selection={isSuperuser ? selection : undefined}
                    onRowClick={(user) => navigate(`/admin/users/${user.id}`)}
                    empty={(
                        <EmptyState
                            title={list.isFiltered ? 'No users match' : 'No users yet'}
                            compact
                            actions={list.isFiltered && <Button variant="secondary" onClick={list.reset}>Clear filters</Button>}
                        >
                            {list.isFiltered ? 'Try another name, or clear the filters.' : 'Members show up here as soon as they sign up.'}
                        </EmptyState>
                    )}
                />
                <Pagination
                    page={list.page}
                    totalPages={users.totalPages}
                    count={users.count}
                    pageSize={list.pageSize}
                    onChange={list.setPage}
                />
            </Panel>

            <BulkBar count={selection.count} onClear={selection.clear}>
                <Button size="sm" variant="danger" icon={Ban} onClick={() => setBulk('ban')}>Suspend</Button>
                <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setBulk('unban')}>Restore</Button>
            </BulkBar>

            <ConfirmDialog
                open={Boolean(bulk)}
                onClose={() => setBulk(null)}
                title={bulk === 'ban' ? `Suspend ${formatNumber(selection.count)} users?` : `Restore ${formatNumber(selection.count)} users?`}
                tone={bulk === 'ban' ? 'danger' : 'primary'}
                confirmLabel={bulk === 'ban' ? 'Suspend' : 'Restore'}
                reason={{ label: 'Reason', required: true, min: REASON_MIN, max: REASON_MAX }}
                busy={bulkAction.isPending}
                onConfirm={({ reason }) => bulkAction.mutate({ operation: bulk, reason })}
            >
                {bulk === 'ban'
                    ? 'They are signed out everywhere and cannot sign in until restored.'
                    : 'They can sign in again straight away.'}
                {' '}Staff, superusers and your own account are skipped; change those one at a time.
            </ConfirmDialog>

            {actions.dialogs}
        </>
    );
}
