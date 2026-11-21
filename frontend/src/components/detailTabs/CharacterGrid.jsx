import { useEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Loader } from 'lucide-react';
import { CharacterRow } from './PeopleRows';

const CHARACTER_VIRTUALIZE_THRESHOLD = 80;
const CHARACTER_GRID_ROW_ESTIMATE = 84;
const CHARACTER_GRID_OVERSCAN = 6;
const CHARACTER_GRID_BREAKPOINTS = [
    { query: '(min-width: 1024px)', columns: 2 },
];

const getResponsiveColumns = (defaultColumns, breakpoints) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return defaultColumns;
    }

    for (const breakpoint of breakpoints) {
        if (window.matchMedia(breakpoint.query).matches) {
            return breakpoint.columns;
        }
    }

    return defaultColumns;
};

function useResponsiveColumns(defaultColumns, breakpoints) {
    const [columns, setColumns] = useState(() => getResponsiveColumns(defaultColumns, breakpoints));

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQueries = breakpoints.map((breakpoint) => window.matchMedia(breakpoint.query));
        const handleChange = () => setColumns(getResponsiveColumns(defaultColumns, breakpoints));

        handleChange();
        mediaQueries.forEach((query) => {
            if (typeof query.addEventListener === 'function') {
                query.addEventListener('change', handleChange);
            } else {
                query.addListener(handleChange);
            }
        });

        return () => {
            mediaQueries.forEach((query) => {
                if (typeof query.removeEventListener === 'function') {
                    query.removeEventListener('change', handleChange);
                } else {
                    query.removeListener(handleChange);
                }
            });
        };
    }, [breakpoints, defaultColumns]);

    return columns;
}

function useElementOffsetTop(ref, itemCount, columns) {
    const [offsetTop, setOffsetTop] = useState(0);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const updateOffset = () => {
            setOffsetTop(ref.current?.offsetTop || 0);
        };

        updateOffset();
        window.addEventListener('resize', updateOffset);
        window.addEventListener('load', updateOffset);

        return () => {
            window.removeEventListener('resize', updateOffset);
            window.removeEventListener('load', updateOffset);
        };
    }, [ref, itemCount, columns]);

    return offsetTop;
}

export function CharacterGrid({ characters }) {
    if (characters.length < CHARACTER_VIRTUALIZE_THRESHOLD) {
        return (
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2 animate-tab-content">
                {characters.map((role) => (
                    <CharacterRow key={role.id} role={role} />
                ))}
            </div>
        );
    }

    return <VirtualizedCharacterGrid characters={characters} />;
}

export function RelationLoadMoreButton({ hasNextPage, isFetchingNextPage, onLoadMore, label }) {
    if (!hasNextPage) {
        return null;
    }

    return (
        <div className="flex justify-center pt-4">
            <button
                type="button"
                onClick={onLoadMore}
                disabled={isFetchingNextPage}
                className="btn-secondary min-h-11 gap-2 text-[15px] disabled:cursor-not-allowed disabled:opacity-60"
            >
                {isFetchingNextPage && <Loader className="h-4 w-4 animate-spin" />}
                {isFetchingNextPage ? 'Loading…' : label}
            </button>
        </div>
    );
}

function VirtualizedCharacterGrid({ characters }) {
    const containerRef = useRef(null);
    const columns = useResponsiveColumns(1, CHARACTER_GRID_BREAKPOINTS);
    const rowCount = Math.ceil(characters.length / columns);
    const scrollMargin = useElementOffsetTop(containerRef, characters.length, columns);
    const rowVirtualizer = useWindowVirtualizer({
        count: rowCount,
        estimateSize: () => CHARACTER_GRID_ROW_ESTIMATE,
        overscan: CHARACTER_GRID_OVERSCAN,
        scrollMargin,
    });

    return (
        <div
            ref={containerRef}
            className="relative animate-tab-content"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const startIndex = virtualRow.index * columns;
                const rowItems = characters.slice(startIndex, startIndex + columns);

                return (
                    <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        className={`absolute left-0 top-0 grid w-full content-start gap-x-10 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
                        style={{
                            height: `${CHARACTER_GRID_ROW_ESTIMATE}px`,
                            transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                        }}
                    >
                        {rowItems.map((role) => (
                            <CharacterRow key={role.id} role={role} />
                        ))}
                    </div>
                );
            })}
        </div>
    );
}
