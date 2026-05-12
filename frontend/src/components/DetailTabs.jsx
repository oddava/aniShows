import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Users, Mic, Loader, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import FranchiseSection from './FranchiseSection';
import MusicSection from './MusicSection';
import LazyYouTube from './LazyYouTube';

import StatusDistribution from './StatusDistribution';
import { getUniqueCharacterRoles } from '../utils/characterRoles';

const PROFILE_PLACEHOLDER = '/placeholder-avatar.png';
const CHARACTER_VIRTUALIZE_THRESHOLD = 80;
const CHARACTER_GRID_ROW_ESTIMATE = 84;
const CHARACTER_GRID_OVERSCAN = 6;
const CHARACTER_GRID_BREAKPOINTS = [
    { query: '(min-width: 1024px)', columns: 2 },
];

const getPortraitUrl = (entity) => (
    entity?.image_small || entity?.image_medium || entity?.image || PROFILE_PLACEHOLDER
);

const getPortraitSrcSet = (entity) => {
    const candidates = [
        entity?.image_small ? `${entity.image_small} 60w` : null,
        entity?.image_medium ? `${entity.image_medium} 150w` : null,
    ].filter(Boolean);

    return candidates.length > 0 ? candidates.join(', ') : undefined;
};

const getResponsiveColumns = (defaultColumns, breakpoints) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return defaultColumns;
    }

    for (const breakpoint of breakpoints) {
        if (window.matchMedia(breakpoint.query).matches) {
            return breakpoint.columns;
        }
    }

    return defaultColumns;
};

function useResponsiveColumns(defaultColumns, breakpoints) {
    const [columns, setColumns] = useState(() => getResponsiveColumns(defaultColumns, breakpoints));

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQueries = breakpoints.map((breakpoint) => window.matchMedia(breakpoint.query));
        const handleChange = () => setColumns(getResponsiveColumns(defaultColumns, breakpoints));

        handleChange();
        mediaQueries.forEach((query) => {
            if (typeof query.addEventListener === 'function') {
                query.addEventListener('change', handleChange);
            } else {
                query.addListener(handleChange);
            }
        });

        return () => {
            mediaQueries.forEach((query) => {
                if (typeof query.removeEventListener === 'function') {
                    query.removeEventListener('change', handleChange);
                } else {
                    query.removeListener(handleChange);
                }
            });
        };
    }, [breakpoints, defaultColumns]);

    return columns;
}

function useElementOffsetTop(ref, itemCount, columns) {
    const [offsetTop, setOffsetTop] = useState(0);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const updateOffset = () => {
            setOffsetTop(ref.current?.offsetTop || 0);
        };

        updateOffset();
        window.addEventListener('resize', updateOffset);
        window.addEventListener('load', updateOffset);

        return () => {
            window.removeEventListener('resize', updateOffset);
            window.removeEventListener('load', updateOffset);
        };
    }, [ref, itemCount, columns]);

    return offsetTop;
}

const PortraitImage = memo(function PortraitImage({ entity, alt, className }) {
    return (
        <img
            src={getPortraitUrl(entity)}
            srcSet={getPortraitSrcSet(entity)}
            sizes="64px"
            alt={alt}
            loading="lazy"
            decoding="async"
            className={className}
        />
    );
});

