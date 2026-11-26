import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UserPlus, Users as UsersIcon, X } from 'lucide-react';

import { adminApi, adminKeys, fieldErrors } from '../api';
import { useAdminAction, useAdminList, useDebouncedValue, useListParams, useOpenParam, useRole } from '../hooks';
import { formatDate, formatNumber, plural } from '../format';
import {
    Avatar, Button, CheckboxRow, Chip, ConfirmDialog, DataTable, Dialog, Drawer, EmptyState, ErrorState, Field, Menu, PageHeader,
    Pagination, Panel, SearchInput, Select, Skeleton, SwitchRow, TextArea, TextInput, Toolbar, UserCell,
} from '../ui';
import { BADGE_COLORS, BADGE_ICONS, BadgeMark, BadgePill } from './people/badgeLook';

const HOLDERS_PAGE_SIZE = 20;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const emptyForm = { name: '', description: '', icon: 'award', color: 'blue', priority: 0, is_active: true };

function BadgeFormDialog({ open, badge, onClose }) {
    const editing = Boolean(badge?.id);
    const [form, setForm] = useState(emptyForm);
    const [image, setImage] = useState(null);
    const [preview, setPreview] = useState(null);
    const [removeImage, setRemoveImage] = useState(false);
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (!open) return;
        setForm(badge ? {
            name: badge.name || '',
            description: badge.description || '',
            icon: badge.icon || 'award',
            color: badge.color || 'blue',
            priority: badge.priority ?? 0,
            is_active: badge.is_active !== false,
        } : emptyForm);
        setImage(null);
        setPreview(null);
        setRemoveImage(false);
        setErrors({});
    }, [open, badge]);

    useEffect(() => () => {
        if (preview) URL.revokeObjectURL(preview);
    }, [preview]);

    const save = useAdminAction(
        (data) => (editing ? adminApi.upload('patch', `badges/${badge.id}`, data) : adminApi.upload('post', 'badges', data)),
        {
            invalidate: [adminKeys.resource('badges')],
            success: editing ? 'Badge saved.' : 'Badge created.',
            onSuccess: onClose,
            onError: (error) => setErrors(fieldErrors(error)),
        },
    );

    const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

    const pickImage = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > MAX_IMAGE_BYTES) {
            setErrors((current) => ({ ...current, image: 'Pick an image under 2 MB.' }));
            event.target.value = '';
            return;
        }
        setErrors((current) => ({ ...current, image: undefined }));
        setImage(file);
        setRemoveImage(false);
        setPreview(URL.createObjectURL(file));
    };

    const submit = (event) => {
        event.preventDefault();
        const next = {};
        if (!form.name.trim()) next.name = 'Give the badge a name.';
        if (!form.description.trim()) next.description = 'Say what the badge is for.';
        setErrors(next);
        if (Object.keys(next).length) return;
        const data = new FormData();
        data.append('name', form.name.trim());
        data.append('description', form.description.trim());
        data.append('icon', form.icon);
        data.append('color', form.color);
        data.append('priority', String(Number(form.priority) || 0));
        data.append('is_active', form.is_active ? 'true' : 'false');
        if (image) data.append('image', image);
        else if (removeImage) data.append('remove_image', 'true');
        save.mutate(data);
    };

    const previewBadge = { ...form, image: preview || removeImage ? null : badge?.image };

    return (
        <Dialog
            open={open}
            onClose={save.isPending ? () => {} : onClose}
            title={editing ? `Edit ${badge.name}` : 'New badge'}
            size="lg"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
                    <Button variant="primary" type="submit" form="badge-form" loading={save.isPending}>
                        {editing ? 'Save badge' : 'Create badge'}
                    </Button>
                </>
            )}
        >
            <form id="badge-form" onSubmit={submit} className="grid gap-4 pb-2 sm:grid-cols-2" noValidate>
                <Field label="Name" required error={errors.name} className="sm:col-span-2">
                    {(id, aria) => <TextInput id={id} {...aria} maxLength={100} value={form.name} onChange={(event) => set('name')(event.target.value)} />}
                </Field>
                <Field label="Description" required error={errors.description} hint="Shown when members hover the badge." className="sm:col-span-2">
                    {(id, aria) => <TextArea id={id} {...aria} rows={3} value={form.description} onChange={(event) => set('description')(event.target.value)} />}
                </Field>
                <Field label="Icon" error={errors.icon}>
                    {(id) => (
                        <Select
                            id={id}
                            value={form.icon}
                            onChange={set('icon')}
                            options={Object.keys(BADGE_ICONS).map((name) => ({ value: name, label: name.charAt(0).toUpperCase() + name.slice(1) }))}
                        />
                    )}
                </Field>
                <Field label="Colour" error={errors.color}>
                    {(id) => (
                        <Select
                            id={id}
                            value={form.color}
                            onChange={set('color')}
                            options={Object.entries(BADGE_COLORS).map(([value, color]) => ({ value, label: color.label }))}
                        />
                    )}
                </Field>
                <Field label="Priority" error={errors.priority} hint="Higher shows first on profiles.">
                    {(id, aria) => (
                        <TextInput id={id} {...aria} type="number" inputMode="numeric" value={form.priority} onChange={(event) => set('priority')(event.target.value)} />
                    )}
                </Field>
                <Field label="Image" error={errors.image} hint="Optional. Replaces the icon. PNG, JPG or WebP under 2 MB.">
                    {(id, aria) => (
                        <input
                            id={id}
                            {...aria}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={pickImage}
                            className="block min-h-11 w-full text-sm text-[var(--text-2)] file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3.5 file:text-sm file:font-medium file:text-[var(--text-1)] hover:file:bg-white/[0.12]"
                        />
                    )}
                </Field>
                {badge?.image && !image && (
                    <div className="sm:col-span-2 -mt-2">
                        <CheckboxRow
                            label="Remove the current image"
                            description="The badge shows its icon instead."
                            checked={removeImage}
                            onChange={setRemoveImage}
                        />
                    </div>
                )}
                <div className="sm:col-span-2">
                    <SwitchRow
                        label="Can be granted"
                        description="Turn off to retire the badge. Members who hold it keep it, but it is hidden on profiles."
                        checked={form.is_active}
                        onChange={set('is_active')}
                    />
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--ink-1)] px-4 py-3 sm:col-span-2">
                    <p className="mb-2 text-xs font-medium text-[var(--text-3)]">Preview</p>
                    <BadgePill badge={previewBadge} src={preview} />
                </div>
            </form>
        </Dialog>
    );
}

