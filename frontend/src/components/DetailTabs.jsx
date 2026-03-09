import { useMemo, useState } from 'react';
import { ChevronDown, Users, Mic, Loader } from 'lucide-react';
import { Link } from 'react-router-dom';
import FranchiseSection from './FranchiseSection';
import MusicSection from './MusicSection';
import LazyYouTube from './LazyYouTube';

export function OverviewTab({ anime, accentColor }) {
    const [synopsisExpanded, setSynopsisExpanded] = useState(false);

    // Extract YouTube video ID
    const getYouTubeId = (url) => {
        if (!url) return null;
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
        return match ? match[1] : null;
    };
    const videoId = getYouTubeId(anime.trailer_url);

    return (
        <div className="animate-tab-content space-y-12">
            <FranchiseSection relations={anime.relations} accentColor={accentColor} sourceSlug={anime.slug} />

            <MusicSection anime={anime} accentColor={accentColor} />

            <div className="mb-12">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <div className="w-1 h-6 rounded-full" style={{ backgroundColor: accentColor || '#8b5cf6' }} />
                    Synopsis
                </h2>
                <div className="relative">
                    <p className={`text-gray-300 leading-loose text-lg font-normal max-w-4xl transition-all duration-300 ${!synopsisExpanded ? 'line-clamp-4' : ''}`}>
                        {anime.synopsis}
                    </p>
                    {anime.synopsis && anime.synopsis.length > 400 && (
                        <>
                            {!synopsisExpanded && (
                                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-dark to-transparent pointer-events-none" />
                            )}
                            <button
                                onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                                className="mt-2 flex items-center gap-1 text-sm font-bold transition-colors"
                                style={{ color: accentColor || '#8b5cf6' }}
                            >
                                {synopsisExpanded ? 'Show Less' : 'Read More'}
                                <ChevronDown className={`w-4 h-4 transition-transform ${synopsisExpanded ? 'rotate-180' : ''}`} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {videoId && (
                <div className="mb-12">
                    <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <div className="w-1 h-6 rounded-full" style={{ backgroundColor: accentColor || '#8b5cf6' }} />
                        Trailer
                    </h2>
                    <LazyYouTube videoId={videoId} title="Trailer" accentColor={accentColor} />
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 animate-tab-content">
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
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent" />

                        <span
                            className="absolute top-2 right-2 px-1.5 py-0.5 text-[8px] font-bold uppercase rounded"
                            style={{
                                backgroundColor: role.role === 'MAIN'
                                    ? (accentColor || '#8b5cf6')
                                    : 'rgba(255,255,255,0.2)',
                                color: 'white'
                            }}
                        >
                            {role.role}
                        </span>

                        <div className="absolute bottom-0 left-0 right-0 p-3">
                            <h3 className="text-sm font-bold text-white truncate drop-shadow-lg">
                                {role.character.name}
                            </h3>
                            {role.voice_actor && (
                                <Link
                                    to={`/staff/${role.voice_actor.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs text-white/70 mt-0.5 truncate drop-shadow-md hover:text-accent transition-colors block"
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-tab-content">
            {uniqueStaff.map((staffRole) => (
                <div
                    key={staffRole.id}
                    onClick={() => onStaffClick(staffRole)}
                    className="flex flex-col items-center text-center p-6 bg-dark-100/30 rounded-xl border border-gray-800/50 hover:bg-dark-100/50 transition-colors cursor-pointer group"
                >
                    <div className="w-20 h-20 rounded-full overflow-hidden border border-gray-700 mb-4 shadow-lg group-hover:border-gray-600 transition-colors">
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
