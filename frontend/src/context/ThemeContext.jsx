import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();
const SUPPORTED_THEMES = ['default'];

export function ThemeProvider({ children }) {
    const normalizeTheme = (value) => (SUPPORTED_THEMES.includes(value) ? value : 'default');

    // Get initial theme from localStorage or default to 'default'
    const [theme, setThemeState] = useState(() => {
        const savedTheme = localStorage.getItem('theme');
        return normalizeTheme(savedTheme || 'default');
    });

    const setTheme = (newTheme) => {
        const normalizedTheme = normalizeTheme(newTheme);
        setThemeState(normalizedTheme);
        localStorage.setItem('theme', normalizedTheme);
    };

    // Apply the theme to the document element
    useEffect(() => {
        const normalizedTheme = normalizeTheme(theme);
        document.documentElement.setAttribute('data-theme', normalizedTheme);
        if (normalizedTheme !== theme) {
            setThemeState(normalizedTheme);
            localStorage.setItem('theme', normalizedTheme);
        }
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
