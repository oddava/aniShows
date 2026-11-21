import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../ui/toast';

export const SIGNED_OUT_MESSAGE = 'Signed out.';

/**
 * The user-facing "Sign out": ends the session (AuthContext.logout, which also
 * detaches push and clears every cached query), then lands on home with one
 * toast. Every sign-out button should call this, not `logout` directly;
 * flows that sign out as a side effect (email change, account deletion) keep
 * calling `logout` and show their own message.
 */
export default function useSignOut() {
    const { logout } = useAuth();
    const navigate = useNavigate();

    return useCallback(async () => {
        await logout();
        navigate('/');
        notify(SIGNED_OUT_MESSAGE, { id: 'signed-out' });
    }, [logout, navigate]);
}
