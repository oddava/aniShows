import { useMemo } from 'react';
import { Users, Mic, Loader, Play, Calendar, Search, Star } from 'lucide-react';
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
            .slice(0, 4);
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
                                className="flex bg-dark-200/40 rounded-xl overflow-hidden border border-white/5"
                            >
                                <Link to={`/character/${role.character.id}`} className="w-16 h-20 sm:w-20 sm:h-24 flex-shrink-0">
                                    <img
                                        src={role.character.image || '/placeholder-avatar.png'}
                                        alt={role.character.name}
                                        className="w-full h-full object-cover saturate-[0.85]"
                                    />
                                </Link>

                                <div className="flex-1 flex justify-between p-3 min-w-0">
                                    <div className="flex flex-col justify-between min-w-0 pr-2">
                                        <Link to={`/character/${role.character.id}`} className="text-[13px] font-medium text-white truncate hover:text-accent transition-colors">
                                            {role.character.name}
                                        </Link>
                                        <span className="text-[11px] text-gray-500 truncate">
                                            {role.role}
                                        </span>
                                    </div>

                                    <div className="flex flex-col justify-between min-w-0 text-right pl-2">
                                        {role.voice_actor ? (
                                            <Link to={`/staff/${role.voice_actor.id}`} className="text-[13px] font-medium text-white truncate hover:text-accent transition-colors">
                                                {role.voice_actor.name}
                                            </Link>
                                        ) : (
                                            <span className="text-[13px] font-medium text-gray-600">N/A</span>
                                        )}
                                        <span className="text-[11px] text-gray-500">
                                            Japanese
                                        </span>
                                    </div>
                                </div>

                                {role.voice_actor && (
                                    <Link to={`/staff/${role.voice_actor.id}`} className="w-16 h-20 sm:w-20 sm:h-24 flex-shrink-0 border-l border-white/5">
                                        <img
                                            src={role.voice_actor.image || '/placeholder-avatar.png'}
                                            alt={role.voice_actor.name}
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
                            <div
                                key={staffRole.id}
                                onClick={() => onStaffClick(staffRole)}
                                className="flex items-center gap-4 bg-dark-200/40 rounded-xl overflow-hidden border border-white/5 cursor-pointer"
                            >
                                <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0">
                                    <img
                                        src={staffRole.staff.image || '/placeholder-avatar.png'}
                                        alt={staffRole.staff.name}
                                        className="w-full h-full object-cover saturate-[0.85]"
                                    />
                                </div>
                                <div className="flex flex-col min-w-0 pr-4">
                                    <span className="font-medium text-white text-[13px] truncate">
                                        {staffRole.staff.name}
                                    </span>
                                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                                        {staffRole.role}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {topEpisodes.length > 0 && (
                <div className="min-w-0 space-y-4">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                        Episodes
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        {topEpisodes.map((episode) => (
                            <article
                                key={episode.number}
                                className="min-w-0"
                            >
                                {episode.crunchyroll_url ? (
                                    <a
                                        href={episode.crunchyroll_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="relative block aspect-video overflow-hidden rounded-2xl border border-white/5 bg-dark-200"
                                    >
                                        {episode.thumbnail ? (
                                            <img
                                                src={episode.thumbnail}
                                                alt={`Episode ${episode.number}`}
                                                loading="lazy"
                                                className="absolute inset-0 h-full w-full object-cover saturate-[0.85]"
                                            />
                                        ) : (
                                            <div className="absolute inset-0 bg-dark-100" />
                                        )}

                                        <div className="absolute inset-x-0 bottom-0 bg-black/85 px-3 py-2 border-t border-white/5">
                                            <h3 className="text-[12px] font-medium text-white line-clamp-1">
                                                Episode {episode.number}{episode.title ? ` - ${episode.title}` : ''}
                                            </h3>
                                        </div>
                                    </a>
                                ) : (
                                    <div className="relative block aspect-video overflow-hidden rounded-2xl border border-white/5 bg-dark-200">
                                        {episode.thumbnail ? (
                                            <img
                                                src={episode.thumbnail}
                                                alt={`Episode ${episode.number}`}
                                                loading="lazy"
                                                className="absolute inset-0 h-full w-full object-cover saturate-[0.85]"
                                            />
                                        ) : (
                                            <div className="absolute inset-0 bg-dark-100" />
                                        )}

                                        <div className="absolute inset-x-0 bottom-0 bg-black/85 px-3 py-2 border-t border-white/5">
                                            <h3 className="text-[12px] font-medium text-white line-clamp-1">
                                                Episode {episode.number}{episode.title ? ` - ${episode.title}` : ''}
                                            </h3>
                                        </div>
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                </div>
            )}

            {hasThemes && (
                <div className="min-w-0">
                    <MusicSection anime={anime} accentColor={accentColor} isCompact={false} />
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-8 items-start">
                <div className="min-w-0">
                    {hasTrailer && (
                        <div className="flex flex-col">
                            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-6">
                                Trailer
                            </h2>
                            <div className="w-full">
                                <LazyYouTube videoId={videoId} title="Trailer" accentColor={accentColor} />
                            </div>
                        </div>
                    )}
                </div>
                
                <div className="min-w-0 flex flex-col gap-8">
                    <div>
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                            Average Score
                        </h2>
                        <div className="bg-dark-100/50 rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
                            <p className="text-2xl font-black text-white">
                                {anime?.rating || 'N/A'}
                                {anime?.rating ? <span className="text-sm font-normal text-gray-400 ml-1">/ 10</span> : ''}
                            </p>
                        </div>
                    </div>

                    <div>
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                            Status Distribution
                        </h2>
                        <StatusDistribution anime={anime} />
                    </div>
                </div>
            </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-tab-content">
            {uniqueCharacters.map((role) => (
                <div 
                    key={role.id}
                    className="flex bg-dark-200/40 rounded-xl overflow-hidden border border-white/5"
                >
                    <Link to={`/character/${role.character.id}`} className="w-16 h-20 sm:w-20 sm:h-24 flex-shrink-0">
                        <img
                            src={role.character.image || '/placeholder-avatar.png'}
                            alt={role.character.name}
                            className="w-full h-full object-cover saturate-[0.85]"
                        />
                    </Link>

                    <div className="flex-1 flex justify-between p-3 min-w-0">
                        <div className="flex flex-col justify-between min-w-0 pr-2">
                            <Link to={`/character/${role.character.id}`} className="text-[13px] font-medium text-white truncate hover:text-accent transition-colors">
                                {role.character.name}
                            </Link>
                            <span className="text-[11px] text-gray-500">
                                {role.role}
                            </span>
                        </div>

                        <div className="flex flex-col justify-between min-w-0 text-right pl-2">
                            {role.voice_actor ? (
                                <Link to={`/staff/${role.voice_actor.id}`} className="text-[13px] font-medium text-white truncate hover:text-accent transition-colors">
                                    {role.voice_actor.name}
                                </Link>
                            ) : (
                                <span className="text-[13px] font-medium text-gray-600">N/A</span>
                            )}
                            <span className="text-[11px] text-gray-500">
                                Japanese
                            </span>
                        </div>
                    </div>

                    {role.voice_actor && (
                        <Link to={`/staff/${role.voice_actor.id}`} className="w-16 h-20 sm:w-20 sm:h-24 flex-shrink-0 border-l border-white/5">
                            <img
                                src={role.voice_actor.image || '/placeholder-avatar.png'}
                                alt={role.voice_actor.name}
                                className="w-full h-full object-cover saturate-[0.85]"
                            />
                        </Link>
                    )}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-tab-content">
            {uniqueStaff.map((staffRole) => (
                <div
                    key={staffRole.id}
                    onClick={() => onStaffClick(staffRole)}
                    className="flex items-center gap-4 bg-dark-200/40 rounded-xl overflow-hidden border border-white/5 cursor-pointer"
                >
                    <div className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0">
                        <img
                            src={staffRole.staff.image || '/placeholder-avatar.png'}
                            alt={staffRole.staff.name}
                            className="w-full h-full object-cover saturate-[0.85]"
                        />
                    </div>
                    <div className="flex flex-col min-w-0 pr-4">
                        <h4 className="font-medium text-white text-[13px] truncate">
                            <Link
                                to={`/staff/${staffRole.staff.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="hover:text-accent transition-colors"
                            >
                                {staffRole.staff.name}
                            </Link>
                        </h4>
                        <p className="text-[11px] text-gray-500 mt-1 truncate">{staffRole.role}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}
