import { useState, useCallback, useMemo } from 'react';

// Platform detection patterns
const PLATFORM_PATTERNS = {
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
    patreon: ['patreon.com'],
    telegram: ['t.me', 'telegram.me'],
    whatsapp: ['wa.me', 'whatsapp.com'],
    snapchat: ['snapchat.com'],
    pinterest: ['pinterest.com'],
    spotify: ['spotify.com'],
    soundcloud: ['soundcloud.com'],
    bandcamp: ['bandcamp.com'],
    deviantart: ['deviantart.com'],
    behance: ['behance.net'],
    dribbble: ['dribbble.com'],
    figma: ['figma.com'],
    notion: ['notion.so'],
    medium: ['medium.com'],
    substack: ['substack.com'],
    mastodon: ['mastodon.social', 'mstdn.jp', 'pawoo.net'],
    threads: ['threads.net'],
    bluesky: ['bsky.app', 'bsky.social'],
};

// URL shorteners to detect and warn about
const URL_SHORTENERS = [
    'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'buff.ly',
    'is.gd', 'short.link', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
    'rb.gy', 'short.io', 'bl.ink', 't2m.io', 'tiny.cc', 'tr.im',
];

// Dangerous schemes to block
const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:'];

// Trust levels
const TRUST_LEVELS = {
    VERIFIED: 'verified',
    COMMON: 'common',
    UNKNOWN: 'unknown',
    SUSPICIOUS: 'suspicious',
};

const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

/**
 * Hook for validating social links in real-time
 */
