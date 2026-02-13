import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Virtualized list component for rendering large anime lists efficiently
 * Only renders items that are visible in the viewport
 * 
 * @param {Array} items - Array of anime items to render
 * @param {Function} renderRow - Function to render each row (anime) => ReactNode
 * @param {number} estimateSize - Estimated height of each row in pixels (default: 120)
 * @param {number} overscan - Number of extra items to render outside viewport (default: 5)
 */
export function VirtualizedAnimeList({ 
    items, 
    renderRow, 
    estimateSize = 120, 
    overscan = 5 
}) {
    const parentRef = useRef(null);
    
    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimateSize,
        overscan: overscan,
    });

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <div 
            ref={parentRef} 
            className="h-[calc(100vh-280px)] overflow-auto custom-scrollbar"
            style={{ minHeight: '400px' }}
        >
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {virtualItems.map((virtualItem) => (
                    <div
                        key={virtualItem.key}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: `${virtualItem.size}px`,
                            transform: `translateY(${virtualItem.start}px)`,
                        }}
                    >
                        {renderRow(items[virtualItem.index], virtualItem.index)}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default VirtualizedAnimeList;
