import { Play, Disc, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export default function MusicSection({ anime, accentColor }) {
    const [showAllOpenings, setShowAllOpenings] = useState(false);
    const [showAllEndings, setShowAllEndings] = useState(false);

    // Get themes from API data
    const themeSongs = anime?.theme_songs || [];

    const themes = {
        openings: themeSongs.filter(t => t.song_type === 'opening'),
        endings: themeSongs.filter(t => t.song_type === 'ending'),
    };

    const hasThemes = themes.openings.length > 0 || themes.endings.length > 0;

    const MAX_VISIBLE = 6;

    if (!hasThemes) {
        return null;
    }

    return (
        <div className="mb-12 animate-tab-content">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                Themes
            </h2>

            <div className="grid md:grid-cols-2 gap-6 min-w-0">
                {/* Openings */}
                {themes.openings.length > 0 && (
                    <div className="bg-dark-100/30 rounded-2xl p-4 sm:p-6 border border-gray-800 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2 mb-4">
                            <Disc className="w-5 h-5" style={{ color: accentColor || '#8b5cf6' }} />
                            <h3 className="font-bold text-white">Opening Themes</h3>
                            <span className="text-xs text-gray-500">({themes.openings.length})</span>
                        </div>
                        <div className="space-y-3">
                            {(showAllOpenings ? themes.openings : themes.openings.slice(0, MAX_VISIBLE)).map((theme, idx) => (
                                <ThemeItem key={idx} theme={theme} accentColor={accentColor} number={idx + 1} />
                            ))}
                        </div>
                        {themes.openings.length > MAX_VISIBLE && (
                            <button
                                onClick={() => setShowAllOpenings(!showAllOpenings)}
                                className="w-full mt-4 py-2 px-4 flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white bg-dark-200/50 hover:bg-dark-200 rounded-xl transition-all"
                            >
                                {showAllOpenings ? (
                                    <>
                                        <ChevronUp className="w-4 h-4" />
                                        Show Less
                                    </>
                                ) : (
                                    <>
                                        <ChevronDown className="w-4 h-4" />
                                        Show {themes.openings.length - MAX_VISIBLE} More
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}

                {/* Endings */}
                {themes.endings.length > 0 && (
                    <div className="bg-dark-100/30 rounded-2xl p-4 sm:p-6 border border-gray-800 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2 mb-4">
                            <Disc className="w-5 h-5" style={{ color: accentColor || '#8b5cf6' }} />
                            <h3 className="font-bold text-white">Ending Themes</h3>
                            <span className="text-xs text-gray-500">({themes.endings.length})</span>
                        </div>
                        <div className="space-y-3">
                            {(showAllEndings ? themes.endings : themes.endings.slice(0, MAX_VISIBLE)).map((theme, idx) => (
                                <ThemeItem key={idx} theme={theme} accentColor={accentColor} number={idx + 1} />
                            ))}
                        </div>
                        {themes.endings.length > MAX_VISIBLE && (
                            <button
                                onClick={() => setShowAllEndings(!showAllEndings)}
                                className="w-full mt-4 py-2 px-4 flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white bg-dark-200/50 hover:bg-dark-200 rounded-xl transition-all"
                            >
                                {showAllEndings ? (
                                    <>
                                        <ChevronUp className="w-4 h-4" />
                                        Show Less
                                    </>
                                ) : (
                                    <>
                                        <ChevronDown className="w-4 h-4" />
                                        Show {themes.endings.length - MAX_VISIBLE} More
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function ThemeItem({ theme, number }) {
    return (
        <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-xl bg-dark-100/50 hover:bg-dark-100 transition-colors group min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center bg-dark-200 text-gray-500 font-bold text-xs sm:text-sm flex-shrink-0">
                #{number}
            </div>

            <div className="flex-1 min-w-0 overflow-hidden">
                <p className="font-medium text-white text-sm sm:text-base truncate">{theme.title}</p>
                <p className="text-xs text-gray-500 truncate">
                    {theme.artist}
                    {theme.episodes && <span className="ml-2 text-gray-600">({theme.episodes})</span>}
                </p>
            </div>

            <div className="flex items-center gap-1">
                {theme.spotify_url && (
                    <a
                        href={theme.spotify_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-dark-200 text-gray-400 hover:text-green-500 transition-colors"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                        </svg>
                    </a>
                )}
                {theme.youtube_url && (
                    <a
                        href={theme.youtube_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-dark-200 text-gray-400 hover:text-red-500 transition-colors"
                    >
                        <Play className="w-4 h-4" />
                    </a>
                )}
            </div>
        </div>
    );
}
