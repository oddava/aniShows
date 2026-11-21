import { Loader } from 'lucide-react';
import ReviewCard from '../ReviewCard';
import ReviewForm from '../ReviewForm';
import ReviewSummary from '../ReviewSummary';
import CustomSelect from '../common/CustomSelect';

/** The reviews block under the tabs. `reviews` is the state from useAnimeReviews. */
export default function ReviewsSection({ anime, reviews, isAuthenticated, accentColor }) {
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

    const hasReviews = allReviews.length > 0 || Boolean(ratingFilter);

    return (
        <section className="panel mt-4 mb-16" aria-labelledby="reviews-heading">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <h2 id="reviews-heading" className="section-title">
                    Reviews
                    {reviewCount > 0 && (
                        <span className="ml-2 text-[15px] font-normal text-[var(--text-3)] tabular">{reviewCount}</span>
                    )}
                </h2>
                <div className="flex items-center gap-3">
                    {hasReviews && (
                        <CustomSelect
                            value={reviewSort}
                            onChange={(nextValue) => setReviewSort(nextValue)}
                            options={[
                                { value: 'helpful', label: 'Most helpful' },
                                { value: 'newest', label: 'Newest' },
                                { value: 'highest', label: 'Highest rated' },
                                { value: 'lowest', label: 'Lowest rated' },
                            ]}
                            triggerClassName="min-h-11 rounded-[var(--radius-sm)] bg-transparent px-3 py-2 text-sm text-[var(--text-2)]"
                            menuClassName="z-[320]"
                            ariaLabel="Sort reviews"
                        />
                    )}

                    {isAuthenticated && !isWritingReview && !editingReview && !userReview && (
                        canReview ? (
                            <button
                                type="button"
                                onClick={() => setIsWritingReview(true)}
                                className="btn-primary text-[15px]"
                            >
                                Write a review
                            </button>
                        ) : hasReviews ? (
                            <p className="text-sm text-[var(--text-2)]">Add it to your list to write a review</p>
                        ) : null
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
                    <div className="py-12">
                        <Loader className="w-8 h-8 text-[var(--text-3)] animate-spin mx-auto" aria-label="Loading reviews" />
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
                                <p className="mb-4 text-sm text-[var(--text-2)]">
                                    Rating-only reviews <span className="tabular text-[var(--text-3)]">{ratingOnlyReviews.length}</span>
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
                                    className="btn-secondary text-[15px]"
                                >
                                    {isFetchingNextPage ? <Loader className="w-5 h-5 animate-spin" /> : 'Load more reviews'}
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    !isWritingReview && (
                        <p className="text-[15px] text-[var(--text-2)]">
                            {isAuthenticated && !userReview && !canReview
                                ? 'No reviews yet. Add it to your list to write the first one.'
                                : 'No reviews yet.'}
                        </p>
                    )
                )}
            </div>
        </section>
    );
}
