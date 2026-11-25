import { useMemo, useState } from 'react';
import MusicSection from './MusicSection';
import { getUniqueCharacterRoles } from '../utils/characterRoles';
import { CharacterGrid, RelationLoadMoreButton } from './detailTabs/CharacterGrid';
import { StaffRow } from './detailTabs/PeopleRows';
import { orderCast } from './detailTabs/format';
import Skeleton from './ui/Skeleton';
import './common/contentFade.css';

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

/**
 * Placeholder rows with the geometry of CharacterRow / StaffRow (60 px
 * portrait, name and meta line) under the count line. It fades in only after
 * 300 ms, so a quick load goes straight from nothing to the list.
 */
function PeopleSkeleton({ label, rows, gridClassName }) {
    return (
        <div role="status" className="delayed-show min-w-0 space-y-3 sm:space-y-4">
            <span className="sr-only">{label}</span>
            <div aria-hidden="true" className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-28" />
            </div>
            <div aria-hidden="true" className={`grid grid-cols-1 gap-x-10 sm:grid-cols-2 ${gridClassName}`}>
                {Array.from({ length: rows }, (_, i) => (
                    <div key={i} className="flex h-[60px] items-center gap-3">
                        <Skeleton className="h-[60px] w-10 shrink-0" rounded="rounded-[var(--radius-sm)]" />
                        <div className="min-w-0 flex-1">
                            <Skeleton className="h-4 w-3/5" />
                            <Skeleton className="mt-2 h-3.5 w-2/5" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
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
    // Content that replaces the skeleton fades in; content that was already
    // cached is simply there (the tab switch has its own fade).
    const [arrivesLater] = useState(Boolean(isLoading));
    const fade = arrivesLater ? 'content-fade' : '';

    if (isLoading) {
        return <PeopleSkeleton label="Loading characters" rows={8} gridClassName="gap-y-5" />;
    }

    if (uniqueCharacters.length === 0) {
        return <EmptyLine>No characters listed for this one yet.</EmptyLine>;
    }

    return (
        <div className={`${fade} min-w-0 space-y-3 sm:space-y-4`}>
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
    const [arrivesLater] = useState(Boolean(isLoading));
    const fade = arrivesLater ? 'content-fade' : '';

    if (isLoading) {
        return <PeopleSkeleton label="Loading staff" rows={9} gridClassName="gap-y-6 xl:grid-cols-3" />;
    }

    if (!uniqueStaff || uniqueStaff.length === 0) {
        return <EmptyLine>No staff listed for this one yet.</EmptyLine>;
    }

    return (
        <div className={`${fade} min-w-0 space-y-3 sm:space-y-4`}>
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
