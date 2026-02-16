import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { jwtDecode } from 'jwt-decode';
import { authApi } from '../api/client';
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

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchUserStats = useCallback(async () => {
        try {
            const response = await authApi.getStats();
            return response.data;
        } catch (error) {
            return null;
        }
    }, []);

    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem('access_token');
        
        if (token && !isTokenExpired(token)) {
            // INSTANT: Decode token to get user info without API call
            const decodedUser = decodeToken(token);
            if (decodedUser) {
                
                // If we have username from token, show it immediately
                if (!decodedUser._needsApiFetch) {
                    setUser(decodedUser);
                    setLoading(false); // Stop loading immediately!
                } else {
                    // Old token - need to fetch username, but set user anyway to avoid blank state
                    setUser({ ...decodedUser, username: 'Loading...' });
                    setLoading(false);
                }
                
                // BACKGROUND: Get lightweight profile (fast, no expensive stats)
                try {
                    const response = await authApi.getProfile(false); // lightweight (default)
                    setUser(response.data);
                    
                    // BACKGROUND: Fetch expensive stats asynchronously (don't block UI)
                    fetchUserStats().then(stats => {
                        if (stats) {
                            setUser(prev => ({ ...prev, ...stats }));
                        }
                    });
                } catch (error) {
                    // Don't remove tokens - keep using decoded data
                }
                return;
            }
        }
        
        // No token or invalid token
        if (token && isTokenExpired(token)) {
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
        }
        
        setLoading(false);
    }, [fetchUserStats]);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    const login = useCallback(async (username, password) => {
        const response = await authApi.login({ username, password });
        const { access, refresh } = response.data;

        localStorage.setItem('access_token', access);
        localStorage.setItem('refresh_token', refresh);

        // Decode token instantly for immediate UI update
        const decodedUser = decodeToken(access);
        if (decodedUser) {
            setUser(decodedUser);
        }

        // Fetch lightweight profile (fast)
        const profileResponse = await authApi.getProfile(false);
        setUser(profileResponse.data);

        // Fetch stats asynchronously in background
        fetchUserStats().then(stats => {
            if (stats) {
                setUser(prev => ({ ...prev, ...stats }));
            }
        });

        return profileResponse.data;
    }, [fetchUserStats]);

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
            return userData;
        }

        const profileResponse = await authApi.getProfile();
        setUser(profileResponse.data);

        return profileResponse.data;
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
