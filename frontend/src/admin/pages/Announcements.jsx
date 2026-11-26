import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { BellRing, Pencil, Plus, Power, Trash2 } from 'lucide-react';

import { adminApi, adminKeys, errorMessage, fieldErrors } from '../api';
import { useAdminAction, useAdminList, useListParams, useRole } from '../hooks';
import { formatDateTime, formatNumber, formatRelative, plural } from '../format';
import { notify, notifyError } from '../../components/ui/toast';
import { ANNOUNCEMENT_LEVELS, AnnouncementBar } from '../../components/AnnouncementBanner';
import {
    Button, Chip, ConfirmDialog, DataTable, Dialog, EmptyState, Field, FilterSelect, Menu, Notice, PageHeader,
    Pagination, Panel, Select, SwitchRow, TextArea, TextInput, Toolbar,
} from '../ui';

/** A send still queued after 15 minutes lost its job; the API lets it be sent again (force). */
const STUCK_AFTER_MS = 15 * 60_000;
const isStuck = (item) => item?.notify_status === 'queued'
    && (!item.notify_queued_at || Date.now() - Date.parse(item.notify_queued_at) > STUCK_AFTER_MS);

const BODY_MAX = 1000;
const LEVEL_TONES = { info: 'accent', success: 'success', warning: 'warning', critical: 'danger' };

const AUDIENCES = [
    { value: 'all', label: 'Everyone', description: 'Every active member.' },
    { value: 'active_30d', label: 'Active in the last 30 days', description: 'Members who used the site this month.' },
    { value: 'staff', label: 'Staff only', description: 'Staff and superusers, to try it out first.' },
];

/** Where an announcement stands right now. */
export function announcementState(item, now = new Date()) {
    if (!item?.is_active) return { key: 'off', label: 'Off', tone: 'neutral' };
    const starts = item.starts_at ? parseISO(item.starts_at) : null;
    const ends = item.ends_at ? parseISO(item.ends_at) : null;
    if (starts && isValid(starts) && starts > now) return { key: 'scheduled', label: 'Scheduled', tone: 'accent' };
    if (ends && isValid(ends) && ends <= now) return { key: 'ended', label: 'Ended', tone: 'neutral' };
    return { key: 'live', label: 'Live', tone: 'success' };
}

/** ISO → the value a datetime-local input wants (local time), and back. */
const toLocalInput = (iso) => {
    if (!iso) return '';
    const date = parseISO(iso);
    return isValid(date) ? format(date, "yyyy-MM-dd'T'HH:mm") : '';
};
const fromLocalInput = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const emptyForm = {
    title: '', body: '', link_url: '', link_label: '', level: 'info', is_active: true, show_banner: true, starts_at: '', ends_at: '',
};

