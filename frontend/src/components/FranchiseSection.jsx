import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Film, Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import { animeApi } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import AnimeMediaImage from './common/AnimeMediaImage';

// Relations carry the AniList ID in uid=1000(oddava) gid=1000(oddava) groups=1000(oddava),4(adm),24(cdrom),27(sudo),30(dip),46(plugdev),100(users),989(docker) (null for Jikan-sourced entries) and the MAL ID in .
const relationKey = (rel) => (rel.id ?  : );

export default function FranchiseSection({ relations, accentColor, sourceSlug }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { theme } = useTheme();
    const isRetro = theme && theme.startsWith('retro-');
    const [loadingId, setLoadingId] = useState(null);
    const [showAll, setShowAll] = useState(false);

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
                queryClient.removeQueries({ queryKey: ['anime', slug] });
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

    const relationLabels = {
        PREQUEL: 'Prequel',
        SEQUEL: 'Sequel',
        PARENT: 'Parent',
        SIDE_STORY: 'Side Story',
        CHARACTER: 'Character',
        SUMMARY: 'Summary',
        ALTERNATIVE: 'Alt.',
        SPIN_OFF: 'Spin-off',
        OTHER: 'Related',
    };

    return (
        <div className={`mb-8 ${isRetro ? 'retro-window p-4 pb-2' : ''}`} data-title={`Franchise (${relations.length} total)`}>
            {/* Full-page loading overlay when fetching a franchise anime */}
            {loadingId && (
                <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-white animate-spin" />
                        <p className="text-sm text-gray-300">Loading anime...</p>
                    </div>
                </div>
            )}

            {!isRetro ? (
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] flex items-center gap-2">
                        Franchise
                        <span 
                            className="text-[10px] font-bold px-2 py-0.5 rounded-md border"
                            style={{ 
                                color: accentColor || '#75698d',
                                borderColor: accentColor ? `${accentColor}30` : 'rgba(117,105,141,0.2)',
                                backgroundColor: accentColor ? `${accentColor}10` : 'rgba(117,105,141,0.05)'
                            }}
                        >
                            {relations.length}
                        </span>
                    </h2>
                    {hasMore && (
                        <button
                            onClick={() => setShowAll(!showAll)}
                            className="text-xs font-medium text-gray-400 hover:text-white transition-colors flex items-center gap-1"
                        >
                            {showAll ? (
                                <>
                                    Show less
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                </>
                            ) : (
                                <>
                                    View all
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </>
                            )}
                        </button>
                    )}
                </div>
            ) : (
                <div className={`flex justify-end mb-3 pb-1 ${hasMore ? 'border-b border-gray-600' : ''}`}>
                    {hasMore && (
                        <button
                            onClick={() => setShowAll(!showAll)}
                            className="bg-[#d4d0c8] text-black px-2 py-0.5 text-xs border-2 border-white border-r-gray-500 border-b-gray-500 active:border-gray-500 active:border-r-white active:border-b-white"
                        >
                            {showAll ? 'Show less' : 'View all'}
                        </button>
                    )}
                </div>
            )}

            <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-hide snap-x snap-mandatory">
                {displayRelations.map((rel) => (
                    <FranchiseCard
                        key={relationKey(rel)}
                        rel={rel}
                        label={relationLabels[rel.type] || 'Related'}
                        onFetch={handleFetchAndNavigate}
                    />
                ))}
            </div>
        </div>
    );
}

function FranchiseCard({ rel, label, onFetch }) {
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        setIsLoaded(false);
    }, [rel?.id, rel?.mal_id, rel?.cover]);

    const handleImageError = useCallback(() => {
        // Prevent permanent skeleton state if image + fallback both fail.
        setIsLoaded(true);
    }, []);

    const relationAnime = {
        title: rel.title,
        cover_image: rel.cover || null,
    };

    const cardContent = (
        <>
            <div className="aspect-[2/3] rounded-lg overflow-hidden border border-gray-800 bg-dark-200 relative">
                {rel.cover ? (
                    <>
                        {!isLoaded && (
                            <div className="absolute inset-0 skeleton-shimmer bg-dark-200 z-10 pointer-events-none" />
                        )}
                        <AnimeMediaImage
                            anime={relationAnime}
                            kind="cover"
                            size="small"
                            alt={rel.title}
                            className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                            loading="lazy"
                            onLoad={() => setIsLoaded(true)}
                            onError={handleImageError}
                        />
                    </>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-700 bg-dark-300">
                        <Film className="w-8 h-8" />
                    </div>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/10" />

                {/* Relation type badge */}
                <div className="absolute top-1.5 left-1.5">
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-black/60 text-white backdrop-blur-sm">
                        {label}
                    </span>
                </div>
            </div>

            <h4 className="text-xs font-bold text-gray-300 line-clamp-2 leading-tight mt-1.5 group-hover:text-white transition-colors duration-200">
                {rel.title}
            </h4>
        </>
    );

    // Anime exists in DB - render as direct Link
    if (rel.slug) {
        return (
            <Link
                to={`/anime/${rel.slug}`}
                className="relative flex-shrink-0 w-28 snap-start cursor-pointer group"
                title={rel.title}
            >
                {cardContent}
            </Link>
        );
    }

    // Anime not in DB yet - fetch on click, then navigate
    return (
        <button
            onClick={() => onFetch(rel)}
            className="relative flex-shrink-0 w-28 snap-start cursor-pointer group text-left"
            title={rel.title}
        >
            {cardContent}
        </button>
    );
}
