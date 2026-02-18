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

const API_BASE_URL = '/api/v1';

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

    const refreshAccessToken = useCallback(async () => {
        try {
            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
                throw new Error('No refresh token available');
            }

            // Check if refresh token itself is expired
            try {
                const decoded = jwtDecode(refreshToken);
                const currentTime = Date.now() / 1000;
                if (decoded.exp < currentTime) {
                    throw new Error('Refresh token expired');
                }
            } catch (decodeError) {
                throw new Error('Invalid refresh token');
            }

            // Use axios directly to avoid interceptors
            const axios = (await import('axios')).default;
            const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
                refresh: refreshToken,
            });

            const { access, refresh } = response.data;
            localStorage.setItem('access_token', access);
            
            // Update refresh token if rotated
            if (refresh) {
                localStorage.setItem('refresh_token', refresh);
                logger.debug('Refresh token rotated and updated');
            }
            
            logger.info('Token refresh successful on app load');
            return access;
        } catch (error) {
            logger.error('Token refresh failed on app load:', error.message);
            throw error;
        }
    }, []);

    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem('access_token');
        const refreshToken = localStorage.getItem('refresh_token');
        
        if (token && !isTokenExpired(token)) {
            // Token is valid - proceed as before
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
                    logger.warn('Failed to fetch profile during checkAuth:', error.message);
                }
                return;
            }
        }
        
        // Token is expired or missing, but we have a refresh token - try to refresh
        if (refreshToken) {
            try {
                logger.info('Access token expired or missing, attempting refresh...');
                const newAccessToken = await refreshAccessToken();
                
                // Decode and set user from new token
                const decodedUser = decodeToken(newAccessToken);
                if (decodedUser) {
                    if (!decodedUser._needsApiFetch) {
                        setUser(decodedUser);
                        setLoading(false);
                    } else {
                        setUser({ ...decodedUser, username: 'Loading...' });
                        setLoading(false);
                    }
                    
                    // Fetch profile in background
                    try {
                        const response = await authApi.getProfile(false);
                        setUser(response.data);
                        
                        fetchUserStats().then(stats => {
                            if (stats) {
                                setUser(prev => ({ ...prev, ...stats }));
                            }
                        });
                    } catch (error) {
                        logger.warn('Failed to fetch profile after token refresh:', error.message);
                    }
                }
                return;
            } catch (refreshError) {
                logger.error('Refresh failed, clearing tokens:', refreshError.message);
                // Refresh failed - clear tokens and log user out
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
            }
        }
        
        // No token or invalid token
        if (token && isTokenExpired(token) && !refreshToken) {
            localStorage.removeItem('access_token');
        }
        
        setLoading(false);
    }, [fetchUserStats, refreshAccessToken]);

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

    const refreshProfile = useCallback(async () => {
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
        setTokens,
        refreshProfile,
        isAuthenticated: !!user,
    }), [user, loading, login, register, logout, setTokens, refreshProfile]);

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
