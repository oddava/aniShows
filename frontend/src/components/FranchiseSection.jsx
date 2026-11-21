import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { animeApi } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import AnimeMediaImage from './common/AnimeMediaImage';
import { animeKeys } from '../api/queries/anime';
import useScrollFade from '../hooks/useScrollFade';

// AniList ID in `id`; `mal_id` is AniList's `idMal` (the key falls back to it when `id` is missing).
const relationKey = (rel) => (rel.id ? `anilist-${rel.id}` : `mal-${rel.mal_id}`);

export default function FranchiseSection({ relations, accentColor, sourceSlug }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { theme } = useTheme();
    const isRetro = theme && theme.startsWith('retro-');
    const [loadingId, setLoadingId] = useState(null);
    const [showAll, setShowAll] = useState(false);
    const scrollerRef = useScrollFade();

    const handleFetchAndNavigate = useCallback(async (rel) => {
        if (loadingId) return;
        setLoadingId(relationKey(rel));

        try {
            const response = await animeApi.fetchFranchise(
                { anilistId: rel.id, malId: rel.mal_id },
                sourceSlug,
            );
            const { slug } = response.data;
            if (slug) {
                // Ensure we don't reuse stale detail payloads for newly linked franchise entries.
                queryClient.removeQueries({ queryKey: animeKeys.bySlug(slug) });
                navigate(`/anime/${slug}`, {
                    state: {
                        prefetchedRelationCover: rel.cover || null,
                    },
                });
            }
        } catch {
            // Silently fail - user can just click again
            // The loading state will clear and they can retry
        } finally {
            setLoadingId(null);
        }
    }, [loadingId, sourceSlug, navigate, queryClient]);

    if (!relations || relations.length === 0) return null;

    // Sort: sequels/prequels first, then side stories, then rest
    const priorityOrder = ['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY'];
    const sortedRelations = [...relations].sort((a, b) => {
        const aPriority = priorityOrder.indexOf(a.type);
        const bPriority = priorityOrder.indexOf(b.type);
        if (aPriority === -1 && bPriority === -1) return 0;
        if (aPriority === -1) return 1;
        if (bPriority === -1) return -1;
        return aPriority - bPriority;
    });

    const displayRelations = showAll ? sortedRelations : sortedRelations.slice(0, 6);
    const hasMore = sortedRelations.length > 6;
    // Catalog relations often arrive without covers. A row of identical
    // placeholder tiles says nothing, so unless most have a cover the
    // franchise is a plain list: title left, relation right.
    const coverCount = displayRelations.filter((rel) => rel.cover).length;
    const asPosters = coverCount > 0 && coverCount >= displayRelations.length / 2;

    const relationLabel = (type) => RELATION_LABELS[type] || 'Related';

    return (
        <section className={`panel min-w-0 ${isRetro ? 'retro-window p-4 pb-2' : ''}`} data-title={`Franchise (${relations.length} total)`} aria-labelledby="franchise-heading">
            {/* Full-page loading overlay when fetching a franchise anime */}
            {loadingId && (
                <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-[var(--text-1)] animate-spin" />
                        <p className="text-sm text-[var(--text-2)]">Loading anime…</p>
                    </div>
                </div>
            )}

            <div className="mb-5 flex items-baseline justify-between gap-4">
                <h2 id="franchise-heading" className="section-title">
                    Franchise <span className="ml-1 text-[15px] font-normal text-[var(--text-3)] tabular">{relations.length}</span>
                </h2>
                {hasMore && (
                    <button
                        type="button"
                        onClick={() => setShowAll(!showAll)}
                        aria-expanded={showAll}
                        className="text-link shrink-0 text-[15px]"
                    >
                        {showAll ? 'Show less' : `See all ${sortedRelations.length}`}
                    </button>
                )}
            </div>

            {asPosters ? (
                <div ref={scrollerRef} className="scroll-fade flex items-start gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory">
                    {displayRelations.map((rel) => (
                        <FranchiseCard
                            key={relationKey(rel)}
                            rel={rel}
                            label={relationLabel(rel.type)}
                            onFetch={handleFetchAndNavigate}
                        />
                    ))}
                </div>
            ) : (
                <ul className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
                    {displayRelations.map((rel) => (
                        <li key={relationKey(rel)}>
                            <RelationTarget rel={rel} onFetch={handleFetchAndNavigate} className="group flex min-h-11 w-full flex-col justify-center text-left">
                                <span className="line-clamp-1 min-w-0 text-[15px] text-[var(--text-1)] group-hover:text-[var(--signature)]">{rel.title}</span>
                                <span className="text-sm text-[var(--text-3)]">{relationLabel(rel.type)}</span>
                            </RelationTarget>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

const RELATION_LABELS = {
    PREQUEL: 'Prequel',
    SEQUEL: 'Sequel',
    PARENT: 'Parent',
    SIDE_STORY: 'Side story',
    CHARACTER: 'Character',
    SUMMARY: 'Summary',
    ALTERNATIVE: 'Alternative',
    SPIN_OFF: 'Spin-off',
    OTHER: 'Related',
};

/** A link when the title is in the catalog; otherwise a button that fetches it first. */
function RelationTarget({ rel, onFetch, className, children }) {
    if (rel.slug) {
        return (
            <Link to={`/anime/${rel.slug}`} className={className} title={rel.title}>
                {children}
            </Link>
        );
    }
    return (
        <button type="button" onClick={() => onFetch(rel)} className={className} title={rel.title}>
            {children}
        </button>
    );
}

function FranchiseCard({ rel, label, onFetch }) {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [rel?.id, rel?.mal_id, rel?.cover]);

    const handleImageError = useCallback(() => setFailed(true), []);
    const showCover = rel.cover && !failed;

    return (
        <RelationTarget rel={rel} onFetch={onFetch} className="group flex w-28 flex-shrink-0 snap-start flex-col text-left sm:w-32">
            <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--radius-md)] bg-[var(--ink-2)]">
                {showCover ? (
                    <AnimeMediaImage
                        anime={{ title: rel.title, cover_image: rel.cover }}
                        kind="cover"
                        size="small"
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={handleImageError}
                    />
                ) : (
                    // Quiet placeholder: the title set on the cover-shaped slot.
                    <span aria-hidden="true" className="absolute inset-0 flex items-end p-2.5 text-sm leading-snug text-[var(--text-3)]">
                        <span className="line-clamp-4">{rel.title}</span>
                    </span>
                )}
            </div>
            <span className="mt-2 line-clamp-2 text-[15px] leading-snug text-[var(--text-1)] group-hover:text-[var(--signature)]">
                {rel.title}
            </span>
            <span className="mt-0.5 text-sm text-[var(--text-3)]">{label}</span>
        </RelationTarget>
    );
}
