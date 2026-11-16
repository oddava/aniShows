import React, { Suspense } from 'react';
import { Lock } from 'lucide-react';
import ProfileErrorBoundary, { ErrorVariant } from './ProfileErrorBoundary';
import ProfileStats from './ProfileStats';
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
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <Lock className="w-16 h-16 mb-4 opacity-50" />
                <h3 className="text-xl font-semibold mb-2">This profile is private</h3>
                <p>Only the user can see their lists and reviews.</p>
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
                    <Suspense fallback={<div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
                        <ActivityTab username={targetUsername} isPrivate={isPrivate} />
                    </Suspense>
                </ProfileErrorBoundary>
            );

        case 'insights':
            return (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Insights">
                    <Suspense fallback={<div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
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
