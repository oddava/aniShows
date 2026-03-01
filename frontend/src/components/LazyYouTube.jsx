import { useState, useCallback, memo } from 'react';
import { Play } from 'lucide-react';

/**
 * Minimal YouTube player with custom theme-matching design
 * Shows thumbnail with elegant play button, loads iframe only on click
 */
const LazyYouTube = memo(function LazyYouTube({ videoId, title = 'Trailer', accentColor }) {
    const [isPlaying, setIsPlaying] = useState(false);

    const handlePlay = useCallback(() => {
        setIsPlaying(true);
    }, []);

    const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    const fallbackThumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    return (
        <div className="relative rounded-2xl overflow-hidden border border-gray-800/50 aspect-video bg-dark-200">
            {!isPlaying ? (
                <>
                    {/* Thumbnail */}
                    <img
                        src={thumbnailUrl}
                        alt={title}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                            e.target.src = fallbackThumbnailUrl;
                        }}
                    />
                    
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-dark/60 via-transparent to-dark/20" />
                    
                    {/* Minimal Play Button */}
                    <button
                        onClick={handlePlay}
                        className="absolute inset-0 flex items-center justify-center cursor-pointer"
                        aria-label={`Play ${title}`}
                    >
                        <div 
                            className="flex items-center justify-center w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm border border-white/20"
                            style={{
                                backgroundColor: accentColor ? `${accentColor}30` : undefined
                            }}
                        >
                            <Play 
                                className="w-7 h-7 text-white fill-white ml-0.5"
                            />
                        </div>
                    </button>
                    
                    {/* Video title */}
                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-dark to-transparent">
                        <p className="text-white/80 text-sm font-medium truncate">
                            {title}
                        </p>
                    </div>
                </>
            ) : (
                <iframe
                    src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
                    title={title}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full"
                />
            )}
        </div>
    );
});

export default LazyYouTube;
