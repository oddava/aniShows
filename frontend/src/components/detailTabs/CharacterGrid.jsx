import { memo, useEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Loader } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getPortraitSrcSet, getPortraitUrl } from './portraits';

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

const PortraitImage = memo(function PortraitImage({ entity, alt, className }) {
    return (
        <img
            src={getPortraitUrl(entity)}
            srcSet={getPortraitSrcSet(entity)}
            sizes="64px"
            alt={alt}
            loading="lazy"
            decoding="async"
            className={className}
        />
    );
});

const CharacterRoleCard = memo(function CharacterRoleCard({ role }) {
    return (
        <div className="flex h-16 sm:h-[72px] bg-dark-200/40 rounded-xl overflow-hidden border border-white/5">
            <Link to={`/character/${role.character.id}`} className="w-14 sm:w-16 flex-shrink-0">
                <PortraitImage
                    entity={role.character}
                    alt={role.character.name}
                    className="w-full h-full object-cover saturate-[0.85]"
                />
            </Link>

            <div className="flex-1 grid grid-cols-2 gap-2 p-2 sm:px-3 sm:py-2 min-w-0">
                <div className="flex flex-col justify-center min-w-0">
                    <Link to={`/character/${role.character.id}`} className="text-[13px] font-medium text-gray-300 hover:text-accent transition-colors break-words line-clamp-2">
                        {role.character.name}
                    </Link>
                    <span className="text-[11px] text-gray-500 mt-0.5 uppercase">
                        {role.role}
                    </span>
                </div>

                <div className="flex flex-col justify-center text-right min-w-0">
                    {role.voice_actor ? (
                        <Link to={`/staff/${role.voice_actor.id}`} className="text-[13px] font-medium text-gray-300 hover:text-accent transition-colors break-words line-clamp-2">
                            {role.voice_actor.name}
                        </Link>
                    ) : (
                        <span className="text-[13px] font-medium text-gray-600">N/A</span>
                    )}
                    <span className="text-[11px] text-gray-500 mt-0.5">
                        Japanese
                    </span>
                </div>
            </div>

            {role.voice_actor && (
                <Link to={`/staff/${role.voice_actor.id}`} className="w-14 sm:w-16 flex-shrink-0 border-l border-white/5">
                    <PortraitImage
                        entity={role.voice_actor}
                        alt={role.voice_actor.name}
                        className="w-full h-full object-cover saturate-[0.85]"
                    />
                </Link>
            )}
        </div>
    );
});

export function CharacterGrid({ characters }) {
    if (characters.length < CHARACTER_VIRTUALIZE_THRESHOLD) {
        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 animate-tab-content">
                {characters.map((role) => (
                    <CharacterRoleCard key={role.id} role={role} />
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
        <div className="flex justify-center pt-2">
            <button
                type="button"
                onClick={onLoadMore}
                disabled={isFetchingNextPage}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-dark-100 px-5 py-2.5 text-sm font-bold text-gray-200 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
                {isFetchingNextPage && <Loader className="h-4 w-4 animate-spin" />}
                {isFetchingNextPage ? 'Loading...' : label}
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
                        className={`absolute left-0 top-0 grid w-full gap-3 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
                        style={{
                            height: `${CHARACTER_GRID_ROW_ESTIMATE - 12}px`,
                            transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                        }}
                    >
                        {rowItems.map((role) => (
                            <CharacterRoleCard key={role.id} role={role} />
                        ))}
                    </div>
                );
            })}
        </div>
    );
}
