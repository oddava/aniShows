import { Disc } from 'lucide-react';

export default function MusicSection({ anime, accentColor, isCompact = false, itemLimit = null }) {
    // Get themes from API data
    const themeSongs = anime?.theme_songs || [];

    const themes = {
        openings: themeSongs.filter(t => t.song_type === 'opening'),
        endings: themeSongs.filter(t => t.song_type === 'ending'),
    };

    const hasThemes = themes.openings.length > 0 || themes.endings.length > 0;
    const visibleOpenings = Number.isFinite(itemLimit) ? themes.openings.slice(0, itemLimit) : themes.openings;
    const visibleEndings = Number.isFinite(itemLimit) ? themes.endings.slice(0, itemLimit) : themes.endings;

    if (!hasThemes) {
        return null;
    }

    return (
        <div className="animate-tab-content w-full">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-6">
                Themes
            </h2>

            <div className={`grid gap-6 min-w-0 w-full ${isCompact ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
                {/* Openings */}
                {themes.openings.length > 0 && (
                    <div className="bg-dark-100/30 rounded-2xl p-4 sm:p-5 border border-gray-800 min-w-0 flex flex-col h-full">
                        <div className="flex items-center gap-2 mb-4">
                            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.16em]">Opening Themes</h3>
                            <span 
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-dark-50 border border-gray-800/50"
                                style={{ color: accentColor || '#75698d' }}
                            >
                                ({themes.openings.length})
                            </span>
                        </div>
                        <div className="space-y-3 pr-2">
                            {visibleOpenings.map((theme) => (
                                <ThemeItem key={`${theme.song_type}-${theme.track_number}`} theme={theme} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Endings */}
                {themes.endings.length > 0 && (
                    <div className="bg-dark-100/30 rounded-2xl p-4 sm:p-5 border border-gray-800 min-w-0 flex flex-col h-full">
                        <div className="flex items-center gap-2 mb-4">
                            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.16em]">Ending Themes</h3>
                            <span 
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-dark-50 border border-gray-800/50"
                                style={{ color: accentColor || '#75698d' }}
                            >
                                ({themes.endings.length})
                            </span>
                        </div>
                        <div className="space-y-3 pr-2">
                            {visibleEndings.map((theme) => (
                                <ThemeItem key={`${theme.song_type}-${theme.track_number}`} theme={theme} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function ThemeItem({ theme }) {
    const href = theme.youtube_url || theme.spotify_url;
    const Wrapper = href ? 'a' : 'div';

    return (
        <Wrapper
            {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {})}
            className={`flex items-center gap-2 sm:gap-3 rounded-xl bg-dark-100/50 p-2 sm:p-3 min-w-0 ${
                href ? 'cursor-pointer' : ''
            }`}
        >
            <div className="flex-1 min-w-0 overflow-hidden">
                <p className="font-medium text-gray-300 text-sm sm:text-base truncate">{theme.title}</p>
                <p className="text-xs text-gray-500 truncate">
                    {theme.artist}
                    {theme.episodes && <span className="ml-2 text-gray-600">({theme.episodes})</span>}
                </p>
            </div>
        </Wrapper>
    );
}
