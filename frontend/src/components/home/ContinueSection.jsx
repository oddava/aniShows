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

function stateText(state, now) {
    if (state.kind === 'ready') {
        if (state.behind === 1) return { text: `episode ${state.nextEpisode} is out`, accent: true };
        if (state.behind > 12) return { text: `catching up, episode ${state.nextEpisode} next`, accent: true };
        return { text: `${state.behind} new episodes`, accent: true };
    }
    if (state.kind === 'soon') return { text: `episode ${state.nextEpisode} in ${countdown(state.nextAt, now)}` };
    if (state.kind === 'finished') return { text: `all ${state.total} watched. score it?` };
    return { text: 'up to date' };
}

/**
 * One show, set like a row on oddava.me: title and what's next on the left,
 * the episode stepper on the right. A finished show asks for a score and
 * completes in one tap.
 */
const ContinueRow = memo(function ContinueRow({ entry, state, now }) {
    const anime = entry.anime || {};
    const { entry: current, setProgress, save, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count },
        entry,
    });
    const href = `/anime/${anime.slug}`;
    const line = stateText(state, now);

    return (
        <li className="flex items-center gap-4 border-b border-white/[0.06] py-4 last:border-b-0">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="shrink-0">
                <img
                    src={getOptimizedImageUrl(anime, 'cover', 'small')}
                    onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                    alt=""
                    loading="lazy"
                    className="h-[72px] w-12 rounded-md bg-[var(--ink-2)] object-cover"
                />
            </Link>
            <div className="min-w-0 flex-1">
                <Link to={href} className="line-clamp-1 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text-1)] hover:text-[var(--signature)]">
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
                    className="shrink-0"
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
            ? 'nothing in progress. mark a show as watching and it lands here with its next episode.'
            : readyCount > 0
                ? `${readyCount} of your shows ${readyCount === 1 ? 'has' : 'have'} a new episode waiting.`
                : 'you’re up to date. here’s what airs next.';

    return (
        <section aria-labelledby="continue-heading" className="page-container pt-24 md:pt-36">
            <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] md:gap-16">
                <div>
                    <h1 className="page-title break-words">{user?.username || 'welcome back'}</h1>
                    <span aria-hidden="true" className="wave mt-3" />
                    <p className="mt-5 max-w-sm text-[17px] leading-relaxed text-[var(--text-2)]">{summaryLine}</p>
                    {summary?.total > 0 && (
                        <p className="mt-3 text-[15px] text-[var(--text-3)] tabular">
                            {summary.total} on your list · {summary.episodes_watched} episodes watched
                        </p>
                    )}
                </div>

                <div>
                    <h2 id="continue-heading" className="sr-only">Continue watching</h2>
                    {isPending ? (
                        <ul aria-hidden="true">
                            {Array.from({ length: 3 }, (_, i) => (
                                <li key={i} className="flex items-center gap-4 border-b border-white/[0.06] py-4">
                                    <Skeleton className="h-[72px] w-12 shrink-0" />
                                    <div className="flex-1">
                                        <Skeleton className="h-4 w-1/2" />
                                        <Skeleton className="mt-2 h-3.5 w-1/3" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : rows.length === 0 ? (
                        <div className="border-t border-white/[0.06] pt-6 text-[17px] text-[var(--text-2)]">
                            <Link to="/browse?sort=trending" className="text-link">find something to watch</Link>
                            <span className="mx-2 text-[var(--text-3)]">or</span>
                            <Link to="/import" className="text-link">import your list from MAL or AniList</Link>
                        </div>
                    ) : (
                        <>
                            <ul>
                                {rows.map(({ entry, state }) => (
                                    <ContinueRow key={entry.id} entry={entry} state={state} now={now} />
                                ))}
                            </ul>
                            <Link to="/list" className="text-link mt-5 inline-block text-[15px]">all of my list</Link>
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}
