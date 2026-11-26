import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import ActivityFeed from './ActivityFeed';
import ActivityHeatmap from '../ActivityHeatmap';
import ProfileCard from './overview/ProfileCard';
import StatsStrip from './overview/StatsStrip';
import { FavoritesShowcase, PeopleList, WatchingShelf } from './overview/Shelves';
import { AboutCard, CompatibilityCard, MakeItYoursCard, TasteCard } from './overview/SidebarCards';
import { WATCHING_SHELF, resultsOf } from './profileShared';
import {
    activityQueries,
    characterFavoriteQueries,
    favoriteQueries,
    listQueries,
    staffFavoriteQueries,
} from '../../api/queries/user';

const WATCHING_SHOWN = 6;
const FAVORITES_SHOWN = 6;
// Two rows of two in the side column.
const PEOPLE_SHOWN = 4;

/** An own profile with an empty list: one line and two ways to start. */
function GettingStarted() {
    return (
        <section className="profile-card">
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text-1)]">Start your list</h2>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[var(--text-2)]">
                Your profile fills in as you watch: what you are on now, your favorites, your taste and a year of activity.
                Coming from MAL or AniList? Bring your list with you.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link to="/browse?sort=trending" className="btn-primary px-4 text-[15px]">Find something to watch</Link>
                <Link to="/import" className="text-link text-[15px]">Import a list</Link>
            </div>
        </section>
    );
}

/*
 * Mobile order vs. desktop columns: on phones the columns are
 * `display: contents`, so every card is a child of one flex column and its
 * `order` places it (who they are first, then their shows). From lg up the two
 * columns are real; the same numbers still ascend inside each, so the
 * order there is just the DOM order.
 */
const ORDER = {
    makeItYours: 'order-1',
    compatibility: 'order-2',
    about: 'order-3',
    stats: 'order-4',
    watching: 'order-5',
    favorites: 'order-6',
    taste: 'order-7',
    people: 'order-8',
    activity: 'order-9',
};

/**
 * The profile overview as a dashboard: the numbers, the shows and the year
 * of activity on the left; who they are (about, taste, how well you match,
 * favourite people) on the right. Every picture section is a
 * single row, so nothing runs long; empty sections are left out.
 */
