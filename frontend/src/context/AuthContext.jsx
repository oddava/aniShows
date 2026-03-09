import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { jwtDecode } from 'jwt-decode';
import { authApi, refreshAccessToken } from '../api/client';
import logger from '../utils/logger';

const AuthContext = createContext(null);

// Decode JWT token to get user info instantly without API call
const decodeToken = (token) => {
    try {
        const decoded = jwtDecode(token);

        // Handle both old tokens (only user_id) and new tokens (with username/email)
        // For old tokens without username, we'll need to fetch from API
        if (!decoded.username && !decoded.email) {
            return {
                id: decoded.user_id,
                username: null, // Will be populated by API call
                email: null,
                avatar: null,
                bio: '',
                is_private: false,
                email_verified: true,
                _needsApiFetch: true, // Flag to indicate we need API data
            };
        }

        return {
            id: decoded.user_id,
            username: decoded.username || 'User', // Fallback if somehow missing
            email: decoded.email || '',
            avatar: null,
            bio: '',
            is_private: false,
            email_verified: true,
            _needsApiFetch: false,
        };
    } catch (error) {
        return null;
    }
};

// Check if token is expired
const isTokenExpired = (token) => {
    try {
        const decoded = jwtDecode(token);
        const currentTime = Date.now() / 1000;
        return decoded.exp < currentTime;
    } catch {
        return true;
    }
};

// Check if token will expire soon (within 5 minutes)
const willExpireSoon = (token) => {
    try {
        const decoded = jwtDecode(token);
        const currentTime = Date.now() / 1000;
        const timeUntilExpiry = decoded.exp - currentTime;
        return timeUntilExpiry > 0 && timeUntilExpiry < 300; // 5 minutes = 300 seconds
    } catch {
        return true;
    }
};

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem('access_token');
        const refreshToken = localStorage.getItem('refresh_token');

        if (token && !isTokenExpired(token)) {
            try {
                // Fetch full profile to get admin status
                const response = await authApi.getProfile();
                setUser(response.data);
                setLoading(false);
                return;
            } catch (error) {
                logger.warn('Failed to fetch profile with valid token, trying refresh:', error.message);
                // Fall through to refresh logic if profile fetch fails
            }
        }

        // Token is expired or missing, but we have a refresh token - try to refresh
        if (refreshToken) {
            try {
                logger.info('Access token expired or missing, attempting refresh...');
                const newAccessToken = await refreshAccessToken();
                logger.info('Token refresh successful on app load');

                // Fetch full profile after refresh
                const response = await authApi.getProfile();
                setUser(response.data);
                setLoading(false);
                return;
            } catch (refreshError) {
                const errorMessage = refreshError?.message || '';
                const isAuthFailure =
                    refreshError?.response?.status === 401 ||
                    errorMessage.includes('expired') ||
                    errorMessage.includes('Invalid refresh token') ||
                    errorMessage.includes('No refresh token');

                if (isAuthFailure) {
                    logger.error('Refresh failed due to invalid auth state, clearing tokens:', errorMessage);
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');
                } else {
                    logger.warn('Refresh failed due to temporary error, keeping tokens for retry:', errorMessage);
                }
            }
        }

        // No token or invalid token
        if (token && isTokenExpired(token) && !refreshToken) {
            localStorage.removeItem('access_token');
        }

        setLoading(false);
    }, []);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    const login = useCallback(async (username, password) => {
        const response = await authApi.login({ username, password });
        const { access, refresh } = response.data;

        localStorage.setItem('access_token', access);
        localStorage.setItem('refresh_token', refresh);

        // Fetch full profile immediately after login to get admin status
        try {
            const profileResponse = await authApi.getProfile();
            setUser(profileResponse.data);
            return profileResponse.data;
        } catch (error) {
            // Fallback to token decode if profile fetch fails
            const decodedUser = decodeToken(access);
            if (decodedUser) {
                setUser(decodedUser);
            }
            return decodedUser;
        }
    }, []);

    const register = useCallback(async (username, email, password) => {
        const response = await authApi.register({
            username,
            email,
            password,
            password_confirm: password
        });

        return response.data;
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setUser(null);
    }, []);

    const setTokens = useCallback(async (access, refresh, userData = null) => {
        localStorage.setItem('access_token', access);
        localStorage.setItem('refresh_token', refresh);

        if (userData) {
            setUser(userData);
        } else {
            // If no user data provided, decode it from token
            const decodedUser = decodeToken(access);
            if (decodedUser) {
                setUser(decodedUser);
            }
        }
    }, []);

    const value = useMemo(() => ({
        user,
        loading,
        login,
        register,
        logout,
        setTokens,
        isAuthenticated: !!user,
    }), [user, loading, login, register, logout, setTokens]);

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
