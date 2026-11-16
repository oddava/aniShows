// Query keys and options owned by G5 Community (feature-revamp seams).
import { queryOptions } from '@tanstack/react-query';

import { reviewApi } from '../client';
import { getApiErrorMessage } from '../errors';

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

export const reviewKeys = {
    all: ['reviews'],
    byUser: (username) => ['reviews', username],
    forAnime: (slug, sort, rating) => ['reviews', slug, sort, rating],
    // Outside the ['reviews'] prefix: invalidate it explicitly after a review write.
    stats: (slug) => ['reviewStats', slug],
};

export const reviewQueries = {
    stats: (slug) => queryOptions({
        queryKey: reviewKeys.stats(slug),
        queryFn: () => reviewApi.getStats(slug).then((res) => res.data),
    }),
};

/** Same copy as the forum mutations (components/forums/useThreadMutations.js). */
const REVIEW_THROTTLED_MESSAGE = 'You are doing that too fast. Please wait a moment.';

/** Toast text for a failed review write: throttle copy on 429, else the envelope's `detail`. */
export const getReviewErrorMessage = (error, fallback) => (
    error?.response?.status === 429 && error?.response?.data?.code !== 'report_limit'
        ? REVIEW_THROTTLED_MESSAGE
        : getApiErrorMessage(error, fallback)
);

export const REVIEW_REPORT_REASONS = [
    { value: 'spoiler', label: 'Unmarked spoilers' },
    { value: 'spam', label: 'Spam' },
    { value: 'harassment', label: 'Harassment' },
    { value: 'hate_speech', label: 'Hate speech' },
    { value: 'misinformation', label: 'Misinformation' },
    { value: 'off_topic', label: 'Off topic' },
    { value: 'other', label: 'Other' },
];

const patchReviewList = (list, reviewId, patch) => {
    let changed = false;
    const next = list.map((review) => {
        if (review?.id !== reviewId) return review;
        changed = true;
        return { ...review, ...(typeof patch === 'function' ? patch(review) : patch) };
    });
    return changed ? next : list;
};

const patchReviewPage = (page, reviewId, patch) => {
    if (Array.isArray(page)) return patchReviewList(page, reviewId, patch);
    if (page && Array.isArray(page.results)) {
        const results = patchReviewList(page.results, reviewId, patch);
        return results === page.results ? page : { ...page, results };
    }
    return page;
};

/**
 * Patches one review inside every cached review list under ['reviews', ...]
 * (infinite `{pages}` data, plain pages or arrays) without refetching. `patch`
 * is an object of fields or `(review) => fields`. Caches that don't hold the
 * review keep their reference, so nothing else re-renders.
 */
export const patchCachedReview = (queryClient, reviewId, patch) => {
    queryClient.setQueriesData({ queryKey: reviewKeys.all }, (data) => {
        if (!data) return data;
        if (Array.isArray(data.pages)) {
            let changed = false;
            const pages = data.pages.map((page) => {
                const nextPage = patchReviewPage(page, reviewId, patch);
                if (nextPage !== page) changed = true;
                return nextPage;
            });
            return changed ? { ...data, pages } : data;
        }
        return patchReviewPage(data, reviewId, patch);
    });
};

/** The review after toggling `voteType` (one vote per user: same type clears, the other switches). */
export const applyReviewVote = (review, voteType) => {
    const current = review.user_votes || { helpful: false, dislike: false };
    const other = voteType === 'helpful' ? 'dislike' : 'helpful';
    const countKey = (type) => (type === 'helpful' ? 'helpful_count' : 'dislike_count');
    const wasActive = Boolean(current[voteType]);
    const fields = {
        user_votes: { ...current, [voteType]: !wasActive, [other]: false },
        [countKey(voteType)]: Math.max(0, (review[countKey(voteType)] || 0) + (wasActive ? -1 : 1)),
    };
    if (current[other]) {
        fields[countKey(other)] = Math.max(0, (review[countKey(other)] || 0) - 1);
    }
    return fields;
};

/** The review's `reactions` after toggling `reactionType` (each type toggles on its own). */
export const applyReviewReaction = (reactions, reactionType) => reactions.map((reaction) => {
    if (reaction.type !== reactionType) return reaction;
    const active = !reaction.active;
    return { ...reaction, active, count: Math.max(0, (reaction.count || 0) + (active ? 1 : -1)) };
});

/** The fresh fields a vote/reaction response carries (contract: additive), or null for an older backend. */
export const pickReviewCounts = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    const fields = {};
    if (typeof payload.helpful_count === 'number') fields.helpful_count = payload.helpful_count;
    if (typeof payload.dislike_count === 'number') fields.dislike_count = payload.dislike_count;
    if (payload.user_votes && typeof payload.user_votes === 'object') fields.user_votes = payload.user_votes;
    if (Array.isArray(payload.reactions)) fields.reactions = payload.reactions;
    return Object.keys(fields).length > 0 ? fields : null;
};
