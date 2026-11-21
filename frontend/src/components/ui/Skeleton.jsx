/**
 * A placeholder block shaped like the content it stands in for. The pulse is
 * quiet and stops under reduced motion (animations.css).
 */
export default function Skeleton({ className = '', rounded = 'rounded-md', style }) {
    return <div aria-hidden="true" className={`skeleton-shimmer ${rounded} ${className}`} style={style} />;
}

/** A poster card placeholder with the same geometry as AnimeCard. */
export function CardSkeleton({ meta = true }) {
    return (
        <div aria-hidden="true" className="flex flex-col">
            <Skeleton className="aspect-[2/3] w-full" rounded="rounded-[var(--radius-md)]" />
            <Skeleton className="mt-3 h-3.5 w-[85%]" />
            {meta && <Skeleton className="mt-2 h-3 w-1/2" />}
        </div>
    );
}

/** A list/table row placeholder: thumb, two lines, a trailing control. */
export function RowSkeleton() {
    return (
        <div aria-hidden="true" className="flex items-center gap-3 py-3">
            <Skeleton className="h-16 w-11 shrink-0" />
            <div className="flex-1 min-w-0">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
            <Skeleton className="h-9 w-28 shrink-0" rounded="rounded-lg" />
        </div>
    );
}
