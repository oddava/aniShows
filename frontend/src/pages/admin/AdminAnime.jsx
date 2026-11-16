import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
    CheckCircle2, Clock, Eye, Film, Filter, Heart, LayoutGrid, MessageSquare, Play, Search, Star, Trash2,
} from 'lucide-react';

import api from '../../api/client';
import { adminKeys } from '../../api/queries/admin';
import AnimeMediaImage from '../../components/common/AnimeMediaImage';
import CustomSelect from '../../components/common/CustomSelect';
import ErrorState from '../../components/common/ErrorState';
import AdminPagination from './components/AdminPagination';
import BulkActions, { useBulkDelete } from './components/BulkActions';
import { useConfirm } from './components/ConfirmDialog';
import DataTable from './components/DataTable';
import { getAdminErrorMessage, useAdminList, useAdminMutation } from './hooks/useAdminQuery';
import useAdminRole from './hooks/useAdminRole';
import useDebouncedValue from './hooks/useDebouncedValue';

const STATUS_STYLE = {
    Airing: { classes: 'border-emerald-500/20 text-emerald-400', Icon: Play },
    Finished: { classes: 'border-blue-500/20 text-blue-400', Icon: CheckCircle2 },
    Upcoming: { classes: 'border-amber-500/20 text-amber-400', Icon: Clock },
};

const SORT_OPTIONS = [
    { value: '-created_at', label: 'Newest first' },
    { value: 'created_at', label: 'Oldest first' },
    { value: '-rating', label: 'Highest rated' },
    { value: 'title', label: 'Title A-Z' },
];

const ICON_BUTTON = 'inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors';

