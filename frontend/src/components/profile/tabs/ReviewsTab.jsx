// Profile "Reviews" tab body (G5 Community). Rendered by the ProfileContent shell (G1).
import React from 'react';
import ReviewCard from '../../ReviewCard';
import ProfileErrorBoundary, { ErrorVariant } from '../ProfileErrorBoundary';

export default function ReviewsContent({
    reviewsData,
    reviewsLoading,
    isFetchingNextReviews,
    hasNextReviews,
    fetchNextReviews,
    isPublicView,
}) {
    const reviews = reviewsData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

    if (reviewsLoading) {
        return (
            <p className="py-12 text-[15px] text-[var(--text-3)]">Loading…</p>
        );
    }

    if (!reviews || reviews.length === 0) {
        return (
            <p className=" pt-6 text-[17px] text-[var(--text-2)]">
                {isPublicView ? 'No reviews yet.' : 'No reviews yet. Write one from any show’s page.'}
            </p>
        );
    }

    return (
        <div className="max-w-3xl space-y-6">
            <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Reviews">
                <div className="space-y-6">
                    {reviews.map((review) => (
                        <div key={review.id} className="relative">
                            <ReviewCard review={review} showAnime={true} />
                        </div>
                    ))}
                </div>
            </ProfileErrorBoundary>

            {hasNextReviews && (
                <div className="mt-8">
                    <button
                        type="button"
                        onClick={() => fetchNextReviews()}
                        disabled={isFetchingNextReviews}
                        className="btn-secondary px-5 text-[15px]"
                    >
                        {isFetchingNextReviews ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
        </div>
    );
}
