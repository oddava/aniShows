import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const ContinueRow = memo(function ContinueRow({ entry, now, onLive }) {
    const anime = entry.anime || {};
    const { entry: current, setProgress, save, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count },
        entry,
    });
    const href = `/anime/${anime.slug}`;
    // From what is on screen (a tap not yet written counts), so "episode 8 is
    // out" and the headline change the moment you +1.
    const [draft, setDraft] = useState(null);
    const watched = draft ?? current.episodes_watched;
    const state = continueState({ ...entry, episodes_watched: watched, score: current.score }, now);
    const line = stateText(state, now);
    useEffect(() => {
        onLive?.(entry.id, { kind: state.kind, delta: (watched || 0) - (entry.episodes_watched || 0) });
    }, [onLive, entry.id, entry.episodes_watched, state.kind, watched]);

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
                    onDraft={setDraft}
                />
            )}
        </li>
    );
});

const DAY_MS = 24 * 60 * 60 * 1000;
const timeOf = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayOf = (at) => new Date(at).toLocaleDateString([], { weekday: 'short' });

/** Shows on your list airing before the end of today, by time; else the next one. */
function tonightFrom(entries, now) {
    const upcoming = (entries || [])
        .map((entry) => ({ entry, at: Date.parse(entry.anime?.next_airing_date) }))
        .filter((row) => Number.isFinite(row.at) && row.at > now)
        .sort((a, b) => a.at - b.at);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const today = upcoming.filter((row) => row.at <= endOfToday.getTime());
    return { today, next: today.length ? null : upcoming.find((row) => row.at - now < 7 * DAY_MS) || null };
}

/** The left column under the headline: what airs tonight, as a timetable. */
function Tonight({ items, now }) {
    if (!items.today.length && !items.next) return null;
    return (
        <div className="mt-10 md:max-w-sm">
            <h2 className="text-[15px] font-semibold text-[var(--text-2)]">Tonight</h2>
            {items.today.length ? (
                <ul className="mt-2">
                    {items.today.map(({ entry, at }) => (
                        <li key={entry.id}>
                            <Link
                                to={`/anime/${entry.anime.slug}`}
                                className="-mx-2 flex min-h-11 items-baseline gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                            >
                                <span className="w-12 shrink-0 text-[15px] font-semibold text-[var(--signature)] tabular">{timeOf(at)}</span>
                                <span className="min-w-0">
                                    <span className="block truncate text-[15px] text-[var(--text-1)]">{entry.anime.title}</span>
                                    <span className="block text-sm text-[var(--text-3)] tabular">
                                        Episode {entry.anime.next_airing_episode} · in {countdown(at, now)}
                                    </span>
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-2)]">
                    Nothing more from your list airs today. Next:{' '}
                    <Link to={`/anime/${items.next.entry.anime.slug}`} className="text-link">{items.next.entry.anime.title}</Link>
                    , {dayOf(items.next.at)} {timeOf(items.next.at)}.
                </p>
            )}
        </div>
    );
}

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

    // The order is set once per visit: a row never jumps away under the
    // cursor after a +1 (new shows join at the end).
    const orderRef = useRef(null);
    const rows = useMemo(() => {
        const sorted = sortForContinue(watching, now);
        if (!orderRef.current) {
            if (sorted.length) orderRef.current = sorted.map((row) => row.entry.id);
            return sorted;
        }
        const position = new Map(orderRef.current.map((id, index) => [id, index]));
        const ordered = [...sorted].sort((a, b) => (position.get(a.entry.id) ?? Infinity) - (position.get(b.entry.id) ?? Infinity));
        orderRef.current = ordered.map((row) => row.entry.id);
        return ordered;
    }, [watching, now]);
    // Each row reports its live state, so the headline and the episode count
    // follow a +1 in the same frame as the row.
    const [live, setLive] = useState({});
    const onLive = useCallback((id, value) => {
        setLive((previous) => (
            previous[id]?.kind === value.kind && previous[id]?.delta === value.delta ? previous : { ...previous, [id]: value }
        ));
    }, []);
    const readyCount = rows.filter((row) => (live[row.entry.id]?.kind ?? row.state.kind) === 'ready').length;
    const episodeDelta = rows.reduce((sum, row) => sum + (live[row.entry.id]?.delta || 0), 0);
    const tonight = useMemo(() => tonightFrom(watching, now), [watching, now]);
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
                            {summary.total} on your list · {(summary.episodes_watched || 0) + episodeDelta} episodes watched
                        </p>
                    )}
                    <Tonight items={tonight} now={now} />
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
                                    <ContinueRow key={entry.id} entry={entry} now={now} onLive={onLive} />
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
