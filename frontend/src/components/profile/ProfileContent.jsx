import React, { Suspense } from 'react';
import ProfileErrorBoundary, { ErrorVariant } from './ProfileErrorBoundary';
import FriendsTab from './FriendsTab';
import ActivityTab from './tabs/ActivityTab';
import AnimeListTab from './tabs/AnimeListTab';
import FavoritesTab from './tabs/FavoritesTab';
import InsightsTab from './tabs/InsightsTab';
import ReviewsTab from './tabs/ReviewsTab';

/*
 * Profile tab shell (G1 Accounts & auth). Each tab body lives in its owner's file:
 * tabs/AnimeListTab, tabs/ActivityTab, tabs/InsightsTab (G3); tabs/FavoritesTab,
 * tabs/ReviewsTab and FriendsTab (G5). Prop names passed to them are a contract.
 * The error boundary and Suspense around Activity/Insights stay here so switching
 * between those two tabs reuses one boundary instance, exactly as before the split.
 */

/** The placeholder every lazy profile tab shows while its code loads. */
function TabSkeleton() {
    return (
        <ul aria-hidden="true" className="panel">
            {Array.from({ length: 5 }, (_, index) => (
                <li key={index} className="flex items-center gap-4 py-3">
                    <span className="h-14 w-10 rounded-md bg-[var(--ink-2)] animate-pulse" />
                    <span className="h-4 w-1/2 rounded bg-[var(--ink-2)] animate-pulse" />
                </li>
            ))}
        </ul>
    );
}

export default function ProfileContent({
    activeTab,
    isPrivate,
    isPublicView,
    isOwnProfile,
    targetUsername,
    displayUser,
    favoritesData,
    favoritesLoading,
    isFetchingNextFavorites,
    hasNextFavorites,
    fetchNextFavorites,
    listStatusFilter,
    setListStatusFilter,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    currentListData,
    listsLoading,
    listsFetching,
    reviewsData,
    reviewsLoading,
    isFetchingNextReviews,
    hasNextReviews,
    fetchNextReviews,
}) {
    if (isPrivate) {
        return (
            <div className="pb-8">
                <h2 className="section-title">This profile is private</h2>
                <p className="mt-2 text-[17px] text-[var(--text-2)]">Only its owner can see their lists and reviews.</p>
            </div>
        );
    }

    switch (activeTab) {
        case 'overview':
            return null; // Overview is now handled directly in Profile.jsx

        case 'friends':
            return <FriendsTab username={targetUsername} isPrivate={isPrivate} />;

        case 'favorites':
            return (
                <FavoritesTab
                    favoritesData={favoritesData}
                    favoritesLoading={favoritesLoading}
                    isFetchingNextFavorites={isFetchingNextFavorites}
                    hasNextFavorites={hasNextFavorites}
                    fetchNextFavorites={fetchNextFavorites}
                    isOwnProfile={isOwnProfile}
                    targetUsername={targetUsername}
                    isPublicView={isPublicView}
                />
            );

        case 'anime_list':
            return (
                <AnimeListTab
                    listStatusFilter={listStatusFilter}
                    setListStatusFilter={setListStatusFilter}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    currentListData={currentListData}
                    listsLoading={listsLoading}
                    listsFetching={listsFetching}
                    isPublicView={isPublicView}
                />
            );

        case 'reviews':
            return (
                <ReviewsTab
                    reviewsData={reviewsData}
                    reviewsLoading={reviewsLoading}
                    isFetchingNextReviews={isFetchingNextReviews}
                    hasNextReviews={hasNextReviews}
                    fetchNextReviews={fetchNextReviews}
                    isPublicView={isPublicView}
                />
            );

        case 'activity':
            return (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Activity">
                    <Suspense fallback={<TabSkeleton />}>
                        <ActivityTab username={targetUsername} isPrivate={isPrivate} isOwner={isOwnProfile} />
                    </Suspense>
                </ProfileErrorBoundary>
            );

        case 'insights':
            return (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Insights">
                    <Suspense fallback={<TabSkeleton />}>
                        <InsightsTab
                            username={targetUsername}
                            isPrivate={isPrivate}
                            accentColor={displayUser?.profile_primary_color}
                        />
                    </Suspense>
                </ProfileErrorBoundary>
            );

        default:
            return null;
    }
}
