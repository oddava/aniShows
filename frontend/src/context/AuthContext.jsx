import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { jwtDecode } from 'jwt-decode';
import { authApi } from '../api/client';

const AuthContext = createContext(null);

// Decode JWT token to get user info instantly without API call
const decodeToken = (token) => {
    try {
        const decoded = jwtDecode(token);
        return {
            id: decoded.user_id,
            username: decoded.username,
            email: decoded.email,
            // Set defaults for fields not in token
            avatar: null,
            bio: '',
            is_private: false,
            email_verified: true, // Assume verified if token exists
        };
    } catch (error) {
        console.error("AuthContext: Failed to decode token:", error);
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

    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem('access_token');
        console.log("AuthContext: checkAuth running. Token present:", !!token);
        
        if (token && !isTokenExpired(token)) {
            // INSTANT: Decode token to get user info without API call
            const decodedUser = decodeToken(token);
            if (decodedUser) {
                console.log("AuthContext: Token decoded instantly. User:", decodedUser.username);
                setUser(decodedUser);
                setLoading(false); // Stop loading immediately!
                
                // BACKGROUND: Verify token and get lightweight profile (fast, no expensive calculations)
                try {
                    const response = await authApi.getProfile(true); // lightweight=true
                    console.log("AuthContext: Profile verified. User:", response.data.username);
                    setUser(response.data);
                } catch (error) {
                    console.error("AuthContext: Profile verification failed:", error);
                    // Don't remove tokens on verification failure - token might still be valid
                    // Just keep the decoded user info
                }
                return;
            }
        }
        
        // No token or invalid token
        if (token && isTokenExpired(token)) {
            console.log("AuthContext: Token expired, clearing storage");
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
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

        const profileResponse = await authApi.getProfile();
        setUser(profileResponse.data);

        return profileResponse.data;
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
        console.log("AuthContext: setTokens called. HasUserData:", !!userData);
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
