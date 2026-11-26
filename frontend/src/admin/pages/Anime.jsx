import { useNavigate } from 'react-router-dom';
import { ExternalLink, Eye, Trash2 } from 'lucide-react';

import { adminKeys } from '../api';
import { useAdminList, useListParams, useRole, useSelection } from '../hooks';
import { formatCompact, formatNumber, formatRelative, humanize } from '../format';
import {
    AnimeCell, BulkBar, Button, DataTable, EmptyState, FilterSelect, Menu, PageHeader, Pagination, Panel,
    SearchInput, Select, Toolbar,
    withCurrentSort,
} from '../ui';
import { useBulkDelete } from './catalog/shared';
import {
    ANIME_STATUSES, ANIME_TYPES, AnimeStatusChip, SEASONS, typeLabel,
} from './catalog/animeMeta';

const yearOf = (anime) => anime.season_year || (anime.release_date ? String(anime.release_date).slice(0, 4) : null);

const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: thisYear + 2 - 1960 }, (_, index) => String(thisYear + 1 - index));

const SORTS = [
    { value: '-created_at', label: 'Recently added' },
    { value: '-updated_at', label: 'Recently updated' },
    { value: 'title', label: 'Title, A to Z' },
    { value: '-rating', label: 'Highest rated' },
    { value: 'popularity_rank', label: 'Most popular' },
    { value: '-member_count', label: 'Most members' },
    { value: '-release_date', label: 'Newest release' },
];

const DEFAULTS = {
    ordering: '-created_at',
    status: '',
    type: '',
    season: '',
    season_year: '',
    is_adult: '',
    missing: '',
};

