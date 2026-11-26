import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ban, Eye, GitMerge, Hash, RotateCcw } from 'lucide-react';

import { adminApi, adminKeys, fieldErrors } from '../api';
import { useAdminAction, useAdminList, useDebouncedValue, useListParams, useRole } from '../hooks';
import { formatDateTime, formatNumber, formatRelative, humanize } from '../format';
import {
    Button, Chip, ConfirmDialog, DataTable, Dialog, Drawer, EmptyState, Field, FilterSelect, KeyValue, Menu, Notice,
    PageHeader, Pagination, Panel, SearchInput, Select, TextInput, Toolbar,
    withCurrentSort,
} from '../ui';
import { SYNC_STATUSES, SyncStatusChip } from './catalog/animeMeta';
import { useOpenParam } from './catalog/shared';

const RESOURCE = 'offline-sync-states';

const DEFAULTS = { ordering: 'next_attempt_at', quarantined: 'true', stage: '', status: '' };

const SORTS = [
    { value: 'next_attempt_at', label: 'Next attempt, soonest' },
    { value: '-last_attempt_at', label: 'Last attempt, latest' },
    { value: '-attempt_count', label: 'Most attempts' },
    { value: '-updated_at', label: 'Recently changed' },
];

function AnimeRef({ anime }) {
    if (!anime) return <span className="text-[var(--text-3)]">Deleted anime</span>;
    const ids = [anime.anilist_id && `AniList ${anime.anilist_id}`, anime.mal_id && `MAL ${anime.mal_id}`].filter(Boolean).join(' · ');
    return (
        <span className="block min-w-0">
            <Link to={`/admin/anime/${anime.id}`} className="line-clamp-2 font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                {anime.title}
            </Link>
            <span className="block truncate text-xs text-[var(--text-3)]">{ids || 'No provider ids'}</span>
        </span>
    );
}

function ErrorCell({ state }) {
    if (!state.last_error_code && !state.last_error_message) return <span className="text-[var(--text-3)]">—</span>;
    return (
        <span className="block min-w-0 max-w-xs">
            {state.last_error_code && <span className="admin-mono block truncate text-[var(--text-1)]">{state.last_error_code}</span>}
            {state.last_error_message && <span className="line-clamp-1 text-xs text-[var(--text-3)]">{state.last_error_message}</span>}
        </span>
    );
}

const toInt = (value) => (String(value ?? '').trim() === '' ? null : Number.parseInt(value, 10));

function SetIdsDialog({ state, onClose, action }) {
    const [anilist, setAnilist] = useState('');
    const [mal, setMal] = useState('');
    const [errors, setErrors] = useState({});
    useEffect(() => {
        if (state) {
            setAnilist(state.anime?.anilist_id ? String(state.anime.anilist_id) : '');
            setMal(state.anime?.mal_id ? String(state.anime.mal_id) : '');
            setErrors({});
        }
    }, [state]);
    const submit = (event) => {
        event.preventDefault();
        action.mutate(
            { id: state.id, body: { anilist_id: toInt(anilist), mal_id: toInt(mal) } },
            { onError: (error) => setErrors(fieldErrors(error)), onSuccess: onClose },
        );
    };
    const empty = !String(anilist).trim() && !String(mal).trim();
    return (
        <Dialog
            open={Boolean(state)}
            onClose={onClose}
            title="Set provider ids and retry"
            description="Use this when the sync could not tell which AniList entry this is. The ids must not belong to another anime."
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={action.isPending}>Cancel</Button>
                    <Button variant="primary" type="submit" form="set-ids-form" loading={action.isPending} disabled={empty}>Save and retry</Button>
                </>
            )}
        >
            <form id="set-ids-form" onSubmit={submit} className="grid gap-4 pb-1 sm:grid-cols-2">
                <Field label="AniList id" error={errors.anilist_id}>
                    {(id, aria) => <TextInput id={id} {...aria} inputMode="numeric" value={anilist} onChange={(event) => setAnilist(event.target.value.replace(/\D/g, ''))} autoFocus />}
                </Field>
                <Field label="MyAnimeList id" error={errors.mal_id}>
                    {(id, aria) => <TextInput id={id} {...aria} inputMode="numeric" value={mal} onChange={(event) => setMal(event.target.value.replace(/\D/g, ''))} />}
                </Field>
            </form>
        </Dialog>
    );
}

