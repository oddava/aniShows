import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { Palette } from 'lucide-react';

export default function ThemeSwitcher() {
    const { theme, setTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    const themes = [
        { id: 'default', name: 'Default Dark' },
        { id: 'retro-crt', name: 'Retro CRT' },
        { id: 'retro-anime', name: 'Pastel Anime' },
    ];

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
                className="p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                title="Switch Theme"
            >
                <Palette className="w-5 h-5" />
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 py-2 bg-dark-100/95 backdrop-blur-xl border border-gray-700/50 rounded-xl shadow-xl shadow-black/20 z-50 animate-fade-in">
                    <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800 mb-1">
                        Select Theme
                    </div>
                    {themes.map((t) => {
                        const isActive = theme === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => {
                                    setTheme(t.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${isActive
                                        ? 'bg-accent/10 text-accent font-medium'
                                        : 'text-gray-300 hover:bg-dark-50 hover:text-white'
                                    }`}
                            >
                                {t.name}
                                {isActive && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
