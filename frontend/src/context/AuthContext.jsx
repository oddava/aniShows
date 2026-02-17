import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { jwtDecode } from 'jwt-decode';
import { authApi } from '../api/client';
import logger from '../utils/logger';

const AuthContext = createContext(null);

// Cache keys
const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const PROFILE_CACHE_KEY = 'anishows_profile_cache';
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Decode JWT token to get user info instantly without API call
const decodeToken = (token) => {
    try {
        const decoded = jwtDecode(token);
        
        // Handle both old tokens (only user_id) and new tokens (with username/email)
        if (!decoded.username && !decoded.email) {
            return {
                id: decoded.user_id,
                username: null,
                email: null,
                avatar: null,
                bio: '',
                is_private: false,
                email_verified: true,
                _needsApiFetch: true,
            };
        }
        
        return {
            id: decoded.user_id,
            username: decoded.username || 'User',
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

// Get cached profile from localStorage
const getCachedProfile = () => {
    try {
        const cached = localStorage.getItem(PROFILE_CACHE_KEY);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;
        
        // Return cached data if not expired
        if (age < PROFILE_CACHE_TTL) {
            return { ...data, _cached: true, _cacheAge: age };
        }
        
        return null;
    } catch {
        return null;
    }
};

// Save profile to localStorage cache
const cacheProfile = (data) => {
    try {
        const cacheData = {
            data,
            timestamp: Date.now(),
        };
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
        logger.warn('Failed to cache profile:', error);
    }
};

// Clear profile cache
const clearProfileCache = () => {
    try {
        localStorage.removeItem(PROFILE_CACHE_KEY);
    } catch (error) {
        logger.warn('Failed to clear profile cache:', error);
    }
};

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isFetchingProfile, setIsFetchingProfile] = useState(false);

    const fetchUserStats = useCallback(async () => {
        try {
            const response = await authApi.getStats();
            return response.data;
        } catch (error) {
            logger.warn('Failed to fetch user stats:', error);
            return null;
        }
    }, []);

    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        
        if (token && !isTokenExpired(token)) {
            // INSTANT: Decode token to get user info without API call
            const decodedUser = decodeToken(token);
            
            if (decodedUser) {
                // Try to get cached profile first
                const cachedProfile = getCachedProfile();
                
                if (cachedProfile && !cachedProfile._needsApiFetch) {
                    // Use cached data immediately for instant UI
                    const { _cached, _cacheAge, ...profileData } = cachedProfile;
                    setUser({ ...decodedUser, ...profileData });
                    setLoading(false);
                    
                    // Refresh cache in background if it's getting old (> 1 minute)
                    if (_cacheAge > 60000 && !isFetchingProfile) {
                        setIsFetchingProfile(true);
                        try {
                            const response = await authApi.getProfile(false);
                            const freshData = response.data;
                            setUser(freshData);
                            cacheProfile(freshData);
                        } catch (error) {
                            logger.warn('Background profile refresh failed:', error);
                        } finally {
                            setIsFetchingProfile(false);
                        }
                    }
                    
                    // Fetch stats asynchronously
                    fetchUserStats().then(stats => {
                        if (stats) {
                            setUser(prev => ({ ...prev, ...stats }));
                        }
                    });
                    
                    return;
                }
                
                // No valid cache, show decoded data immediately
                if (!decodedUser._needsApiFetch) {
                    setUser(decodedUser);
                } else {
                    setUser({ ...decodedUser, username: 'Loading...' });
                }
                setLoading(false);
                
                // Fetch profile in background
                setIsFetchingProfile(true);
                try {
                    const response = await authApi.getProfile(false);
                    const profileData = response.data;
                    setUser(profileData);
                    cacheProfile(profileData);
                    
                    // Fetch stats asynchronously
                    fetchUserStats().then(stats => {
                        if (stats) {
                            setUser(prev => ({ ...prev, ...stats }));
                        }
                    });
                } catch (error) {
                    logger.error('Failed to fetch profile:', error);
                    // Keep using decoded data
                } finally {
                    setIsFetchingProfile(false);
                }
                
                return;
            }
        }
        
        // No token or invalid token
        if (token && isTokenExpired(token)) {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(REFRESH_TOKEN_KEY);
            clearProfileCache();
        }
        
        setLoading(false);
    }, [fetchUserStats, isFetchingProfile]);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    const login = useCallback(async (username, password) => {
        const response = await authApi.login({ username, password });
        const { access, refresh } = response.data;

        localStorage.setItem(TOKEN_KEY, access);
        localStorage.setItem(REFRESH_TOKEN_KEY, refresh);

        // Decode token instantly for immediate UI update
        const decodedUser = decodeToken(access);
        if (decodedUser) {
            setUser(decodedUser);
        }

        // Fetch profile and cache it
        const profileResponse = await authApi.getProfile(false);
        const profileData = profileResponse.data;
        setUser(profileData);
        cacheProfile(profileData);

        // Fetch stats asynchronously in background
        fetchUserStats().then(stats => {
            if (stats) {
                setUser(prev => ({ ...prev, ...stats }));
            }
        });

        return profileData;
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
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        clearProfileCache();
        setUser(null);
    }, []);

    const setTokens = useCallback(async (access, refresh, userData = null) => {
        localStorage.setItem(TOKEN_KEY, access);
        localStorage.setItem(REFRESH_TOKEN_KEY, refresh);

        if (userData) {
            setUser(userData);
            cacheProfile(userData);
            return userData;
        }

        try {
            const profileResponse = await authApi.getProfile();
            const profileData = profileResponse.data;
            setUser(profileData);
            cacheProfile(profileData);
            return profileData;
        } catch (error) {
            logger.error('Failed to fetch profile after token set:', error);
            throw error;
        }
    }, []);

    // Refresh user profile manually (e.g., after profile update)
    const refreshProfile = useCallback(async () => {
        try {
            // Clear cache first to ensure fresh data
            clearProfileCache();
            const response = await authApi.getProfile(false);
            const profileData = response.data;
            setUser(profileData);
            cacheProfile(profileData);
            return profileData;
        } catch (error) {
            logger.error('Failed to refresh profile:', error);
            throw error;
        }
    }, []);

    const value = useMemo(() => ({
        user,
        loading,
        isFetchingProfile,
        login,
        register,
        logout,
        setTokens,
        refreshProfile,
        isAuthenticated: !!user,
    }), [user, loading, isFetchingProfile, login, register, logout, setTokens, refreshProfile]);

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