const CharacterRoleCard = memo(function CharacterRoleCard({ role }) {
    return (
        <div className="flex h-16 sm:h-[72px] bg-dark-200/40 rounded-xl overflow-hidden border border-white/5">
            <Link to={`/character/${role.character.id}`} className="w-14 sm:w-16 flex-shrink-0">
                <PortraitImage
                    entity={role.character}
                    alt={role.character.name}
                    className="w-full h-full object-cover saturate-[0.85]"
                />
            </Link>

            <div className="flex-1 grid grid-cols-2 gap-2 p-2 sm:px-3 sm:py-2 min-w-0">
                <div className="flex flex-col justify-center min-w-0">
                    <Link to={`/character/${role.character.id}`} className="text-[13px] font-medium text-gray-300 hover:text-accent transition-colors break-words line-clamp-2">
                        {role.character.name}
                    </Link>
                    <span className="text-[11px] text-gray-500 mt-0.5 uppercase">
                        {role.role}
                    </span>
                </div>

                <div className="flex flex-col justify-center text-right min-w-0">
                    {role.voice_actor ? (
                        <Link to={`/staff/${role.voice_actor.id}`} className="text-[13px] font-medium text-gray-300 hover:text-accent transition-colors break-words line-clamp-2">
                            {role.voice_actor.name}
                        </Link>
                    ) : (
                        <span className="text-[13px] font-medium text-gray-600">N/A</span>
                    )}
                    <span className="text-[11px] text-gray-500 mt-0.5">
                        Japanese
                    </span>
                </div>
            </div>

            {role.voice_actor && (
                <Link to={`/staff/${role.voice_actor.id}`} className="w-14 sm:w-16 flex-shrink-0 border-l border-white/5">
                    <PortraitImage
                        entity={role.voice_actor}
                        alt={role.voice_actor.name}
                        className="w-full h-full object-cover saturate-[0.85]"
                    />
                </Link>
            )}
        </div>
    );
});

function CharacterGrid({ characters }) {
    if (characters.length < CHARACTER_VIRTUALIZE_THRESHOLD) {
        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 animate-tab-content">
                {characters.map((role) => (
                    <CharacterRoleCard key={role.id} role={role} />
                ))}
            </div>
        );
    }

    return <VirtualizedCharacterGrid characters={characters} />;
}

function RelationLoadMoreButton({ hasNextPage, isFetchingNextPage, onLoadMore, label }) {
    if (!hasNextPage) {
        return null;
    }

    return (
        <div className="flex justify-center pt-2">
            <button
                type="button"
                onClick={onLoadMore}
                disabled={isFetchingNextPage}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-dark-100 px-5 py-2.5 text-sm font-bold text-gray-200 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
                {isFetchingNextPage && <Loader className="h-4 w-4 animate-spin" />}
                {isFetchingNextPage ? 'Loading...' : label}
            </button>
        </div>
    );
}

