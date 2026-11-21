import { memo, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import useListEntryMutation from '../../hooks/useListEntryMutation';
import { airedEpisodeCount, knownEpisodeTotal } from '../../utils/episodes';
import { formatTimeAgo } from '../../utils/dateUtils';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import QuickAdd from '../ui/QuickAdd';
import ProgressStepper from '../ui/ProgressStepper';
import ScorePicker from '../ui/ScorePicker';

/** The score cell: "★ 9" (or "Rate"), opening a one-tap 1–10 row in place (T4). */
function ScoreCell({ score, title, onChange, disabled }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
            if (!ref.current?.contains(event.target)) setOpen(false);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-label={score ? `Your score for ${title}: ${score}. Change` : `Score ${title}`}
                className="flex h-11 min-w-16 items-center justify-center gap-1 rounded-[var(--radius-sm)] px-2 text-sm font-semibold tabular hover:bg-white/[0.06]"
            >
                {score ? (
                    <>
                        <Star aria-hidden="true" className="h-3.5 w-3.5 fill-[var(--status-on-hold)] text-[var(--status-on-hold)]" />
                        <span className="text-white">{score}</span>
                    </>
                ) : (
                    <span className="text-gray-500 font-medium">Rate</span>
                )}
            </button>
            {open && (
                <div className="popover-in absolute right-0 top-full z-30 mt-1 w-[19rem] rounded-[var(--radius-md)] bg-[var(--ink-3)] p-2 shadow-[var(--shadow-pop)]">
                    <ScorePicker
                        value={score}
                        size="sm"
                        disabled={disabled}
                        label={`Score ${title}`}
                        onChange={(value) => {
                            onChange(value);
                            setOpen(false);
                        }}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * One row of the dense library table (T2): poster, title, progress stepper,
 * score, status, last update, all editable in place.
 */
function LibraryRow({ entry: listEntry, titleLanguage = 'en' }) {
    const anime = listEntry.anime || {};
    const { entry, setStatus, setScore, setProgress, remove, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count },
        entry: listEntry,
    });
    const title = titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title;
    const href = `/anime/${anime.slug}`;

    return (
        <li className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-white/[0.05] py-2.5 last:border-b-0 sm:grid-cols-[2.75rem_minmax(0,1fr)_11rem_4.5rem_9rem_6.5rem] sm:gap-x-4">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="row-span-2 sm:row-span-1">
                <img
                    src={getOptimizedImageUrl(anime, 'cover', 'small')}
                    onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                    alt=""
                    loading="lazy"
                    className="h-16 w-11 rounded-[var(--radius-sm)] bg-[var(--ink-3)] object-cover"
                />
            </Link>
            <div className="min-w-0">
                <Link to={href} className="line-clamp-2 text-sm font-medium text-gray-100 hover:text-white">{title}</Link>
                <p className="mt-0.5 text-xs text-gray-500 tabular sm:hidden">
                    {anime.anime_type}{entry.status === 'Watching' ? '' : ` · ${entry.episodes_watched || 0} eps`}
                </p>
            </div>

            <div className="col-start-2 row-start-2 sm:col-start-auto sm:row-start-auto">
                {entry.status !== 'Plan to Watch' ? (
                    <ProgressStepper
                        size="sm"
                        value={entry.episodes_watched || 0}
                        total={knownEpisodeTotal(anime)}
                        aired={airedEpisodeCount(anime)}
                        title={title}
                        onCommit={(next) => setProgress(next)}
                    />
                ) : (
                    <span className="text-xs text-gray-500">Not started</span>
                )}
            </div>

            <div className="col-start-3 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto sm:justify-self-start">
                <ScoreCell score={entry.score} title={title} disabled={isPending} onChange={(value) => setScore(value)} />
            </div>

            <div className="col-start-3 row-start-2 justify-self-end sm:col-start-auto sm:row-start-auto sm:justify-self-stretch">
                <QuickAdd
                    variant="button"
                    placement="down"
                    className="relative w-11 sm:w-full [&>button]:px-2.5 [&>button>span:nth-child(2)]:hidden sm:[&>button>span:nth-child(2)]:inline [&>button>svg:last-child]:hidden sm:[&>button>svg:last-child]:block"
                    status={entry.status}
                    score={entry.score}
                    title={title}
                    pending={isPending}
                    onSelect={(value) => setStatus(value)}
                    onScore={(value) => setScore(value)}
                    onRemove={() => remove()}
                />
            </div>

            <span className="hidden text-xs text-gray-500 tabular sm:block">
                {formatTimeAgo(listEntry.updated_at)}
            </span>
        </li>
    );
}

export default memo(LibraryRow);
