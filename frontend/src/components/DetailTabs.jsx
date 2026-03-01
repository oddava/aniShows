import { useState } from 'react';
import { ChevronDown, Users, Mic } from 'lucide-react';
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

export function CharactersTab({ anime, accentColor, onCharacterClick }) {
    if (!anime.characters || anime.characters.length === 0) {
        return (
            <div className="text-center py-16 animate-tab-content">
                <Users className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">No character information available.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 animate-tab-content">
            {anime.characters.map((role) => (
                <div
                    key={role.id}
                    onClick={() => onCharacterClick(role)}
                    className="group relative h-40 sm:h-48 md:h-56 lg:h-64 overflow-hidden rounded-lg sm:rounded-xl lg:rounded-2xl border border-white/5 bg-dark-200/40 cursor-pointer hover:border-gray-600 transition-colors"
                >
                    <div className="absolute inset-0">
                        <img
                            src={role.character.image || '/placeholder-avatar.png'}
                            alt={role.character.name}
                            loading="lazy"
                            className="h-full w-full object-cover opacity-70"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/80 to-transparent" />
                    </div>
                    <div className="relative h-full flex flex-col justify-end p-4 z-10">
                        <div className="absolute top-3 right-3">
                            <span
                                className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-lg border backdrop-blur-md
                                    ${role.role === 'MAIN'
                                        ? 'text-white'
                                        : 'bg-white/5 border-white/10 text-gray-400'}`}
                                style={role.role === 'MAIN' ? {
                                    backgroundColor: accentColor ? `${accentColor}30` : 'rgba(139,92,246,0.2)',
                                    borderColor: accentColor ? `${accentColor}50` : 'rgba(139,92,246,0.3)',
                                    color: accentColor || '#8b5cf6'
                                } : {}}
                            >
                                {role.role}
                            </span>
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-white leading-tight mb-1">
                                {role.character.name}
                            </h3>
                            {role.voice_actor && (
                                <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-white/10">
                                    <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10 lg:w-9 lg:h-9 shrink-0">
                                        <img
                                            src={role.voice_actor.image || '/placeholder-avatar.png'}
                                            alt={role.voice_actor.name}
                                            loading="lazy"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-gray-300 leading-tight">
                                            {role.voice_actor.name}
                                        </p>
                                        <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mt-0.5">
                                            Japanese
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function StaffTab({ anime, accentColor, onStaffClick }) {
    if (!anime.staff || anime.staff.length === 0) {
        return (
            <div className="text-center py-16 animate-tab-content">
                <Mic className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">No staff information available.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-tab-content">
            {anime.staff.map((staffRole) => (
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
                    <h4 className="font-bold text-white text-sm line-clamp-2 mb-1">{staffRole.staff.name}</h4>
                    <p className="text-xs text-gray-500 line-clamp-1">{staffRole.role}</p>
                </div>
            ))}
        </div>
    );
}
