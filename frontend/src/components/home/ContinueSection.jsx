import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import useListEntryMutation from '../../hooks/useListEntryMutation';
import { listQueries, userQueries } from '../../api/queries/lists';
import { airedEpisodeCount, knownEpisodeTotal } from '../../utils/episodes';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import ProgressStepper from '../ui/ProgressStepper';
import ScorePicker from '../ui/ScorePicker';
import Skeleton from '../ui/Skeleton';
import { continueState, countdown, sortForContinue } from './continueModel';

/** Re-render once a minute so countdowns stay true without a refetch. */
function useMinuteClock() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

function stateText(state, now) {
    if (state.kind === 'ready') {
        if (state.behind === 1) return { text: `Episode ${state.nextEpisode} is out`, accent: true };
        if (state.behind > 12) return { text: `Catching up, episode ${state.nextEpisode} next`, accent: true };
        return { text: `${state.behind} new episodes`, accent: true };
    }
    if (state.kind === 'soon') return { text: `Episode ${state.nextEpisode} in ${countdown(state.nextAt, now)}` };
    if (state.kind === 'finished') return { text: `All ${state.total} watched. Score it?` };
    return { text: 'Up to date' };
}

/**
 * One show, set like a row on oddava.me: title and what's next on the left,
 * the episode stepper on the right. A finished show asks for a score and
 * completes in one tap.
 */
const ContinueRow = memo(function ContinueRow({ entry, now }) {
    const anime = entry.anime || {};
    const { entry: current, setProgress, save, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count },
        entry,
    });
    const href = `/anime/${anime.slug}`;
    // From the live entry, so "episode 8 is out" changes the moment you +1.
    const state = continueState({ ...entry, episodes_watched: current.episodes_watched, score: current.score }, now);
    const line = stateText(state, now);

    return (
        <li className="-mx-3 grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] px-3 py-3 transition-colors hover:bg-white/[0.03] sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="row-span-2 self-start sm:row-span-1 sm:self-center">
                <img
                    src={getOptimizedImageUrl(anime, 'cover', 'small')}
                    onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                    alt=""
                    loading="lazy"
                    className="h-[72px] w-12 rounded-md bg-[var(--ink-2)] object-cover"
                />
            </Link>
            <div className="min-w-0 flex-1">
                <Link to={href} className="line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[var(--text-1)] hover:text-[var(--signature)]">
                    {anime.title}
                </Link>
                <p className={`mt-0.5 text-[15px] tabular ${line.accent ? 'text-[var(--signature)]' : 'text-[var(--text-2)]'}`}>
                    {line.text}
                </p>
                {state.kind === 'finished' && (
                    <ScorePicker
                        className="mt-2 max-w-sm"
                        size="sm"
                        allowClear={false}
                        disabled={isPending}
                        value={current.score}
                        label={`Score ${anime.title}`}
                        onChange={(score) => save({ status: 'Completed', score })}
                    />
                )}
            </div>
            {state.kind !== 'finished' && (
                <ProgressStepper
                    size="sm"
                    className="col-start-2 justify-self-start sm:col-start-auto sm:justify-self-end"
                    value={current.episodes_watched || 0}
                    total={knownEpisodeTotal(anime)}
                    aired={airedEpisodeCount(anime)}
                    title={anime.title}
                    onCommit={(next) => setProgress(next)}
                />
            )}
        </li>
    );
});

/**
 * The top of the signed-in home (L2), laid out like oddava.me's front page:
 * who you are and one line about tonight on the left; your shows on the
 * right, ready ones first, with what's next and +1.
 */
export default function ContinueSection() {
    const now = useMinuteClock();
    const { user } = useAuth();
    const { data: watching, isPending } = useQuery({
        ...userQueries.watching(),
        staleTime: 60 * 1000,
    });
    const { data: summary } = useQuery({
        ...listQueries.summary(user?.username),
        enabled: Boolean(user?.username),
        staleTime: 60 * 1000,
    });

    const rows = sortForContinue(watching, now);
    const readyCount = rows.filter((row) => row.state.kind === 'ready').length;
    const summaryLine = isPending
        ? ''
        : rows.length === 0
            ? 'Nothing in progress. Mark a show as Watching and it lands here with its next episode.'
            : readyCount > 0
                ? `${readyCount} of your shows ${readyCount === 1 ? 'has' : 'have'} a new episode waiting.`
                : 'You’re up to date. Here’s what airs next.';

    return (
        <section aria-labelledby="continue-heading" className="page-container pt-20 md:pt-32">
            <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] md:gap-16">
                <div>
                    <h1 className="page-title break-words">{user?.username || 'Welcome back'}</h1>
                    <p className="mt-3 max-w-sm text-[17px] leading-relaxed text-[var(--text-2)]">{summaryLine}</p>
                    {summary?.total > 0 && (
                        <p className="mt-3 text-[15px] text-[var(--text-3)] tabular">
                            {summary.total} on your list · {summary.episodes_watched} episodes watched
                        </p>
                    )}
                </div>

                <div className="panel">
                    <h2 id="continue-heading" className="section-title mb-2">Continue watching</h2>
                    {isPending ? (
                        <ul aria-hidden="true">
                            {Array.from({ length: 3 }, (_, i) => (
                                <li key={i} className="flex items-center gap-4 py-3">
                                    <Skeleton className="h-[72px] w-12 shrink-0" />
                                    <div className="flex-1">
                                        <Skeleton className="h-4 w-1/2" />
                                        <Skeleton className="mt-2 h-3.5 w-1/3" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : rows.length === 0 ? (
                        <div className="pt-2 text-[17px] text-[var(--text-2)]">
                            <Link to="/browse?sort=trending" className="text-link">Find something to watch</Link>
                            <span className="mx-2 text-[var(--text-3)]">or</span>
                            <Link to="/import" className="text-link">Import your list from MAL or AniList</Link>
                        </div>
                    ) : (
                        <>
                            <ul>
                                {rows.map(({ entry }) => (
                                    <ContinueRow key={entry.id} entry={entry} now={now} />
                                ))}
                            </ul>
                            <Link to="/list" className="text-link mt-5 inline-block text-[15px]">All of my list</Link>
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}
