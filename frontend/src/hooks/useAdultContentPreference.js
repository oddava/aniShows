import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { authApi } from '../api/client';
import { animeKeys } from '../api/queries/anime';
import { profileKeys } from '../api/queries/profile';
import { useAuth } from '../context/AuthContext';

/**
 * The signed-in user's "show adult content" preference (G1 contract, overview section 5).
 *
 * Returns `{ enabled, toggle, isUpdating }`. `toggle()` PATCHes the profile, refreshes
 * AuthContext, drops every cached anime query (plus any `alsoRemove` keys, e.g.
 * Schedule's `scheduleKeys.all`) and invalidates the profile keys.
 *
 * Prep-commit stub: the same steps as the handlers in Browse.jsx and Schedule.jsx today.
 * Nothing uses it yet; G2 switches those pages to it. G1 owns it.
 */
export default function useAdultContentPreference({ alsoRemove = [] } = {}) {
    const queryClient = useQueryClient();
    const { isAuthenticated, user, refreshProfile } = useAuth();
    const enabled = Boolean(user?.show_adult_content);
    const [isUpdating, setIsUpdating] = useState(false);
    const alsoRemoveRef = useRef(alsoRemove);
    alsoRemoveRef.current = alsoRemove;

    const toggle = useCallback(async () => {
        if (!isAuthenticated || isUpdating) return;

        setIsUpdating(true);
        try {
            const response = await authApi.updateProfile({ show_adult_content: !enabled });
            const updatedProfile = response?.data;
            if (updatedProfile && typeof updatedProfile === 'object') {
                await refreshProfile(updatedProfile);
                queryClient.setQueryData(profileKeys.own, updatedProfile);
            } else {
                await refreshProfile();
            }
            alsoRemoveRef.current.forEach((queryKey) => queryClient.removeQueries({ queryKey }));
            queryClient.removeQueries({ queryKey: animeKeys.all });
            queryClient.invalidateQueries({ queryKey: profileKeys.own });
            queryClient.invalidateQueries({ queryKey: profileKeys.all });
        } finally {
            setIsUpdating(false);
        }
    }, [enabled, isAuthenticated, isUpdating, queryClient, refreshProfile]);

    return { enabled, toggle, isUpdating };
}
