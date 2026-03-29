import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Globe, Loader2, Link2 } from 'lucide-react';

// Platform icons as simple SVG components
const PlatformIcons = {
    twitter: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    ),
    youtube: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
    ),
    instagram: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
        </svg>
    ),
    github: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
    ),
    linkedin: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
    ),
    twitch: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h6.857V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
        </svg>
    ),
    discord: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    ),
    tiktok: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
        </svg>
    ),
    facebook: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
    ),
    reddit: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
        </svg>
    ),
    telegram: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
    ),
    website: (
        <Globe className="w-4 h-4" />
    ),
};

// Get platform icon
const getPlatformIcon = (platform) => {
    if (!platform) return PlatformIcons.website;
    return PlatformIcons[platform.toLowerCase()] || PlatformIcons.website;
};

// Detect platform from URL
const detectPlatform = (url) => {
    if (!url) return null;
    try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        const domain = urlObj.hostname.toLowerCase().replace('www.', '');

        const patterns = {
            twitter: ['x.com', 'twitter.com'],
            youtube: ['youtube.com', 'youtu.be'],
            instagram: ['instagram.com'],
            github: ['github.com'],
            linkedin: ['linkedin.com'],
            twitch: ['twitch.tv'],
            discord: ['discord.com', 'discord.gg'],
            tiktok: ['tiktok.com'],
            facebook: ['facebook.com', 'fb.com'],
            reddit: ['reddit.com', 'redd.it'],
            telegram: ['t.me', 'telegram.me'],
        };

        for (const [platform, domains] of Object.entries(patterns)) {
            for (const pattern of domains) {
                if (domain.includes(pattern)) return platform;
            }
        }
        return null;
    } catch {
        return null;
    }
};

// Basic URL validation
const isValidUrl = (url) => {
    if (!url) return false;
    try {
        const urlToCheck = url.startsWith('http') ? url : `https://${url}`;
        const urlObj = new URL(urlToCheck);
        return urlObj.protocol === 'https:' || urlObj.protocol === 'http:';
    } catch {
        return false;
    }
};

// Normalize username to URL based on platform
export const normalizeUrl = (platform, input) => {
    if (!input) return '';

    let value = input.trim();

    // If already a URL, return it
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return value;
    }

    // Remove @ prefix
    if (value.startsWith('@')) {
        value = value.slice(1);
    }

    const p = platform?.toLowerCase();
    const normalizeMap = {
        twitter: () => `https://x.com/${value}`,
        x: () => `https://x.com/${value}`,
        youtube: () => `https://youtube.com/@${value}`,
        instagram: () => `https://instagram.com/${value}`,
        github: () => `https://github.com/${value}`,
        twitch: () => `https://twitch.tv/${value}`,
        tiktok: () => `https://tiktok.com/@${value}`,
        linkedin: () => `https://linkedin.com/in/${value}`,
        telegram: () => `https://t.me/${value}`,
        reddit: () => `https://reddit.com/user/${value}`,
        facebook: () => `https://facebook.com/${value}`,
        discord: () => `https://discord.gg/${value}`,
    };

    if (normalizeMap[p]) {
        return normalizeMap[p]();
    }

    // Generic fallback
    if (value.includes('.') && !value.includes(' ')) {
        return `https://${value}`;
    }

    return value;
};

/**
 * Smart Link Input Component - Clean Version
 */
const SmartLinkInput = ({
    platform,
    value,
    onChange,
    onPlatformChange,
    placeholder = "Enter username or URL",
    disabled = false
}) => {
    const [localValue, setLocalValue] = useState(value || '');
    const [localPlatform, setLocalPlatform] = useState(platform || '');
    const [isValidating, setIsValidating] = useState(false);
    const [error, setError] = useState(null);

    // Update local values when props change
    useEffect(() => {
        setLocalValue(value || '');
    }, [value]);

    useEffect(() => {
        setLocalPlatform(platform || '');
    }, [platform]);

    // Simple validation
    useEffect(() => {
        if (!localValue) {
            setError(null);
            return;
        }

        const normalized = normalizeUrl(localPlatform, localValue);
        if (normalized && !isValidUrl(normalized)) {
            setError('Invalid URL format');
        } else {
            setError(null);
        }
    }, [localValue, localPlatform]);

    const handleValueChange = (e) => {
        const newValue = e.target.value;
        setLocalValue(newValue);

        // Smart paste: auto-convert t.me/user, x.com/user, etc.
        const trimmed = newValue.trim();

        if (trimmed.match(/^(t\.me|x\.com|github\.com|instagram\.com)\/\w+$/i)) {
            onChange(`https://${trimmed}`);
            // Auto-detect platform
            const detected = detectPlatform(`https://${trimmed}`);
            if (detected && !localPlatform) {
                onPlatformChange(detected.charAt(0).toUpperCase() + detected.slice(1));
            }
            return;
        }

        onChange(newValue);
    };

    const handlePlatformChange = (e) => {
        const newPlatform = e.target.value;
        setLocalPlatform(newPlatform);
        onPlatformChange(newPlatform);
    };

    const normalizedUrl = normalizeUrl(localPlatform, localValue);
    const detectedPlatform = detectPlatform(normalizedUrl) || localPlatform?.toLowerCase();
    const showPreview = normalizedUrl && isValidUrl(normalizedUrl);

    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
                {/* Platform Selector */}
                <div className="w-full sm:w-32 shrink-0">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                        Platform
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={localPlatform}
                            onChange={handlePlatformChange}
                            spellCheck="false"
                            autoComplete="off"
                            className="input py-2 text-sm w-full pl-9"
                            placeholder="Twitter"
                            disabled={disabled}
                        />
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500">
                            {getPlatformIcon(detectedPlatform)}
                        </div>
                    </div>
                </div>

                {/* URL Input */}
                <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                        Link
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={localValue}
                            onChange={handleValueChange}
                            spellCheck="false"
                            autoComplete="off"
                            className={`input py-2 text-sm w-full pr-10 ${error ? 'bg-red-500/[0.06]' : ''
                                }`}
                            placeholder={placeholder}
                            disabled={disabled}
                        />

                        {/* Validation icon */}
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            {isValidating ? (
                                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                            ) : error ? (
                                <AlertCircle className="w-4 h-4 text-red-400" />
                            ) : showPreview ? (
                                <Link2 className="w-4 h-4 text-green-400" />
                            ) : null}
                        </div>
                    </div>

                    {/* Error message */}
                    {error && (
                        <div className="flex items-center gap-1.5 mt-1.5 text-red-400 text-xs">
                            <AlertCircle className="w-3 h-3" />
                            <span>{error}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Preview */}
            {showPreview && (
                <div className="p-3 bg-dark-100 rounded-lg">
                    <div className="flex items-center gap-3">
                        <div className="shrink-0 text-gray-400">
                            {getPlatformIcon(detectedPlatform)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-300 truncate">
                                {normalizedUrl}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SmartLinkInput;
