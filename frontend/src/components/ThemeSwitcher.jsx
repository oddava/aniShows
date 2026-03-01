import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { Palette, Monitor, Laptop, Sparkles } from 'lucide-react';

export default function ThemeSwitcher() {
    const { theme, setTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    const themes = [
        { id: 'default', name: 'Default Dark', icon: Monitor },
        { id: 'retro-crt', name: 'Retro CRT', icon: Laptop },
        { id: 'retro-anime', name: 'Pastel Anime', icon: Sparkles },
    ];

    const currentThemeInfo = themes.find(t => t.id === theme) || themes[0];
    const Icon = currentThemeInfo.icon;

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent rounded-full border border-accent/20 transition-all text-sm font-medium"
                title="Switch Theme"
            >
                <Palette className="w-4 h-4" />
                <span className="hidden md:inline">Theme</span>
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 py-2 bg-dark-100/95 backdrop-blur-xl border border-gray-700/50 rounded-xl shadow-xl shadow-black/20 z-50 animate-fade-in">
                    <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800 mb-1">
                        Select Theme
                    </div>
                    {themes.map((t) => {
                        const ThemeIcon = t.icon;
                        const isActive = theme === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => {
                                    setTheme(t.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isActive
                                        ? 'bg-accent/10 text-accent font-medium'
                                        : 'text-gray-300 hover:bg-dark-50 hover:text-white'
                                    }`}
                            >
                                <ThemeIcon className="w-4 h-4" />
                                {t.name}
                                {isActive && (
                                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
