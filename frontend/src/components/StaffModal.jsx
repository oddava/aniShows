import { X, Briefcase, Sparkles, Film, ArrowRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

// Parse markdown-style links [text](url) into React elements
function parseMarkdownLinks(text) {
    if (!text) return null;

    // Split by markdown link pattern
    const parts = text.split(/(\[.*?\]\(.*?\))/g);

    return parts.map((part, index) => {
        const match = part.match(/\[(.*?)\]\((.*?)\)/);
        if (match) {
            const [, linkText, url] = match;
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
        // Clean up HTML tags but preserve text
        return <span key={index}>{part.replace(/<[^>]*>/g, '')}</span>;
    });
}

export default function StaffModal({ staffRole, onClose, accentColor }) {
    const { staff, role } = staffRole || {};

    const getImageUrl = (url) => {
        if (!url) return '/placeholder-avatar.png';
        return url;
    };

    // eslint-disable-next-line react-hooks/preserve-manual-memoization
    const parsedDescription = useMemo(() => {
        if (!staff) return null;
        return parseMarkdownLinks(staff.description);
    }, [staff?.description]);

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

    if (!staffRole) return null;

    return createPortal(
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4">
            <div
                className="absolute inset-0 bg-black/80"
                onClick={onClose}
            />
            <div
                className="relative w-full max-w-xl max-h-[85vh] sm:max-h-[90vh] bg-dark-100 rounded-2xl sm:rounded-3xl border border-gray-800 overflow-hidden shadow-2xl flex flex-col"
            >
                {/* Header */}
                <div className="relative h-16 sm:h-20 flex items-center justify-end px-4 sm:px-6 border-b border-white/5 flex-shrink-0"
                    style={{
                        backgroundColor: accentColor ? `${accentColor}20` : 'rgba(117,105,141,0.15)'
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
                    <div className="flex flex-col items-center text-center">
                        {/* Staff Image - positioned at top, not using negative margin */}
                        <div
                            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-2 sm:border-4 border-dark-100 shadow-xl mb-4 sm:mb-5 flex-shrink-0"
                            style={{ borderColor: accentColor ? `${accentColor}40` : undefined }}
                        >
                            <img
                                src={getImageUrl(staff.image)}
                                alt={staff.name}
                                className="w-full h-full object-cover"
                            />
                        </div>

                        {/* Info */}
                        <h2 className="text-xl sm:text-2xl font-black text-white mb-1">
                            {staff.name}
                        </h2>
                        {staff.name_native && (
                            <p className="text-gray-400 text-sm mb-2">{staff.name_native}</p>
                        )}

                        <span
                            className="inline-block px-3 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm font-bold rounded-full"
                            style={{
                                backgroundColor: accentColor ? `${accentColor}20` : 'rgba(117,105,141,0.2)',
                                color: accentColor || '#75698d'
                            }}
                        >
                            <Briefcase className="w-3 h-3 sm:w-3.5 sm:h-3.5 inline mr-1" />
                            {role}
                        </span>

                        {/* Description */}
                        {staff.description && (
                            <div className="mt-4 sm:mt-6 text-left w-full">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-2">
                                    <Sparkles className="w-3 h-3" />
                                    About
                                </h3>
                                <div className="text-gray-300 text-sm leading-relaxed">
                                    {parsedDescription}
                                </div>
                            </div>
                        )}

                        {/* Other Works Section */}
                        <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-white/10 w-full">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-2">
                                <Film className="w-3 h-3" />
                                Other Works
                            </h3>
                            <Link
                                to={`/staff/${staff.id}`}
                                onClick={onClose}
                                className="group flex w-full items-center justify-between rounded-xl border border-white/5 bg-dark-200/60 px-4 py-3 transition-colors hover:border-gray-600 hover:bg-dark-200"
                            >
                                <span className="text-gray-300 text-sm group-hover:text-white transition-colors">
                                    View {staff.name}'s full profile
                                </span>
                                <ArrowRight className="w-4 h-4 text-gray-500 transition-colors group-hover:text-accent" />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
