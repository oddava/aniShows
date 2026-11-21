import { Link } from 'react-router-dom';
import Portrait from '../ui/Portrait';
import { RoleListSkeleton } from './RoleRows';

/**
 * The head of a character or staff page: portrait, name as the page title,
 * one muted line (native name, appearances), the favourite button and the
 * description. On wide screens the description sits beside the portrait; on
 * phones it runs full width under it.
 */
export default function PersonHeader({ image, name, nativeName, appearanceCount = 0, action, aside, children }) {
    const appearances = appearanceCount > 0
        ? `${appearanceCount} ${appearanceCount === 1 ? 'appearance' : 'appearances'}`
        : null;

    return (
        <header className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-5 gap-y-6 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-8">
            <div className="sm:row-span-2">
                <Portrait
                    src={image}
                    alt={name}
                    sizes="176px"
                    loading="eager"
                    className="h-40 w-28 rounded-[var(--radius-md)] sm:h-60 sm:w-44"
                />
                {aside}
            </div>

            <div className="min-w-0 self-start sm:pt-1">
                <h1 className="page-title break-words">{name}</h1>
                {(nativeName || appearances) && (
                    <p className="mt-2 text-sm text-[var(--text-2)] tabular">
                        {nativeName && <span className="break-words">{nativeName}</span>}
                        {nativeName && appearances && <span aria-hidden="true"> · </span>}
                        {appearances && <span>{appearances}</span>}
                    </p>
                )}
                {action && <div className="mt-4">{action}</div>}
            </div>

            {children && (
                <div className="col-span-2 max-w-3xl text-[15px] leading-relaxed text-[var(--text-2)] sm:col-span-1 sm:col-start-2">
                    {children}
                </div>
            )}
        </header>
    );
}

/**
 * "Back" above the head, on wide screens only: phones already have the
 * top bar's back button.
 */
export function BackButton() {
    return (
        <button
            type="button"
            onClick={() => window.history.back()}
            className="btn-ghost -ml-3 mb-4 hidden text-sm text-[var(--text-2)] md:inline-flex"
        >
            Back
        </button>
    );
}

/** A missing character or staff member: one sentence and a way home. */
export function PersonNotFound({ what }) {
    return (
        <div className="page-container pt-6 pb-16 md:pt-10">
            <h1 className="page-title">Not found</h1>
            <p className="mt-2 text-sm text-[var(--text-2)]">We couldn&apos;t find that {what}.</p>
            <Link to="/" className="text-link mt-2 text-sm">Go home</Link>
        </div>
    );
}

/** Loading state in the same geometry as the page. */
export function PersonPageSkeleton() {
    return (
        <div className="page-container animate-pulse pt-6 pb-16 md:pt-10" aria-hidden="true">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-8">
                <div className="h-40 w-28 rounded-[var(--radius-md)] bg-white/[0.05] sm:h-60 sm:w-44" />
                <div className="space-y-3 sm:pt-1">
                    <div className="h-8 w-full max-w-[18rem] rounded bg-white/[0.05] sm:h-11" />
                    <div className="h-4 w-32 rounded bg-white/[0.05]" />
                    <div className="mt-4 h-11 w-20 rounded-lg bg-white/[0.05]" />
                </div>
            </div>
            <div className="mt-12 mb-4 h-6 w-40 rounded bg-white/[0.05]" />
            <RoleListSkeleton />
        </div>
    );
}
