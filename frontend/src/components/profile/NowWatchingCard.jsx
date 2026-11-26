import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import AnimeMediaImage from '../common/AnimeMediaImage';
import { listQueries } from '../../api/queries/user';
import { knownEpisodeTotal } from '../../utils/episodes';
import { WATCHING_SHELF, resultsOf, timeAgo } from './profileShared';

/**
 * "Watching now", like Discord's activity card: the show this person touched
 * last and how far in they are. A plain panel; nothing at all when they are
 * not watching anything.
 */
export default function NowWatchingCard({ username }) {
    const { data, isPending } = useQuery({
        ...listQueries.overview(username, 'Watching', WATCHING_SHELF),
        enabled: Boolean(username),
        staleTime: 60 * 1000,
    });

    if (isPending) {
        return <div aria-hidden="true" className="hidden rounded-[var(--radius-lg)] bg-[var(--ink-1)] lg:block lg:self-stretch" />;
    }

    const entry = resultsOf(data)[0];
    const anime = entry?.anime;
    if (!anime) return null;

    const watched = Number(entry.episodes_watched) || 0;
    const total = knownEpisodeTotal(anime);
    const progress = total
        ? `Episode ${watched} of ${total}`
        : watched ? `Episode ${watched}` : 'Just started';

    return (
        // Named by its visible text ("Watching now Vinland Saga Episode 4 of
        // 24 · 3h ago"); an aria-label left the time out (WCAG 2.5.3, RA-004).
        <Link
            to={`/anime/${anime.slug}`}
            className="group flex items-center gap-4 self-start rounded-[var(--radius-lg)] bg-[var(--ink-1)] p-3 pr-5 lg:self-stretch lg:gap-5 lg:p-4 lg:pr-6"
        >
            <AnimeMediaImage
                anime={anime}
                kind="cover"
                size="small"
                alt=""
                className="h-[4.5rem] w-12 shrink-0 rounded-[var(--radius-sm)] bg-[var(--ink-2)] object-cover sm:h-24 sm:w-16 lg:h-[7.5rem] lg:w-20"
            />
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[var(--signature)]">Watching now</p>
                <p className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug sm:mt-1 sm:text-[17px] tracking-[-0.01em] text-[var(--text-1)]">
                    {anime.title}
                </p>
                <p className="mt-1 text-sm text-[var(--text-2)] tabular">
                    {progress}
                    {entry.updated_at && <span className="text-[var(--text-3)]"> · {timeAgo(entry.updated_at)}</span>}
                </p>
                {total > 0 && (
                    <div aria-hidden="true" className="mt-3 hidden h-1 overflow-hidden rounded-full bg-[var(--ink-3)] lg:block">
                        <div className="h-full rounded-full bg-[var(--pa)]" style={{ width: `${Math.min(100, (watched / total) * 100)}%` }} />
                    </div>
                )}
            </div>
        </Link>
    );
}
