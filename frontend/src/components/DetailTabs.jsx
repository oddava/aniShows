import { useMemo } from 'react';
import { Users, Mic, Loader, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import MusicSection from './MusicSection';
import { getUniqueCharacterRoles } from '../utils/characterRoles';
import { getPortraitSrcSet, getPortraitUrl } from './detailTabs/portraits';
import { CharacterGrid, RelationLoadMoreButton } from './detailTabs/CharacterGrid';

// The Overview tab lives in its own file; it is re-exported so the anime page
// keeps importing every tab from here.
export { default as OverviewTab } from './detailTabs/OverviewTab';

export function ThemesTab({ anime, accentColor }) {
    const hasThemes = anime?.theme_songs?.length > 0;

    if (!hasThemes) {
        return (
            <div className="text-center py-12 animate-tab-content">
                <Search className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No theme songs available.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content">
            <MusicSection anime={anime} accentColor={accentColor} isCompact={false} />
        </div>
    );
}

export function CharactersTab({
    anime,
    characters: charactersProp,
    isLoading,
    totalCount,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
}) {
    const sourceCharacters = charactersProp || anime?.characters;
    const uniqueCharacters = useMemo(() => {
        return getUniqueCharacterRoles(sourceCharacters);
    }, [sourceCharacters]);
    const resolvedCount = Number.isFinite(totalCount) && totalCount >= 0
        ? totalCount
        : uniqueCharacters.length;

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-24">
                <Loader className="w-10 h-10 text-accent animate-spin" />
            </div>
        );
    }

    if (uniqueCharacters.length === 0) {
        return (
            <div className="text-center py-12 animate-tab-content">
                <Users className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No character information available.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content min-w-0 space-y-3 sm:space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 rounded-xl border border-white/5 bg-dark-200/30 px-3 py-2.5 sm:px-4 sm:py-3 text-[11px] sm:text-xs text-gray-400">
                <div>
                    Loaded <span className="font-bold text-gray-300">{uniqueCharacters.length}</span> of <span className="font-bold text-gray-300">{resolvedCount}</span> characters
                </div>
            </div>

            <CharacterGrid characters={uniqueCharacters} />

            <RelationLoadMoreButton
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={onLoadMore}
                label="Load More Characters"
            />
        </div>
    );
}

export function StaffTab({
    anime,
    staff: staffProp,
    isLoading,
    totalCount,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
}) {
    const sourceStaff = staffProp || anime?.staff;
    const uniqueStaff = useMemo(() => {
        if (!Array.isArray(sourceStaff)) return [];
        const seen = new Set();
        return sourceStaff.filter((staffRole) => {
            const staffName = staffRole?.staff?.name;
            if (!staffName) return false;
            const roleName = staffRole?.role || 'unknown';
            const dedupeKey = `${staffName}:${roleName}`;
            if (seen.has(dedupeKey)) return false;
            seen.add(dedupeKey);
            return true;
        });
    }, [sourceStaff]);
    const resolvedCount = Number.isFinite(totalCount) && totalCount >= 0
        ? totalCount
        : uniqueStaff.length;

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-24">
                <Loader className="w-10 h-10 text-accent animate-spin" />
            </div>
        );
    }

    if (!uniqueStaff || uniqueStaff.length === 0) {
        return (
            <div className="text-center py-16 animate-tab-content">
                <Mic className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">No staff information available.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content min-w-0 space-y-3 sm:space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 rounded-xl border border-white/5 bg-dark-200/30 px-3 py-2.5 sm:px-4 sm:py-3 text-[11px] sm:text-xs text-gray-400">
                <div>
                    Loaded <span className="font-bold text-gray-300">{uniqueStaff.length}</span> of <span className="font-bold text-gray-300">{resolvedCount}</span> staff credits
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {uniqueStaff.map((staffRole) => (
                    <Link
                        key={staffRole.id}
                        to={staffRole.staff?.id ? `/staff/${staffRole.staff.id}` : '#'}
                        className="flex items-center gap-4 bg-dark-200/40 rounded-xl overflow-hidden border border-white/5 hover:border-gray-700 transition-colors"
                    >
                        <div className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0">
                            <img
                                src={getPortraitUrl(staffRole.staff)}
                                srcSet={getPortraitSrcSet(staffRole.staff)}
                                sizes="96px"
                                alt={staffRole.staff.name}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover saturate-[0.85]"
                            />
                        </div>
                        <div className="flex flex-col min-w-0 pr-4">
                            <h4 className="font-medium text-gray-300 text-[13px] truncate">
                                <span className="transition-colors hover:text-accent">{staffRole.staff.name}</span>
                            </h4>
                            <p className="text-[11px] text-gray-500 mt-1 truncate">{staffRole.role}</p>
                        </div>
                    </Link>
                ))}
            </div>

            <RelationLoadMoreButton
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={onLoadMore}
                label="Load More Staff"
            />
        </div>
    );
}