function VirtualizedCharacterGrid({ characters }) {
    const containerRef = useRef(null);
    const columns = useResponsiveColumns(1, CHARACTER_GRID_BREAKPOINTS);
    const rowCount = Math.ceil(characters.length / columns);
    const scrollMargin = useElementOffsetTop(containerRef, characters.length, columns);
    const rowVirtualizer = useWindowVirtualizer({
        count: rowCount,
        estimateSize: () => CHARACTER_GRID_ROW_ESTIMATE,
        overscan: CHARACTER_GRID_OVERSCAN,
        scrollMargin,
    });

    return (
        <div
            ref={containerRef}
            className="relative animate-tab-content"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const startIndex = virtualRow.index * columns;
                const rowItems = characters.slice(startIndex, startIndex + columns);

                return (
                    <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        className={`absolute left-0 top-0 grid w-full gap-3 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
                        style={{
                            height: `${CHARACTER_GRID_ROW_ESTIMATE - 12}px`,
                            transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                        }}
                    >
                        {rowItems.map((role) => (
                            <CharacterRoleCard key={role.id} role={role} />
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

export function OverviewTab({ anime, accentColor, characters, staff, episodes }) {
    // Extract YouTube video ID
    const getYouTubeId = (url) => {
        if (!url) return null;
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
        return match ? match[1] : null;
    };
    const videoId = getYouTubeId(anime.trailer_url);

    const hasThemes = anime?.theme_songs && anime.theme_songs.some(t => t.song_type === 'opening' || t.song_type === 'ending');
    const hasTrailer = !!videoId;
    const scoreLabel = anime?.rating != null
        ? (anime?.anilist_id ? 'on AniList' : '/ 10')
        : '';

    // Deduplicate and filter staff
    const topStaff = useMemo(() => {
        if (!Array.isArray(staff)) return [];
        const seen = new Set();
        return staff
            .filter((s) => {
                const name = s?.staff?.name;
                if (!name || seen.has(name)) return false;
                seen.add(name);
                return true;
            })
            .slice(0, 3);
    }, [staff]);

    // Deduplicate and filter characters
    const topCharacters = useMemo(() => {
        return getUniqueCharacterRoles(characters, { includeVoiceActor: false }).slice(0, 4);
    }, [characters]);

    const topEpisodes = useMemo(() => {
        if (!Array.isArray(episodes)) return [];
        return episodes.slice(0, 4);
    }, [episodes]);

    return (
        <div className="animate-tab-content space-y-12">
            <FranchiseSection relations={anime.relations} accentColor={accentColor} sourceSlug={anime.slug} />

            {topCharacters.length > 0 && (
                <div className="min-w-0">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                        Characters
                    </h2>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {topCharacters.map((role) => (
                            <div 
                                key={role.id}
                                className="flex bg-dark-200/40 rounded-xl overflow-hidden border border-white/5 min-h-[64px]"
                            >
                                <Link to={`/character/${role.character.id}`} className="w-14 sm:w-16 flex-shrink-0">
                                    <img
                                        src={getPortraitUrl(role.character)}
                                        srcSet={getPortraitSrcSet(role.character)}
                                        sizes="64px"
                                        alt={role.character.name}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full h-full object-cover saturate-[0.85]"
                                    />
                                </Link>

                                <div className="flex-1 grid grid-cols-2 gap-2 p-2 sm:px-3 sm:py-2 min-w-0">
                                    <div className="flex flex-col justify-center min-w-0">
                                        <Link to={`/character/${role.character.id}`} className="text-[13px] font-medium text-gray-300 hover:text-accent transition-colors break-words line-clamp-2">
                                            {role.character.name}
                                        </Link>
                                        <span className="text-[11px] text-gray-500 mt-0.5 uppercase">
                                            {role.role}
                                        </span>
                                    </div>

                                    <div className="flex flex-col justify-center text-right min-w-0">
                                        {role.voice_actor ? (
                                            <Link to={`/staff/${role.voice_actor.id}`} className="text-[13px] font-medium text-gray-300 hover:text-accent transition-colors break-words line-clamp-2">
                                                {role.voice_actor.name}
                                            </Link>
                                        ) : (
                                            <span className="text-[13px] font-medium text-gray-600">N/A</span>
                                        )}
                                        <span className="text-[11px] text-gray-500 mt-0.5">
                                            Japanese
                                        </span>
                                    </div>
                                </div>

                                {role.voice_actor && (
                                    <Link to={`/staff/${role.voice_actor.id}`} className="w-14 sm:w-16 flex-shrink-0 border-l border-white/5">
                                        <img
                                            src={getPortraitUrl(role.voice_actor)}
                                            srcSet={getPortraitSrcSet(role.voice_actor)}
                                            sizes="64px"
                                            alt={role.voice_actor.name}
                                            loading="lazy"
                                            decoding="async"
                                            className="w-full h-full object-cover saturate-[0.85]"
                                        />
                                    </Link>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {topStaff.length > 0 && (
                <div className="min-w-0">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                        Staff
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {topStaff.map((staffRole) => (
                            <Link
                                key={staffRole.id}
                                to={staffRole.staff?.id ? `/staff/${staffRole.staff.id}` : '#'}
                                className="flex items-center gap-4 bg-dark-200/40 rounded-xl overflow-hidden border border-white/5 hover:border-gray-700 transition-colors"
                            >
                                <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0">
                                    <img
                                        src={getPortraitUrl(staffRole.staff)}
                                        srcSet={getPortraitSrcSet(staffRole.staff)}
                                        sizes="80px"
                                        alt={staffRole.staff.name}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full h-full object-cover saturate-[0.85]"
                                    />
                                </div>
                                <div className="flex flex-col min-w-0 pr-4">
                                    <span className="font-medium text-gray-300 text-[13px] truncate">
                                        {staffRole.staff.name}
                                    </span>
                                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                                        {staffRole.role}
                                    </p>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {topEpisodes.length > 0 && (
                <div className="min-w-0 space-y-3 sm:space-y-4">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-3 sm:mb-6">
                        Episodes
                    </h2>
                    <div className={topEpisodes.some(e => e.thumbnail) 
                        ? "grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-4" 
                        : "grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3"}>
                        {topEpisodes.map((episode) => {
                            const hasThumbnail = episode.thumbnail;
                            
                            if (!hasThumbnail) {
                                return (
                                    <a
                                        key={episode.number}
                                        href={episode.crunchyroll_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-3 sm:gap-4 bg-dark-200/40 rounded-lg sm:rounded-xl p-2.5 sm:p-3 border border-white/5 hover:border-gray-700 transition-colors group"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-xs sm:text-[13px] font-medium text-gray-300 truncate">
                                                Episode {episode.number}{episode.title ? ` - ${episode.title}` : ''}
                                            </h3>
                                        </div>
                                    </a>
                                );
                            }

                            return (
                                <article
                                    key={episode.number}
                                    className="min-w-0"
                                >
                                    {episode.crunchyroll_url ? (
                                        <a
                                            href={episode.crunchyroll_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="relative block h-24 sm:h-auto sm:aspect-video overflow-hidden rounded-lg sm:rounded-2xl border border-white/5 bg-dark-200"
                                        >
                                            <img
                                                src={episode.thumbnail}
                                                alt={`Episode ${episode.number}`}
                                                loading="lazy"
                                                className="absolute inset-0 h-full w-full object-cover saturate-[0.85]"
                                            />
                                            <div className="absolute inset-x-0 bottom-0 bg-black/85 px-2.5 py-1.5 sm:px-3 sm:py-2 border-t border-white/5">
                                                <h3 className="text-[11px] sm:text-[12px] font-medium text-gray-300 line-clamp-1">
                                                    Episode {episode.number}{episode.title ? ` - ${episode.title}` : ''}
                                                </h3>
                                            </div>
                                        </a>
                                    ) : (
                                        <div className="relative block h-24 sm:h-auto sm:aspect-video overflow-hidden rounded-lg sm:rounded-2xl border border-white/5 bg-dark-200">
                                            <img
                                                src={episode.thumbnail}
                                                alt={`Episode ${episode.number}`}
                                                loading="lazy"
                                                className="absolute inset-0 h-full w-full object-cover saturate-[0.85]"
                                            />
                                            <div className="absolute inset-x-0 bottom-0 bg-black/85 px-2.5 py-1.5 sm:px-3 sm:py-2 border-t border-white/5">
                                                <h3 className="text-[11px] sm:text-[12px] font-medium text-gray-300 line-clamp-1">
                                                    Episode {episode.number}{episode.title ? ` - ${episode.title}` : ''}
                                                </h3>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </div>
            )}

            {hasThemes && (
                <div className="min-w-0">
                    <MusicSection anime={anime} accentColor={accentColor} isCompact={false} itemLimit={2} />
                </div>
            )}

            <div
                className={`grid grid-cols-1 gap-8 items-start ${
                    hasTrailer ? 'xl:grid-cols-[2fr_1fr]' : ''
                }`}
            >
                {hasTrailer && (
                    <div className="min-w-0">
                        <div className="flex flex-col">
                            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-6">
                                Trailer
                            </h2>
                            <div className="w-full">
                                <LazyYouTube videoId={videoId} title="Trailer" accentColor={accentColor} />
                            </div>
                        </div>
                    </div>
                )}

                <div
                    className={`min-w-0 ${
                        hasTrailer
                            ? 'flex flex-col gap-8'
                            : 'grid grid-cols-1 md:grid-cols-2 gap-8'
                    }`}
                >
                    <div>
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                            Average Score
                        </h2>
                        <div className="bg-dark-100/50 rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
                            <p className="text-2xl font-black text-gray-300">
                                {anime?.rating != null ? anime.rating : 'N/A'}
                                {anime?.rating != null ? <span className="text-sm font-normal text-gray-400 ml-1">{scoreLabel}</span> : ''}
                            </p>
                        </div>
                    </div>

                    <StatusDistribution anime={anime} />
                </div>
            </div>
        </div>
    );
}

export function ThemesTab({ anime, accentColor }) {
    const hasThemes = anime?.theme_songs?.length > 0;

    if (!hasThemes) {
        return (
            <div className="text-center py-12 animate-tab-content">
                <Search className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No theme songs available.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content">
            <MusicSection anime={anime} accentColor={accentColor} isCompact={false} />
        </div>
    );
}

export function CharactersTab({
    anime,
    characters: charactersProp,
    isLoading,
    totalCount,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
}) {
    const sourceCharacters = charactersProp || anime?.characters;
    const uniqueCharacters = useMemo(() => {
        return getUniqueCharacterRoles(sourceCharacters);
    }, [sourceCharacters]);
    const resolvedCount = Number.isFinite(totalCount) && totalCount >= 0
        ? totalCount
        : uniqueCharacters.length;

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-24">
                <Loader className="w-10 h-10 text-accent animate-spin" />
            </div>
        );
    }

    if (uniqueCharacters.length === 0) {
        return (
            <div className="text-center py-12 animate-tab-content">
                <Users className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No character information available.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content min-w-0 space-y-3 sm:space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 rounded-xl border border-white/5 bg-dark-200/30 px-3 py-2.5 sm:px-4 sm:py-3 text-[11px] sm:text-xs text-gray-400">
                <div>
                    Loaded <span className="font-bold text-gray-300">{uniqueCharacters.length}</span> of <span className="font-bold text-gray-300">{resolvedCount}</span> characters
                </div>
            </div>

            <CharacterGrid characters={uniqueCharacters} />

            <RelationLoadMoreButton
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={onLoadMore}
                label="Load More Characters"
            />
        </div>
    );
}

export function StaffTab({
    anime,
    staff: staffProp,
    isLoading,
    totalCount,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
}) {
    const sourceStaff = staffProp || anime?.staff;
    const uniqueStaff = useMemo(() => {
        if (!Array.isArray(sourceStaff)) return [];
        const seen = new Set();
        return sourceStaff.filter((staffRole) => {
            const staffName = staffRole?.staff?.name;
            if (!staffName) return false;
            const roleName = staffRole?.role || 'unknown';
            const dedupeKey = `${staffName}:${roleName}`;
            if (seen.has(dedupeKey)) return false;
            seen.add(dedupeKey);
            return true;
        });
    }, [sourceStaff]);
    const resolvedCount = Number.isFinite(totalCount) && totalCount >= 0
        ? totalCount
        : uniqueStaff.length;

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-24">
                <Loader className="w-10 h-10 text-accent animate-spin" />
            </div>
        );
    }

    if (!uniqueStaff || uniqueStaff.length === 0) {
        return (
            <div className="text-center py-16 animate-tab-content">
                <Mic className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">No staff information available.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content min-w-0 space-y-3 sm:space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 rounded-xl border border-white/5 bg-dark-200/30 px-3 py-2.5 sm:px-4 sm:py-3 text-[11px] sm:text-xs text-gray-400">
                <div>
                    Loaded <span className="font-bold text-gray-300">{uniqueStaff.length}</span> of <span className="font-bold text-gray-300">{resolvedCount}</span> staff credits
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {uniqueStaff.map((staffRole) => (
                    <Link
                        key={staffRole.id}
                        to={staffRole.staff?.id ? `/staff/${staffRole.staff.id}` : '#'}
                        className="flex items-center gap-4 bg-dark-200/40 rounded-xl overflow-hidden border border-white/5 hover:border-gray-700 transition-colors"
                    >
                        <div className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0">
                            <img
                                src={getPortraitUrl(staffRole.staff)}
                                srcSet={getPortraitSrcSet(staffRole.staff)}
                                sizes="96px"
                                alt={staffRole.staff.name}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover saturate-[0.85]"
                            />
                        </div>
                        <div className="flex flex-col min-w-0 pr-4">
                            <h4 className="font-medium text-gray-300 text-[13px] truncate">
                                <span className="transition-colors hover:text-accent">{staffRole.staff.name}</span>
                            </h4>
                            <p className="text-[11px] text-gray-500 mt-1 truncate">{staffRole.role}</p>
                        </div>
                    </Link>
                ))}
            </div>

            <RelationLoadMoreButton
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={onLoadMore}
                label="Load More Staff"
            />
        </div>
    );
}
