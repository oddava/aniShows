import { X, Users, Sparkles } from 'lucide-react';
import { useEffect, useMemo } from 'react';

// Parse markdown text into readable format with bold labels and links
function parseMarkdownText(text) {
    if (!text) return null;
    
    // First clean up HTML tags
    const cleanText = text.replace(/<[^>]*>/g, '');
    
    // Split by newlines to process each paragraph
    const paragraphs = cleanText.split(/\n+/).filter(p => p.trim());
    
    return paragraphs.map((paragraph, pIndex) => {
        // Split the paragraph by markdown patterns
        const parts = paragraph.split(/(\[.*?\]\(.*?\)|__.*?__)/g);
        
        const processedParts = parts.map((part, index) => {
            // Check for markdown links [text](url)
            const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
            if (linkMatch) {
                const [, linkText, url] = linkMatch;
                return (
                    <a
                        key={index}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline transition-colors"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {linkText}
                    </a>
                );
            }
            
            // Check for bold text __text__
            const boldMatch = part.match(/__(.+?)__/);
            if (boldMatch) {
                return (
                    <span key={index} className="font-bold text-gray-200">
                        {boldMatch[1]}
                    </span>
                );
            }
            
            // Regular text
            return <span key={index}>{part}</span>;
        });
        
        return (
            <p key={pIndex} className="mb-3 last:mb-0">
                {processedParts}
            </p>
        );
    });
}

export default function CharacterModal({ role, onClose, accentColor }) {
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [onClose]);

    const { character, voice_actor, role: characterRole } = role || {};

    const getImageUrl = (url) => {
        if (!url) return '/placeholder-avatar.png';
        return url;
    };

    // eslint-disable-next-line react-hooks/preserve-manual-memoization
    const parsedDescription = useMemo(() => {
        if (!character) return null;
        return parseMarkdownText(character.description);
    }, [character?.description]);

    if (!role) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
            <div 
                className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
                onClick={onClose}
            />
            <div 
                className="relative w-full max-w-2xl max-h-[90vh] bg-dark-100 rounded-2xl sm:rounded-3xl border border-gray-800 overflow-hidden shadow-2xl animate-modal-in flex flex-col"
                style={{ boxShadow: `0 0 50px -10px ${accentColor || '#8b5cf6'}30` }}
            >
                {/* Header */}
                <div className="relative h-16 sm:h-20 flex items-center justify-end px-4 sm:px-6 border-b border-white/5 flex-shrink-0"
                    style={{
                        background: accentColor 
                            ? `linear-gradient(135deg, ${accentColor}20 0%, transparent 100%)`
                            : 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, transparent 100%)'
                    }}
                >
                    <button
                        onClick={onClose}
                        className="p-2 bg-dark-200/80 hover:bg-dark-200 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-white" />
                    </button>
                </div>

                {/* Content */}
                <div className="px-4 sm:px-8 pb-6 sm:pb-8 overflow-y-auto">
                    {/* Mobile: Stacked layout, Desktop: Side by side */}
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                        {/* Character Image */}
                        <div className="flex-shrink-0 mx-auto sm:mx-0">
                            <div 
                                className="w-28 h-40 sm:w-32 sm:h-44 rounded-xl sm:rounded-2xl overflow-hidden border-2 sm:border-4 border-dark-100 shadow-xl"
                                style={{ borderColor: accentColor ? `${accentColor}40` : undefined }}
                            >
                                <img
                                    src={getImageUrl(character.image)}
                                    alt={character.name}
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <span
                                className="inline-block mt-2 sm:mt-3 px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-full text-center w-full"
                                style={{ 
                                    backgroundColor: accentColor ? `${accentColor}20` : 'rgba(139,92,246,0.2)',
                                    color: accentColor || '#8b5cf6'
                                }}
                            >
                                {characterRole}
                            </span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 sm:pt-4">
                            <h2 className="text-xl sm:text-2xl font-black text-white mb-1 text-center sm:text-left">
                                {character.name}
                            </h2>
                            {character.name_native && (
                                <p className="text-gray-400 text-sm mb-3 sm:mb-4 text-center sm:text-left">
                                    {character.name_native}
                                </p>
                            )}
                            
                            {/* Description */}
                            {character.description && (
                                <div className="mb-4 sm:mb-6">
                                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                        About
                                    </h3>
                                    <div className="text-gray-300 text-sm leading-relaxed">
                                        {parsedDescription}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Voice Actor Section */}
                    {voice_actor && (
                        <div className="mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-white/10">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 sm:mb-4 flex items-center gap-2">
                                <Users className="w-3 h-3" />
                                Voice Actor (Japanese)
                            </h3>
                            <div className="flex items-center gap-3 sm:gap-4">
                                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg sm:rounded-xl overflow-hidden border-2 border-gray-700 flex-shrink-0">
                                    <img
                                        src={getImageUrl(voice_actor.image)}
                                        alt={voice_actor.name}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-white text-sm sm:text-base truncate">
                                        {voice_actor.name}
                                    </p>
                                    {voice_actor.name_native && (
                                        <p className="text-gray-400 text-xs sm:text-sm truncate">
                                            {voice_actor.name_native}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
