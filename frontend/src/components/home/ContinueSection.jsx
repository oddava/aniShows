import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Download } from 'lucide-react';
import useListEntryMutation from '../../hooks/useListEntryMutation';
import { userQueries } from '../../api/queries/lists';
import { airedEpisodeCount, knownEpisodeTotal } from '../../utils/episodes';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import ProgressStepper from '../ui/ProgressStepper';
import ScorePicker from '../ui/ScorePicker';
import Skeleton from '../ui/Skeleton';
import EmptyState from '../ui/EmptyState';
import { countdown, sortForContinue } from './continueModel';

/** Re-render once a minute so countdowns stay true without a refetch. */
function useMinuteClock() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

function StateLine({ state, now }) {
    if (state.kind === 'ready') {
        return (
            <p className="text-sm font-semibold text-[var(--signature)]">
                {state.behind === 1
                    ? `EP ${state.nextEpisode} is out`
                    : state.behind > 12
                        ? `Catching up · EP ${state.nextEpisode} next`
                        : `${state.behind} new episodes`}
            </p>
        );
    }
    if (state.kind === 'soon') {
        return (
            <p className="text-sm text-gray-300 tabular">
                EP {state.nextEpisode} in <span className="font-semibold text-white">{countdown(state.nextAt, now)}</span>
            </p>
        );
    }
    if (state.kind === 'finished') {
        return <p className="text-sm font-semibold text-[var(--status-completed)]">All {state.total} watched</p>;
    }
    return <p className="text-sm text-gray-400">Up to date</p>;
}

/**
 * One show in the Continue row: where you are, what's next, and +1 right
 * there. A finished show asks "Score it?" and completes in one tap.
 */
const ContinueCard = memo(function ContinueCard({ entry, state, now }) {
    const anime = entry.anime || {};
    const { entry: current, setProgress, save, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count },
        entry,
    });
    const href = `/anime/${anime.slug}`;

    return (
        <li className="flex gap-3.5 rounded-[var(--radius-lg)] bg-[var(--ink-1)] p-3 transition-colors hover:bg-[var(--ink-2)]">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="shrink-0">
                <img
                    src={getOptimizedImageUrl(anime, 'cover', 'small')}
                    onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                    alt=""
                    loading="lazy"
                    className="h-[104px] w-[70px] rounded-[var(--radius-sm)] bg-[var(--ink-3)] object-cover"
                />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
                <Link to={href} className="line-clamp-2 text-[15px] font-semibold leading-snug text-gray-100 hover:text-white">
                    {anime.title}
                </Link>
                <div className="mt-1">
                    <StateLine state={state} now={now} />
                </div>
                <div className="mt-auto pt-2">
                    {state.kind === 'finished' ? (
                        <div>
                            <p className="mb-1.5 text-xs text-gray-400">Score it and mark it completed:</p>
                            <ScorePicker
                                size="sm"
                                layout="grid"
                                allowClear={false}
                                disabled={isPending}
                                value={current.score}
                                label={`Score ${anime.title}`}
                                onChange={(score) => save({ status: 'Completed', score })}
                            />
                        </div>
                    ) : (
                        <ProgressStepper
                            size="sm"
                            value={current.episodes_watched || 0}
                            total={knownEpisodeTotal(anime)}
                            aired={airedEpisodeCount(anime)}
                            title={anime.title}
                            onCommit={(next) => setProgress(next)}
                        />
                    )}
                </div>
            </div>
        </li>
    );
});

/**
 * The top of the signed-in home (L2): every show you're watching, ready
 * ones first, with the next episode, a countdown and +1.
 */
export default function ContinueSection() {
    const now = useMinuteClock();
    const { data: watching, isPending, isError } = useQuery({
        ...userQueries.watching(),
        staleTime: 60 * 1000,
    });

    const rows = sortForContinue(watching, now);
    const readyCount = rows.filter((row) => row.state.kind === 'ready').length;

    return (
        <section aria-labelledby="continue-heading" className="px-4 md:px-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex items-end justify-between gap-4">
                    <div>
                        <h2 id="continue-heading" className="section-title">Continue</h2>
                        {!isPending && rows.length > 0 && (
                            <p className="mt-1 text-sm text-gray-400">
                                {readyCount > 0
                                    ? `${readyCount} ${readyCount === 1 ? 'show has' : 'shows have'} a new episode waiting.`
                                    : 'You’re up to date. Here’s what airs next.'}
                            </p>
                        )}
                    </div>
                    <Link to="/list" className="btn-ghost text-sm">
                        My List
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                </div>

                {isPending ? (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
                        {Array.from({ length: 3 }, (_, i) => (
                            <li key={i} className="flex gap-3.5 rounded-[var(--radius-lg)] bg-[var(--ink-1)] p-3">
                                <Skeleton className="h-[104px] w-[70px] shrink-0" />
                                <div className="flex-1">
                                    <Skeleton className="h-4 w-3/4" />
                                    <Skeleton className="mt-2 h-3.5 w-1/3" />
                                    <Skeleton className="mt-6 h-8 w-32" rounded="rounded-lg" />
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : isError || rows.length === 0 ? (
                    <EmptyState
                        compact
                        title="Nothing in progress"
                        actions={(
                            <>
                                <Link to="/browse?sort=trending" className="btn-primary text-sm">Find something to watch</Link>
                                <Link to="/import" className="btn-secondary text-sm">
                                    <Download aria-hidden="true" className="h-4 w-4" />
                                    Import your list
                                </Link>
                            </>
                        )}
                    >
                        Mark a show Watching and it lands here with its next episode and a +1 button.
                    </EmptyState>
                ) : (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {rows.map(({ entry, state }) => (
                            <ContinueCard key={entry.id} entry={entry} state={state} now={now} />
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}