export const useLinkValidation = () => {
    const [validationResult, setValidationResult] = useState({
        isValid: false,
        isValidating: false,
        error: null,
        platform: null,
        trustLevel: null,
        normalizedUrl: null,
        metadata: null,
    });

    // Detect platform from domain
    const detectPlatform = useCallback((url) => {
        try {
            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            const domain = urlObj.hostname.toLowerCase().replace('www.', '');

            for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
                for (const pattern of patterns) {
                    if (domain.includes(pattern)) {
                        return platform;
                    }
                }
            }

            return null;
        } catch {
            return null;
        }
    }, []);

    // Normalize URL based on platform
    const normalizeUrl = useCallback((platform, input) => {
        if (!input) return null;

        let value = input.trim();

        // Check for dangerous schemes
        const lowerValue = value.toLowerCase();
        for (const scheme of DANGEROUS_SCHEMES) {
            if (lowerValue.startsWith(scheme)) {
                throw new Error(`Invalid URL scheme: ${scheme}`);
            }
        }

        // If already a URL, return it
        if (value.startsWith('http://') || value.startsWith('https://')) {
            return value;
        }

        // Remove @ prefix
        if (value.startsWith('@')) {
            value = value.slice(1);
        }

        // Platform-specific normalization
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
            patreon: () => `https://patreon.com/${value}`,
            'ko-fi': () => `https://ko-fi.com/${value}`,
            buymeacoffee: () => `https://buymeacoffee.com/${value}`,
            mastodon: () => {
                if (value.includes('@')) {
                    const parts = value.split('@');
                    if (parts.length === 3) {
                        return `https://${parts[2]}/@${parts[1]}`;
                    }
                }
                return `https://mastodon.social/@${value}`;
            },
            threads: () => `https://threads.net/@${value}`,
            bluesky: () => `https://bsky.app/profile/${value}`,
        };

        if (normalizeMap[p]) {
            return normalizeMap[p]();
        }

        // Generic fallback
        if (value.includes('.') && !value.includes(' ')) {
            return `https://${value}`;
        }

        return null;
    }, []);

    // Validate URL locally
    const validateUrl = useCallback((url) => {
        if (!url) {
            return { isValid: false, error: 'URL is required' };
        }

        try {
            // Add https if missing for parsing
            let urlToParse = url;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                urlToParse = `https://${url}`;
            }

            const urlObj = new URL(urlToParse);

            // Check HTTPS only
            if (urlObj.protocol !== 'https:') {
                return { isValid: false, error: 'Only HTTPS URLs are allowed' };
            }

            // Check for URL shorteners
            const domain = urlObj.hostname.toLowerCase().replace('www.', '');
            if (URL_SHORTENERS.some(shortener => domain.includes(shortener))) {
                return { 
                    isValid: false, 
                    error: 'URL shorteners are not allowed for security reasons',
                    trustLevel: TRUST_LEVELS.SUSPICIOUS
                };
            }

            // Check subdomain depth
            const parts = domain.split('.');
            const subdomainCount = parts.length - 2; // Remove domain and TLD
            if (subdomainCount > 3) {
                return { 
                    isValid: false, 
                    error: `Too many subdomains (${subdomainCount}). Maximum allowed: 3`,
                    trustLevel: TRUST_LEVELS.SUSPICIOUS
                };
            }

            // Check for IP address
            const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
            if (ipv4Pattern.test(domain)) {
                return { 
                    isValid: false, 
                    error: 'IP addresses are not allowed',
                    trustLevel: TRUST_LEVELS.SUSPICIOUS
                };
            }

            // Check for punycode (potential homograph attack)
            if (domain.startsWith('xn--') || urlObj.hostname.startsWith('xn--')) {
                return { 
                    isValid: false, 
                    error: 'Punycode domains are not allowed',
                    trustLevel: TRUST_LEVELS.SUSPICIOUS
                };
            }

            return { isValid: true };
        } catch (error) {
            return { isValid: false, error: 'Invalid URL format' };
        }
    }, []);

    // Determine trust level
    const determineTrustLevel = useCallback((platform, url) => {
        if (!platform) return TRUST_LEVELS.UNKNOWN;

        const verifiedPlatforms = [
            'twitter', 'youtube', 'instagram', 'github', 'linkedin',
            'twitch', 'discord', 'tiktok', 'facebook', 'reddit',
            'telegram', 'whatsapp', 'pinterest', 'spotify',
            'soundcloud', 'mastodon', 'threads', 'bluesky'
        ];

        if (verifiedPlatforms.includes(platform.toLowerCase())) {
            return TRUST_LEVELS.VERIFIED;
        }

        const commonPlatforms = [
            'patreon', 'ko-fi', 'buymeacoffee', 'deviantart',
            'behance', 'dribbble', 'figma', 'notion', 'medium',
            'substack', 'bandcamp'
        ];

        if (commonPlatforms.includes(platform.toLowerCase())) {
            return TRUST_LEVELS.COMMON;
        }

        return TRUST_LEVELS.UNKNOWN;
    }, []);

    // Main validation function
    const validate = useMemo(
        () => debounce((platform, value) => {
            if (!value) {
                setValidationResult({
                    isValid: false,
                    isValidating: false,
                    error: null,
                    platform: null,
                    trustLevel: null,
                    normalizedUrl: null,
                    metadata: null,
                });
                return;
            }

            setValidationResult(prev => ({ ...prev, isValidating: true, error: null }));

            try {
                // Normalize URL
                const normalizedUrl = normalizeUrl(platform, value);
                
                if (!normalizedUrl) {
                    setValidationResult({
                        isValid: false,
                        isValidating: false,
                        error: 'Could not normalize URL',
                        platform: null,
                        trustLevel: null,
                        normalizedUrl: null,
                        metadata: null,
                    });
                    return;
                }

                // Validate URL
                const validation = validateUrl(normalizedUrl);
                
                if (!validation.isValid) {
                    setValidationResult({
                        isValid: false,
                        isValidating: false,
                        error: validation.error,
                        platform: detectPlatform(normalizedUrl),
                        trustLevel: validation.trustLevel || TRUST_LEVELS.SUSPICIOUS,
                        normalizedUrl,
                        metadata: null,
                    });
                    return;
                }

                // Detect platform
                const detectedPlatform = detectPlatform(normalizedUrl);
                const trustLevel = determineTrustLevel(detectedPlatform, normalizedUrl);

                setValidationResult({
                    isValid: true,
                    isValidating: false,
                    error: null,
                    platform: detectedPlatform || platform?.toLowerCase() || 'website',
                    trustLevel,
                    normalizedUrl,
                    metadata: null,
                });
            } catch (error) {
                setValidationResult({
                    isValid: false,
                    isValidating: false,
                    error: error.message,
                    platform: null,
                    trustLevel: TRUST_LEVELS.SUSPICIOUS,
                    normalizedUrl: null,
                    metadata: null,
                });
            }
        }, 300),
        [normalizeUrl, validateUrl, detectPlatform, determineTrustLevel]
    );

    return {
        ...validationResult,
        validate,
        TRUST_LEVELS,
    };
};

export default useLinkValidation;
