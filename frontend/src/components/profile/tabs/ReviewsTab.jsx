// Profile "Reviews" tab body (G5 Community). Rendered by the ProfileContent shell (G1).
import React from 'react';
import { MessageSquare } from 'lucide-react';
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
            <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!reviews || reviews.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-dark-100/30 rounded-3xl border border-gray-800 border-dashed">
                <MessageSquare className="w-12 h-12 text-gray-700 mb-4" />
                <p className="text-gray-400 text-lg font-medium">
                    {isPublicView ? "No reviews yet." : "You haven't written any reviews yet."}
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
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
                <div className="text-center mt-8">
                    <button
                        onClick={() => fetchNextReviews()}
                        disabled={isFetchingNextReviews}
                        className="btn-secondary text-sm px-6 py-2"
                    >
                        {isFetchingNextReviews ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            'Load More Reviews'
                        )}
                    </button>
                </div>
            )}
        </div>
    );
}