function GrantDialog({ open, badge, onClose }) {
    const [term, setTerm] = useState('');
    const [picked, setPicked] = useState([]);
    const [reason, setReason] = useState('');
    const search = useDebouncedValue(term.trim(), 250);

    useEffect(() => {
        if (open) {
            setTerm('');
            setPicked([]);
            setReason('');
        }
    }, [open]);

    const results = useQuery({
        queryKey: adminKeys.list('users', { search, page_size: 6 }),
        queryFn: ({ signal }) => adminApi.get('users', { search, page_size: 6 }, { signal }),
        enabled: open && search.length >= 2,
        staleTime: 30_000,
        retry: false,
    });

    const grant = useAdminAction(
        () => adminApi.post(`badges/${badge.id}/grant`, { user_ids: picked.map((user) => user.id), reason: reason.trim() }),
        {
            invalidate: [adminKeys.resource('badges'), adminKeys.resource('users')],
            success: (data) => data?.message || 'Badge granted.',
            onSuccess: onClose,
        },
    );

    const pickedIds = new Set(picked.map((user) => user.id));
    const rows = (results.data?.results || []).filter((user) => !pickedIds.has(user.id));

    return (
        <Dialog
            open={open}
            onClose={grant.isPending ? () => {} : onClose}
            title={`Grant ${badge?.name || 'badge'}`}
            description="Pick the members who earned it. They get a notification."
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={grant.isPending}>Cancel</Button>
                    <Button variant="primary" onClick={() => grant.mutate()} disabled={picked.length === 0} loading={grant.isPending}>
                        {picked.length ? `Grant to ${plural(picked.length, 'member')}` : 'Grant'}
                    </Button>
                </>
            )}
        >
            <div className="space-y-4 pb-2">
                <Field label="Find members">
                    {(id) => (
                        <TextInput
                            id={id}
                            type="search"
                            value={term}
                            onChange={(event) => setTerm(event.target.value)}
                            placeholder="Username or email"
                            autoComplete="off"
                            autoFocus
                        />
                    )}
                </Field>

                {search.length >= 2 && (
                    <div aria-live="polite">
                        {results.isFetching && !results.data ? (
                            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
                        ) : rows.length === 0 ? (
                            <p className="text-sm text-[var(--text-3)]">{results.data ? 'No one else matches.' : ''}</p>
                        ) : (
                            <ul className="-mx-2 space-y-0.5">
                                {rows.map((user) => (
                                    <li key={user.id}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPicked((current) => [...current, user]);
                                                setTerm('');
                                            }}
                                            className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-2 text-left text-sm transition-colors hover:bg-white/[0.05]"
                                        >
                                            <Avatar src={user.avatar} name={user.username} size="xs" />
                                            <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-1)]">{user.username}</span>
                                            <span className="truncate text-xs text-[var(--text-3)]">{user.email}</span>
                                            <Plus className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {picked.length > 0 && (
                    <div>
                        <p className="mb-2 text-xs font-medium text-[var(--text-3)]">{plural(picked.length, 'member')} picked</p>
                        <ul className="flex flex-wrap gap-1.5">
                            {picked.map((user) => (
                                <li key={user.id} className="inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.07] pl-1.5 pr-1 text-sm text-[var(--text-1)]">
                                    <Avatar src={user.avatar} name={user.username} size="xs" />
                                    {user.username}
                                    <button
                                        type="button"
                                        onClick={() => setPicked((current) => current.filter((item) => item.id !== user.id))}
                                        aria-label={`Remove ${user.username}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-3)] hover:bg-white/[0.08] hover:text-[var(--text-1)] relative after:absolute after:-inset-1.5 after:content-['']"
                                    >
                                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <Field label="Reason" hint="Optional. Shown with the badge and kept in the audit log.">
                    {(id, aria) => (
                        <TextInput id={id} {...aria} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Helped moderate the forums" />
                    )}
                </Field>
            </div>
        </Dialog>
    );
}

function HoldersDrawer({ badge, onClose }) {
    const { isSuperuser } = useRole();
    const [page, setPage] = useState(1);
    const [revoking, setRevoking] = useState(null);
    const open = Boolean(badge);

    useEffect(() => {
        setPage(1);
    }, [badge?.id]);

    const holders = useQuery({
        queryKey: [...adminKeys.resource('badges'), 'holders', String(badge?.id), { page }],
        queryFn: ({ signal }) => adminApi.get(`badges/${badge.id}/holders`, { page, page_size: HOLDERS_PAGE_SIZE }, { signal }),
        enabled: open,
        retry: false,
    });

    const revoke = useAdminAction(
        (user) => adminApi.post(`badges/${badge.id}/revoke`, { user_ids: [user.id] }),
        {
            invalidate: [adminKeys.resource('badges'), adminKeys.resource('users')],
            success: (data) => data?.message || 'Badge revoked.',
            onSuccess: () => setRevoking(null),
        },
    );

    const rows = holders.data?.results || [];
    const count = holders.data?.count ?? rows.length;

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={badge ? `Who holds ${badge.name}` : 'Holders'}
            description={holders.data ? plural(count, 'member') : undefined}
        >
            {holders.isLoading ? (
                <div className="space-y-3" aria-busy="true">
                    {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
                </div>
            ) : holders.error ? (
                <ErrorState error={holders.error} onRetry={holders.refetch} compact />
            ) : rows.length === 0 ? (
                <EmptyState title="No one holds this badge yet" compact>
                    {isSuperuser ? 'Grant it from the badge’s menu.' : 'Superusers grant badges; holders show up here.'}
                </EmptyState>
            ) : (
                <>
                    <ul className="space-y-1">
                        {rows.map((holder) => (
                            <li key={holder.id} className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] px-2 py-2.5 hover:bg-white/[0.03]">
                                <div className="min-w-0">
                                    <UserCell
                                        user={holder.user}
                                        secondary={[
                                            `Granted ${formatDate(holder.granted_at)}`,
                                            holder.granted_by?.username && `by ${holder.granted_by.username}`,
                                        ].filter(Boolean).join(' ')}
                                    />
                                    {holder.reason && <p className="mt-1.5 pl-11 text-sm text-[var(--text-2)]">{holder.reason}</p>}
                                </div>
                                {isSuperuser && (
                                    <Button size="sm" variant="ghost" onClick={() => setRevoking(holder.user)}>Revoke</Button>
                                )}
                            </li>
                        ))}
                    </ul>
                    <Pagination
                        page={page}
                        totalPages={Math.max(1, Math.ceil(count / HOLDERS_PAGE_SIZE))}
                        count={count}
                        pageSize={HOLDERS_PAGE_SIZE}
                        onChange={setPage}
                    />
                </>
            )}
            <ConfirmDialog
                open={Boolean(revoking)}
                onClose={() => setRevoking(null)}
                title={`Take ${badge?.name || 'the badge'} from ${revoking?.username || 'this member'}?`}
                tone="danger"
                confirmLabel="Revoke"
                busy={revoke.isPending}
                onConfirm={() => revoke.mutate(revoking)}
            >
                It disappears from their profile. You can grant it again later.
            </ConfirmDialog>
        </Drawer>
    );
}

export default function Badges() {
    const { isSuperuser } = useRole();
    const list = useListParams({});
    const [openId, setOpenId] = useOpenParam();
    const badges = useAdminList('badges', list.apiParams, { onVanishedPage: list.setPage });
    const [form, setForm] = useState(null); // { badge } | null
    const [granting, setGranting] = useState(null);
    const [deleting, setDeleting] = useState(null);

    const holdersBadge = openId ? badges.rows.find((badge) => String(badge.id) === String(openId)) || { id: openId, name: 'this badge' } : null;

    const remove = useAdminAction(
        (badge) => adminApi.del(`badges/${badge.id}`),
        { invalidate: [adminKeys.resource('badges')], success: 'Badge deleted.', onSuccess: () => setDeleting(null) },
    );

    const columns = [
        {
            key: 'badge',
            header: 'Badge',
            primary: true,
            cell: (badge) => (
                <span className="flex min-w-0 items-center gap-3">
                    <BadgeMark badge={badge} />
                    <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--text-1)]">{badge.name}</span>
                        <span className="line-clamp-1 text-xs text-[var(--text-3)]">{badge.description}</span>
                    </span>
                </span>
            ),
        },
        {
            key: 'state',
            header: 'State',
            cell: (badge) => (badge.is_active === false ? <Chip>Retired</Chip> : <Chip tone="success" dot>Can be granted</Chip>),
        },
        { key: 'priority', header: 'Priority', align: 'right', cell: (badge) => formatNumber(badge.priority ?? 0) },
        {
            key: 'holders',
            header: 'Holders',
            align: 'right',
            cell: (badge) => (
                <button
                    type="button"
                    onClick={() => setOpenId(badge.id)}
                    className="inline-flex min-h-11 items-center rounded-md px-2 font-medium tabular text-[var(--signature)] hover:bg-[var(--signature-soft)]"
                    aria-label={`${plural(badge.holders_count ?? 0, 'holder')} of ${badge.name}`}
                >
                    {formatNumber(badge.holders_count ?? 0)}
                </button>
            ),
        },
        {
            key: 'actions',
            actions: true,
            cell: (badge) => (
                <Menu
                    label={`Actions for ${badge.name}`}
                    items={[
                        { label: 'See holders', icon: UsersIcon, onSelect: () => setOpenId(badge.id) },
                        { label: 'Grant', icon: UserPlus, hidden: !isSuperuser || badge.is_active === false, onSelect: () => setGranting(badge) },
                        { label: 'Edit', icon: Pencil, hidden: !isSuperuser, onSelect: () => setForm({ badge }) },
                        { label: 'Delete', icon: Trash2, tone: 'danger', hidden: !isSuperuser, onSelect: () => setDeleting(badge) },
                    ]}
                />
            ),
        },
    ];

    return (
        <>
            <PageHeader
                title="Badges"
                description={isSuperuser
                    ? 'Recognise members for what they do. Create badges, grant them and see who holds each one.'
                    : 'The badges members can earn and who holds them. Superusers create and grant them.'}
                actions={isSuperuser && (
                    <Button variant="primary" icon={Plus} onClick={() => setForm({ badge: null })}>New badge</Button>
                )}
            />

            <Panel>
                <Toolbar>
                    <SearchInput value={list.searchInput} onChange={list.setSearchInput} placeholder="Search badges" />
                </Toolbar>
                <DataTable
                    caption="Badges"
                    columns={columns}
                    rows={badges.rows}
                    loading={badges.isInitialLoading}
                    fetching={badges.isFetching}
                    error={badges.error}
                    onRetry={badges.refetch}
                    skeletonRows={5}
                    empty={(
                        <EmptyState
                            title={list.search ? 'No badges match' : 'No badges yet'}
                            compact
                            actions={!list.search && isSuperuser && <Button variant="primary" icon={Plus} onClick={() => setForm({ badge: null })}>New badge</Button>}
                        >
                            {list.search ? 'Try another name.' : isSuperuser ? 'Create the first badge to start recognising members.' : 'Superusers create badges; they show up here.'}
                        </EmptyState>
                    )}
                />
                <Pagination page={list.page} totalPages={badges.totalPages} count={badges.count} pageSize={list.pageSize} onChange={list.setPage} />
            </Panel>

            <BadgeFormDialog open={Boolean(form)} badge={form?.badge} onClose={() => setForm(null)} />
            <GrantDialog open={Boolean(granting)} badge={granting} onClose={() => setGranting(null)} />
            <HoldersDrawer badge={holdersBadge} onClose={() => setOpenId(null)} />
            <ConfirmDialog
                open={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                title={`Delete ${deleting?.name || 'this badge'}?`}
                tone="danger"
                confirmLabel="Delete badge"
                busy={remove.isPending}
                onConfirm={() => remove.mutate(deleting)}
            >
                {deleting?.holders_count
                    ? `${plural(deleting.holders_count, 'member')} lose it from their profile. To keep their badges, turn off “Can be granted” instead.`
                    : 'No one holds it, so nothing else changes.'}
            </ConfirmDialog>
        </>
    );
}