/** Pick the anime this one duplicates: search by title, or type an id. */
function MergeDialog({ state, onClose, action }) {
    const [term, setTerm] = useState('');
    const [target, setTarget] = useState(null);
    const debounced = useDebouncedValue(term.trim());
    useEffect(() => {
        if (state) {
            setTerm('');
            setTarget(null);
        }
    }, [state]);
    const isId = /^\d+$/.test(debounced);
    const results = useQuery({
        queryKey: adminKeys.view('anime-picker', { q: debounced }),
        queryFn: ({ signal }) => adminApi.get('anime', { search: debounced, page_size: 6 }, { signal }),
        enabled: Boolean(state) && debounced.length >= 2 && !isId,
        staleTime: 30_000,
    });
    const options = (results.data?.results || []).filter((anime) => anime.id !== state?.anime?.id);
    const chosen = target || (isId ? { id: Number(debounced), title: `Anime #${debounced}` } : null);
    return (
        <Dialog
            open={Boolean(state)}
            onClose={onClose}
            title="Merge into another anime"
            description={state ? `Marks “${state.anime?.title}” as a duplicate and stops syncing it. The other anime keeps syncing.` : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={action.isPending}>Cancel</Button>
                    <Button
                        variant="primary"
                        loading={action.isPending}
                        disabled={!chosen || chosen.id === state?.anime?.id}
                        onClick={() => action.mutate({ id: state.id, body: { target_anime_id: chosen.id } }, { onSuccess: onClose })}
                    >
                        Merge
                    </Button>
                </>
            )}
        >
            <div className="space-y-3 pb-1">
                <Field label="The anime to keep" hint="Search by title, or type its admin id.">
                    {(id, aria) => (
                        <TextInput
                            id={id}
                            {...aria}
                            value={term}
                            onChange={(event) => {
                                setTerm(event.target.value);
                                setTarget(null);
                            }}
                            placeholder="Title or id"
                            autoComplete="off"
                            autoFocus
                        />
                    )}
                </Field>
                {!isId && debounced.length >= 2 && (
                    <ul className="space-y-1" aria-label="Matching anime">
                        {results.isFetching && !options.length && <li className="px-3 py-2 text-sm text-[var(--text-3)]">Searching…</li>}
                        {!results.isFetching && !options.length && <li className="px-3 py-2 text-sm text-[var(--text-3)]">No other anime match.</li>}
                        {options.map((anime) => (
                            <li key={anime.id}>
                                <button
                                    type="button"
                                    onClick={() => setTarget(anime)}
                                    aria-pressed={target?.id === anime.id}
                                    className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${target?.id === anime.id ? 'bg-[var(--signature-soft)] text-[var(--text-1)]' : 'hover:bg-white/[0.05] text-[var(--text-1)]'}`}
                                >
                                    <span className="min-w-0 truncate font-medium">{anime.title}</span>
                                    <span className="shrink-0 text-xs text-[var(--text-3)] tabular">#{anime.id}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {chosen && <Notice tone="accent">Keeps <span className="font-medium text-[var(--text-1)]">{chosen.title}</span>{chosen.id ? ` (#${chosen.id})` : ''}.</Notice>}
            </div>
        </Dialog>
    );
}

function StateDrawer({ state, open, onClose, isSuperuser, onAction }) {
    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={state?.anime?.title || 'Sync state'}
            description={state ? `Sync record #${state.id}` : undefined}
            footer={isSuperuser && state && (
                <>
                    <Button variant="secondary" icon={Ban} onClick={() => onAction('skip', state)}>Mark skipped</Button>
                    <Button variant="primary" icon={RotateCcw} onClick={() => onAction('retry', state)}>Retry now</Button>
                </>
            )}
        >
            {state && (
                <div className="space-y-6">
                    <KeyValue
                        items={[
                            { label: 'Anime', value: <AnimeRef anime={state.anime} />, wide: true },
                            { label: 'Metadata', value: <SyncStatusChip value={state.metadata_status} /> },
                            { label: 'Franchise', value: <SyncStatusChip value={state.franchise_status} /> },
                            { label: 'Attempts', value: `${formatNumber(state.attempt_count)} (metadata ${formatNumber(state.metadata_attempt_count)}, franchise ${formatNumber(state.franchise_attempt_count)})` },
                            { label: 'Quarantined', value: state.quarantined ? humanize(state.quarantine_reason || 'yes') : 'No' },
                            { label: 'Last attempt', value: formatDateTime(state.last_attempt_at, 'Never') },
                            { label: 'Next attempt', value: formatDateTime(state.next_attempt_at) },
                            { label: 'Error code', value: state.last_error_code ? <span className="admin-mono">{state.last_error_code}</span> : null },
                        ]}
                    />
                    {state.last_error_message && (
                        <section>
                            <h3 className="mb-2 text-sm font-medium text-[var(--text-1)]">Last error</h3>
                            <pre className="admin-code">{state.last_error_message}</pre>
                        </section>
                    )}
                    {state.quarantine_context && Object.keys(state.quarantine_context).length > 0 && (
                        <section>
                            <h3 className="mb-2 text-sm font-medium text-[var(--text-1)]">Quarantine context</h3>
                            <pre className="admin-code">{JSON.stringify(state.quarantine_context, null, 2)}</pre>
                        </section>
                    )}
                </div>
            )}
        </Drawer>
    );
}

export default function SyncHealth() {
    const { isSuperuser } = useRole();
    const list = useListParams(DEFAULTS);
    const query = useAdminList(RESOURCE, list.apiParams, { onVanishedPage: list.setPage });
    const [openId, setOpenId] = useOpenParam();
    const [pending, setPending] = useState({ kind: null, state: null });
    const filter = (key) => (value) => list.set({ [key]: value });
    const close = () => setPending({ kind: null, state: null });
    const invalidate = [adminKeys.resource(RESOURCE), adminKeys.resource('anime')];

    const post = (operation) => ({ id, body }) => adminApi.post(`${RESOURCE}/${id}/${operation}`, body);
    const retry = useAdminAction(post('retry'), { invalidate, success: 'Queued for another try.', error: 'Could not reset it for retry.', onSuccess: close });
    const skip = useAdminAction(post('mark_skipped'), { invalidate, success: 'Marked skipped. It will not sync again.', error: 'Could not mark it skipped.', onSuccess: close });
    const setIds = useAdminAction(post('set_ids_and_retry'), { invalidate, success: 'Ids saved. Queued for another try.', error: 'Could not save the ids.' });
    const merge = useAdminAction(post('merge_target'), { invalidate, success: 'Marked as a duplicate.', error: 'Could not merge it.' });

    const openState = query.rows.find((row) => String(row.id) === String(openId));
    const detail = useQuery({
        queryKey: adminKeys.detail(RESOURCE, openId),
        queryFn: ({ signal }) => adminApi.get(`${RESOURCE}/${openId}`, undefined, { signal }),
        enabled: Boolean(openId) && !openState && !query.isLoading,
        retry: false,
    });
    const drawerState = openState || detail.data || null;

    const ask = (kind, state) => setPending({ kind, state });

    const columns = [
        { key: 'anime', header: 'Anime', primary: true, cell: (row) => <AnimeRef anime={row.anime} /> },
        { key: 'metadata', header: 'Metadata', cell: (row) => <SyncStatusChip value={row.metadata_status} /> },
        { key: 'franchise', header: 'Franchise', cell: (row) => <SyncStatusChip value={row.franchise_status} /> },
        { key: 'attempts', header: 'Attempts', align: 'right', sortKey: 'attempt_count', cell: (row) => formatNumber(row.attempt_count) },
        { key: 'error', header: 'Last error', hideOnPhone: true, cell: (row) => <ErrorCell state={row} /> },
        {
            key: 'reason',
            header: 'Held back because',
            cell: (row) => (row.quarantined ? <Chip tone="warning">{humanize(row.quarantine_reason || 'quarantined')}</Chip> : <span className="text-[var(--text-3)]">Not held back</span>),
        },
        {
            key: 'next',
            header: 'Next attempt',
            sortKey: 'next_attempt_at',
            sortFirst: 'asc',
            cell: (row) => <span className="text-[var(--text-2)]" title={formatDateTime(row.next_attempt_at)}>{formatRelative(row.next_attempt_at)}</span>,
        },
        {
            key: 'actions',
            actions: true,
            cell: (row) => (
                <Menu
                    label={`Actions for ${row.anime?.title || `record ${row.id}`}`}
                    items={[
                        { label: 'Details', icon: Eye, onSelect: () => setOpenId(row.id) },
                        isSuperuser && 'divider',
                        { label: 'Retry now', icon: RotateCcw, hidden: !isSuperuser, onSelect: () => ask('retry', row) },
                        { label: 'Set ids and retry', icon: Hash, hidden: !isSuperuser, onSelect: () => ask('ids', row) },
                        { label: 'Merge into another anime', icon: GitMerge, hidden: !isSuperuser, onSelect: () => ask('merge', row) },
                        { label: 'Mark skipped', icon: Ban, tone: 'danger', hidden: !isSuperuser, onSelect: () => ask('skip', row) },
                    ].filter(Boolean)}
                />
            ),
        },
    ];

    const empty = list.isFiltered || list.values.quarantined !== 'true' ? (
        <EmptyState title="Nothing matches" actions={<Button variant="secondary" onClick={list.reset}>Clear filters</Button>} compact>
            No sync records fit these filters.
        </EmptyState>
    ) : (
        <EmptyState title="Nothing is held back" actions={<Button variant="secondary" onClick={() => list.set({ quarantined: 'all' })}>Show every record</Button>} compact>
            Every anime in the offline catalog is syncing normally.
        </EmptyState>
    );

    return (
        <>
            <PageHeader
                title="Sync health"
                description="Where the offline catalog's AniList sync is stuck: anime it could not match, kept failing on, or held back. Fix the ids, retry, merge duplicates or skip them."
                meta={!query.isInitialLoading && <span className="text-sm text-[var(--text-3)] tabular">{formatNumber(query.count)} {list.values.quarantined === 'true' ? 'held back' : 'records'}</span>}
            />

            {!isSuperuser && <Notice className="mb-4">Read only. Superusers can retry, skip and merge records.</Notice>}

            <Panel>
                <Toolbar>
                    <SearchInput value={list.searchInput} onChange={list.setSearchInput} placeholder="Search by title, reason or error code" />
                    <Select label="Sort by" value={list.values.ordering} onChange={filter('ordering')} options={withCurrentSort(SORTS, list.values.ordering)} className="!w-auto min-w-[11rem] max-md:hidden" />
                </Toolbar>
                <Toolbar className="-mt-1">
                    <Select
                        label="Held back"
                        value={list.values.quarantined}
                        onChange={filter('quarantined')}
                        options={[
                            { value: 'true', label: 'Held back only' },
                            { value: 'false', label: 'Not held back' },
                            { value: 'all', label: 'All records' },
                        ]}
                        className="!w-auto min-w-[10rem]"
                    />
                    <FilterSelect
                        label="Stage"
                        allLabel="Any stage"
                        value={list.values.stage}
                        onChange={(value) => list.set({ stage: value, ...(value ? {} : { status: '' }) })}
                        options={[{ value: 'metadata', label: 'Metadata' }, { value: 'franchise', label: 'Franchise' }]}
                    />
                    {/* The API only filters a status within a stage. */}
                    <Select
                        label="Stage status"
                        value={list.values.status}
                        onChange={filter('status')}
                        options={[
                            { value: '', label: list.values.stage ? 'Any status' : 'Pick a stage first' },
                            ...SYNC_STATUSES.map((value) => ({ value, label: humanize(value) })),
                        ]}
                        disabled={!list.values.stage}
                        className="!w-auto min-w-[10rem]"
                    />
                    {list.isFiltered && <Button variant="ghost" size="sm" onClick={list.reset}>Clear</Button>}
                </Toolbar>

                <DataTable
                    caption="Sync records"
                    columns={columns}
                    rows={query.rows}
                    loading={query.isLoading}
                    fetching={query.isFetching}
                    error={query.error}
                    onRetry={query.refetch}
                    empty={empty}
                    sort={{ value: list.values.ordering, onChange: filter('ordering'), options: SORTS }}
                    onRowClick={(row) => setOpenId(row.id)}
                />
                <Pagination page={list.page} totalPages={query.totalPages} count={query.count} pageSize={list.pageSize} onChange={list.setPage} />
            </Panel>

            <StateDrawer
                state={drawerState}
                open={Boolean(openId) && Boolean(drawerState)}
                onClose={() => setOpenId(null)}
                isSuperuser={isSuperuser}
                onAction={ask}
            />

            {isSuperuser && (
                <>
                    <ConfirmDialog
                        open={pending.kind === 'retry'}
                        onClose={close}
                        title="Retry now?"
                        confirmLabel="Retry"
                        busy={retry.isPending}
                        onConfirm={() => retry.mutate({ id: pending.state.id })}
                    >
                        {`Clears the error and attempt count for “${pending.state?.anime?.title}” and puts it back in the sync queue.`}
                    </ConfirmDialog>
                    <ConfirmDialog
                        open={pending.kind === 'skip'}
                        onClose={close}
                        tone="danger"
                        title="Stop syncing this anime?"
                        confirmLabel="Mark skipped"
                        reason={{ label: 'Why', required: false, max: 120, hint: 'Optional, up to 120 characters. Shown as the reason it is held back.' }}
                        busy={skip.isPending}
                        onConfirm={({ reason }) => skip.mutate({ id: pending.state.id, body: reason ? { reason } : {} })}
                    >
                        {`“${pending.state?.anime?.title}” stays in the catalog but the offline sync stops trying it. You can retry it later.`}
                    </ConfirmDialog>
                    <SetIdsDialog state={pending.kind === 'ids' ? pending.state : null} onClose={close} action={setIds} />
                    <MergeDialog state={pending.kind === 'merge' ? pending.state : null} onClose={close} action={merge} />
                </>
            )}
        </>
    );
}
