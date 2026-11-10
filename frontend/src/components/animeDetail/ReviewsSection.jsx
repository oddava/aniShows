import { Loader } from 'lucide-react';
import ReviewCard from '../ReviewCard';
import ReviewForm from '../ReviewForm';
import ReviewSummary from '../ReviewSummary';
import CustomSelect from '../common/CustomSelect';

/** The reviews block under the tabs. `reviews` is the state from useAnimeReviews. */
export default function ReviewsSection({ anime, reviews, isAuthenticated, accentColor, mappedAccent }) {
    const {
        isWritingReview, setIsWritingReview,
        editingReview, setEditingReview,
        reviewSort, setReviewSort,
        ratingFilter, setRatingFilter,
        hideSpoilersGlobal, setHideSpoilersGlobal,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        reviewsLoading,
        reviewStats,
        allReviews,
        textReviews,
        ratingOnlyReviews,
        reviewCount,
        userReview,
        canReview,
        deleteReviewMutation,
        handleReviewSubmit,
    } = reviews;

    return (
        <div className="mt-16 mb-16">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-6 flex items-center gap-2 sm:gap-3">
                    Reviews
                    <span 
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md border"
                        style={{ 
                            color: mappedAccent,
                            borderColor: mappedAccent ? `${mappedAccent}30` : 'rgba(117,105,141,0.2)',
                            backgroundColor: mappedAccent ? `${mappedAccent}10` : 'rgba(117,105,141,0.05)'
                        }}
                    >
                        {reviewCount}
                    </span>
                </h2>
                <div className="flex items-center gap-3">
                    <CustomSelect
                        value={reviewSort}
                        onChange={(nextValue) => setReviewSort(nextValue)}
                        options={[
                            { value: 'helpful', label: 'Most Helpful' },
                            { value: 'newest', label: 'Newest' },
                            { value: 'highest', label: 'Highest Rated' },
                            { value: 'lowest', label: 'Lowest Rated' },
                        ]}
                        triggerClassName="bg-dark-100 border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300"
                        menuClassName="z-[320]"
                        ariaLabel="Sort reviews"
                    />

                    {isAuthenticated && !isWritingReview && !editingReview && !userReview && (
                        canReview ? (
                            <button
                                onClick={() => setIsWritingReview(true)}
                                className="text-xs sm:text-sm px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl  text-white font-bold bg-accent"
                                style={{
                                    backgroundColor: accentColor || '#75698d'
                                }}
                            >
                                Write a Review
                            </button>
                        ) : (
                            <div className="text-xs text-gray-300 bg-dark-50 px-4 py-2.5 rounded-xl border border-gray-700 ">
                                Add to list to write a review
                            </div>
                        )
                    )}
                </div>
            </div>

            {reviewStats && reviewStats.total_reviews > 0 && (
                <ReviewSummary
                    stats={reviewStats}
                    onFilterByRating={(rating) => setRatingFilter(rating === ratingFilter ? null : rating)}
                    activeRatingFilter={ratingFilter}
                    hideSpoilers={hideSpoilersGlobal}
                    onToggleHideSpoilers={() => setHideSpoilersGlobal(!hideSpoilersGlobal)}
                    accentColor={accentColor}
                />
            )}

            {(isWritingReview || editingReview) && (
                <div className="mb-12 animate-fade-in">
                    <ReviewForm
                        initialData={editingReview}
                        onSubmit={handleReviewSubmit}
                        onCancel={() => {
                            setIsWritingReview(false);
                            setEditingReview(null);
                        }}
                        animeTitle={anime.title}
                    />
                </div>
            )}

            <div className="space-y-4">
                {reviewsLoading ? (
                    <div className="text-center py-12">
                        <Loader className="w-10 h-10 text-accent animate-spin mx-auto" />
                    </div>
                ) : allReviews.length > 0 ? (
                    <>
                        {textReviews.map((review) => (
                            <ReviewCard
                                key={review.id}
                                review={review}
                                onEdit={setEditingReview}
                                onDelete={deleteReviewMutation.mutate}
                                forceHideSpoilers={hideSpoilersGlobal}
                                accentColor={accentColor}
                            />
                        ))}

                        {ratingOnlyReviews.length > 0 && (
                            <div className="mt-8">
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.16em] mb-4">
                                    Rating-only reviews ({ratingOnlyReviews.length})
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {ratingOnlyReviews.map((review) => (
                                        <ReviewCard
                                            key={review.id}
                                            review={review}
                                            onEdit={setEditingReview}
                                            onDelete={deleteReviewMutation.mutate}
                                            compact
                                            accentColor={accentColor}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {hasNextPage && (
                            <div className="text-center mt-12">
                                <button
                                    onClick={() => fetchNextPage()}
                                    disabled={isFetchingNextPage}
                                    className="btn-secondary text-sm px-8 py-3 rounded-xl"
                                >
                                    {isFetchingNextPage ? <Loader className="w-5 h-5 animate-spin" /> : 'Load More Reviews'}
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    !isWritingReview && (
                        <div className="text-center py-16 bg-dark-100/50 rounded-2xl border border-gray-800 border-dashed">
                            <p className="text-gray-400 mb-4">No reviews for this anime yet.</p>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
