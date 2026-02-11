import { useState, useEffect } from 'react';
import { followApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function useFriendsWatching(animeId) {
    const [friends, setFriends] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { isAuthenticated, user } = useAuth();

    useEffect(() => {
        const fetchFriendsWatching = async () => {
            // Don't fetch if not authenticated or no animeId
            if (!animeId || !isAuthenticated) {
                setFriends([]);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const response = await followApi.getFriendsWatching(animeId);
                setFriends(response.data || []);
                setError(null);
            } catch (err) {
                setError(err);
                setFriends([]);
            } finally {
                setLoading(false);
            }
        };

        fetchFriendsWatching();
    }, [animeId, isAuthenticated, user?.id]);

    return { friends, loading, error };
}