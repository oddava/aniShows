import { Tv, Check, Play, Clock, CalendarDays } from 'lucide-react';
import { useState } from 'react';

export default function EpisodesTab({ anime, accentColor }) {
    const episodeCount = anime?.episode_count || 0;
    const duration = anime?.duration_minutes || 24;
    const [watchedEpisodes, setWatchedEpisodes] = useState(new Set());

    // Generate episode data (placeholder for now - would come from API)
    const episodes = Array.from({ length: episodeCount }, (_, i) => ({
        number: i + 1,
        title: `Episode ${i + 1}`,
        aired: null, // Would come from API
        isFiller: false, // Would come from API
    }));

    const toggleWatched = (episodeNum) => {
        setWatchedEpisodes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(episodeNum)) {
                newSet.delete(episodeNum);
            } else {
                newSet.add(episodeNum);
            }
            return newSet;
        });
    };

    const markAllWatched = () => {
        setWatchedEpisodes(new Set(episodes.map(e => e.number)));
    };

    const unmarkAllWatched = () => {
        setWatchedEpisodes(new Set());
    };

    if (episodeCount === 0) {
        return (
            <div className="text-center py-16 animate-tab-content">
                <Tv className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">No episode information available.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-dark-100/50 rounded-2xl p-4 border border-gray-800">
                <div className="flex items-center gap-4">
                    <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: accentColor ? `${accentColor}20` : 'rgba(117,105,141,0.2)' }}
                    >
                        <Tv className="w-6 h-6" style={{ color: accentColor || '#75698d' }} />
                    </div>
                    <div>
                        <p className="text-white font-bold">{episodeCount} Episodes</p>
                        <p className="text-gray-400 text-sm">~{duration} min each</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={markAllWatched}
                        className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-dark-200 hover:bg-dark-300 rounded-lg transition-colors"
                    >
                        Mark All Watched
                    </button>
                    <button
                        onClick={unmarkAllWatched}
                        className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-dark-200 hover:bg-dark-300 rounded-lg transition-colors"
                    >
                        Reset
                    </button>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="bg-dark-100/50 rounded-2xl p-4 border border-gray-800">
                <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-400">Progress</span>
                    <span className="text-white font-medium">
                        {watchedEpisodes.size} / {episodeCount} episodes
                    </span>
                </div>
                <div className="h-3 bg-dark-200 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                            width: `${(watchedEpisodes.size / episodeCount) * 100}%`,
                            backgroundColor: accentColor || '#75698d'
                        }}
                    />
                </div>
            </div>

            {/* Episodes List */}
            <div className="grid gap-2">
                {episodes.map((episode) => {
                    const isWatched = watchedEpisodes.has(episode.number);
                    
                    return (
                        <div
                            key={episode.number}
                            className={`group flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer
                                ${isWatched 
                                    ? 'bg-dark-100/30 border-gray-800' 
                                    : 'bg-dark-100/50 border-gray-700 hover:border-gray-600'
                                }`}
                            onClick={() => toggleWatched(episode.number)}
                        >
                            <button
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all
                                    ${isWatched 
                                        ? 'bg-green-500/20 text-green-500' 
                                        : 'bg-dark-200 text-gray-600 group-hover:text-gray-400'
                                    }`}
                            >
                                <Check className={`w-4 h-4 ${isWatched ? 'opacity-100' : 'opacity-0'}`} />
                            </button>

                            <div className="w-10 h-10 rounded-lg bg-dark-200 flex items-center justify-center text-sm font-bold text-gray-500">
                                {episode.number}
                            </div>

                            <div className="flex-1">
                                <p className={`font-medium ${isWatched ? 'text-gray-500 line-through' : 'text-white'}`}>
                                    {episode.title}
                                </p>
                                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                                    {episode.aired && (
                                        <span className="flex items-center gap-1">
                                            <CalendarDays className="w-3 h-3" />
                                            {episode.aired}
                                        </span>
                                    )}
                                    <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {duration} min
                                    </span>
                                    {episode.isFiller && (
                                        <span className="px-2 py-0.5 bg-yellow-500/10 text-yellow-500 rounded text-[10px]">
                                            Filler
                                        </span>
                                    )}
                                </div>
                            </div>

                            <button
                                className="p-2 rounded-lg bg-dark-200 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    // Would open video player
                                }}
                            >
                                <Play className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
