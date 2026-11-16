import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { friendsWatchingKeys, socialQueries } from '../api/queries/social';
import { useAuth } from '../context/AuthContext';

const EMPTY = [];

/**
 * Mutual follows who have this anime on their list (cached per anime for
 * 60 s, shared by every mount, refreshed when a follow changes).
 *
 * `error` is set only when the request failed, so callers can tell it apart
 * from "no friends watching" (`friends` empty, `error` null).
 */
export function useFriendsWatching(animeId) {
    const { isAuthenticated, user } = useAuth();
    const queryClient = useQueryClient();
    const viewerId = isAuthenticated ? (user?.id ?? null) : null;
    const previousViewerId = useRef(viewerId);

    // The key is per anime, not per viewer: drop cached answers when the
    // signed-in account changes so one account never sees another's friends.
    useEffect(() => {
        if (previousViewerId.current !== viewerId) {
            previousViewerId.current = viewerId;
            queryClient.removeQueries({ queryKey: friendsWatchingKeys.all });
        }
    }, [viewerId, queryClient]);

    const options = socialQueries.friendsWatching(animeId);
    const query = useQuery({
        ...options,
        enabled: Boolean(isAuthenticated) && options.enabled !== false,
    });

    return {
        friends: query.data?.results ?? EMPTY,
        total: query.data?.total ?? 0,
        loading: query.isLoading,
        error: query.error ?? null,
        refetch: query.refetch,
    };
}
