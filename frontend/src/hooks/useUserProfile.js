import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { profileQueries } from '../api/queries/user';

/**
 * Hook to manage user profile data with TanStack Query.
 * Fetches the current user's full profile including statistics.
 * 
 * @returns {Object} The query result from useQuery
 */
export function useUserProfile() {
    const { user, isAuthenticated } = useAuth();

    return useQuery({
        ...profileQueries.own(),
        enabled: isAuthenticated && !!user?.id,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
        refetchOnWindowFocus: false,
    });
}

export default useUserProfile;