function AnnouncementForm({ open, item, onClose }) {
    const editing = Boolean(item?.id);
    const [form, setForm] = useState(emptyForm);
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (!open) return;
        setErrors({});
        setForm(item ? {
            title: item.title || '',
            body: item.body || '',
            link_url: item.link_url || '',
            link_label: item.link_label || '',
            level: item.level || 'info',
            is_active: item.is_active !== false,
            show_banner: item.show_banner !== false,
            starts_at: toLocalInput(item.starts_at),
            ends_at: toLocalInput(item.ends_at),
        } : emptyForm);
    }, [open, item]);

    const save = useAdminAction(
        (payload) => (editing ? adminApi.patch(`announcements/${item.id}`, payload) : adminApi.post('announcements', payload)),
        {
            invalidate: [adminKeys.resource('announcements'), ['announcements', 'active']],
            success: editing ? 'Announcement saved.' : 'Announcement created.',
            onSuccess: onClose,
            onError: (error) => setErrors(fieldErrors(error)),
        },
    );

    const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

    const submit = (event) => {
        event.preventDefault();
        const next = {};
        if (!form.title.trim()) next.title = 'Add a title.';
        if (form.body.length > BODY_MAX) next.body = `Keep it under ${BODY_MAX} characters.`;
        if (form.link_url && !/^(https?:\/\/|\/(?!\/))/i.test(form.link_url.trim())) next.link_url = 'Use a full https:// address or a site path like /schedule.';
        const starts = fromLocalInput(form.starts_at);
        const ends = fromLocalInput(form.ends_at);
        if (starts && ends && new Date(ends) <= new Date(starts)) next.ends_at = 'End after it starts.';
        setErrors(next);
        if (Object.keys(next).length) return;
        save.mutate({
            title: form.title.trim(),
            body: form.body.trim(),
            link_url: form.link_url.trim(),
            link_label: form.link_label.trim(),
            level: form.level,
            is_active: form.is_active,
            show_banner: form.show_banner,
            starts_at: starts,
            ends_at: ends,
        });
    };

    return (
        <Dialog
            open={open}
            onClose={save.isPending ? () => {} : onClose}
            title={editing ? 'Edit announcement' : 'New announcement'}
            description="A short note for members, shown as a bar at the top of every page while it is live."
            size="lg"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
                    <Button variant="primary" type="submit" form="announcement-form" loading={save.isPending}>
                        {editing ? 'Save' : 'Create announcement'}
                    </Button>
                </>
            )}
        >
            <form id="announcement-form" onSubmit={submit} noValidate className="grid gap-4 pb-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                    <p className="mb-2 text-xs font-medium text-[var(--text-3)]">Preview</p>
                    <AnnouncementBar announcement={form} onDismiss={() => {}} />
                </div>
                <Field label="Title" required error={errors.title} className="sm:col-span-2">
                    {(id, aria) => <TextInput id={id} {...aria} maxLength={120} value={form.title} onChange={(event) => set('title')(event.target.value)} placeholder="Scheduled maintenance on Sunday" />}
                </Field>
                <Field
                    label="Message"
                    error={errors.body}
                    hint={`${formatNumber(form.body.length)} of ${formatNumber(BODY_MAX)} characters. One or two sentences read best.`}
                    className="sm:col-span-2"
                >
                    {(id, aria) => <TextArea id={id} {...aria} rows={3} maxLength={BODY_MAX} value={form.body} onChange={(event) => set('body')(event.target.value)} />}
                </Field>
                <Field label="Link" error={errors.link_url} hint="Optional. https://… or a site path such as /schedule.">
                    {(id, aria) => <TextInput id={id} {...aria} type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="/schedule" value={form.link_url} onChange={(event) => set('link_url')(event.target.value)} />}
                </Field>
                <Field label="Link text" error={errors.link_label} hint="Defaults to “Learn more”.">
                    {(id, aria) => <TextInput id={id} {...aria} maxLength={40} value={form.link_label} onChange={(event) => set('link_label')(event.target.value)} />}
                </Field>
                <Field label="Tone" error={errors.level}>
                    {(id) => (
                        <Select
                            id={id}
                            value={form.level}
                            onChange={set('level')}
                            options={Object.entries(ANNOUNCEMENT_LEVELS).map(([value, level]) => ({ value, label: level.label }))}
                        />
                    )}
                </Field>
                <div className="hidden sm:block" />
                <Field label="Starts" error={errors.starts_at} hint="Leave empty to start now.">
                    {(id, aria) => <TextInput id={id} {...aria} type="datetime-local" value={form.starts_at} onChange={(event) => set('starts_at')(event.target.value)} />}
                </Field>
                <Field label="Ends" error={errors.ends_at} hint="Leave empty to run until turned off.">
                    {(id, aria) => <TextInput id={id} {...aria} type="datetime-local" value={form.ends_at} onChange={(event) => set('ends_at')(event.target.value)} />}
                </Field>
                <div className="sm:col-span-2">
                    <SwitchRow
                        label="Show as a banner"
                        description="The bar at the top of every page. Turn off to only send it as a notification."
                        checked={form.show_banner}
                        onChange={set('show_banner')}
                    />
                    <SwitchRow
                        label="Turned on"
                        description="Off hides it everywhere without deleting it."
                        checked={form.is_active}
                        onChange={set('is_active')}
                    />
                </div>
            </form>
        </Dialog>
    );
}

