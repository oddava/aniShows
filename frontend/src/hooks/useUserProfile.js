import { useQuery } from '@tanstack/react-query';
import { authApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * Hook to manage user profile data with TanStack Query.
 * Fetches the current user's full profile including statistics.
 * 
 * @returns {Object} The query result from useQuery
 */
export function useUserProfile() {
    const { user, isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['user', 'profile', user?.id],
        queryFn: async () => {
            const response = await authApi.getProfile(true); // Fetch full profile with stats
            return response.data;
        },
        enabled: isAuthenticated && !!user?.id,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
        refetchOnWindowFocus: false,
    });
}

export default useUserProfile;
