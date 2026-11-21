import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import MarkdownRenderer from '../common/MarkdownRenderer';
import ActivityFeed from './ActivityFeed';
import ActivityHeatmap from '../ActivityHeatmap';
import Portrait from '../ui/Portrait';
import AnimeMediaImage from '../common/AnimeMediaImage';
import { knownEpisodeTotal } from '../../utils/episodes';
import {
    activityQueries,
    characterFavoriteQueries,
    favoriteQueries,
    listQueries,
    staffFavoriteQueries,
} from '../../api/queries/user';

const WATCHING_ROWS = 5;
const GRID_ITEMS = 12;

function getFavoritesItems(favoritesData) {
    return favoritesData?.pages?.flatMap((page) => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || favoritesData?.results || (Array.isArray(favoritesData) ? favoritesData : []);
}

/** A section title with an optional quiet "see all" action. */
function SectionHead({ title, onSeeAll, seeAllLabel }) {
    return (
        <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="section-title">{title}</h2>
            {onSeeAll && (
                <button
                    type="button"
                    onClick={onSeeAll}
                    aria-label={seeAllLabel || `See all: ${title}`}
                    className="text-link shrink-0 text-[15px]"
                >
                    See all
                </button>
            )}
        </div>
    );
}

/**
 * Each section sits on its own panel (the shared .panel surface), stacked
 * with a small gap: no lines between them.
 */
function Column({ children }) {
    return (
        <div className="min-w-0 [&>*]:rounded-[var(--radius-lg)] [&>*]:bg-[var(--ink-1)] [&>*]:p-5 md:[&>*]:p-6 [&>*+*]:mt-4">
            {children}
        </div>
    );
}

/** An own profile with an empty list: one line and two ways to start. */
function GettingStarted() {
    return (
        <section>
            <h2 className="section-title">Start your list</h2>
            <p className="mt-3 max-w-md text-[17px] leading-relaxed text-[var(--text-2)]">
                Your profile fills in as you watch: shows, scores, favorites and a year of activity.
            </p>
            <p className="mt-4 text-[17px] text-[var(--text-2)]">
                <Link to="/import" className="text-link">Import from MAL or AniList</Link>
                <span className="mx-2 text-[var(--text-3)]">or</span>
                <Link to="/browse?sort=trending" className="text-link">Find something to watch</Link>
            </p>
        </section>
    );
}

function WatchingRows({ items }) {
    return (
        <ul>
            {items.map((item) => {
                const anime = item.anime || {};
                const watched = item.episodes_watched || 0;
                const total = knownEpisodeTotal(anime);
                return (
                    <li key={item.id} className="flex items-center gap-4 py-3 ">
                        <Link to={`/anime/${anime.slug}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
                            <AnimeMediaImage
                                anime={anime}
                                kind="cover"
                                size="small"
                                alt=""
                                className="h-14 w-10 rounded-md bg-[var(--ink-2)] object-cover"
                            />
                        </Link>
                        <Link
                            to={`/anime/${anime.slug}`}
                            className="line-clamp-1 min-w-0 flex-1 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text-1)] hover:text-[var(--signature)]"
                        >
                            {anime.title}
                        </Link>
                        <span className="shrink-0 text-[15px] text-[var(--text-2)] tabular">
                            {total ? `${watched} of ${total}` : `${watched} watched`}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

function CoverGrid({ children }) {
    return <ul className="grid grid-cols-4 gap-3 sm:grid-cols-6">{children}</ul>;
}

function AnimeCovers({ favorites }) {
    return (
        <CoverGrid>
            {favorites.map((fav) => (
                <li key={fav.id}>
                    <Link
                        to={`/anime/${fav.anime?.slug}`}
                        title={fav.anime?.title}
                        className="block aspect-[2/3] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--ink-2)]"
                    >
                        <AnimeMediaImage
                            anime={fav.anime}
                            kind="cover"
                            size="small"
                            alt={fav.anime?.title}
                            className="h-full w-full object-cover"
                        />
                    </Link>
                </li>
            ))}
        </CoverGrid>
    );
}

function PersonCovers({ items, itemKey, hrefBuilder }) {
    return (
        <CoverGrid>
            {items.map((entry) => {
                const item = entry[itemKey];
                return (
                    <li key={entry.id}>
                        <Link
                            to={hrefBuilder(item)}
                            title={item?.name}
                            className="block aspect-[2/3] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--ink-2)]"
                        >
                            <Portrait src={item?.image} alt={item?.name} sizes="120px" className="h-full w-full" />
                        </Link>
                    </li>
                );
            })}
        </CoverGrid>
    );
}

function TopGenres({ genres }) {
    return (
        <section>
            <SectionHead title="Top genres" />
            <ul>
                {genres.map((genre) => (
                    <li
                        key={genre.name}
                        className="flex items-baseline justify-between gap-4 py-2.5 text-[15px] "
                    >
                        <span className="text-[var(--text-1)]">{genre.name}</span>
                        <span className="text-[var(--text-2)] tabular">{genre.count}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/**
 * The profile overview, laid out like the home page: who this is on the left
 * (about, links, taste), what they are watching and doing on the right.
 * Sections with nothing to show are left out, not drawn empty.
 */
export default function OverviewTab({
    displayUser,
    targetUsername,
    isPrivate,
    onTabChange,
    isOwnProfile = false,
}) {
    const enabled = Boolean(displayUser) && !isPrivate && Boolean(targetUsername);
    const query = { enabled, staleTime: 60 * 1000, refetchOnMount: true };

    const { data: watchingData } = useQuery({ ...listQueries.overview(targetUsername, 'Watching', WATCHING_ROWS), ...query });
    const { data: favsData } = useQuery({ ...favoriteQueries.overview(targetUsername, GRID_ITEMS), ...query });
    const { data: characterFavsData } = useQuery({ ...characterFavoriteQueries.overview(targetUsername, GRID_ITEMS), ...query });
    const { data: staffFavsData } = useQuery({ ...staffFavoriteQueries.overview(targetUsername, GRID_ITEMS), ...query });
    const { data: summary, isPending: summaryPending } = useQuery({ ...listQueries.summary(targetUsername), ...query });
    const { data: heatmapData } = useQuery({ ...activityQueries.heatmap(targetUsername), ...query, staleTime: 2 * 60 * 1000 });

    if (isPrivate) {
        return (
            <p className="pb-8 text-[17px] text-[var(--text-2)]">
                This profile is private. Only {displayUser?.username} can see their lists and activity.
            </p>
        );
    }

    const watching = (Array.isArray(watchingData) ? watchingData : getFavoritesItems(watchingData)).slice(0, WATCHING_ROWS);
    const favorites = getFavoritesItems(favsData).slice(0, GRID_ITEMS);
    const characters = getFavoritesItems(characterFavsData).slice(0, GRID_ITEMS);
    const staff = getFavoritesItems(staffFavsData).slice(0, GRID_ITEMS);
    const genres = (summary?.top_genres || []).slice(0, 5);
    const links = displayUser?.social_links || [];
    const listIsEmpty = !summaryPending && !(Number(displayUser?.anime_count ?? summary?.total) > 0);
    const hasHeatmap = Array.isArray(heatmapData) && heatmapData.some((day) => day.count > 0);

    const left = [];
    if (listIsEmpty && isOwnProfile) left.push(<GettingStarted key="start" />);
    if (displayUser?.bio) {
        left.push(
            <section key="about">
                <SectionHead title="About" />
                <div className="overview-about-scroll overflow-y-auto custom-scrollbar pr-1 text-[15px] text-[var(--text-2)]">
                    <MarkdownRenderer content={displayUser.bio} className="overview-about-markdown" />
                </div>
            </section>,
        );
    }
    if (links.length > 0) {
        left.push(
            <section key="links">
                <SectionHead title="Links" />
                <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
                    {links.map((link, index) => (
                        <li key={`${link.platform}-${index}`}>
                            <a href={link.value} target="_blank" rel="noreferrer" className="text-link">
                                {link.platform || 'Link'}
                            </a>
                        </li>
                    ))}
                </ul>
            </section>,
        );
    }
    if (genres.length > 0) left.push(<TopGenres key="genres" genres={genres} />);
    if (listIsEmpty && !isOwnProfile) {
        left.push(
            <p key="empty" className="text-[17px] text-[var(--text-2)]">
                Nothing on {displayUser?.username}’s list yet.
            </p>,
        );
    }

    const right = [];
    if (watching.length > 0) {
        right.push(
            <section key="watching">
                <SectionHead title="Watching" onSeeAll={() => onTabChange?.('anime_list')} seeAllLabel="See the whole list" />
                <WatchingRows items={watching} />
            </section>,
        );
    }
    if (favorites.length > 0) {
        right.push(
            <section key="favorites">
                <SectionHead title="Favorites" onSeeAll={() => onTabChange?.('favorites')} />
                <AnimeCovers favorites={favorites} />
            </section>,
        );
    }
    if (characters.length > 0) {
        right.push(
            <section key="characters">
                <SectionHead title="Characters" />
                <PersonCovers items={characters} itemKey="character" hrefBuilder={(c) => `/character/${c?.id}`} />
            </section>,
        );
    }
    if (staff.length > 0) {
        right.push(
            <section key="staff">
                <SectionHead title="Voice actors" />
                <PersonCovers items={staff} itemKey="staff" hrefBuilder={(s) => `/staff/${s?.id}`} />
            </section>,
        );
    }
    // One "Activity" section: the year at a glance, then the latest rows.
    right.push(
        <ActivityFeed
            key="activity"
            username={targetUsername}
            isPrivate={isPrivate}
            compact
            header={(
                <>
                    <SectionHead title="Activity" onSeeAll={() => onTabChange?.('activity')} seeAllLabel="See all activity" />
                    {hasHeatmap && (
                        <div className="mb-6">
                            <ActivityHeatmap activityData={heatmapData} accentColor={displayUser?.profile_primary_color} />
                        </div>
                    )}
                </>
            )}
        />,
    );

    return (
        <div className="animate-tab-content overview-tab pb-8">
            <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
                {left.length > 0 && <Column>{left}</Column>}
                <div className={left.length > 0 ? 'min-w-0' : 'min-w-0 md:col-span-2'}>
                    <Column>{right}</Column>
                </div>
            </div>
        </div>
    );
}