export default function Anime() {
    const navigate = useNavigate();
    const { isSuperuser } = useRole();
    const list = useListParams(DEFAULTS);
    const query = useAdminList('anime', list.apiParams, { onVanishedPage: list.setPage });
    const selection = useSelection([list.search, list.values]);
    const bulk = useBulkDelete({
        entity: 'anime',
        noun: 'anime',
        primaryLabel: 'anime.Anime',
        invalidate: [adminKeys.resource('anime')],
        onDone: selection.clear,
    });
    const filter = (key) => (value) => list.set({ [key]: value });

    const columns = [
        {
            key: 'title',
            header: 'Anime',
            primary: true,
            sortKey: 'title',
            sortFirst: 'asc',
            cell: (row) => (
                <AnimeCell
                    anime={row}
                    secondary={[typeLabel(row.anime_type), yearOf(row), row.studio?.name].filter(Boolean).join(' · ')}
                />
            ),
        },
        { key: 'status', header: 'Status', cell: (row) => <AnimeStatusChip status={row.status} /> },
        {
            key: 'episodes',
            header: 'Episodes',
            align: 'right',
            cell: (row) => (row.episode_count ? formatNumber(row.episode_count) : <span className="text-[var(--text-3)]">—</span>),
        },
        {
            key: 'rating',
            header: 'Rating',
            align: 'right',
            sortKey: 'rating',
            cell: (row) => (row.rating ? Number(row.rating).toFixed(1) : <span className="text-[var(--text-3)]">—</span>),
        },
        {
            key: 'engagement',
            header: 'Favorites · reviews',
            phoneLabel: 'Favorites · reviews',
            align: 'right',
            cell: (row) => (
                <span className="tabular">
                    {formatCompact(row.favorites_count ?? 0)}
                    <span className="text-[var(--text-3)]"> · </span>
                    {formatCompact(row.reviews_count ?? 0)}
                </span>
            ),
        },
        ...(query.rows.some((row) => row.member_count !== undefined) ? [{
            key: 'members',
            header: 'Members',
            align: 'right',
            sortKey: 'member_count',
            cell: (row) => formatCompact(row.member_count ?? 0),
        }] : []),
        {
            key: 'updated',
            header: 'Updated',
            sortKey: 'updated_at',
            hideOnPhone: true,
            cell: (row) => <span className="text-[var(--text-2)]">{formatRelative(row.updated_at)}</span>,
        },
        {
            key: 'actions',
            actions: true,
            cell: (row) => (
                <Menu
                    label={`Actions for ${row.title}`}
                    items={[
                        { label: 'Open', icon: Eye, to: `/admin/anime/${row.id}` },
                        { label: 'View on site', icon: ExternalLink, onSelect: () => window.open(`/anime/${row.slug}`, '_blank', 'noopener') },
                    ]}
                />
            ),
        },
    ];

    const empty = list.isFiltered ? (
        <EmptyState title="No anime match" actions={<Button variant="secondary" onClick={list.reset}>Clear filters</Button>} compact>
            Try fewer filters or a shorter title.
        </EmptyState>
    ) : (
        <EmptyState title="The catalog is empty" actions={isSuperuser && <Button variant="primary" to="/admin/imports">Import the catalog</Button>} compact>
            Anime arrive through catalog imports and AniList syncs.
        </EmptyState>
    );

    return (
        <>
            <PageHeader
                title="Anime"
                description="The catalog as synced from AniList. Details refresh from AniList; open an anime to refresh it, fix its images or edit its SEO text."
                meta={!query.isInitialLoading && <span className="text-sm text-[var(--text-3)] tabular">{formatNumber(query.count)} {list.isFiltered ? 'match' : 'in the catalog'}</span>}
            />

            <Panel>
                <Toolbar>
                    <SearchInput value={list.searchInput} onChange={list.setSearchInput} placeholder="Search by title" />
                    <Select
                        label="Sort by"
                        value={list.values.ordering}
                        onChange={filter('ordering')}
                        options={withCurrentSort(SORTS, list.values.ordering)}
                        className="!w-auto min-w-[10.5rem] max-md:hidden"
                    />
                </Toolbar>
                <Toolbar className="-mt-1">
                    <FilterSelect label="Status" allLabel="Any status" value={list.values.status} onChange={filter('status')} options={ANIME_STATUSES.map((value) => ({ value, label: humanize(value) }))} />
                    <FilterSelect label="Type" allLabel="Any type" value={list.values.type} onChange={filter('type')} options={ANIME_TYPES.map((value) => ({ value, label: typeLabel(value) }))} />
                    <FilterSelect label="Season" allLabel="Any season" value={list.values.season} onChange={filter('season')} options={SEASONS} />
                    <FilterSelect label="Year" allLabel="Any year" value={list.values.season_year} onChange={filter('season_year')} options={YEARS} className="min-w-[7.5rem]" />
                    <FilterSelect
                        label="Adult"
                        allLabel="Adult or not"
                        value={list.values.is_adult}
                        onChange={filter('is_adult')}
                        options={[{ value: 'true', label: 'Adult only' }, { value: 'false', label: 'Not adult' }]}
                    />
                    <FilterSelect
                        label="Missing data"
                        allLabel="Any data"
                        value={list.values.missing}
                        onChange={filter('missing')}
                        options={[
                            { value: 'cover', label: 'No cover' },
                            { value: 'synopsis', label: 'No synopsis' },
                            { value: 'anilist_id', label: 'No AniList id' },
                            { value: 'studio', label: 'No studio' },
                        ]}
                    />
                    {list.isFiltered && <Button variant="ghost" size="sm" onClick={list.reset}>Clear</Button>}
                </Toolbar>

                <DataTable
                    caption="Anime"
                    columns={columns}
                    rows={query.rows}
                    loading={query.isLoading}
                    fetching={query.isFetching}
                    error={query.error}
                    onRetry={query.refetch}
                    empty={empty}
                    selection={isSuperuser ? selection : undefined}
                    sort={{ value: list.values.ordering, onChange: filter('ordering'), options: SORTS }}
                    onRowClick={(row) => navigate(`/admin/anime/${row.id}`)}
                />
                <Pagination page={list.page} totalPages={query.totalPages} count={query.count} pageSize={list.pageSize} onChange={list.setPage} />
            </Panel>

            {isSuperuser && (
                <BulkBar count={selection.count} onClear={selection.clear}>
                    <Button variant="danger" size="sm" icon={Trash2} loading={bulk.checking} onClick={() => bulk.start(selection.ids)}>
                        Delete
                    </Button>
                </BulkBar>
            )}
            {bulk.dialog}
        </>
    );
}
