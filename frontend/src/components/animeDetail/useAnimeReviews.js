import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { reviewApi } from '../../api/client';
import { favoriteKeys, profileKeys, reviewKeys, reviewQueries } from '../../api/queries/user';

/**
 * The reviews block of the anime detail page: sort and rating filter, the
 * paged review list and stats, the write/edit form state and the
 * create/update/delete mutations. Called from AnimeDetail before its loading
 * return so the reviews load alongside the anime.
 */
export default function useAnimeReviews({ slug, anime, user, isAuthenticated, queryClient, animeDetailQueryKey }) {
    const [isWritingReview, setIsWritingReview] = useState(false);
    const [editingReview, setEditingReview] = useState(null);
    const [reviewSort, setReviewSort] = useState('helpful');
    const [ratingFilter, setRatingFilter] = useState(null);
    const [hideSpoilersGlobal, setHideSpoilersGlobal] = useState(false);

    const { data: reviewsData, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading: reviewsLoading } = useInfiniteQuery({
        queryKey: reviewKeys.forAnime(slug, reviewSort, ratingFilter),
        queryFn: ({ pageParam }) => reviewApi.getAll({
            anime: slug,
            page: pageParam,
            sort: reviewSort,
            rating: ratingFilter
        }).then(res => res.data),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage?.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch { return undefined; }
            }
            return undefined;
        },
        enabled: !!slug
    });

    const { data: reviewStats } = useQuery({
        ...reviewQueries.stats(slug),
        enabled: !!slug
    });

    const allReviews = useMemo(() =>
        reviewsData?.pages.flatMap(page => Array.isArray(page) ? page : (page.results || [])) || [],
        [reviewsData]
    );

    const { textReviews, ratingOnlyReviews, reviewCount } = useMemo(() => ({
        textReviews: allReviews.filter(r => r.text?.trim().length > 0),
        ratingOnlyReviews: allReviews.filter(r => !r.text?.trim()),
        reviewCount: reviewsData?.pages[0]?.count ?? anime?.review_count ?? allReviews.length
    }), [allReviews, reviewsData, anime]);

    const userReview = useMemo(() =>
        anime?.user_review || allReviews.find(r => r.user?.username === user?.username),
        [anime, allReviews, user]
    );

    const canReview = isAuthenticated && anime?.user_list_status != null;

    const createReviewMutation = useMutation({
        mutationFn: (data) => reviewApi.create({ ...data, anime_slug: slug }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: reviewKeys.all });
            queryClient.invalidateQueries({ queryKey: animeDetailQueryKey });
            queryClient.invalidateQueries({ queryKey: profileKeys.own });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: profileKeys.byUsername(user.username) });
            }
            setIsWritingReview(false);
        },
    });

    const updateReviewMutation = useMutation({
        mutationFn: ({ id, data }) => reviewApi.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: reviewKeys.all });
            queryClient.invalidateQueries({ queryKey: animeDetailQueryKey });
            setEditingReview(null);
        },
    });

    const deleteReviewMutation = useMutation({
        mutationFn: (id) => reviewApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: reviewKeys.all });
            queryClient.invalidateQueries({ queryKey: animeDetailQueryKey });
            queryClient.invalidateQueries({ queryKey: profileKeys.own });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: profileKeys.byUsername(user.username) });
                queryClient.invalidateQueries({ queryKey: favoriteKeys.byUser(user.username) });
                queryClient.invalidateQueries({ queryKey: favoriteKeys.overview(user.username) });
            }
        },
    });

    const handleReviewSubmit = useCallback(async (data) => {
        if (editingReview) {
            await updateReviewMutation.mutateAsync({ id: editingReview.id, data });
        } else {
            await createReviewMutation.mutateAsync(data);
        }
    }, [editingReview, updateReviewMutation, createReviewMutation]);

    return {
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
    };
}
