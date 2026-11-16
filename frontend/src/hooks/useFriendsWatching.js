import { useQuery } from '@tanstack/react-query';
import { socialQueries } from '../api/queries/social';
import { useAuth } from '../context/AuthContext';

const EMPTY = [];

/**
 * Mutual follows who have this anime on their list (cached per anime and
 * viewer for 60 s, shared by every mount, refreshed when a follow changes).
 *
 * `error` is set only when the request failed, so callers can tell it apart
 * from "no friends watching" (`friends` empty, `error` null).
 */
export function useFriendsWatching(animeId) {
    const { isAuthenticated, user } = useAuth();
    const viewerId = isAuthenticated ? (user?.id ?? null) : null;

    const options = socialQueries.friendsWatching(animeId, viewerId);
    const query = useQuery({
        ...options,
        enabled: viewerId !== null && options.enabled !== false,
    });

    return {
        friends: query.data?.results ?? EMPTY,
        total: query.data?.total ?? 0,
        loading: query.isLoading,
        error: query.error ?? null,
        refetch: query.refetch,
    };
}
