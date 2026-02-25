import { useRef } from 'react';
import { Link } from 'react-router-dom';

export default function HorizontalCarousel({ 
    items, 
    renderItem,
    emptyMessage = "Nothing here yet",
    showViewAll = false,
    viewAllLink = "#",
    viewAllText = "View All",
    className = ""
}) {
    const scrollRef = useRef(null);

    const scroll = (direction) => {
        if (scrollRef.current) {
            const scrollAmount = 300;
            scrollRef.current.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            });
        }
    };

    if (!items || items.length === 0) {
        return (
            <div className={`text-center py-8 text-gray-500 text-sm ${className}`}>
                {emptyMessage}
            </div>
        );
    }

    return (
        <div className={`relative group ${className}`}>
            {/* Scroll Buttons */}
            <button
                onClick={() => scroll('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-dark-100 border border-gray-800 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:border-accent"
                aria-label="Scroll left"
            >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            <button
                onClick={() => scroll('right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-dark-100 border border-gray-800 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:border-accent"
                aria-label="Scroll right"
            >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
            </button>

            {/* Carousel Container */}
            <div 
                ref={scrollRef}
                className="flex gap-4 overflow-x-auto scrollbar-hide pb-2"
                style={{ scrollSnapType: 'x mandatory' }}
            >
                {items.map((item, index) => (
                    <div 
                        key={item.id || index}
                        style={{ scrollSnapAlign: 'start' }}
                        className="flex-shrink-0"
                    >
                        {renderItem(item)}
                    </div>
                ))}
                
                {showViewAll && (
                    <div 
                        style={{ scrollSnapAlign: 'start' }}
                        className="flex-shrink-0"
                    >
                        <Link
                            to={viewAllLink}
                            className="w-32 h-full min-h-[180px] bg-dark-100 border border-gray-800 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-accent transition-colors"
                        >
                            <span className="text-xs text-gray-400">{viewAllText}</span>
                            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}