function NotifyDialog({ item, onClose }) {
    const queryClient = useQueryClient();
    const [audience, setAudience] = useState('all');
    // new | sent | failed | stuck | busy: what the last send left behind.
    const [mode, setMode] = useState('new');
    const open = Boolean(item);

    useEffect(() => {
        if (!open) return;
        // A retry goes to the same people by default: never widen a staff-only test.
        setAudience(AUDIENCES.some((option) => option.value === item?.notify_audience) ? item.notify_audience : 'all');
        if (isStuck(item)) setMode('stuck');
        else if (item?.notify_status === 'queued') setMode('busy');
        else if (item?.notify_status === 'failed') setMode('failed');
        else if (item?.notified_at || item?.notify_status === 'sent') setMode('sent');
        else setMode('new');
    }, [open, item]);

    const lastAudience = AUDIENCES.find((option) => option.value === item?.notify_audience)?.label;

    const send = useMutation({
        mutationFn: ({ force }) => adminApi.post(`announcements/${item.id}/notify`, { audience, force }),
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: adminKeys.resource('announcements') });
            const count = data?.estimated_recipients;
            notify(data?.message || (count !== undefined ? `Sending to about ${plural(count, 'member')}.` : 'Sending now.'));
            onClose();
        },
        onError: (error) => {
            if (error?.response?.status === 409) {
                // Another admin got there first: say what the server says.
                setMode(/still being sent/i.test(error.response.data?.detail || '') ? 'busy' : 'sent');
                return;
            }
            notifyError(errorMessage(error, 'The notification was not sent. Try again.'));
        },
    });

    return (
        <Dialog
            open={open}
            onClose={send.isPending ? () => {} : onClose}
            title="Notify members"
            description={item ? `Send “${item.title}” to members’ notifications.` : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={send.isPending}>Cancel</Button>
                    <Button
                        variant="primary"
                        icon={BellRing}
                        loading={send.isPending}
                        disabled={mode === 'busy'}
                        onClick={() => send.mutate({ force: mode === 'sent' || mode === 'stuck' })}
                    >
                        {mode === 'new' ? 'Send' : mode === 'failed' || mode === 'stuck' ? 'Try again' : 'Send again'}
                    </Button>
                </>
            )}
        >
            <div className="space-y-4 pb-2">
                <Notice tone="neutral">
                    In-app only: it lands in their notification list. No email or push is sent.
                    {item?.link_url && !item.link_url.startsWith('/') && ' The notice opens site pages only, so it will not carry the external link; the banner keeps it.'}
                </Notice>
                {lastAudience && mode !== 'new' && (
                    <p className="text-sm text-[var(--text-2)]">
                        Last sent to: <span className="font-medium text-[var(--text-1)]">{lastAudience}</span>
                    </p>
                )}
                {mode === 'sent' && (
                    <Notice tone="warning" title="Already sent">
                        {item?.notified_at
                            ? `This went out ${formatRelative(item.notified_at)}${item.notified_count ? ` to ${plural(item.notified_count, 'member')}` : ''}. Sending again only reaches members who do not have it yet.`
                            : 'This was sent before. Sending again only reaches members who do not have it yet.'}
                    </Notice>
                )}
                {mode === 'failed' && (
                    <Notice tone="danger" title="The last send stopped part way">
                        Trying again only reaches members who did not get it.
                    </Notice>
                )}
                {mode === 'stuck' && (
                    <Notice tone="warning" title="The last send did not finish">
                        It has been queued for over 15 minutes, so its job was probably lost. Trying again only reaches members who did not get it.
                    </Notice>
                )}
                {mode === 'busy' && (
                    <Notice tone="accent" title="Being sent now">
                        Another send of this notice is still running. Check back in a minute.
                    </Notice>
                )}
                <fieldset>
                    <legend className="mb-1.5 text-sm font-medium text-[var(--text-1)]">Who gets it</legend>
                    <div className="space-y-1">
                        {AUDIENCES.map((option) => (
                            <label
                                key={option.value}
                                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors ${audience === option.value ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
                            >
                                <input
                                    type="radio"
                                    name="audience"
                                    value={option.value}
                                    checked={audience === option.value}
                                    onChange={() => setAudience(option.value)}
                                    className="mt-1 h-4 w-4 accent-[var(--signature)]"
                                />
                                <span>
                                    <span className="block text-sm font-medium text-[var(--text-1)]">{option.label}</span>
                                    <span className="block text-sm text-[var(--text-2)]">{option.description}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            </div>
        </Dialog>
    );
}

function Window({ item }) {
    if (!item.starts_at && !item.ends_at) return <span className="text-[var(--text-3)]">Until turned off</span>;
    return (
        <span className="text-[var(--text-2)]">
            {item.starts_at ? formatDateTime(item.starts_at) : 'Now'}
            <span className="text-[var(--text-3)]"> to </span>
            {item.ends_at ? formatDateTime(item.ends_at) : 'open-ended'}
        </span>
    );
}

export default function Announcements() {
    const { isSuperuser } = useRole();
    const list = useListParams({ ordering: '-created_at', level: '', is_active: '' });
    const announcements = useAdminList('announcements', list.apiParams, {
        onVanishedPage: list.setPage,
        // While a notice is being sent, check back until it settles.
        refetchInterval: (query) => ((query.state.data?.results || []).some((item) => item.notify_status === 'queued' && !isStuck(item)) ? 4000 : false),
        refetchIntervalInBackground: false,
    });
    const [editing, setEditing] = useState(null); // { item } | null
    const [notifying, setNotifying] = useState(null);
    const [deleting, setDeleting] = useState(null);

    const invalidate = [adminKeys.resource('announcements'), ['announcements', 'active']];
    const toggle = useAdminAction(
        (item) => adminApi.patch(`announcements/${item.id}`, { is_active: !item.is_active }),
        { invalidate, success: (data, item) => (item.is_active ? 'Announcement turned off.' : 'Announcement turned on.') },
    );
    const remove = useAdminAction(
        (item) => adminApi.del(`announcements/${item.id}`),
        { invalidate, success: 'Announcement deleted.', onSuccess: () => setDeleting(null) },
    );

    const columns = [
        {
            key: 'announcement',
            header: 'Announcement',
            primary: true,
            cell: (item) => (
                <span className="block min-w-0 max-w-md">
                    {isSuperuser ? (
                        <button type="button" onClick={() => setEditing({ item })} className="text-left font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                            {item.title}
                        </button>
                    ) : (
                        <span className="font-medium text-[var(--text-1)]">{item.title}</span>
                    )}
                    {item.body && <span className="mt-0.5 line-clamp-1 text-xs text-[var(--text-3)]">{item.body}</span>}
                </span>
            ),
        },
        {
            key: 'state',
            header: 'State',
            cell: (item) => {
                const state = announcementState(item);
                return (
                    <span className="inline-flex flex-wrap gap-1.5">
                        <Chip tone={state.tone} dot={state.key === 'live'}>{state.label}</Chip>
                        <Chip tone={LEVEL_TONES[item.level] || 'neutral'}>{ANNOUNCEMENT_LEVELS[item.level]?.label || 'Info'}</Chip>
                    </span>
                );
            },
        },
        { key: 'banner', header: 'Banner', cell: (item) => (item.show_banner === false ? <span className="text-[var(--text-3)]">No</span> : 'Yes') },
        { key: 'window', header: 'Runs', hideOnPhone: true, cell: (item) => <Window item={item} /> },
        {
            key: 'notified',
            header: 'Notified',
            cell: (item) => (isStuck(item) ? (
                <Chip tone="warning" dot title="The send has not finished in 15 minutes; its job was probably lost. You can send it again.">Stuck</Chip>
            ) : item.notify_status === 'queued' ? (
                <Chip tone="accent" dot>Sending</Chip>
            ) : item.notify_status === 'failed' ? (
                <Chip tone="danger" dot title="The send stopped part way. Sending again reaches only members who do not have it.">Failed</Chip>
            ) : item.notified_at ? (
                <span className="text-[var(--text-2)]" title={formatDateTime(item.notified_at)}>
                    {item.notified_count ? `${formatNumber(item.notified_count)} · ` : ''}{formatRelative(item.notified_at)}
                </span>
            ) : <span className="text-[var(--text-3)]">Not sent</span>),
        },
        {
            key: 'actions',
            actions: true,
            cell: (item) => (isSuperuser ? (
                <Menu
                    label={`Actions for ${item.title}`}
                    items={[
                        { label: 'Edit', icon: Pencil, onSelect: () => setEditing({ item }) },
                        { label: item.notify_status === 'queued' && !isStuck(item) ? 'Sending…' : isStuck(item) ? 'Send again' : 'Notify members', icon: BellRing, hidden: !item.is_active, disabled: item.notify_status === 'queued' && !isStuck(item), onSelect: () => setNotifying(item) },
                        { label: item.is_active ? 'Turn off' : 'Turn on', icon: Power, onSelect: () => toggle.mutate(item) },
                        'divider',
                        { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setDeleting(item) },
                    ]}
                />
            ) : null),
        },
    ];

    return (
        <>
            <PageHeader
                title="Announcements"
                description={isSuperuser
                    ? 'Tell members about maintenance, new features or events: a bar on every page, a notification, or both.'
                    : 'What members see at the top of the site. Superusers write and send them.'}
                actions={isSuperuser && (
                    <Button variant="primary" icon={Plus} onClick={() => setEditing({ item: null })}>New announcement</Button>
                )}
            />

            <Panel>
                <Toolbar>
                    <FilterSelect
                        label="Tone"
                        allLabel="Any tone"
                        value={list.values.level}
                        onChange={(value) => list.set({ level: value })}
                        options={Object.entries(ANNOUNCEMENT_LEVELS).map(([value, level]) => ({ value, label: level.label }))}
                    />
                    <FilterSelect
                        label="On or off"
                        allLabel="On and off"
                        value={list.values.is_active}
                        onChange={(value) => list.set({ is_active: value })}
                        options={[{ value: 'true', label: 'Turned on' }, { value: 'false', label: 'Turned off' }]}
                    />
                </Toolbar>
                <DataTable
                    caption="Announcements"
                    columns={columns}
                    rows={announcements.rows}
                    loading={announcements.isInitialLoading}
                    fetching={announcements.isFetching}
                    error={announcements.error}
                    onRetry={announcements.refetch}
                    skeletonRows={4}
                    empty={(
                        <EmptyState
                            title={list.isFiltered ? 'Nothing matches' : 'No announcements yet'}
                            compact
                            actions={list.isFiltered
                                ? <Button variant="secondary" onClick={list.reset}>Clear filters</Button>
                                : isSuperuser && <Button variant="primary" icon={Plus} onClick={() => setEditing({ item: null })}>New announcement</Button>}
                        >
                            {list.isFiltered ? 'Try other filters.' : isSuperuser ? 'Write one when there is something every member should know.' : 'Superusers write announcements; they show up here.'}
                        </EmptyState>
                    )}
                />
                <Pagination page={list.page} totalPages={announcements.totalPages} count={announcements.count} pageSize={list.pageSize} onChange={list.setPage} />
            </Panel>

            <AnnouncementForm open={Boolean(editing)} item={editing?.item} onClose={() => setEditing(null)} />
            <NotifyDialog item={notifying} onClose={() => setNotifying(null)} />
            <ConfirmDialog
                open={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                title={`Delete “${deleting?.title || 'this announcement'}”?`}
                tone="danger"
                confirmLabel="Delete"
                busy={remove.isPending}
                onConfirm={() => remove.mutate(deleting)}
            >
                The banner disappears at once. Notifications already sent stay in members’ lists. To pause it instead, turn it off.
            </ConfirmDialog>
        </>
    );
}
