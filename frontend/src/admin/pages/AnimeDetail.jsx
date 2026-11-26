import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    ChevronLeft, ExternalLink, ImageDown, Pencil, RefreshCw, Trash2,
} from 'lucide-react';

import { getImageUrl } from '../../utils/imageUtils';
import { adminApi, adminKeys, fieldErrors } from '../api';
import { useAdminAction, useAdminQuery, useRole } from '../hooks';
import {
    formatCompact, formatDate, formatDateTime, formatNumber, formatRelative, humanize,
} from '../format';
import {
    Button, Chip, ConfirmDialog, Dialog, ErrorState, Field, KeyValue, MetaLine, Notice, PageHeader, Panel, PanelSkeleton,
    Poster, Skeleton, StatCard, StatGrid, TextArea,
} from '../ui';
import { AnimeStatusChip, typeLabel } from './catalog/animeMeta';
import { exclusionLabel } from './catalog/catalogScope';

const SEO_MAX = 160;

const seasonLabel = (anime) => [humanize(anime.season, ''), anime.season_year].filter(Boolean).join(' ');

function SeoDialog({ open, onClose, anime }) {
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setValue(anime?.meta_description || '');
            setError('');
        }
    }, [open, anime]);

    const save = useAdminAction(
        (meta_description) => adminApi.patch(`anime/${anime.id}`, { meta_description }),
        {
            invalidate: [adminKeys.detail('anime', anime?.id), adminKeys.resource('anime')],
            success: 'SEO description saved.',
            error: 'Could not save the description.',
            onSuccess: onClose,
            onError: (err) => setError(fieldErrors(err).meta_description || ''),
        },
    );

    const submit = (event) => {
        event.preventDefault();
        // Saving the sync's own text unchanged would quietly take it over.
        if (value.trim() === (anime?.meta_description || '').trim()) {
            onClose();
            return;
        }
        save.mutate(value.trim());
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="SEO description"
            description="Shown to search engines and in link previews. Once you save it here, syncs leave it alone; clear it and the next sync writes one from the synopsis again."
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
                    <Button variant="primary" type="submit" form="seo-form" loading={save.isPending}>Save</Button>
                </>
            )}
        >
            <form id="seo-form" onSubmit={submit} className="pb-1">
                <Field label="Description" hint={`${value.length}/${SEO_MAX} characters`} error={error}>
                    {(id, aria) => (
                        <TextArea
                            id={id}
                            {...aria}
                            rows={4}
                            maxLength={SEO_MAX}
                            value={value}
                            onChange={(event) => setValue(event.target.value)}
                            autoFocus
                        />
                    )}
                </Field>
            </form>
        </Dialog>
    );
}

function ExternalAnchor({ href, children }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--signature)] hover:text-[var(--signature-hover)]">
            {children}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
    );
}

function DetailSkeleton() {
    return (
        <div aria-busy="true">
            <Skeleton className="mb-4 h-4 w-20" />
            <div className="flex gap-5">
                <Skeleton className="h-48 w-32 shrink-0" rounded="rounded-[var(--radius-md)]" />
                <div className="flex-1 space-y-3 pt-2">
                    <Skeleton className="h-8 w-2/3" />
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-6 w-1/2" />
                </div>
            </div>
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
                <PanelSkeleton lines={6} className="lg:col-span-2" />
                <PanelSkeleton lines={5} />
            </div>
        </div>
    );
}

/** A decorative image that tries each source in turn and hides itself if none loads. */
function FallbackImage({ sources, className }) {
    const [attempt, setAttempt] = useState(0);
    const src = sources[attempt];
    if (!src) return null;
    return <img key={src} src={src} alt="" className={className} onError={() => setAttempt((value) => value + 1)} />;
}

