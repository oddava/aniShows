import { useMemo } from 'react';
import { Loader } from 'lucide-react';
import MusicSection from './MusicSection';
import { getUniqueCharacterRoles } from '../utils/characterRoles';
import { CharacterGrid, RelationLoadMoreButton } from './detailTabs/CharacterGrid';
import { StaffRow } from './detailTabs/PeopleRows';
import { orderCast } from './detailTabs/format';

function EmptyLine({ children }) {
    return <p className="animate-tab-content py-10 text-[15px] text-[var(--text-2)]">{children}</p>;
}

function LoadedLine({ loaded, total, noun }) {
    if (loaded >= total) {
        return <p className="text-sm text-[var(--text-3)] tabular">{total} {noun}</p>;
    }
    return (
        <p className="text-sm text-[var(--text-3)] tabular">
            Showing {loaded} of {total} {noun}
        </p>
    );
}

// The Overview tab lives in its own file; it is re-exported so the anime page
// keeps importing every tab from here.
export { default as OverviewTab } from './detailTabs/OverviewTab';

export function ThemesTab({ anime, accentColor }) {
    const hasThemes = anime?.theme_songs?.length > 0;

    if (!hasThemes) {
        return <EmptyLine>No theme songs listed for this one yet.</EmptyLine>;
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
        return orderCast(getUniqueCharacterRoles(sourceCharacters));
    }, [sourceCharacters]);
    const resolvedCount = Number.isFinite(totalCount) && totalCount >= 0
        ? totalCount
        : uniqueCharacters.length;

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-24">
                <Loader className="w-8 h-8 text-[var(--text-3)] animate-spin" aria-label="Loading" />
            </div>
        );
    }

    if (uniqueCharacters.length === 0) {
        return <EmptyLine>No characters listed for this one yet.</EmptyLine>;
    }

    return (
        <div className="animate-tab-content min-w-0 space-y-3 sm:space-y-4">
            <LoadedLine loaded={uniqueCharacters.length} total={resolvedCount} noun="characters" />

            <CharacterGrid characters={uniqueCharacters} />

            <RelationLoadMoreButton
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={onLoadMore}
                label="Load more characters"
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
                <Loader className="w-8 h-8 text-[var(--text-3)] animate-spin" aria-label="Loading" />
            </div>
        );
    }

    if (!uniqueStaff || uniqueStaff.length === 0) {
        return <EmptyLine>No staff listed for this one yet.</EmptyLine>;
    }

    return (
        <div className="animate-tab-content min-w-0 space-y-3 sm:space-y-4">
            <LoadedLine loaded={uniqueStaff.length} total={resolvedCount} noun="staff credits" />

            <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
                {uniqueStaff.map((staffRole) => (
                    <StaffRow key={staffRole.id} staffRole={staffRole} />
                ))}
            </div>

            <RelationLoadMoreButton
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={onLoadMore}
                label="Load more staff"
            />
        </div>
    );
}
