import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { jwtDecode } from 'jwt-decode';
import {
    AUTH_EXPIRED_EVENT,
    SESSION_HINT_KEY,
    authApi,
    clearSession,
    hasSession,
    isAuthFailureError,
    refreshAccessToken,
    setAccessToken,
} from '../api/client';
import {
    clearStoredTimeZonePreference,
    syncStoredTimeZonePreference,
} from '../utils/dateUtils';
import logger from '../utils/logger';

const AuthContext = createContext(null);

// Last-resort user when /users/me/ can't be reached right after sign-in.
// The token carries only id and username; role flags (is_staff/is_superuser)
// are never read from it, so admin UI stays hidden until the profile loads.
const userFromToken = (token) => {
    try {
        const decoded = jwtDecode(token);
        return {
            id: decoded.user_id,
            username: decoded.username || null,
            email: '',
            avatar: null,
            bio: '',
            is_private: false,
            email_verified: true,
            preferred_timezone: 'auto',
            is_staff: false,
            is_superuser: false,
        };
    } catch {
        return null;
    }
};

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadProfileFor = useCallback(async (access) => {
        try {
            const response = await authApi.getProfile();
            setUser(response.data);
            return response.data;
        } catch (error) {
            if (isAuthFailureError(error)) throw error;
            logger.warn('Profile fetch failed, using minimal user from token:', error.message);
            const fallbackUser = userFromToken(access);
            setUser(fallbackUser);
            return fallbackUser;
        }
    }, []);

    // The access token lives in memory only, so every page load starts by
    // trading the httpOnly refresh cookie for a new one.
    const checkAuth = useCallback(async () => {
        if (!hasSession()) {
            setLoading(false);
            return;
        }

        try {
            const access = await refreshAccessToken();
            await loadProfileFor(access);
        } catch (error) {
            if (!isAuthFailureError(error)) {
                logger.warn('Could not restore session, will retry on next load:', error.message);
            }
        } finally {
            setLoading(false);
        }
    }, [loadProfileFor]);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    // Sign out locally when a refresh fails, or when another tab logs out.
    useEffect(() => {
        const handleExpired = () => setUser(null);
        const handleStorage = (event) => {
            if (event.key === SESSION_HINT_KEY && !event.newValue) {
                clearSession();
                setUser(null);
            }
        };

        window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
        window.addEventListener('storage', handleStorage);
        return () => {
            window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    useEffect(() => {
        if (user) {
            syncStoredTimeZonePreference(user.preferred_timezone);
            return;
        }

        clearStoredTimeZonePreference();
    }, [user]);

    /**
     * Start a session from an access token returned by a login-style endpoint
     * (the refresh token arrived as an httpOnly cookie on the same response).
     */
    const startSession = useCallback(async (access, userData = null) => {
        setAccessToken(access);

        if (userData) {
            setUser(userData);
            return userData;
        }
        return loadProfileFor(access);
    }, [loadProfileFor]);

    const login = useCallback(async (username, password) => {
        const response = await authApi.login({ username, password });
        return startSession(response.data.access);
    }, [startSession]);

    const register = useCallback(async (username, email, password) => {
        const response = await authApi.register({
            username,
            email,
            password,
            password_confirm: password
        });

        return response.data;
    }, []);

    const logout = useCallback(async () => {
        try {
            // Blacklists the refresh token and clears its cookie.
            await authApi.logout();
        } catch (error) {
            logger.warn('Logout request failed, clearing local session anyway:', error.message);
        }
        clearSession();
        clearStoredTimeZonePreference();
        setUser(null);
    }, []);

    const refreshProfile = useCallback(async (profileData = null) => {
        if (profileData && typeof profileData === 'object') {
            setUser(profileData);
            return profileData;
        }

        try {
            const response = await authApi.getProfile();
            setUser(response.data);
            return response.data;
        } catch (error) {
            logger.error('Failed to refresh profile:', error);
            throw error;
        }
    }, []);

    const value = useMemo(() => ({
        user,
        loading,
        login,
        register,
        logout,
        startSession,
        refreshProfile,
        isAuthenticated: !!user,
    }), [user, loading, login, register, logout, startSession, refreshProfile]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