export default function AnimeDetail() {
    const { animeId } = useParams();
    const navigate = useNavigate();
    const { isSuperuser } = useRole();
    const [dialog, setDialog] = useState(null); // 'seo' | 'refresh' | 'images' | 'delete'
    const detailKey = adminKeys.detail('anime', animeId);
    const query = useAdminQuery(detailKey, ({ signal }) => adminApi.get(`anime/${animeId}`, undefined, { signal }));
    const anime = query.data;
    const close = () => setDialog(null);

    const refresh = useAdminAction(() => adminApi.post(`anime/${animeId}/refresh`), {
        invalidate: [detailKey],
        success: (data) => data?.message || 'Refresh queued.',
        error: 'Could not queue the refresh.',
        onSuccess: close,
    });
    const images = useAdminAction(() => adminApi.post(`anime/${animeId}/refetch_images`), {
        success: (data) => data?.message || 'Image download queued.',
        error: 'Could not queue the image download.',
        onSuccess: close,
    });
    const remove = useAdminAction(() => adminApi.del(`anime/${animeId}`), {
        invalidate: [adminKeys.resource('anime')],
        success: (data) => data?.message || 'Anime deleted.',
        error: 'Could not delete this anime.',
        onSuccess: () => navigate('/admin/anime', { replace: true }),
    });

    if (query.isLoading) return <DetailSkeleton />;

    if (query.error || !anime) {
        const notFound = query.error?.response?.status === 404;
        return (
            <>
                <PageHeader title={notFound ? 'Anime not found' : 'Anime'} back={{ to: '/admin/anime', label: 'Anime' }} />
                <Panel>
                    {notFound ? (
                        <p className="py-6 text-center text-sm text-[var(--text-2)]">It may have been deleted or merged into another entry.</p>
                    ) : (
                        <ErrorState error={query.error} onRetry={() => query.refetch()} />
                    )}
                </Panel>
            </>
        );
    }

    // Every copy we know of, best first: a missing stored file falls back to AniList's.
    const sources = (...urls) => [...new Set(urls.filter((url) => typeof url === 'string' && url.trim()))].map((url) => getImageUrl(url));
    const posterSources = sources(anime.poster, anime.cover_image, anime.cover_image_external_url);
    const bannerSources = sources(anime.banner, anime.banner_image, anime.banner_image_external_url);
    const hasExternalImages = Boolean(anime.cover_image_external_url || anime.banner_image_external_url);
    const catalog = anime.catalog || {};
    const studios = anime.studios?.length ? anime.studios : anime.studio ? [anime.studio] : [];
    const metaFacts = [
        anime.episode_count ? `${formatNumber(anime.episode_count)} episodes` : null,
        anime.duration_minutes ? `${anime.duration_minutes} min each` : null,
        anime.rating ? `rated ${Number(anime.rating).toFixed(1)}` : null,
        anime.member_count ? `${formatCompact(anime.member_count)} members` : null,
        anime.popularity_rank ? `#${formatNumber(anime.popularity_rank)} popular` : null,
        anime.trending_rank ? `#${formatNumber(anime.trending_rank)} trending` : null,
    ];

    return (
        <>
            <div className="relative">
                {bannerSources.length > 0 && (
                    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-4 -top-6 h-56 overflow-hidden sm:-inset-x-6 lg:-inset-x-10 lg:-top-10">
                        <FallbackImage sources={bannerSources} className="h-full w-full object-cover opacity-[0.18] blur-[2px]" />
                        <div className="absolute inset-0 bg-gradient-to-b from-[rgb(21_24_29/0.35)] to-[var(--ink-0)]" />
                    </div>
                )}
                <div className="relative">
                    <Link
                        to="/admin/anime"
                        className="-ml-1 mb-2 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                    >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        Anime
                    </Link>
                    <header className="mb-6 flex flex-col gap-5 sm:mb-8 sm:flex-row sm:items-start">
                        <Poster sources={posterSources} size="xl" className="hidden !rounded-[var(--radius-md)] shadow-[var(--shadow-pop)] sm:block" />
                        <div className="min-w-0 flex-1">
                            <h1 className="text-[1.75rem] font-[650] leading-tight tracking-[-0.03em] text-[var(--text-1)] sm:text-[2rem] [overflow-wrap:anywhere]">
                                {anime.title}
                            </h1>
                            {anime.title_jp && <p className="mt-1 text-base text-[var(--text-2)]">{anime.title_jp}</p>}
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <AnimeStatusChip status={anime.status} />
                                {anime.anime_type && <Chip>{typeLabel(anime.anime_type)}</Chip>}
                                {seasonLabel(anime) && <Chip>{seasonLabel(anime)}</Chip>}
                                {anime.is_adult && <Chip tone="danger">Adult</Chip>}
                            </div>
                            <MetaLine items={metaFacts} className="mt-3" />
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <Button variant="secondary" icon={ExternalLink} href={`/anime/${anime.slug}`} target="_blank" rel="noopener noreferrer">
                                    View on site
                                </Button>
                                {isSuperuser && (
                                    <>
                                        <Button
                                            variant="secondary"
                                            icon={RefreshCw}
                                            onClick={() => setDialog('refresh')}
                                            disabled={!anime.anilist_id}
                                            title={anime.anilist_id ? undefined : 'No AniList id to refresh from'}
                                        >
                                            Refresh from AniList
                                        </Button>
                                        <Button variant="danger" icon={Trash2} onClick={() => setDialog('delete')}>Delete</Button>
                                    </>
                                )}
                            </div>
                        </div>
                    </header>
                </div>
            </div>

            {catalog.excluded && (
                <Notice tone="warning" title="Not listed on the site" className="mb-4">
                    {exclusionLabel(catalog.excluded)}: outside the catalog&apos;s scope, so browse, search and shelves leave it out. Its page still opens for anyone who has it on their list.
                </Notice>
            )}

            <div className="space-y-4 sm:space-y-5">
                <StatGrid columns={4}>
                    <StatCard compact label="Favorites" value={anime.favorites_count ?? 0} />
                    <StatCard
                        compact
                        label="Reviews"
                        value={anime.reviews_count ?? 0}
                        hint={anime.avg_review_rating ? `average ${Number(anime.avg_review_rating).toFixed(1)}` : null}
                        to={`/admin/reviews?anime=${anime.id}`}
                    />
                    <StatCard compact label="On lists" value={anime.list_entries_count ?? '—'} />
                    <StatCard compact label="Members on AniList" value={anime.member_count ?? '—'} />
                </StatGrid>

                <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
                    <div className="space-y-4 sm:space-y-5 lg:col-span-2">
                        <Panel title="Synopsis">
                            {anime.synopsis ? (
                                <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-2)]">{anime.synopsis}</p>
                            ) : (
                                <p className="text-sm text-[var(--text-3)]">No synopsis yet. A refresh from AniList usually fills it in.</p>
                            )}
                        </Panel>

                        <Panel title="Details">
                            <KeyValue
                                items={[
                                    { label: 'Aired', value: anime.release_date ? `${formatDate(anime.release_date)}${anime.end_date ? ` to ${formatDate(anime.end_date)}` : ''}` : null },
                                    { label: 'Source', value: humanize(anime.source_material, '') },
                                    { label: 'Studios', value: studios.map((studio) => studio.name).join(', ') },
                                    {
                                        label: 'Genres',
                                        value: anime.genres?.length ? (
                                            <span className="flex flex-wrap gap-1.5">
                                                {anime.genres.map((genre) => <Chip key={genre.id}>{genre.name}</Chip>)}
                                            </span>
                                        ) : null,
                                    },
                                    {
                                        label: 'Next episode',
                                        value: anime.next_airing_episode
                                            ? `Episode ${anime.next_airing_episode}${anime.next_airing_date ? `, ${formatDateTime(anime.next_airing_date)}` : ''}`
                                            : null,
                                    },
                                    { label: 'Trailer', value: anime.trailer_url ? <ExternalAnchor href={anime.trailer_url}>Watch</ExternalAnchor> : null },
                                    { label: 'Also known as', value: anime.synonyms?.length ? anime.synonyms.join(' · ') : null, wide: true },
                                    { label: 'Slug', value: <span className="admin-mono">{anime.slug}</span> },
                                    { label: 'Added', value: formatDateTime(anime.created_at) },
                                ]}
                            />
                        </Panel>

                        <Panel
                            title="SEO description"
                            description={anime.meta_description
                                ? (anime.meta_description_locked ? 'Written here; syncs leave it alone.' : 'From the sync; it follows the synopsis until you edit it.')
                                : undefined}
                            actions={isSuperuser && <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setDialog('seo')}>Edit</Button>}
                        >
                            {anime.meta_description ? (
                                <p className="text-sm leading-relaxed text-[var(--text-2)]">{anime.meta_description}</p>
                            ) : (
                                <p className="text-sm text-[var(--text-3)]">None set. Search engines see the start of the synopsis.</p>
                            )}
                        </Panel>
                    </div>

                    <div className="space-y-4 sm:space-y-5">
                        <Panel title="Identity">
                            <KeyValue
                                columns={1}
                                items={[
                                    { label: 'Admin id', value: <span className="tabular">{anime.id}</span> },
                                    { label: 'AniList', value: anime.anilist_id ? <ExternalAnchor href={`https://anilist.co/anime/${anime.anilist_id}`}>{anime.anilist_id}</ExternalAnchor> : null },
                                    { label: 'MyAnimeList', value: anime.mal_id ? <ExternalAnchor href={`https://myanimelist.net/anime/${anime.mal_id}`}>{anime.mal_id}</ExternalAnchor> : null },
                                    { label: 'Metadata checked', value: anime.metadata_checked_at ? formatRelative(anime.metadata_checked_at) : 'Never' },
                                    { label: 'Last updated', value: formatRelative(anime.updated_at) },
                                ]}
                            />
                        </Panel>

                        <Panel title="Catalog" actions={<Link to="/admin/catalog-sync" className="text-link !min-h-9 text-sm">Catalog sync</Link>}>
                            <KeyValue
                                columns={1}
                                items={[
                                    { label: 'Listed', value: catalog.excluded ? exclusionLabel(catalog.excluded) : 'Yes' },
                                    { label: 'Made in', value: catalog.country_of_origin || null },
                                    { label: 'AniList format', value: catalog.format ? humanize(catalog.format.toLowerCase()) : null },
                                    {
                                        label: 'Details',
                                        value: catalog.hydrated_at
                                            ? `Cast and staff from ${formatRelative(catalog.hydrated_at)}`
                                            : catalog.hydrate_requested_at ? 'Queued' : 'Not fetched yet',
                                    },
                                    { label: 'Edited on AniList', value: catalog.anilist_updated_at ? formatRelative(catalog.anilist_updated_at) : null },
                                ]}
                            />
                        </Panel>

                        <Panel
                            title="Images"
                            actions={isSuperuser && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={ImageDown}
                                    onClick={() => setDialog('images')}
                                    disabled={!hasExternalImages}
                                    title={hasExternalImages ? undefined : 'No external image URLs to download from'}
                                >
                                    Re-download
                                </Button>
                            )}
                        >
                            <div className="flex items-end gap-3">
                                <Poster sources={posterSources} size="md" />
                                <div className="min-w-0 text-sm text-[var(--text-2)]">
                                    <p>{anime.cover_image ? 'Cover stored on our media.' : anime.cover_image_external_url ? 'Cover served from AniList.' : 'No cover.'}</p>
                                    <p className="mt-1">{anime.banner_image ? 'Banner stored on our media.' : anime.banner_image_external_url ? 'Banner served from AniList.' : 'No banner.'}</p>
                                </div>
                            </div>
                        </Panel>
                    </div>
                </div>
            </div>

            {isSuperuser && (
                <>
                    <SeoDialog open={dialog === 'seo'} onClose={close} anime={anime} />
                    <ConfirmDialog
                        open={dialog === 'refresh'}
                        onClose={close}
                        title="Refresh from AniList?"
                        confirmLabel="Refresh"
                        busy={refresh.isPending}
                        onConfirm={() => refresh.mutate()}
                    >
                        This runs in the background and takes a minute or so. Titles, synopsis, dates, genres, studios, cast and
                        images are replaced with what AniList has now. An SEO description written here stays.
                    </ConfirmDialog>
                    <ConfirmDialog
                        open={dialog === 'images'}
                        onClose={close}
                        title="Download the images again?"
                        confirmLabel="Download"
                        busy={images.isPending}
                        onConfirm={() => images.mutate()}
                    >
                        The cover and banner are fetched again from their AniList URLs and replace the stored copies. Use it when a
                        poster is broken or out of date.
                    </ConfirmDialog>
                    <ConfirmDialog
                        open={dialog === 'delete'}
                        onClose={close}
                        tone="danger"
                        title={`Delete ${anime.title}?`}
                        confirmLabel="Delete anime"
                        confirmText="delete"
                        busy={remove.isPending}
                        onConfirm={() => remove.mutate()}
                    >
                        {`This removes it from the catalog along with its ${formatNumber(anime.reviews_count ?? 0)} reviews, ${formatNumber(anime.favorites_count ?? 0)} favorites and every list entry. A later sync may add it again. This cannot be undone.`}
                    </ConfirmDialog>
                </>
            )}
        </>
    );
}
