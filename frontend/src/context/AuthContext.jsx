import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { authApi } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem('access_token');
        console.log("AuthContext: checkAuth running. Token present:", !!token);
        if (token) {
            try {
                const response = await authApi.getProfile();
                console.log("AuthContext: checkAuth success. User:", response.data.username);
                setUser(response.data);
            } catch (error) {
                console.error("AuthContext: checkAuth failed:", error);
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
            }
        }
        setLoading(false);
    }, []);

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
