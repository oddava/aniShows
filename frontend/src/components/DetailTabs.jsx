import { useMemo } from 'react';
import { Users, Mic, Loader, Play, Calendar, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import FranchiseSection from './FranchiseSection';
import MusicSection from './MusicSection';
import LazyYouTube from './LazyYouTube';

import StatusDistribution from './StatusDistribution';

export function OverviewTab({ anime, accentColor, characters, staff, episodes, onStaffClick }) {
    // Extract YouTube video ID
    const getYouTubeId = (url) => {
        if (!url) return null;
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
        return match ? match[1] : null;
    };
    const videoId = getYouTubeId(anime.trailer_url);

    const hasThemes = anime?.theme_songs && anime.theme_songs.some(t => t.song_type === 'opening' || t.song_type === 'ending');
    const hasTrailer = !!videoId;

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
        if (!Array.isArray(characters)) return [];
        const seen = new Set();
        return characters
            .filter((c) => {
                const name = c?.character?.name;
                if (!name || seen.has(name)) return false;
                seen.add(name);
                return true;
            })
            .slice(0, 6);
    }, [characters]);

    const topEpisodes = useMemo(() => {
        if (!Array.isArray(episodes)) return [];
        return episodes.slice(0, 3);
    }, [episodes]);

    return (
        <div className="animate-tab-content space-y-12">
            <FranchiseSection relations={anime.relations} accentColor={accentColor} sourceSlug={anime.slug} />

            {topCharacters.length > 0 && (
                <div className="min-w-0">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                        Characters
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                        {topCharacters.map((role) => (
                            <Link
                                key={role.id}
                                to={`/character/${role.character.id}`}
                                className="group relative overflow-hidden rounded-xl border border-white/5 bg-dark-200/40 cursor-pointer block"
                            >
                                <div className="aspect-[3/4] relative">
                                    <img
                                        src={role.character.image || '/placeholder-avatar.png'}
                                        alt={role.character.name}
                                        loading="lazy"
                                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500"
                                    />
                                    <div className="absolute inset-0 bg-black/60 transition-opacity duration-300" />

                                    <span
                                        className="absolute top-2 right-2 px-1.5 py-0.5 text-[8px] font-bold uppercase rounded"
                                        style={{
                                            backgroundColor: role.role === 'MAIN'
                                                ? (accentColor || '#75698d')
                                                : 'rgba(255,255,255,0.2)',
                                            color: 'white'
                                        }}
                                    >
                                        {role.role}
                                    </span>

                                    <div className="absolute bottom-0 left-0 right-0 p-3 flex flex-col justify-end">
                                        <h3 className="text-sm font-bold text-white truncate ">
                                            {role.character.name}
                                        </h3>
                                        {role.voice_actor && (
                                            <span className="text-xs text-white/70 mt-0.5 truncate block">
                                                {role.voice_actor.name}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {topStaff.length > 0 && (
                <div className="min-w-0">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                        Staff
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {topStaff.map((staffRole) => (
                            <div
                                key={staffRole.id}
                                onClick={() => onStaffClick(staffRole)}
                                className="flex flex-col items-center text-center p-4 bg-dark-100/30 rounded-xl border border-gray-800/50 cursor-pointer group"
                            >
                                <div className="w-20 h-20 rounded-full overflow-hidden border border-gray-700 mb-4 transition-colors">
                                    <img
                                        src={staffRole.staff.image || '/placeholder-avatar.png'}
                                        alt={staffRole.staff.name}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <span className="font-bold text-white text-sm line-clamp-2 mb-1">
                                    {staffRole.staff.name}
                                </span>
                                <p className="text-xs text-gray-500 line-clamp-1">{staffRole.role}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className={`grid grid-cols-1 ${topEpisodes.length > 0 ? 'xl:grid-cols-[2fr_1fr]' : ''} gap-8 items-start`}>
                {topEpisodes.length > 0 && (
                    <div className="min-w-0 space-y-4">
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                            Episodes
                        </h2>
                        <div className="grid gap-3">
                            {topEpisodes.map((episode) => (
                                <article
                                    key={episode.number}
                                    className="group flex flex-row items-center justify-between gap-4 rounded-xl border border-white/5 bg-dark-200/40 p-3 transition-colors hover:border-gray-600 min-w-0 overflow-hidden"
                                >
                                    <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                                        {episode.thumbnail && (
                                            <div className="relative aspect-video w-24 sm:w-32 flex-shrink-0 overflow-hidden rounded-lg bg-dark-200 border border-transparent group-hover:border-white/10 transition-colors">
                                                <img
                                                    src={episode.thumbnail}
                                                    alt={`Episode ${episode.number}`}
                                                    loading="lazy"
                                                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                />
                                            </div>
                                        )}

                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-sm font-bold text-gray-200 group-hover:text-white transition-colors truncate">
                                                <span className="text-gray-500 mr-1.5 sm:mr-2 flex-shrink-0">EP {episode.number}</span>
                                                {episode.title || `Episode ${episode.number}`}
                                            </h3>
                                            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 font-medium truncate">
                                                {episode.aired && (
                                                    <span className="flex-shrink-0">{episode.aired}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex-shrink-0 sm:flex sm:items-center">
                                        <a
                                            href={episode.crunchyroll_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white transition-all bg-white/5 hover:!bg-[var(--hover-accent)] active:scale-95 w-full sm:w-auto"
                                            style={{ '--hover-accent': accentColor || '#75698d' }}
                                        >
                                            {episode.has_real_crunchyroll_url ? (
                                                <Play className="h-3.5 w-3.5 fill-current flex-shrink-0" />
                                            ) : (
                                                <Search className="h-3.5 w-3.5 flex-shrink-0" />
                                            )}
                                            <span className="truncate hidden sm:inline">
                                                {episode.has_real_crunchyroll_url ? 'Watch' : 'Search'}
                                            </span>
                                        </a>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                )}
                
                <div className="min-w-0">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                        Status Distribution
                    </h2>
                    <StatusDistribution anime={anime} />
                </div>
            </div>

            {(hasThemes || hasTrailer) && (
                <div className={`grid grid-cols-1 ${hasThemes && hasTrailer ? 'xl:grid-cols-[2fr_1fr]' : ''} gap-8 items-start`}>
                    {hasTrailer && (
                        <div className="min-w-0 flex flex-col order-1 xl:order-1">
                            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-6">
                                Trailer
                            </h2>
                            <div className="w-full flex flex-col justify-start">
                                <LazyYouTube videoId={videoId} title="Trailer" accentColor={accentColor} />
                            </div>
                        </div>
                    )}

                    {hasThemes && (
                        <div className="min-w-0 order-2 xl:order-2 xl:row-span-2">
                            <MusicSection anime={anime} accentColor={accentColor} isCompact={hasTrailer} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function CharactersTab({ anime, isLoading, accentColor, onCharacterClick }) {
    const uniqueCharacters = useMemo(() => {
        if (!Array.isArray(anime.characters)) return [];

        const seen = new Set();
        return anime.characters.filter((role) => {
            const characterName = role?.character?.name;
            if (!characterName) return false;

            const voiceActorName = role?.voice_actor?.name || 'none';
            const dedupeKey = `${characterName}:${role?.role || 'unknown'}:${voiceActorName}`;
            if (seen.has(dedupeKey)) return false;

            seen.add(dedupeKey);
            return true;
        });
    }, [anime.characters]);

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
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-3 animate-tab-content">
            {uniqueCharacters.map((role) => (
                <div
                    key={role.id}
                    onClick={() => onCharacterClick(role)}
                    className="group relative overflow-hidden rounded-xl border border-white/5 bg-dark-200/40 cursor-pointer hover:border-gray-600"
                >
                    <div className="aspect-[3/4] relative">
                        <img
                            src={role.character.image || '/placeholder-avatar.png'}
                            alt={role.character.name}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/60" />

                        <span
                            className="absolute top-2 right-2 px-1.5 py-0.5 text-[8px] font-bold uppercase rounded"
                            style={{
                                backgroundColor: role.role === 'MAIN'
                                    ? (accentColor || '#75698d')
                                    : 'rgba(255,255,255,0.2)',
                                color: 'white'
                            }}
                        >
                            {role.role}
                        </span>

                        <div className="absolute bottom-0 left-0 right-0 p-3">
                            <h3 className="text-sm font-bold text-white truncate ">
                                {role.character.name}
                            </h3>
                            {role.voice_actor && (
                                <Link
                                    to={`/staff/${role.voice_actor.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs text-white/70 mt-0.5 truncate  hover:text-accent transition-colors block"
                                >
                                    {role.voice_actor.name}
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function StaffTab({ anime, isLoading, accentColor, onStaffClick }) {
    const uniqueStaff = useMemo(() => {
        if (!Array.isArray(anime.staff)) return [];
        const seen = new Set();
        return anime.staff.filter((staffRole) => {
            const staffName = staffRole?.staff?.name;
            if (!staffName) return false;
            const roleName = staffRole?.role || 'unknown';
            const dedupeKey = `${staffName}:${roleName}`;
            if (seen.has(dedupeKey)) return false;
            seen.add(dedupeKey);
            return true;
        });
    }, [anime.staff]);

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
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 animate-tab-content">
            {uniqueStaff.map((staffRole) => (
                <div
                    key={staffRole.id}
                    onClick={() => onStaffClick(staffRole)}
                    className="flex flex-col items-center text-center p-4 bg-dark-100/30 rounded-xl border border-gray-800/50 hover:bg-dark-100/50 transition-colors cursor-pointer group"
                >
                    <div className="w-20 h-20 rounded-full overflow-hidden border border-gray-700 mb-4  group-hover:border-gray-600 transition-colors">
                        <img
                            src={staffRole.staff.image || '/placeholder-avatar.png'}
                            alt={staffRole.staff.name}
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <h4 className="font-bold text-white text-sm line-clamp-2 mb-1">
                        <Link
                            to={`/staff/${staffRole.staff.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-accent transition-colors"
                        >
                            {staffRole.staff.name}
                        </Link>
                    </h4>
                    <p className="text-xs text-gray-500 line-clamp-1">{staffRole.role}</p>
                </div>
            ))}
        </div>
    );
}