const AdminAnime = () => {
    const { isSuperuser } = useAdminRole();
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search.trim());
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState({ status: '', type: '' });
    const [ordering, setOrdering] = useState('-created_at');
    const [selectedRows, setSelectedRows] = useState([]);
    const [confirm, confirmDialog] = useConfirm();

    const list = useAdminList({
        resource: 'anime',
        params: {
            page,
            ...(debouncedSearch && { search: debouncedSearch }),
            ...(filters.status && { status: filters.status }),
            ...(filters.type && { type: filters.type }),
            ordering,
        },
        page,
        setPage,
        errorLog: 'Failed to fetch anime:',
    });

    const invalidate = [adminKeys.resource('anime')];
    const deleteMutation = useAdminMutation((animeId) => api.delete(`/admin/anime/${animeId}/`), { invalidate });
    const bulkDelete = useBulkDelete({
        entityType: 'anime',
        noun: 'anime',
        invalidate,
        onError: (message) => toast.error(message),
    });

    const changeFilter = (key, value) => {
        setFilters((f) => ({ ...f, [key]: value }));
        setPage(1);
    };
    const changeOrdering = (next) => {
        setOrdering(next);
        setPage(1);
    };

    const deleteAnime = async (anime) => {
        const ok = await confirm({
            title: `Delete "${anime.title}"?`,
            message: 'Its favorites, reviews and list entries are deleted too. The next catalog sync may import it again.',
            confirmLabel: 'Delete anime',
            destructive: true,
            requireText: anime.title,
        });
        if (!ok) return;
        try {
            await deleteMutation.mutateAsync(anime.id);
            toast.success(`Deleted "${anime.title}"`);
        } catch (err) {
            toast.error(getAdminErrorMessage(err, 'Failed to delete anime'));
        }
    };

    const handleBulkDelete = async () => {
        const result = await bulkDelete.start(selectedRows);
        if (result) {
            toast.success(result.message || 'Deleted anime');
            setSelectedRows([]);
        }
    };

    const columns = [
        {
            key: 'title',
            title: 'Title',
            sortable: true,
            render: (anime) => (
                <div className="flex items-center gap-3 min-w-0 text-left">
                    <div className="w-12 h-16 rounded-md bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0 border border-white/5">
                        {anime.cover_image ? (
                            <AnimeMediaImage anime={anime} kind="cover" size="small" alt="" className="w-full h-full object-cover" />
                        ) : <Film size={18} className="text-white/30" aria-hidden="true" />}
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-white truncate" title={anime.title}>{anime.title}</span>
                        <span className="text-xs text-gray-500 truncate">Studio: {anime.studio?.name || 'Unknown'}</span>
                    </div>
                </div>
            ),
        },
        {
            key: 'rating',
            title: 'Rating',
            sortable: true,
            render: (anime) => (
                <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                    <Star size={12} aria-hidden="true" />
                    {anime.rating ? Number(anime.rating).toFixed(1) : '—'}
                </span>
            ),
        },
        {
            key: 'status',
            title: 'Status',
            render: (anime) => {
                const style = STATUS_STYLE[anime.status];
                const Icon = style?.Icon;
                return (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] uppercase font-semibold border ${style?.classes || 'border-white/10 text-gray-400'}`}>
                        {Icon && <Icon size={12} aria-hidden="true" />}
                        {anime.status}
                    </span>
                );
            },
        },
        {
            key: 'anime_type',
            title: 'Format',
            render: (anime) => (
                <span className="text-xs text-gray-300">
                    {anime.anime_type} · {anime.episode_count ? `${anime.episode_count} eps` : 'Ongoing'}
                </span>
            ),
        },
        {
            key: 'engagement',
            title: 'Engagement',
            render: (anime) => (
                <span className="flex flex-col gap-1 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5"><Heart size={12} aria-hidden="true" /> {anime.favorites_count?.toLocaleString() || 0} favorites</span>
                    <span className="flex items-center gap-1.5"><MessageSquare size={12} aria-hidden="true" /> {anime.reviews_count?.toLocaleString() || 0} reviews</span>
                </span>
            ),
        },
        {
            key: 'actions',
            title: 'Actions',
            render: (anime) => (
                <div className="flex items-center gap-2">
                    <Link to={`/anime/${anime.slug}`} className={ICON_BUTTON} aria-label={`Open ${anime.title}`}>
                        <Eye size={16} aria-hidden="true" />
                    </Link>
                    {isSuperuser && (
                        <button
                            type="button"
                            onClick={() => deleteAnime(anime)}
                            className={`${ICON_BUTTON} hover:bg-red-500/20 hover:text-red-400`}
                            aria-label={`Delete ${anime.title}`}
                        >
                            <Trash2 size={16} aria-hidden="true" />
                        </button>
                    )}
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Anime Library</h1>
                <p className="text-gray-400 mt-1">Browse the catalog and remove bad entries.</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} aria-hidden="true" />
                    <input
                        type="search"
                        aria-label="Search anime titles"
                        placeholder="Search anime titles..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500"
                    />
                </div>
                <div className="flex w-full md:w-auto gap-3 flex-wrap md:flex-nowrap">
                    <div className="flex-1 md:flex-none">
                        <CustomSelect
                            value={filters.status}
                            onChange={(next) => changeFilter('status', next)}
                            options={[
                                { value: '', label: 'All statuses' },
                                { value: 'Airing', label: 'Airing' },
                                { value: 'Finished', label: 'Finished' },
                                { value: 'Upcoming', label: 'Upcoming' },
                            ]}
                            startIcon={Filter}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm"
                            ariaLabel="Filter anime by status"
                        />
                    </div>
                    <div className="flex-1 md:flex-none">
                        <CustomSelect
                            value={filters.type}
                            onChange={(next) => changeFilter('type', next)}
                            options={[
                                { value: '', label: 'All types' },
                                { value: 'TV', label: 'TV Show' },
                                { value: 'Movie', label: 'Movie' },
                                { value: 'OVA', label: 'OVA' },
                                { value: 'Special', label: 'Special' },
                            ]}
                            startIcon={LayoutGrid}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm"
                            ariaLabel="Filter anime by type"
                        />
                    </div>
                    <div className="w-full md:w-auto md:flex-none">
                        <CustomSelect
                            value={ordering}
                            onChange={changeOrdering}
                            options={SORT_OPTIONS.some((o) => o.value === ordering)
                                ? SORT_OPTIONS
                                : [...SORT_OPTIONS, { value: ordering, label: 'Custom order' }]}
                            startIcon={Clock}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm"
                            ariaLabel="Sort anime list"
                        />
                    </div>
                </div>
            </div>

            {isSuperuser && (
                <BulkActions
                    selectedCount={selectedRows.length}
                    actions={[{ label: 'Delete selected', icon: Trash2, variant: 'danger', onClick: handleBulkDelete }]}
                    onClearSelection={() => setSelectedRows([])}
                />
            )}

            {list.error && !list.isFetching ? (
                <ErrorState
                    title="Error Loading Anime"
                    message={getAdminErrorMessage(list.error, 'Failed to load anime')}
                    onRetry={() => list.refetch()}
                />
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    <DataTable
                        columns={columns}
                        data={list.items}
                        loading={list.isFetching && list.items.length === 0}
                        selectable={isSuperuser}
                        selectedRows={selectedRows}
                        onSelectionChange={setSelectedRows}
                        ordering={ordering}
                        onSort={changeOrdering}
                        rowLabel={(anime) => anime.title}
                        emptyMessage="No anime found matching your criteria."
                    />
                    <AdminPagination page={page} totalPages={list.totalPages} onPageChange={setPage} />
                </div>
            )}

            {bulkDelete.dialog}
            {confirmDialog}
        </div>
    );
};

export default AdminAnime;