export default function OverviewTab({
    displayUser,
    targetUsername,
    isPrivate,
    onTabChange,
    onOpenListStatus,
    isOwnProfile = false,
    viewerSignedIn = false,
}) {
    const enabled = Boolean(displayUser) && !isPrivate && Boolean(targetUsername);
    const query = { enabled, staleTime: 60 * 1000, refetchOnMount: true };

    const { data: watchingData } = useQuery({ ...listQueries.overview(targetUsername, 'Watching', WATCHING_SHELF), ...query });
    const { data: favsData, isPending: favoritesPending } = useQuery({ ...favoriteQueries.overview(targetUsername, 12), ...query });
    const { data: characterFavsData } = useQuery({ ...characterFavoriteQueries.overview(targetUsername, 12), ...query });
    const { data: staffFavsData } = useQuery({ ...staffFavoriteQueries.overview(targetUsername, 12), ...query });
    const { data: summary, isPending: summaryPending, isError: summaryFailed, refetch: refetchSummary } = useQuery({ ...listQueries.summary(targetUsername), ...query });
    const { data: heatmapData } = useQuery({ ...activityQueries.heatmap(targetUsername), ...query, staleTime: 2 * 60 * 1000 });
    const sideRef = useRef(null);

    // The side column sticks while the shows scroll past. When it is taller
    // than the window it sticks by its foot (a negative top), so every card in
    // it is reached before it stops: X's sidebar, in CSS plus one measurement.
    useEffect(() => {
        const side = sideRef.current;
        if (!side || typeof window === 'undefined') return undefined;
        const place = () => {
            const header = 60 + (document.documentElement.dataset.desktopNav === 'shown' ? 64 : 0);
            side.style.top = `${Math.min(header + 16, window.innerHeight - side.offsetHeight - 24)}px`;
        };
        place();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
        observer?.observe(side);
        const navObserver = typeof MutationObserver === 'function' ? new MutationObserver(place) : null;
        navObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-desktop-nav'] });
        window.addEventListener('resize', place);
        return () => {
            observer?.disconnect();
            navObserver?.disconnect();
            window.removeEventListener('resize', place);
        };
    });

    if (isPrivate) {
        return (
            <div className="profile-card">
                <h2 className="text-xl font-semibold text-[var(--text-1)]">This profile is private</h2>
                <p className="mt-2 text-[15px] text-[var(--text-2)]">
                    Only {displayUser?.display_name || displayUser?.username} can see their lists and activity.
                </p>
            </div>
        );
    }

    const watchingAll = resultsOf(watchingData);
    // The hero's "watching now" card shows the first; the shelf shows the rest
    // when there are several, or all of them when there are only a few.
    const watching = (watchingAll.length > WATCHING_SHOWN ? watchingAll.slice(1) : watchingAll).slice(0, WATCHING_SHOWN);
    const favorites = resultsOf(favsData).slice(0, FAVORITES_SHOWN);
    const characters = resultsOf(characterFavsData).slice(0, PEOPLE_SHOWN);
    const staff = resultsOf(staffFavsData).slice(0, PEOPLE_SHOWN);

    // The summary is the source of truth for "is there a list": the profile's
    // cached anime_count can lag behind a removal.
    const listTotal = Number(summary?.total ?? displayUser?.anime_count);
    const listIsEmpty = !summaryPending && !summaryFailed && !(listTotal > 0);
    const hasHeatmap = !summaryPending
        && !listIsEmpty
        && Array.isArray(heatmapData)
        && heatmapData.some((day) => day.count > 0);
    const viewerHasList = viewerSignedIn && !isOwnProfile;
    // Sections the owner chose to hide (Settings > Profile > Sections).
    const hidden = new Set(displayUser?.hidden_sections || []);
    const shows = (section) => !hidden.has(section);

    const main = [];
    const side = [];

    if (summaryFailed && !(listTotal > 0)) {
        main.push(
            <section key="stats-failed" className={`profile-card ${ORDER.stats}`}>
                <p className="text-[15px] text-[var(--text-2)]">
                    {isOwnProfile ? 'Your stats' : 'Stats'} couldn’t load.
                </p>
                <button type="button" onClick={() => refetchSummary()} className="btn-secondary mt-3 px-4 text-sm">
                    Try again
                </button>
            </section>,
        );
    } else if (listIsEmpty) {
        main.push(isOwnProfile ? (
            <div key="start" className={ORDER.stats}><GettingStarted /></div>
        ) : (
            <section key="empty" className={`profile-card ${ORDER.stats}`}>
                <p className="text-[15px] text-[var(--text-2)]">Nothing on {displayUser?.username}’s list yet.</p>
            </section>
        ));
    } else if (!shows('stats')) {
        // Hidden by the owner.
    } else if (summaryPending) {
        main.push(<div key="stats" aria-hidden="true" className={`profile-card h-[9.5rem] animate-pulse ${ORDER.stats}`} />);
    } else {
        main.push(
            <div key="stats" className={ORDER.stats}>
                <StatsStrip
                    user={displayUser}
                    summary={summary}
                    onOpenStatus={onOpenListStatus}
                    onOpenStats={() => onTabChange?.('insights')}
                />
            </div>,
        );
    }

    // Only once favorites are in: it must not ask for favorites someone has.
    if (isOwnProfile && !favoritesPending) {
        side.push(
            <MakeItYoursCard key="mine" className={ORDER.makeItYours} user={displayUser} hasFavorites={favorites.length > 0} />,
        );
    }
    if (viewerHasList && !listIsEmpty) {
        side.push(
            <CompatibilityCard key="compat" className={ORDER.compatibility} username={targetUsername} viewerHasList={viewerHasList} />,
        );
    }

    if (shows('watching') && watching.length > 0) {
        main.push(
            <ProfileCard
                key="watching"
                className={ORDER.watching}
                title="Watching"
                onSeeAll={() => onOpenListStatus?.('Watching')}
                seeAllLabel="See everything they are watching"
            >
                <WatchingShelf entries={watching} />
            </ProfileCard>,
        );
    }
    if (shows('favorites') && favorites.length > 0) {
        main.push(
            <ProfileCard
                key="favorites"
                className={ORDER.favorites}
                title="Favorites"
                onSeeAll={() => onTabChange?.('favorites')}
            >
                <FavoritesShowcase favorites={favorites} />
            </ProfileCard>,
        );
    }
    if (displayUser?.bio) {
        side.push(
            <AboutCard key="about" className={ORDER.about} bio={displayUser.bio} />,
        );
    }
    if (shows('taste') && !listIsEmpty && summary) {
        side.push(
            <TasteCard key="taste" className={ORDER.taste} summary={summary} user={displayUser} />,
        );
    }
    // Characters and voice actors share one side card, two rows of two each,
    // which keeps the two columns close to one height.
    const showCharacters = shows('characters') && characters.length > 0;
    const showStaff = shows('staff') && staff.length > 0;
    if (showCharacters || showStaff) {
        const both = showCharacters && showStaff;
        side.push(
            <ProfileCard
                key="people"
                className={ORDER.people}
                title={both ? 'Favorite people' : showCharacters ? 'Favorite characters' : 'Favorite voice actors'}
            >
                {showCharacters && (
                    <>
                        {both && <h3 className="mb-1.5 text-[13px] text-[var(--text-3)]">Characters</h3>}
                        <PeopleList items={characters} itemKey="character" hrefBuilder={(c) => `/character/${c?.id}`} />
                    </>
                )}
                {showStaff && (
                    <>
                        {both && <h3 className="mb-1.5 mt-4 text-[13px] text-[var(--text-3)]">Voice actors</h3>}
                        <PeopleList items={staff} itemKey="staff" hrefBuilder={(s) => `/staff/${s?.id}`} />
                    </>
                )}
            </ProfileCard>,
        );
    }

    // The year at a glance, then the latest changes: the last card of the
    // main column, so it carries on below the side column instead of leaving
    // a gap beside it. An empty list has no activity section (what is left of
    // its history is adds and removals).
    if (shows('activity') && !listIsEmpty && !summaryPending) {
        main.push(
            <div key="activity" className={`profile-activity ${ORDER.activity}`}>
            <ActivityFeed
                username={targetUsername}
                isPrivate={isPrivate}
                isOwner={isOwnProfile}
                compact
                currentEntries={watchingAll}
                header={(
                    <>
                        <div className="mb-4 flex items-center justify-between gap-4">
                            <h2 className="profile-card-title">Activity</h2>
                            <button
                                type="button"
                                onClick={() => onTabChange?.('activity')}
                                aria-label="See all activity"
                                className="-my-2 inline-flex min-h-[2.75rem] items-center gap-0.5 text-sm font-medium text-[var(--signature)] transition-colors hover:text-[var(--signature-hover)]"
                            >
                                See all
                                <ChevronRight aria-hidden="true" className="h-4 w-4" />
                            </button>
                        </div>
                        {hasHeatmap && (
                            <div className="mb-5">
                                <ActivityHeatmap activityData={heatmapData} accentColor={displayUser?.profile_primary_color} />
                            </div>
                        )}
                    </>
                )}
            />
            </div>,
        );
    }

    return (
        <div className="overview-tab pb-8">
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
                <div className={`contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5 ${side.length > 0 ? '' : 'lg:col-span-2'}`}>{main}</div>
                {side.length > 0 && (
                    <aside ref={sideRef} className="contents lg:sticky lg:flex lg:min-w-0 lg:flex-col lg:gap-5" aria-label="About">{side}</aside>
                )}
            </div>

            {isOwnProfile && hidden.size > 0 && (
                <p className="mt-5 text-sm text-[var(--text-3)]">
                    {hidden.size === 1 ? '1 section is' : `${hidden.size} sections are`} hidden from your profile.{' '}
                    <Link to="/settings" className="text-[var(--text-2)] underline-offset-4 hover:text-[var(--text-1)] hover:underline">Change</Link>
                </p>
            )}
        </div>
    );
}
